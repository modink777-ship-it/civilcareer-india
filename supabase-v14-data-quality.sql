-- CivilCareer — discovery data-quality columns (Phase 4 / O / R layer)
-- Smallest additive migration: the discovery pipeline now computes
-- quality_flags (missing company/location/application URL, short
-- description) and a quality_score for every discovered draft. This
-- migration stores them so admins can filter and review by quality.
-- Safe to run more than once; destroys nothing.

alter table public.jobs add column if not exists quality_flags jsonb not null default '[]'::jsonb;
alter table public.jobs add column if not exists salary_unit text;

create index if not exists jobs_quality_score_idx on public.jobs(quality_score);
