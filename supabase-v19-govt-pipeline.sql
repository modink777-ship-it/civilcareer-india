-- CivilCareer Government Civil-Jobs Pipeline
-- Additive/idempotent. Keeps private jobs untouched.
create extension if not exists pgcrypto;

create table if not exists public.govt_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('official','aggregator_lead')),
  url text not null unique,
  kind text not null check (kind in ('rss','html','pdf_index','sitemap')),
  org text,
  category text,
  state text,
  enabled boolean not null default false,
  last_run_at timestamptz,
  last_status text,
  robots_ok boolean,
  etag text,
  last_modified text,
  last_error text,
  items_found integer not null default 0,
  items_staged integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.govt_job_leads (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.govt_sources(id) on delete cascade,
  source_url text not null,
  title text not null,
  org_hint text,
  discovered_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new','processed','ignored')),
  url_hash text not null unique
);
create index if not exists govt_job_leads_source_idx on public.govt_job_leads(source_id, discovered_at desc);

create table if not exists public.govt_job_staging (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.govt_job_leads(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','needs_info','approved','rejected','duplicate')),
  civil_status text not null default 'discipline_unknown' check (civil_status in ('civil','multi_incl_civil','discipline_unknown','not_civil')),
  tier text check (tier in ('A','B','C','U')),
  relevance_score integer,
  confidence numeric,
  extraction_method text check (extraction_method in ('rules','llm','manual')),
  dedupe_key text unique,
  match_reasons jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  review_notes text,
  reject_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists govt_job_staging_status_idx on public.govt_job_staging(status, created_at desc);
create index if not exists govt_job_staging_filter_idx on public.govt_job_staging(tier, civil_status, created_at desc);

create table if not exists public.govt_jobs (
  id uuid primary key default gen_random_uuid(),
  staging_id uuid unique references public.govt_job_staging(id) on delete set null,
  title text not null,
  slug text not null unique,
  organization text not null,
  org_type text not null,
  scope text not null check (scope in ('central','state')),
  state text not null default 'All India',
  department_category text not null default 'Other',
  job_type text not null default 'regular',
  notification_no text,
  total_posts_in_notification integer,
  civil_posts_count integer,
  civil_status text not null,
  tier text,
  dates jsonb not null default '{}'::jsonb,
  deadline_kind text not null default 'fixed',
  deadline_text text,
  apply_end date,
  previous_apply_end date,
  age_limit_by_category jsonb,
  age_as_on date,
  fee_by_category jsonb,
  payment_mode text,
  required_documents text[] not null default '{}',
  how_to_apply text,
  language_required text,
  local_cadre_or_domicile text,
  reservation_notes text,
  official_notice_url text not null,
  official_apply_url text,
  official_site_url text,
  summary text,
  status text not null default 'active' check (status in ('active','closed','archived')),
  reviewed_at timestamptz not null default now(),
  reviewed_by uuid,
  published_at timestamptz not null default now(),
  closes_at timestamptz,
  change_log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists govt_jobs_active_idx on public.govt_jobs(status, apply_end desc, published_at desc);
create index if not exists govt_jobs_scope_idx on public.govt_jobs(scope, state, department_category);

create table if not exists public.govt_job_posts (
  id uuid primary key default gen_random_uuid(),
  govt_job_id uuid not null references public.govt_jobs(id) on delete cascade,
  post_name text not null,
  discipline text,
  is_civil boolean not null default false,
  vacancies integer,
  pay jsonb,
  qualification text,
  qualification_levels text[] not null default '{}',
  selection_process text
);
create index if not exists govt_job_posts_job_idx on public.govt_job_posts(govt_job_id, is_civil);

-- Lock the public schema down. Public application reads/writes go through Vercel APIs.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('revoke all on table public.%I from anon, authenticated', r.tablename);
  end loop;
end $$;

grant all on table public.govt_sources, public.govt_job_leads, public.govt_job_staging, public.govt_jobs, public.govt_job_posts to service_role;

comment on table public.govt_job_staging is 'Private government recruitment review queue. Nothing here is public until explicitly approved.';
comment on table public.govt_jobs is 'Approved active government civil notifications only.';
