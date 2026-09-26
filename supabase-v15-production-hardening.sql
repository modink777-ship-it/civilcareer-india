-- CivilCareer Phase 15 production hardening (additive only)
-- Safe to run after the existing Phase 1–14 migrations.
-- No rows are deleted and no published job content is rewritten.

-- Canonical job lifecycle: use explicit government deadlines when expires_at
-- has not yet been populated. Existing explicit expires_at values win.
alter table public.jobs add column if not exists expires_at timestamptz;
update public.jobs
set expires_at = (deadline::timestamptz + interval '1 day')
where expires_at is null
  and deadline is not null
  and sector in ('Government','Public Sector');

create index if not exists jobs_public_sector_lifecycle_idx
  on public.jobs (sector, published, expires_at, created_at desc);
create index if not exists jobs_public_location_idx
  on public.jobs (state, city);
create index if not exists jobs_review_ingestion_idx
  on public.jobs (review_state, ingestion_source, created_at desc);

create index if not exists candidate_profiles_user_idx
  on public.candidate_profiles (user_id);
create index if not exists candidate_saved_jobs_user_idx
  on public.candidate_saved_jobs (user_id, saved_at desc);
create index if not exists candidate_job_events_user_idx
  on public.candidate_job_events (user_id, created_at desc);
create index if not exists candidate_job_applications_user_idx
  on public.candidate_job_applications (user_id, updated_at desc);
create index if not exists job_alerts_user_idx
  on public.job_alerts (user_id, active, frequency);

create index if not exists exams_review_state_idx
  on public.exams (review_state, created_at desc);
create index if not exists materials_review_state_idx
  on public.materials (review_state, created_at desc);
