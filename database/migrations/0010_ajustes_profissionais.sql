-- =============================================================================
-- Vira-7 · 0010 · Ajustes: amigos nas salas, baralho, nível das CPUs, trocar lugares,
--                 limpeza de partidas antigas e espectadores ao vivo
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Salas: baralho e privacidade para amigos
-- ---------------------------------------------------------------------------
alter table public.rooms
  add column if not exists friends_join boolean not null default false,
  add column if not exists deck_version smallint not null default 2;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rooms_deck_version_valid') then
    alter table public.rooms add constraint rooms_deck_version_valid check (deck_version in (1, 2));
  end if;
end $$;

comment on column public.rooms.friends_join is 'true = amigos veem o código de uma sala privada e entram sem pedir.';
comment on column public.rooms.deck_version is '1 = baralho clássico (94 cartas, sem penalidades); 2 = com penalidades (99 cartas).';

-- ---------------------------------------------------------------------------
-- CPUs: nível (personalidade)
-- ---------------------------------------------------------------------------
alter table public.room_players
  add column if not exists bot_level text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'room_players_bot_level_valid') then
    alter table public.room_players
      add constraint room_players_bot_level_valid check (bot_level is null or bot_level in ('cautious', 'balanced', 'bold'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Trocar dois jogadores de lugar (define as duplas: assentos opostos)
-- ---------------------------------------------------------------------------
create or replace function public.vira7_swap_seats(p_room uuid, p_a uuid, p_b uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_a public.room_players;
  v_b public.room_players;
begin
  select * into v_room from public.rooms where id = p_room for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.status <> 'lobby' then
    raise exception 'ROOM_NOT_OPEN';
  end if;

  select * into v_a from public.room_players where id = p_a and room_id = p_room and status = 'joined';
  select * into v_b from public.room_players where id = p_b and room_id = p_room and status = 'joined';
  if v_a.id is null or v_b.id is null then
    raise exception 'PLAYER_NOT_FOUND';
  end if;

  -- O índice de assento só vale para quem está "joined": tira um da mesa, troca e devolve.
  update public.room_players set status = 'left' where id = v_a.id;
  update public.room_players set seat = v_a.seat where id = v_b.id;
  update public.room_players set seat = v_b.seat, status = 'joined' where id = v_a.id;
  update public.rooms set updated_at = now() where id = p_room;

  return jsonb_build_object('a', v_a.id, 'b', v_b.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Limpeza: eventos e segredos de partidas terminadas há mais de N dias.
-- O resultado (game_results) e o resumo (games) ficam para sempre.
-- ---------------------------------------------------------------------------
create index if not exists games_finished_idx
  on public.games (finished_at) where status <> 'playing';

create or replace function public.vira7_prune_games(p_days integer default 7)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_events bigint;
  v_secrets bigint;
begin
  with old_games as (
    select id from public.games
    where status <> 'playing'
      and finished_at is not null
      and finished_at < now() - make_interval(days => greatest(p_days, 1))
  ), gone as (
    delete from public.game_events where game_id in (select id from old_games) returning 1
  )
  select count(*) into v_events from gone;

  with old_games as (
    select id from public.games
    where status <> 'playing'
      and finished_at is not null
      and finished_at < now() - make_interval(days => greatest(p_days, 1))
  ), gone as (
    delete from public.game_secrets where game_id in (select id from old_games) returning 1
  )
  select count(*) into v_secrets from gone;

  return jsonb_build_object('events', v_events, 'secrets', v_secrets);
end;
$$;

-- ---------------------------------------------------------------------------
-- Espectadores ao vivo: quem está na sala enxerga (e recebe pelo Realtime) a lista
-- ---------------------------------------------------------------------------
grant select on public.room_spectators to authenticated;

drop policy if exists room_spectators_select_member on public.room_spectators;
create policy room_spectators_select_member on public.room_spectators
  for select to authenticated
  using (public.is_room_member(room_id));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_spectators'
     ) then
    alter publication supabase_realtime add table public.room_spectators;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Permissões das funções novas: só o servidor
-- ---------------------------------------------------------------------------
revoke execute on function
  public.vira7_swap_seats(uuid, uuid, uuid),
  public.vira7_prune_games(integer)
  from public, anon, authenticated;

grant execute on function
  public.vira7_swap_seats(uuid, uuid, uuid),
  public.vira7_prune_games(integer)
  to service_role;
