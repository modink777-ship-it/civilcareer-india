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
