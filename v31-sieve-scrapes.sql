-- CivilCareer v31 — Sieve scrape API integration (durable run store)
--
-- Run this once in the Supabase SQL editor before enabling SIEVE_API_KEY.
-- Safe to re-run: every statement is guarded with IF NOT EXISTS.
--
-- Why this table exists: POST /api/scrapes has no idempotency key and an
-- accepted call spends credits, so the session row is written BEFORE the
-- request and resumed from here after a crash instead of starting a
-- duplicate run.
--
-- RLS follows the project lockdown: only the server (service-role key)
-- reads or writes this table; anon/authenticated get no privileges.

create table if not exists public.sieve_sessions (
  id                uuid primary key default gen_random_uuid(),
  client_request_id text not null unique,
  session_id        text unique,
  instruction       text,
  request           jsonb not null default '{}'::jsonb,
  last_request      jsonb,
  status            text  not null default 'starting',
  turns             integer not null default 0,
  summary           jsonb,
  result            jsonb,
  files             jsonb not null default '[]'::jsonb,
  schema_conformance jsonb,
  refusal           jsonb,
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz
);

create index if not exists sieve_sessions_status_idx on public.sieve_sessions (status);
create index if not exists sieve_sessions_created_idx on public.sieve_sessions (created_at desc);

alter table public.sieve_sessions enable row level security;

revoke all on public.sieve_sessions from anon, authenticated;

-- Verify (read-only):
--   select count(*) from public.sieve_sessions;                       -- 0 on a fresh install
--   select has_table_privilege('anon','public.sieve_sessions','SELECT'); -- false
--   select has_table_privilege('authenticated','public.sieve_sessions','SELECT'); -- false
