-- =============================================================================
-- Vira-7 · 0007 · Segurança: Row Level Security, políticas e permissões
-- =============================================================================
-- Princípios:
--   * TODA escrita de jogo passa pela API (service role), que valida as regras.
--     Os clientes não têm permissão de INSERT/UPDATE/DELETE em salas e partidas.
--   * Os clientes só LEEM o que precisam para o tempo real, e só das salas em
--     que estão.
--   * O estado secreto da partida e a presença não têm política nenhuma:
--     ficam invisíveis para qualquer cliente.

alter table public.profiles        enable row level security;
alter table public.user_settings   enable row level security;
alter table public.player_stats    enable row level security;
alter table public.rooms           enable row level security;
alter table public.room_players    enable row level security;
alter table public.player_presence enable row level security;
alter table public.games           enable row level security;
alter table public.game_secrets    enable row level security;
alter table public.game_events     enable row level security;
alter table public.game_results    enable row level security;

-- ---------------------------------------------------------------------------
-- Permissões de tabela (as políticas abaixo refinam por linha)
-- ---------------------------------------------------------------------------
revoke all on public.profiles, public.user_settings, public.player_stats, public.rooms,
              public.room_players, public.player_presence, public.games, public.game_secrets,
              public.game_events, public.game_results
  from anon, authenticated;
revoke all on public.leaderboard from anon, authenticated;

grant all on public.profiles, public.user_settings, public.player_stats, public.rooms,
             public.room_players, public.player_presence, public.games, public.game_secrets,
             public.game_events, public.game_results
  to service_role;
grant select on public.leaderboard to service_role, authenticated;
grant usage, select on all sequences in schema public to service_role;

grant select on public.profiles, public.player_stats, public.rooms, public.room_players,
                public.games, public.game_events, public.game_results
  to authenticated;
-- O jogador só pode alterar o próprio nome de usuário e personagem.
grant update (username, avatar) on public.profiles to authenticated;
grant select, insert, update on public.user_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Perfis e estatísticas: públicos para quem está logado
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists player_stats_select_authenticated on public.player_stats;
create policy player_stats_select_authenticated on public.player_stats
  for select to authenticated using (true);

drop policy if exists game_results_select_authenticated on public.game_results;
create policy game_results_select_authenticated on public.game_results
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Preferências: só o dono
-- ---------------------------------------------------------------------------
drop policy if exists user_settings_select_own on public.user_settings;
create policy user_settings_select_own on public.user_settings
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists user_settings_insert_own on public.user_settings;
create policy user_settings_insert_own on public.user_settings
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists user_settings_update_own on public.user_settings;
create policy user_settings_update_own on public.user_settings
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Salas: públicas abertas aparecem para todos; privadas só para quem está nelas
-- ---------------------------------------------------------------------------
drop policy if exists rooms_select_public_or_member on public.rooms;
create policy rooms_select_public_or_member on public.rooms
  for select to authenticated
  using (
    (visibility = 'public' and status = 'lobby')
    or public.is_room_member(id)
  );

drop policy if exists room_players_select_member on public.room_players;
create policy room_players_select_member on public.room_players
  for select to authenticated
  using (public.is_room_member(room_id));

-- ---------------------------------------------------------------------------
-- Partidas e eventos: só os participantes da sala
-- ---------------------------------------------------------------------------
drop policy if exists games_select_member on public.games;
create policy games_select_member on public.games
  for select to authenticated
  using (public.is_room_member(room_id));

drop policy if exists game_events_select_member on public.game_events;
create policy game_events_select_member on public.game_events
  for select to authenticated
  using (public.is_room_member(room_id));

-- game_secrets e player_presence: RLS ligado e nenhuma política = acesso negado.

-- ---------------------------------------------------------------------------
-- Funções: só o servidor executa as funções de jogo
-- ---------------------------------------------------------------------------
revoke execute on function
  public.vira7_create_room(uuid, text, text, text, integer, integer, integer),
  public.vira7_join_room(uuid, uuid),
  public.vira7_add_bot(uuid, text, text),
  public.vira7_leave_room(uuid, uuid),
  public.vira7_free_seat(uuid, smallint),
  public.vira7_insert_events(uuid, uuid, jsonb),
  public.vira7_start_game(uuid, uuid[], jsonb, jsonb, jsonb, uuid, timestamptz),
  public.vira7_commit_game(uuid, integer, jsonb, jsonb, jsonb, uuid, timestamptz, text, jsonb, uuid, text, text),
  public.generate_room_code(),
  public.handle_new_user(),
  public.apply_game_result()
  from public, anon, authenticated;

grant execute on function
  public.vira7_create_room(uuid, text, text, text, integer, integer, integer),
  public.vira7_join_room(uuid, uuid),
  public.vira7_add_bot(uuid, text, text),
  public.vira7_leave_room(uuid, uuid),
  public.vira7_free_seat(uuid, smallint),
  public.vira7_insert_events(uuid, uuid, jsonb),
  public.vira7_start_game(uuid, uuid[], jsonb, jsonb, jsonb, uuid, timestamptz),
  public.vira7_commit_game(uuid, integer, jsonb, jsonb, jsonb, uuid, timestamptz, text, jsonb, uuid, text, text),
  public.generate_room_code()
  to service_role;

-- As políticas acima chamam is_room_member como o usuário autenticado.
revoke execute on function public.is_room_member(uuid) from public, anon;
grant execute on function public.is_room_member(uuid) to authenticated, service_role;
