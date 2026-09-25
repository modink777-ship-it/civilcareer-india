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
