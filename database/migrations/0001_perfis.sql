-- =============================================================================
-- Vira-7 · 0001 · Perfis, preferências e estatísticas dos jogadores
-- =============================================================================
-- Cada conta do Supabase Auth (auth.users) ganha automaticamente:
--   * um perfil público (nome de usuário e personagem);
--   * uma linha de preferências privadas;
--   * uma linha de estatísticas, atualizada somente pelo servidor.

-- Atualiza a coluna updated_at em qualquer UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Perfil público
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null,
  avatar      text not null default 'raposa',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  constraint profiles_avatar_valid check (
    avatar in ('raposa', 'panda', 'sapo', 'leao', 'gato', 'coelho', 'urso', 'pinguim', 'coruja', 'macaco')
  )
);

comment on table public.profiles is 'Perfil público de cada jogador (1:1 com auth.users).';

-- Nomes de usuário são únicos sem diferenciar maiúsculas de minúsculas.
create unique index if not exists profiles_username_lower_key on public.profiles (lower(username));

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Preferências privadas (áudio, animações, etc.)
-- ---------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  settings    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  constraint user_settings_is_object check (jsonb_typeof(settings) = 'object')
);

comment on table public.user_settings is 'Preferências pessoais; visíveis apenas para o próprio jogador.';

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
  before update on public.user_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Estatísticas acumuladas
-- ---------------------------------------------------------------------------
create table if not exists public.player_stats (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  games_played      integer not null default 0 check (games_played >= 0),
  wins              integer not null default 0 check (wins >= 0),
  losses            integer not null default 0 check (losses >= 0),
  total_points      bigint  not null default 0 check (total_points >= 0),
  best_game_score   integer not null default 0,
  best_round_score  integer not null default 0,
  rounds_played     integer not null default 0,
  flip7_count       integer not null default 0,
  busts             integer not null default 0,
  current_streak    integer not null default 0,
  best_streak       integer not null default 0,
  updated_at        timestamptz not null default now()
);

comment on table public.player_stats is 'Estatísticas de cada jogador. Só o servidor escreve (via trigger em game_results).';

create index if not exists player_stats_ranking_idx
  on public.player_stats (wins desc, total_points desc);

-- ---------------------------------------------------------------------------
-- Criação automática do perfil ao cadastrar
-- ---------------------------------------------------------------------------
-- O nome de usuário vem dos metadados do cadastro (options.data.username).
-- Se for inválido ou já existir, gera um nome livre no formato jogador_xxxxxx.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := coalesce(new.raw_user_meta_data ->> 'username', '');
  v_avatar   text := coalesce(new.raw_user_meta_data ->> 'avatar', 'raposa');
  v_attempt  integer := 0;
begin
  if v_username !~ '^[A-Za-z0-9_]{3,20}$'
     or exists (select 1 from public.profiles p where lower(p.username) = lower(v_username)) then
    loop
      v_attempt := v_attempt + 1;
      v_username := 'jogador_' || substr(md5(new.id::text || v_attempt::text), 1, 6);
      exit when not exists (select 1 from public.profiles p where lower(p.username) = lower(v_username));
    end loop;
  end if;

  if v_avatar not in ('raposa', 'panda', 'sapo', 'leao', 'gato', 'coelho', 'urso', 'pinguim', 'coruja', 'macaco') then
    v_avatar := 'raposa';
  end if;

  insert into public.profiles (id, username, avatar) values (new.id, v_username, v_avatar);
  insert into public.user_settings (user_id) values (new.id);
  insert into public.player_stats (user_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Contas criadas antes desta migration também recebem perfil.
insert into public.profiles (id, username)
select u.id, 'jogador_' || substr(md5(u.id::text), 1, 6)
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict do nothing;

insert into public.user_settings (user_id)
select p.id from public.profiles p
on conflict do nothing;

insert into public.player_stats (user_id)
select p.id from public.profiles p
on conflict do nothing;
