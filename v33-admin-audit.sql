-- ════════════════════════════════════════════════════════════════
-- CivilCareer v33 — ADMIN SESSION AUDIT
-- Run once in the Supabase SQL editor (same procedure as v32).
-- Additive only.
--
-- Why: the owner's dashboard session was shared in chat, so we need a
-- record of who signed in, from where, and which attempts were
-- refused. The table is append-only in practice (the APIs only insert)
-- and is written with the service-role key from server-side code.
--
-- Privacy: no tokens are stored — not the access token, not the
-- refresh token. Only the verified account email/id plus coarse
-- request metadata (ip, user agent, event, small detail object).
--
-- RLS: enabled with NO policies at all, so anon/authenticated can
-- neither read nor write it. Service role bypasses RLS.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.admin_audit (
  id         uuid primary key default gen_random_uuid(),
  event      text not null,
  email      text,
  user_id    text,
  ip         text,
  user_agent text,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_created_at_idx on public.admin_audit (created_at desc);
create index if not exists admin_audit_event_idx      on public.admin_audit (event);
create index if not exists admin_audit_email_idx      on public.admin_audit (email);

alter table public.admin_audit enable row level security;

-- Deliberately no policies: the server (service role) is the only
-- reader and writer. A compromised browser session cannot read the
-- audit trail or forge entries.
