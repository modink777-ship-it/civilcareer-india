-- CivilCareer V8 structured jobs, lifecycle and SEO
-- Safe to run more than once.
alter table public.jobs add column if not exists responsibilities text;
alter table public.jobs add column if not exists skills text;
alter table public.jobs add column if not exists country text;
alter table public.jobs add column if not exists state text;
alter table public.jobs add column if not exists district text;
alter table public.jobs add column if not exists city text;
alter table public.jobs add column if not exists location_display text;
alter table public.jobs add column if not exists locations jsonb not null default '[]'::jsonb;
alter table public.jobs add column if not exists qualifications jsonb not null default '[]'::jsonb;
alter table public.jobs add column if not exists qualification_notes text;
alter table public.jobs add column if not exists experience_min numeric;
alter table public.jobs add column if not exists experience_max numeric;
alter table public.jobs add column if not exists experience_ranges jsonb not null default '[]'::jsonb;
alter table public.jobs add column if not exists employment_types jsonb not null default '[]'::jsonb;
alter table public.jobs add column if not exists salary_min numeric;
alter table public.jobs add column if not exists salary_max numeric;
alter table public.jobs add column if not exists salary_currency text default 'INR';
alter table public.jobs add column if not exists application_email text;
alter table public.jobs add column if not exists application_emails jsonb not null default '[]'::jsonb;
alter table public.jobs add column if not exists application_email_private boolean not null default false;
alter table public.jobs add column if not exists application_url text;
alter table public.jobs add column if not exists company_url text;
alter table public.jobs add column if not exists role_normalized text;
alter table public.jobs add column if not exists posted_at timestamptz;
alter table public.jobs add column if not exists published_at timestamptz;
alter table public.jobs add column if not exists expires_at timestamptz;
alter table public.jobs add column if not exists verification_status text not null default 'Pending';
alter table public.jobs add column if not exists last_verified_at timestamptz;
alter table public.jobs add column if not exists updated_at timestamptz not null default now();
alter table public.jobs add column if not exists slug text;
create unique index if not exists jobs_slug_unique_idx on public.jobs(slug) where slug is not null;
create index if not exists jobs_public_lifecycle_idx on public.jobs(published,status,expires_at,published_at desc);
create index if not exists jobs_location_idx on public.jobs(country,state,city);
create table if not exists public.job_role_master (name text primary key, active boolean not null default true);
create table if not exists public.qualification_master (name text primary key, active boolean not null default true);
insert into public.job_role_master(name) values ('Civil Engineer'),('Site Engineer'),('Planning Engineer'),('Quantity Surveyor'),('Structural Engineer'),('Project Engineer'),('Estimation Engineer'),('Billing Engineer'),('QA/QC Engineer'),('Design Engineer'),('Construction Engineer'),('Project Coordinator'),('Other Civil/Construction Role') on conflict do nothing;
insert into public.qualification_master(name) values ('10th / SSLC'),('12th / PUC'),('ITI'),('Diploma'),('BE / BTech'),('ME / MTech'),('BSc'),('MSc'),('BA'),('MA'),('BCom'),('MCom'),('BBA'),('MBA'),('LLB'),('LLM'),('MBBS'),('Nursing'),('PhD'),('Any Graduate'),('Any Post Graduate'),('Other') on conflict do nothing;
alter table public.job_role_master enable row level security;
alter table public.qualification_master enable row level security;
update public.jobs set posted_at=coalesce(posted_at,created_at,now()), published_at=coalesce(published_at,created_at,now()), location_display=coalesce(location_display,location), role_normalized=coalesce(role_normalized,role), verification_status=case when last_verified is not null then 'Verified' else verification_status end, last_verified_at=coalesce(last_verified_at,last_verified::timestamptz), qualifications=case when jsonb_array_length(qualifications)=0 and qualification is not null then jsonb_build_array(qualification) else qualifications end, experience_ranges=case when jsonb_array_length(experience_ranges)=0 and experience_level is not null then jsonb_build_array(experience_level) else experience_ranges end, employment_types=case when jsonb_array_length(employment_types)=0 and employment_type is not null then jsonb_build_array(employment_type) else employment_types end, application_email=coalesce(application_email,case when contact_info ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then contact_info else null end) where posted_at is null or published_at is null or location_display is null or role_normalized is null;
update public.jobs set expires_at=case when sector in ('Government','Public Sector') and deadline is not null then (deadline::timestamptz + interval '1 day') else coalesce(expires_at,published_at + interval '30 days') end where expires_at is null;

-- Optional stable slugs for indexable exam/resource URLs. Runtime also derives slugs for existing rows.
alter table public.exams add column if not exists slug text;
alter table public.materials add column if not exists slug text;
create index if not exists exams_slug_idx on public.exams(slug);
create index if not exists materials_slug_idx on public.materials(slug);
