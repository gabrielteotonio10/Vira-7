-- =============================================================================
-- Vira-7 · 0002 · Salas, participantes e presença
-- =============================================================================

create table if not exists public.rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null,
  name             text not null,
  host_id          uuid not null references public.profiles (id) on delete cascade,
  visibility       text not null default 'private',
  mode             text not null default 'custom',
  status           text not null default 'lobby',
  max_players      smallint not null default 4,
  target_score     smallint not null default 200,
  turn_seconds     smallint not null default 30,
  current_game_id  uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint rooms_code_format check (code ~ '^[A-Z2-9]{6}$'),
  constraint rooms_name_length check (char_length(name) between 1 and 40),
  constraint rooms_visibility_valid check (visibility in ('public', 'private')),
  constraint rooms_mode_valid check (mode in ('quick', 'custom')),
  constraint rooms_status_valid check (status in ('lobby', 'playing', 'closed')),
  constraint rooms_max_players_range check (max_players between 2 and 8),
  constraint rooms_target_score_valid check (target_score in (50, 100, 150, 200, 300, 500)),
  constraint rooms_turn_seconds_valid check (turn_seconds in (0, 15, 30, 45, 60, 90))
);

comment on table public.rooms is 'Salas de jogo. Privadas entram por código; públicas aparecem na lista.';
comment on column public.rooms.mode is 'quick = partida rápida (começa quando todos estão prontos); custom = o anfitrião inicia.';

create unique index if not exists rooms_code_key on public.rooms (code);
-- Lista de salas públicas abertas.
create index if not exists rooms_public_lobby_idx
  on public.rooms (created_at desc)
  where visibility = 'public' and status = 'lobby';
create index if not exists rooms_host_idx on public.rooms (host_id);

drop trigger if exists rooms_set_updated_at on public.rooms;
create trigger rooms_set_updated_at
  before update on public.rooms
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Participantes (pessoas e CPUs)
-- ---------------------------------------------------------------------------
create table if not exists public.room_players (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms (id) on delete cascade,
  user_id     uuid references public.profiles (id) on delete cascade,
  is_bot      boolean not null default false,
  bot_name    text,
  bot_avatar  text,
  seat        smallint not null,
  is_ready    boolean not null default false,
  status      text not null default 'joined',
  joined_at   timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint room_players_status_valid check (status in ('joined', 'left')),
  constraint room_players_seat_range check (seat between 0 and 7),
  -- Ou é uma pessoa (user_id) ou é uma CPU (nome próprio).
  constraint room_players_kind check (
    (is_bot and user_id is null and bot_name is not null)
    or (not is_bot and user_id is not null)
  )
);

comment on table public.room_players is 'Quem está em cada sala. status = left mantém o histórico sem ocupar o assento.';

-- Um assento por participante ativo.
create unique index if not exists room_players_seat_key
  on public.room_players (room_id, seat) where status = 'joined';
-- Uma linha por pessoa em cada sala (reentrar reaproveita a linha).
create unique index if not exists room_players_room_user_key
  on public.room_players (room_id, user_id) where user_id is not null;
-- Uma pessoa só pode estar em UMA sala por vez: evita partidas duplicadas.
create unique index if not exists room_players_one_active_room_key
  on public.room_players (user_id) where status = 'joined' and user_id is not null;
create index if not exists room_players_room_idx on public.room_players (room_id) where status = 'joined';

drop trigger if exists room_players_set_updated_at on public.room_players;
create trigger room_players_set_updated_at
  before update on public.room_players
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Presença (batimento enviado pelo cliente a cada poucos segundos)
-- ---------------------------------------------------------------------------
-- Fica em tabela separada e FORA do Realtime, para os batimentos não gerarem
-- uma enxurrada de notificações para a sala.
create table if not exists public.player_presence (
  room_id       uuid not null references public.rooms (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  last_seen_at  timestamptz not null default now(),
  primary key (room_id, user_id)
);

comment on table public.player_presence is 'Último sinal de vida de cada jogador na sala; usado para tratar desconexões.';

-- ---------------------------------------------------------------------------
-- Código de convite
-- ---------------------------------------------------------------------------
-- Seis caracteres sem letras/números que se confundem (0/O, 1/I/L).
create or replace function public.generate_room_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text := '';
begin
  for i in 1..6 loop
    v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
  end loop;
  return v_code;
end;
$$;
