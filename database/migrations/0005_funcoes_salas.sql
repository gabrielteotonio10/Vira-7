-- =============================================================================
-- Vira-7 · 0005 · Funções atômicas de salas (chamadas pela API com a service role)
-- =============================================================================
-- Cada função roda em uma única transação e trava a linha da sala, então duas
-- requisições simultâneas nunca ocupam o mesmo assento nem estouram a lotação.
-- Erros de regra usam mensagens em MAIÚSCULAS que a API traduz para o usuário.

-- O usuário autenticado participa desta sala? (usada pelas políticas de RLS)
create or replace function public.is_room_member(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.room_players rp
    where rp.room_id = p_room
      and rp.user_id = (select auth.uid())
      and rp.status = 'joined'
  );
$$;

-- Menor assento livre da sala.
create or replace function public.vira7_free_seat(p_room uuid, p_max smallint)
returns smallint
language sql
stable
set search_path = ''
as $$
  select s::smallint
  from generate_series(0, p_max - 1) as s
  where not exists (
    select 1 from public.room_players rp
    where rp.room_id = p_room and rp.status = 'joined' and rp.seat = s
  )
  order by s
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Criar sala (o criador entra como anfitrião no assento 0)
-- ---------------------------------------------------------------------------
create or replace function public.vira7_create_room(
  p_host uuid,
  p_name text,
  p_visibility text,
  p_mode text,
  p_max_players integer,
  p_target_score integer,
  p_turn_seconds integer
)
returns public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_attempt integer := 0;
begin
  if exists (select 1 from public.room_players where user_id = p_host and status = 'joined') then
    raise exception 'ALREADY_IN_ROOM';
  end if;

  loop
    v_attempt := v_attempt + 1;
    begin
      insert into public.rooms (code, name, host_id, visibility, mode, max_players, target_score, turn_seconds)
      values (public.generate_room_code(), p_name, p_host, p_visibility, p_mode,
              p_max_players, p_target_score, p_turn_seconds)
      returning * into v_room;
      exit;
    exception when unique_violation then
      -- Código de convite repetido: tenta outro.
      if v_attempt >= 10 then raise; end if;
    end;
  end loop;

  insert into public.room_players (room_id, user_id, seat) values (v_room.id, p_host, 0);
  insert into public.player_presence (room_id, user_id) values (v_room.id, p_host)
  on conflict (room_id, user_id) do update set last_seen_at = now();
  return v_room;
end;
$$;

-- ---------------------------------------------------------------------------
-- Entrar em uma sala
-- ---------------------------------------------------------------------------
create or replace function public.vira7_join_room(p_room uuid, p_user uuid)
returns public.room_players
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_player public.room_players;
  v_seat smallint;
begin
  select * into v_room from public.rooms where id = p_room for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  select * into v_player from public.room_players where room_id = p_room and user_id = p_user;
  -- Já está na sala (reconexão): devolve a mesma linha.
  if found and v_player.status = 'joined' then
    return v_player;
  end if;

  if v_room.status <> 'lobby' then
    raise exception 'ROOM_NOT_OPEN';
  end if;
  if exists (select 1 from public.room_players where user_id = p_user and status = 'joined') then
    raise exception 'ALREADY_IN_ROOM';
  end if;

  v_seat := public.vira7_free_seat(p_room, v_room.max_players);
  if v_seat is null then
    raise exception 'ROOM_FULL';
  end if;

  if v_player.id is not null then
    update public.room_players
      set status = 'joined', seat = v_seat, is_ready = false, joined_at = now()
      where id = v_player.id
      returning * into v_player;
  else
    insert into public.room_players (room_id, user_id, seat)
    values (p_room, p_user, v_seat)
    returning * into v_player;
  end if;

  insert into public.player_presence (room_id, user_id) values (p_room, p_user)
  on conflict (room_id, user_id) do update set last_seen_at = now();
  -- Marca a sala como alterada (dispara o Realtime da lista pública).
  update public.rooms set updated_at = now() where id = p_room;
  return v_player;
end;
$$;

-- ---------------------------------------------------------------------------
-- Adicionar uma CPU (sempre pronta)
-- ---------------------------------------------------------------------------
create or replace function public.vira7_add_bot(p_room uuid, p_name text, p_avatar text)
returns public.room_players
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_player public.room_players;
  v_seat smallint;
begin
  select * into v_room from public.rooms where id = p_room for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.status <> 'lobby' then
    raise exception 'ROOM_NOT_OPEN';
  end if;

  v_seat := public.vira7_free_seat(p_room, v_room.max_players);
  if v_seat is null then
    raise exception 'ROOM_FULL';
  end if;

  insert into public.room_players (room_id, is_bot, bot_name, bot_avatar, seat, is_ready)
  values (p_room, true, p_name, p_avatar, v_seat, true)
  returning * into v_player;
  update public.rooms set updated_at = now() where id = p_room;
  return v_player;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sair da sala (ou ser removido pelo anfitrião)
-- ---------------------------------------------------------------------------
-- Se o anfitrião sai, a pessoa mais antiga assume. Sem pessoas, a sala fecha.
create or replace function public.vira7_leave_room(p_room uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_new_host uuid;
  v_closed boolean := false;
begin
  select * into v_room from public.rooms where id = p_room for update;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;

  update public.room_players
    set status = 'left', is_ready = false
    where room_id = p_room and user_id = p_user and status = 'joined';
  if not found then
    return jsonb_build_object('left', false, 'closed', v_room.status = 'closed', 'host_id', v_room.host_id);
  end if;

  delete from public.player_presence where room_id = p_room and user_id = p_user;

  select rp.user_id into v_new_host
  from public.room_players rp
  where rp.room_id = p_room and rp.status = 'joined' and not rp.is_bot
  order by rp.joined_at, rp.seat
  limit 1;

  if v_new_host is null then
    v_closed := true;
    update public.rooms set status = 'closed' where id = p_room;
    update public.room_players set status = 'left' where room_id = p_room and status = 'joined';
  elsif v_room.host_id = p_user then
    update public.rooms set host_id = v_new_host where id = p_room;
  else
    v_new_host := v_room.host_id;
    update public.rooms set updated_at = now() where id = p_room;
  end if;

  return jsonb_build_object('left', true, 'closed', v_closed, 'host_id', v_new_host);
end;
$$;
