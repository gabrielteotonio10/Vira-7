-- =============================================================================
-- Vira-7 · 0003 · Partidas, estado secreto, eventos e resultados
-- =============================================================================

create table if not exists public.games (
  id                uuid primary key default gen_random_uuid(),
  room_id           uuid not null references public.rooms (id) on delete cascade,
  status            text not null default 'playing',
  -- Controle de concorrência otimista: cada jogada aceita incrementa a versão.
  version           integer not null default 1,
  target_score      smallint not null,
  turn_seconds      smallint not null default 0,
  round             integer not null default 1,
  last_seq          integer not null default 0,
  -- Retrato PÚBLICO da mesa (cartas viradas, pontos, de quem é a vez).
  public_state      jsonb not null,
  awaiting_user_id  uuid references public.profiles (id) on delete set null,
  turn_deadline     timestamptz,
  winner_user_id    uuid references public.profiles (id) on delete set null,
  winner_name       text,
  finish_reason     text,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  constraint games_status_valid check (status in ('playing', 'finished', 'abandoned')),
  constraint games_finish_reason_valid check (
    finish_reason is null or finish_reason in ('score', 'forfeit', 'abandoned')
  )
);

comment on table public.games is 'Uma partida. O estado público é legível pelos participantes; o secreto não.';

-- No máximo UMA partida em andamento por sala.
create unique index if not exists games_one_playing_per_room_key
  on public.games (room_id) where status = 'playing';
create index if not exists games_room_idx on public.games (room_id, started_at desc);
-- Usado pelo árbitro do servidor para achar prazos vencidos.
create index if not exists games_playing_idx on public.games (turn_deadline) where status = 'playing';

alter table public.rooms
  drop constraint if exists rooms_current_game_fkey;
alter table public.rooms
  add constraint rooms_current_game_fkey
  foreign key (current_game_id) references public.games (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Estado secreto: semente do embaralhamento e decisões da rodada.
-- Nenhum cliente tem acesso (RLS sem políticas); só o servidor lê e escreve.
-- ---------------------------------------------------------------------------
create table if not exists public.game_secrets (
  game_id     uuid primary key references public.games (id) on delete cascade,
  state       jsonb not null,
  updated_at  timestamptz not null default now()
);

comment on table public.game_secrets is 'Estado privado da partida (ordem do monte). Inacessível aos clientes.';

-- ---------------------------------------------------------------------------
-- Eventos: o fluxo que os clientes recebem em tempo real e animam em ordem.
-- ---------------------------------------------------------------------------
create table if not exists public.game_events (
  id          bigint generated always as identity primary key,
  game_id     uuid not null references public.games (id) on delete cascade,
  room_id     uuid not null references public.rooms (id) on delete cascade,
  seq         integer not null,
  type        text not null,
  payload     jsonb not null default '{}'::jsonb,
  -- Retrato público da mesa DEPOIS do evento.
  state       jsonb not null,
  created_at  timestamptz not null default now(),
  constraint game_events_seq_positive check (seq > 0)
);

comment on table public.game_events is 'Eventos da partida em ordem (seq). Transmitidos pelo Supabase Realtime.';

-- A sequência é única por partida: impede eventos duplicados de jogadas simultâneas.
create unique index if not exists game_events_game_seq_key on public.game_events (game_id, seq);
create index if not exists game_events_room_idx on public.game_events (room_id);

-- ---------------------------------------------------------------------------
-- Resultado final por jogador (histórico de partidas)
-- ---------------------------------------------------------------------------
create table if not exists public.game_results (
  id             bigint generated always as identity primary key,
  game_id        uuid not null references public.games (id) on delete cascade,
  user_id        uuid references public.profiles (id) on delete set null,
  seat           smallint not null,
  name           text not null,
  is_bot         boolean not null default false,
  score          integer not null default 0,
  placement      smallint not null,
  is_winner      boolean not null default false,
  forfeited      boolean not null default false,
  rounds_played  integer not null default 0,
  best_round     integer not null default 0,
  flip7_count    integer not null default 0,
  busts          integer not null default 0,
  created_at     timestamptz not null default now()
);

comment on table public.game_results is 'Placar final de cada participante; alimenta histórico e estatísticas.';

create unique index if not exists game_results_game_seat_key on public.game_results (game_id, seat);
create index if not exists game_results_user_idx on public.game_results (user_id, created_at desc);
