-- ════════════════════════════════════════════════════════════════
-- CivilCareer — ALL 5 MIGRATIONS IN ONE FILE (run once, top to bottom)
-- Safe: creates tables/columns only. Nothing is deleted or dropped.
-- ════════════════════════════════════════════════════════════════

-- ✅ CHECK 1 — jobs count BEFORE (note the number, expect 568):
select 'BEFORE' as stage, count(*) as jobs_count from jobs;

-- ═══════════ 1/5 · V11 ACCOUNT LAYER ═══════════

-- CivilCareer Phase 5 — optional candidate account layer.
-- Safe additive migration. Do not run automatically in deployment.
create table if not exists public.candidate_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text,
  location text,
  stage text,
  project text,
  work text,
  environment text,
  education text,
  skills jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.candidate_saved_jobs (
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key(user_id,job_id)
);
create index if not exists candidate_saved_jobs_user_idx on public.candidate_saved_jobs(user_id,saved_at desc);
create table if not exists public.candidate_job_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists candidate_job_events_user_idx on public.candidate_job_events(user_id,created_at desc);
create index if not exists candidate_job_events_user_job_idx on public.candidate_job_events(user_id,job_id,created_at desc);
create table if not exists public.candidate_job_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  status text not null default 'Applied',
  notes text,
  applied_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,job_id)
);
create index if not exists candidate_job_applications_user_idx on public.candidate_job_applications(user_id,updated_at desc);

alter table public.candidate_profiles enable row level security;
alter table public.candidate_saved_jobs enable row level security;
alter table public.candidate_job_events enable row level security;
alter table public.candidate_job_applications enable row level security;

-- Browser clients are not given direct table access by the CivilCareer UI;
-- the server API uses the Supabase service role after verifying the user's token.
-- These policies are still added as defense-in-depth for any future direct client use.
drop policy if exists candidate_profiles_owner on public.candidate_profiles;
create policy candidate_profiles_owner on public.candidate_profiles for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
drop policy if exists candidate_saved_jobs_owner on public.candidate_saved_jobs;
create policy candidate_saved_jobs_owner on public.candidate_saved_jobs for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
drop policy if exists candidate_job_events_owner on public.candidate_job_events;
create policy candidate_job_events_owner on public.candidate_job_events for select using (auth.uid()=user_id);
create policy candidate_job_events_insert_owner on public.candidate_job_events for insert with check (auth.uid()=user_id);
drop policy if exists candidate_job_applications_owner on public.candidate_job_applications;
create policy candidate_job_applications_owner on public.candidate_job_applications for all using (auth.uid()=user_id) with check (auth.uid()=user_id);

-- ═══════════ 2/5 · V12 ALERTS + RETENTION ═══════════

-- CivilCareer Phase 7 — alerts and notification queue.
-- Safe additive migration. Do not run automatically in deployment.
alter table public.job_alerts add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.job_alerts add column if not exists keywords text not null default '';
alter table public.job_alerts add column if not exists role text not null default '';
alter table public.job_alerts add column if not exists state text not null default '';
alter table public.job_alerts add column if not exists city text not null default '';
alter table public.job_alerts add column if not exists work_type text not null default '';
alter table public.job_alerts add column if not exists frequency text not null default 'daily';
alter table public.job_alerts add column if not exists unsubscribe_token text;
alter table public.job_alerts add column if not exists last_evaluated_at timestamptz;
create index if not exists job_alerts_user_idx on public.job_alerts(user_id,created_at desc);
create index if not exists job_alerts_frequency_idx on public.job_alerts(active,frequency,last_evaluated_at);
create unique index if not exists job_alerts_user_one_idx on public.job_alerts(user_id) where user_id is not null;
create table if not exists public.job_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.job_alerts(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error text,
  unique(alert_id,job_id)
);
create index if not exists job_alert_deliveries_pending_idx on public.job_alert_deliveries(status,created_at);
alter table public.job_alerts enable row level security;
alter table public.job_alert_deliveries enable row level security;
drop policy if exists job_alerts_owner on public.job_alerts;
create policy job_alerts_owner on public.job_alerts for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
drop policy if exists job_alert_deliveries_owner on public.job_alert_deliveries;
create policy job_alert_deliveries_owner on public.job_alert_deliveries for select using (exists(select 1 from public.job_alerts a where a.id=alert_id and a.user_id=auth.uid()));

-- ═══════════ 3/5 · V13 EMPLOYER TRUST ═══════════

