-- =============================================================================
-- Vira-7 · 0004 · Estatísticas atualizadas por trigger e ranking
-- =============================================================================

-- Sempre que o servidor grava o resultado de uma pessoa em uma partida,
-- as estatísticas dela são atualizadas na mesma transação.
create or replace function public.apply_game_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is null or new.is_bot then
    return new;
  end if;

  insert into public.player_stats as s (
    user_id, games_played, wins, losses, total_points, best_game_score, best_round_score,
    rounds_played, flip7_count, busts, current_streak, best_streak, updated_at
  )
  values (
    new.user_id, 1,
    case when new.is_winner then 1 else 0 end,
    case when new.is_winner then 0 else 1 end,
    greatest(new.score, 0), new.score, new.best_round,
    new.rounds_played, new.flip7_count, new.busts,
    case when new.is_winner then 1 else 0 end,
    case when new.is_winner then 1 else 0 end,
    now()
  )
  on conflict (user_id) do update set
    games_played     = s.games_played + 1,
    wins             = s.wins + case when new.is_winner then 1 else 0 end,
    losses           = s.losses + case when new.is_winner then 0 else 1 end,
    total_points     = s.total_points + greatest(new.score, 0),
    best_game_score  = greatest(s.best_game_score, new.score),
    best_round_score = greatest(s.best_round_score, new.best_round),
    rounds_played    = s.rounds_played + new.rounds_played,
    flip7_count      = s.flip7_count + new.flip7_count,
    busts            = s.busts + new.busts,
    current_streak   = case when new.is_winner then s.current_streak + 1 else 0 end,
    best_streak      = greatest(s.best_streak, case when new.is_winner then s.current_streak + 1 else 0 end),
    updated_at       = now();

  return new;
end;
$$;

drop trigger if exists game_results_apply_stats on public.game_results;
create trigger game_results_apply_stats
  after insert on public.game_results
  for each row execute function public.apply_game_result();

-- Ranking público: quem já jogou, ordenado por vitórias e pontos.
create or replace view public.leaderboard
with (security_invoker = true)
as
select
  p.id as user_id,
  p.username,
  p.avatar,
  s.games_played,
  s.wins,
  s.losses,
  s.total_points,
  s.best_game_score,
  s.flip7_count,
  s.best_streak,
  case when s.games_played > 0 then round(100.0 * s.wins / s.games_played)::integer else 0 end as win_rate
from public.player_stats s
join public.profiles p on p.id = s.user_id
where s.games_played > 0
order by s.wins desc, s.total_points desc, p.username;

comment on view public.leaderboard is 'Ranking geral dos jogadores.';
