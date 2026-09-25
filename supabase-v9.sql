-- CivilCareer All-Phases Foundation
-- Safe to run after V8 migration.
create table if not exists public.job_alerts (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  alert_type text not null default 'all',
  location text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz
);
create index if not exists job_alerts_active_idx on public.job_alerts(active,created_at desc);
create index if not exists job_alerts_email_idx on public.job_alerts(lower(email));

create table if not exists public.job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid,
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists job_events_job_idx on public.job_events(job_id,created_at desc);

create table if not exists public.source_snapshots (
  id uuid primary key default gen_random_uuid(),
  job_id uuid,
  source_url text,
  http_status integer,
  content_hash text,
  verified boolean not null default false,
  checked_at timestamptz not null default now()
);
create index if not exists source_snapshots_job_idx on public.source_snapshots(job_id,checked_at desc);

create table if not exists public.career_profiles (
  id uuid primary key default gen_random_uuid(),
  visitor_id text unique,
  role text,
  location text,
  experience text,
  skills text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employer_verifications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid,
  company text,
  official_url text,
  status text not null default 'Pending',
  notes text,
  checked_at timestamptz
);

alter table public.jobs add column if not exists quality_score numeric;
alter table public.jobs add column if not exists duplicate_group text;
alter table public.jobs add column if not exists source_domain text;
alter table public.jobs add column if not exists source_checked_at timestamptz;
alter table public.jobs add column if not exists source_http_status integer;
alter table public.jobs add column if not exists source_content_hash text;
alter table public.jobs add column if not exists review_state text default 'Published';
alter table public.jobs add column if not exists employer_verification_status text default 'Pending';
create index if not exists jobs_quality_idx on public.jobs(quality_score);
create index if not exists jobs_review_state_idx on public.jobs(review_state);

-- Helpful exam fields
alter table public.exams add column if not exists official_source_type text;
alter table public.exams add column if not exists reminder_enabled boolean not null default true;
