-- =============================================================================
-- Vira-7 · 0006 · Funções atômicas de partidas
-- =============================================================================
-- A API calcula a jogada (regras em Python) e grava o resultado aqui, em uma
-- única transação. A versão da partida garante que duas jogadas simultâneas
-- nunca sejam aplicadas sobre o mesmo estado: a segunda é recusada.

-- Insere os eventos recebidos como array JSON: [{seq, type, payload, state}, ...]
create or replace function public.vira7_insert_events(p_game uuid, p_room uuid, p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.game_events (game_id, room_id, seq, type, payload, state)
  select p_game, p_room, (e ->> 'seq')::integer, e ->> 'type',
         coalesce(e -> 'payload', '{}'::jsonb), e -> 'state'
  from jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) as e
  order by (e ->> 'seq')::integer;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Iniciar a partida
-- ---------------------------------------------------------------------------
-- Retorna o id da partida, ou NULL se a sala não está mais no lobby ou se a
-- lista de participantes mudou desde que a API a leu (a API tenta de novo).
create or replace function public.vira7_start_game(
  p_room uuid,
  p_player_ids uuid[],
  p_public jsonb,
  p_secret jsonb,
  p_events jsonb,
  p_awaiting uuid,
  p_deadline timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_current uuid[];
  v_game uuid;
begin
  select * into v_room from public.rooms where id = p_room for update;
  if not found or v_room.status <> 'lobby' then
    return null;
  end if;

  select coalesce(array_agg(rp.id order by rp.seat), '{}') into v_current
  from public.room_players rp
  where rp.room_id = p_room and rp.status = 'joined';
  if v_current <> p_player_ids then
    return null;
  end if;

  insert into public.games (room_id, target_score, turn_seconds, round, last_seq,
                            public_state, awaiting_user_id, turn_deadline)
  values (p_room, v_room.target_score, v_room.turn_seconds,
          coalesce((p_public ->> 'round')::integer, 1),
          coalesce((p_public ->> 'seq')::integer, 0),
          p_public, p_awaiting, p_deadline)
  returning id into v_game;

  insert into public.game_secrets (game_id, state) values (v_game, p_secret);
  perform public.vira7_insert_events(v_game, p_room, p_events);

  update public.rooms set status = 'playing', current_game_id = v_game where id = p_room;
  return v_game;
end;
$$;

-- ---------------------------------------------------------------------------
-- Gravar o resultado de uma jogada
-- ---------------------------------------------------------------------------
-- Retorna FALSE se a versão não confere (outra jogada chegou antes): nada é gravado.
create or replace function public.vira7_commit_game(
  p_game uuid,
  p_expected_version integer,
  p_public jsonb,
  p_secret jsonb,
  p_events jsonb,
  p_awaiting uuid,
  p_deadline timestamptz,
  p_status text,
  p_results jsonb,
  p_winner uuid,
  p_winner_name text,
  p_finish_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room uuid;
  v_has_humans boolean;
begin
  update public.games set
    version          = version + 1,
    public_state     = p_public,
    round            = coalesce((p_public ->> 'round')::integer, round),
    last_seq         = coalesce((p_public ->> 'seq')::integer, last_seq),
    awaiting_user_id = p_awaiting,
    turn_deadline    = p_deadline,
    status           = p_status,
    winner_user_id   = p_winner,
    winner_name      = p_winner_name,
    finish_reason    = p_finish_reason,
    finished_at      = case when p_status = 'playing' then null else now() end
  where id = p_game and version = p_expected_version and status = 'playing'
  returning room_id into v_room;

  if not found then
    return false;
  end if;

  update public.game_secrets set state = p_secret, updated_at = now() where game_id = p_game;
  perform public.vira7_insert_events(p_game, v_room, p_events);

  if p_status <> 'playing' then
    -- Placar final (dispara a atualização das estatísticas).
    insert into public.game_results (game_id, user_id, seat, name, is_bot, score, placement,
                                     is_winner, forfeited, rounds_played, best_round, flip7_count, busts)
    select p_game,
           nullif(r ->> 'userId', '')::uuid,
           (r ->> 'seat')::smallint,
           r ->> 'name',
           coalesce((r ->> 'isBot')::boolean, false),
           (r ->> 'score')::integer,
           (r ->> 'placement')::smallint,
           coalesce((r ->> 'isWinner')::boolean, false),
           coalesce((r ->> 'forfeited')::boolean, false),
           coalesce((r ->> 'roundsPlayed')::integer, 0),
           coalesce((r ->> 'bestRound')::integer, 0),
           coalesce((r ->> 'flip7Count')::integer, 0),
           coalesce((r ->> 'busts')::integer, 0)
    from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) as r;

    -- A sala volta para o lobby (para uma revanche) ou fecha se não sobrou ninguém.
    select exists (
      select 1 from public.room_players rp
      where rp.room_id = v_room and rp.status = 'joined' and not rp.is_bot
    ) into v_has_humans;

    update public.room_players set is_ready = is_bot
      where room_id = v_room and status = 'joined';
    update public.rooms
      set status = case when v_has_humans then 'lobby' else 'closed' end,
          current_game_id = null
      where id = v_room and status = 'playing';
  end if;

  return true;
end;
$$;
