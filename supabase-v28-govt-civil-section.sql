-- ═══════════════════════════════════════════════════════════════════
-- CivilCareer v28 — Government Jobs → Civil Engineering section
-- ADDITIVE + IDEMPOTENT. Touches ONLY government tables
-- (govt_jobs, govt_job_staging, govt_sources, govt_job_leads,
-- govt_job_posts + new govt_* tables). Private jobs are untouched.
--
-- THE PUBLICATION GATE (mandatory, enforced in the database itself):
--   IF human_reviewed != true THEN publication MUST BE BLOCKED.
-- No AI confidence, provider response or source score can bypass
-- this: govt_jobs cannot hold status='active' unless
-- human_reviewed=true, and the public reader additionally filters
-- human_reviewed=eq.true on every query.
-- ═══════════════════════════════════════════ unique-section ═══════

create extension if not exists pgcrypto;

/* ── 1. govt_jobs: master recruitment structure + gate ─────────────── */

alter table public.govt_jobs add column if not exists human_reviewed boolean not null default false;
alter table public.govt_jobs add column if not exists human_reviewed_by uuid;
alter table public.govt_jobs add column if not exists human_reviewed_at timestamptz;

-- Government level: central | state | psu | railways | authority | other
alter table public.govt_jobs add column if not exists gov_level text not null default 'other'
  check (gov_level in ('central','state','psu','railways','authority','other'));

-- Civil discipline classification (direct / related / possible)
alter table public.govt_jobs add column if not exists civil_discipline text
  check (civil_discipline in ('direct','related','possible','not_civil'));
alter table public.govt_jobs add column if not exists civil_specialization text;

-- Spec §2 public job data (null when unknown — never fabricated)
alter table public.govt_jobs add column if not exists post_name text;
alter table public.govt_jobs add column if not exists department text;
alter table public.govt_jobs add column if not exists qualification text;
alter table public.govt_jobs add column if not exists branch text;
alter table public.govt_jobs add column if not exists experience text;
alter table public.govt_jobs add column if not exists age_limit text;
alter table public.govt_jobs add column if not exists age_relaxation text;
alter table public.govt_jobs add column if not exists application_start date;
alter table public.govt_jobs add column if not exists application_mode text;
alter table public.govt_jobs add column if not exists application_fee text;
alter table public.govt_jobs add column if not exists correction_window date;
alter table public.govt_jobs add column if not exists exam_date date;
alter table public.govt_jobs add column if not exists exam_mode text;
alter table public.govt_jobs add column if not exists selection_stages jsonb not null default '[]'::jsonb;
alter table public.govt_jobs add column if not exists timeline jsonb not null default '[]'::jsonb;
alter table public.govt_jobs add column if not exists civil_vacancies integer;
alter table public.govt_jobs add column if not exists total_vacancies integer;

-- Spec §8 official-source verification + §7 human review metadata
alter table public.govt_jobs add column if not exists official_notification_url text;
alter table public.govt_jobs add column if not exists verification_status text not null default 'unverified'
  check (verification_status in ('official','unverified','needs_verification'));
alter table public.govt_jobs add column if not exists verified_by uuid;
alter table public.govt_jobs add column if not exists last_verified_at timestamptz;

-- Workflow: drafts and archive live beside the existing statuses
alter table public.govt_jobs add column if not exists archived_at timestamptz;
alter table public.govt_jobs add column if not exists scheduled_for timestamptz;
alter table public.govt_jobs add column if not exists deleted_at timestamptz;

-- Widening the status CHECK is backwards compatible: every existing
-- value stays legal; 'draft' is the only addition.
do $$ begin
  alter table public.govt_jobs drop constraint if exists govt_jobs_status_check;
  alter table public.govt_jobs add constraint govt_jobs_status_check
    check (status in ('draft','active','closed','archived'));
exception when others then null; end $$;

-- ═══ THE PUBLICATION GATE ═══
-- Backfill: rows already active were approved by a human admin through
-- the review queue before this migration existed.
update public.govt_jobs set human_reviewed = true, human_reviewed_at = coalesce(human_reviewed_at, reviewed_at)
where status = 'active' and human_reviewed = false;

do $$ begin
  alter table public.govt_jobs add constraint govt_jobs_publish_gate
    check (status <> 'active' or human_reviewed = true);
exception when duplicate_object then null; end $$;

-- Legacy readers check published_at / published; keep them truthful.
alter table public.govt_jobs add column if not exists published boolean;
update public.govt_jobs set published = (status = 'active') where published is null;

create index if not exists govt_jobs_gate_idx on public.govt_jobs(status, human_reviewed);
create index if not exists govt_jobs_level_idx on public.govt_jobs(gov_level, state);
create index if not exists govt_jobs_slug_idx on public.govt_jobs(slug);

/* ── 2. govt_job_staging: AI inbox kinds + AI extraction evidence ──── */