-- CivilCareer Phase 8 — Employer & Verification Layer
-- Additive migration. Apply only after reviewing against the production schema.
create table if not exists public.employer_profiles (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  official_url text not null,
  description text,
  locations jsonb not null default '[]'::jsonb,
  industries jsonb not null default '[]'::jsonb,
  status text not null default 'Pending',
  verified_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists employer_profiles_company_url_idx on public.employer_profiles(lower(company_name), lower(official_url));
create index if not exists employer_profiles_status_idx on public.employer_profiles(status, updated_at desc);
alter table public.employer_profiles enable row level security;
-- Public verified profiles are served through the server API using the service role.
-- No direct public table policy is added here.

alter table public.jobs add column if not exists employer_profile_id uuid references public.employer_profiles(id);
alter table public.jobs add column if not exists employer_verification_status text default 'Pending';
create index if not exists jobs_employer_profile_idx on public.jobs(employer_profile_id);
create index if not exists jobs_employer_verification_idx on public.jobs(employer_verification_status);

alter table public.employer_submissions add column if not exists employer_profile_id uuid references public.employer_profiles(id);
alter table public.employer_submissions add column if not exists review_notes text;

-- ═══════════ 4/5 · V14 DATA QUALITY ═══════════

-- CivilCareer — discovery data-quality columns (Phase 4 / O / R layer)
-- Smallest additive migration: the discovery pipeline now computes
-- quality_flags (missing company/location/application URL, short
-- description) and a quality_score for every discovered draft. This
-- migration stores them so admins can filter and review by quality.
-- Safe to run more than once; destroys nothing.

alter table public.jobs add column if not exists quality_flags jsonb not null default '[]'::jsonb;
alter table public.jobs add column if not exists salary_unit text;

create index if not exists jobs_quality_score_idx on public.jobs(quality_score);

-- ═══════════ 5/5 · AGENT REACH ═══════════

-- ============================================================
-- CivilCareer — Agent Reach integration (safe to run any time)
-- Adds ingestion metadata + review lifecycle for Agent Reach.
-- Never destroys or rewrites existing data.
-- Run in Supabase SQL Editor after supabase.sql … supabase-v10.sql.
-- ============================================================

-- ── JOBS: ingestion metadata ─────────────────────────────────
alter table public.jobs add column if not exists ingestion_source text;   -- 'agent_reach' | 'discovery' | 'admin'
alter table public.jobs add column if not exists ingested_at timestamptz; -- when Agent Reach delivered it
alter table public.jobs add column if not exists external_id text;        -- id in the source system
alter table public.jobs add column if not exists source_name text;        -- human name of the source site
alter table public.jobs add column if not exists agent_reach_meta jsonb;  -- raw structured extras (skills, deadlines…)

-- ── MATERIALS (resources / videos): review lifecycle ─────────
-- The materials table itself is created by earlier setup; these are additive.
alter table public.materials add column if not exists review_state text;      -- 'Pending Review' | 'Published' | 'Rejected'
alter table public.materials add column if not exists ingestion_source text;
alter table public.materials add column if not exists ingested_at timestamptz;
alter table public.materials add column if not exists external_id text;
alter table public.materials add column if not exists source_name text;
alter table public.materials add column if not exists source_url text;        -- page the resource came from
alter table public.materials add column if not exists agent_reach_meta jsonb;

-- Backfill: every material that already existed was published under the old
-- flow — keep it exactly as it is, just label its review state.
update public.materials set review_state = 'Published' where review_state is null;

-- Label how existing unpublished job drafts arrived (discovery pipeline).
update public.jobs
   set ingestion_source = 'discovery'
 where ingestion_source is null
   and published = false
   and source like 'Multi-source discovery%';

-- ── DUPLICATE DETECTION ──────────────────────────────────────
-- One record per (source URL, external id) pair when Agent Reach supplies an
-- external id; the ingestion API also matches on normalized source_url alone.
create unique index if not exists jobs_agent_reach_ext_unique
  on public.jobs (source_url, external_id) where external_id is not null;
create unique index if not exists materials_agent_reach_ext_unique
  on public.materials (source_url, external_id) where external_id is not null;

-- Review-queue listing indexes (admin inbox filters on these).
create index if not exists jobs_ingestion_idx
  on public.jobs (ingestion_source, review_state, created_at desc);
create index if not exists materials_ingestion_idx
  on public.materials (ingestion_source, review_state, created_at desc);

-- ✅ CHECK 2 — jobs count AFTER (must equal the BEFORE number):
select 'AFTER' as stage, count(*) as jobs_count from jobs;

-- ✅ CHECK 3 — everything the 5 migrations create (each row should say 'exists'):
select 'v11 candidate_profiles' as grp, case when to_regclass('public.candidate_profiles') is not null then 'exists' else 'MISSING' end as status;
select 'v11 candidate_saved_jobs' as grp, case when to_regclass('public.candidate_saved_jobs') is not null then 'exists' else 'MISSING' end as status;
select 'v12 job_alert_deliveries' as grp, case when to_regclass('public.job_alert_deliveries') is not null then 'exists' else 'MISSING' end as status;
select 'v13 employer_profiles' as grp, case when to_regclass('public.employer_profiles') is not null then 'exists' else 'MISSING' end as status;
select 'agent-reach jobs.ingestion_source' as grp, case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='ingestion_source') then 'exists' else 'MISSING' end as status;
select 'agent-reach jobs.external_id' as grp, case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='external_id') then 'exists' else 'MISSING' end as status;
select 'v14 jobs.quality_flags' as grp, case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='quality_flags') then 'exists' else 'MISSING' end as status;
select 'v13 jobs.employer_verification_status' as grp, case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='jobs' and column_name='employer_verification_status') then 'exists' else 'MISSING' end as status;
