-- =============================================================================
-- Vira-7 · 0008 · Supabase Realtime
-- =============================================================================
-- Publica as tabelas cujas mudanças os clientes acompanham em tempo real.
-- O Realtime respeita as políticas de RLS: cada jogador só recebe mudanças
-- das salas em que está (e da lista de salas públicas abertas).
--
--   game_events  -> cada carta virada, estouro, congelamento… (INSERT)
--   room_players -> entrou, saiu, ficou pronto                 (INSERT/UPDATE)
--   rooms        -> configurações, anfitrião, início da partida (INSERT/UPDATE)

do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach v_table in array array['game_events', 'room_players', 'rooms'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;