-- Inbox kind (spec §4 AI Inbox): new | updated | closing_date_changed |
-- result | admit_card | other_update
alter table public.govt_job_staging add column if not exists inbox_kind text
  not null default 'new'
  check (inbox_kind in ('new','updated','closing_date_changed','result','admit_card','other_update'));

-- Dedupe/hash evidence + provenance summary + AI provider trail
alter table public.govt_job_staging add column if not exists duplicate_hash text;
alter table public.govt_job_staging add column if not exists source_evidence jsonb not null default '[]'::jsonb;
alter table public.govt_job_staging add column if not exists ai_extractions jsonb not null default '[]'::jsonb;
alter table public.govt_job_staging add column if not exists conflict_ids jsonb not null default '[]'::jsonb;
alter table public.govt_job_staging add column if not exists updated_fields jsonb not null default '{}'::jsonb;
alter table public.govt_job_staging add column if not exists linked_govt_job_id uuid;

create index if not exists govt_staging_kind_idx on public.govt_job_staging(inbox_kind, status, created_at desc);
create index if not exists govt_staging_hash_idx on public.govt_job_staging(duplicate_hash);

/* ── 3. New government-section tables ───────────────────────────────── */

-- Provenance: field-level source evidence (spec §10)
create table if not exists public.govt_field_provenance (
  id uuid primary key default gen_random_uuid(),
  recruitment_id uuid not null,
  field_name text not null,
  field_value text,
  source_id uuid,
  source_url text,
  source_document_url text,
  page_number integer,
  extracted_by text not null default 'ai',
  confidence numeric,
  verified boolean not null default false,
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists govt_prov_rec_idx on public.govt_field_provenance(recruitment_id, field_name);

-- Conflicts: conflicting values are stored, never silently resolved (spec §11)
create table if not exists public.govt_conflicts (
  id uuid primary key default gen_random_uuid(),
  recruitment_id uuid,
  staging_id uuid,
  field_name text not null,
  values jsonb not null default '[]'::jsonb,
  authoritative_value text,
  authoritative_source text,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists govt_conflicts_open_idx on public.govt_conflicts(status, created_at desc);

-- Audit history for every admin action (spec §4)
create table if not exists public.govt_audit_log (
  id uuid primary key default gen_random_uuid(),
  entity text not null,
  entity_id uuid,
  action text not null,
  actor uuid,
  actor_email text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists govt_audit_entity_idx on public.govt_audit_log(entity, entity_id, created_at desc);

-- Organizations registry (public knowledge, human curated)
create table if not exists public.govt_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  kind text not null default 'other' check (kind in ('central','state','psu','railways','authority','other')),
  website text,
  notes text,
  created_at timestamptz not null default now()
);

-- Civil categories / specializations registry (spec §3)
create table if not exists public.govt_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  kind text not null default 'specialization' check (kind in ('discipline','specialization')),
  created_at timestamptz not null default now()
);

-- AI provider health, persisted from the failover chain (spec §6)
create table if not exists public.govt_ai_providers (
  id text primary key,
  label text not null,
  available boolean not null default true,
  last_error text,
  last_attempt_at timestamptz,
  updated_at timestamptz not null default now()
);

grant all on table public.govt_field_provenance, public.govt_conflicts, public.govt_audit_log,
  public.govt_organizations, public.govt_categories, public.govt_ai_providers to service_role;

do $$
declare r record;
begin
  for r in select tablename from pg_tables
           where schemaname = 'public'
             and tablename in ('govt_field_provenance','govt_conflicts','govt_audit_log',
                               'govt_organizations','govt_categories','govt_ai_providers')
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('revoke all on table public.%I from anon, authenticated', r.tablename);
  end loop;
end $$;

-- Seed the civil specialization registry (idempotent)
insert into public.govt_categories (slug, label, kind) values
  ('general-civil','General Civil','specialization'),
  ('structural','Structural','specialization'),
  ('geotechnical','Geotechnical','specialization'),
  ('transportation','Transportation','specialization'),
  ('highway','Highway','specialization'),
  ('railway','Railway','specialization'),
  ('water-resources','Water Resources','specialization'),
  ('hydraulics','Hydraulics','specialization'),
  ('irrigation','Irrigation','specialization'),
  ('environmental','Environmental','specialization'),
  ('construction','Construction','specialization'),
  ('quantity-surveying','Quantity Surveying','specialization'),
  ('surveying','Surveying','specialization'),
  ('urban-infrastructure','Urban Infrastructure','specialization'),
  ('urban-planning','Urban Planning','specialization'),
  ('coastal','Coastal','specialization'),
  ('bridge','Bridge','specialization'),
  ('building','Building','specialization'),
  ('infrastructure','Infrastructure','specialization'),
  ('project-construction-management','Project/Construction Management','specialization'),
  ('planning','Planning','specialization'),
  ('estimation','Estimation','specialization'),
  ('bim','BIM','specialization'),
  ('gis','GIS','specialization'),
  ('remote-sensing','Remote Sensing','specialization')
on conflict (slug) do nothing;
