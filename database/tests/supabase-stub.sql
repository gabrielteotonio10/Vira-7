-- Simula o mínimo do ambiente Supabase para testar as migrations em um Postgres
-- comum (PGlite): papéis, schema auth e a função auth.uid().
-- NÃO execute este arquivo no Supabase: lá tudo isso já existe.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- No Supabase, auth.uid() lê o "sub" do JWT da requisição.
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
