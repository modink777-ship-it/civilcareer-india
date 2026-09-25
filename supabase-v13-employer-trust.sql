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
