-- =============================================================================
-- Vira-7 · 0009 · Equipes, amigos e espectadores
-- =============================================================================
-- * rooms.team_mode: partida em duplas (os pontos de cada dupla são somados).
-- * friendships: pedidos de amizade e amigos.
-- * room_spectators: quem entra numa sala cheia (ou em andamento) e só assiste.
--   Vira jogador quando a sala volta ao lobby e há assento livre.
-- Escritas passam pela API (service role); o cliente só lê o que lhe diz respeito.

alter table public.rooms
  add column if not exists team_mode boolean not null default false;

comment on column public.rooms.team_mode is 'true = partida em duplas (assentos opostos formam uma dupla).';

-- ---------------------------------------------------------------------------
-- Amigos
-- ---------------------------------------------------------------------------
create table if not exists public.friendships (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references public.profiles (id) on delete cascade,
  addressee_id  uuid not null references public.profiles (id) on delete cascade,
  status        text not null default 'pending',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint friendships_status_valid check (status in ('pending', 'accepted')),
  constraint friendships_not_self check (requester_id <> addressee_id)
);

comment on table public.friendships is 'Pedidos de amizade (pending) e amizades (accepted). Uma linha por par de pessoas.';

-- Um par de pessoas só pode ter uma linha, independentemente de quem pediu.
create unique index if not exists friendships_pair_key
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friendships_requester_idx on public.friendships (requester_id);
create index if not exists friendships_addressee_idx on public.friendships (addressee_id);

drop trigger if exists friendships_set_updated_at on public.friendships;
create trigger friendships_set_updated_at
  before update on public.friendships
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Espectadores
-- ---------------------------------------------------------------------------
create table if not exists public.room_spectators (
  room_id    uuid not null references public.rooms (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  joined_at  timestamptz not null default now(),
  primary key (room_id, user_id)
);

comment on table public.room_spectators is 'Quem assiste a uma sala sem jogar. Uma pessoa assiste a uma sala por vez.';

create unique index if not exists room_spectators_one_room_key on public.room_spectators (user_id);

-- Espectadores também enxergam a sala e a partida (para o tempo real).
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
  ) or exists (
    select 1
    from public.room_spectators rs
    where rs.room_id = p_room
      and rs.user_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- Segurança
-- ---------------------------------------------------------------------------
alter table public.friendships     enable row level security;
alter table public.room_spectators enable row level security;

revoke all on public.friendships, public.room_spectators from anon, authenticated;
grant all on public.friendships, public.room_spectators to service_role;
grant select on public.friendships to authenticated;

drop policy if exists friendships_select_own on public.friendships;
create policy friendships_select_own on public.friendships
  for select to authenticated
  using ((select auth.uid()) in (requester_id, addressee_id));

-- room_spectators: RLS ligado e nenhuma política = só o servidor acessa.
