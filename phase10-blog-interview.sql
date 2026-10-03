-- CivilCareer premium career ecosystem additions.
create table if not exists public.saved_jobs (
  id uuid primary key default gen_random_uuid(),
  visitor_id text not null,
  job_id uuid not null,
  saved_at timestamptz not null default now(),
  unique(visitor_id, job_id)
);
create index if not exists saved_jobs_visitor_idx on public.saved_jobs(visitor_id, saved_at desc);
create index if not exists saved_jobs_job_idx on public.saved_jobs(job_id);
-- Server API uses the service-role key, so the public browser does not need direct table access.
alter table public.saved_jobs enable row level security;
