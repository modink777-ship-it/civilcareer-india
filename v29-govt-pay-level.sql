-- ════════════════════════════════════════════════════════════════════
-- CivilCareer — v29: government jobs publish schema fix
--
-- /api/govt-review (approve + create_draft) writes govt_jobs.pay_level,
-- but no earlier migration ever created that column. On a database that
-- was migrated only from the repo's .sql files, every publish therefore
-- failed with PostgREST's "Could not find the 'pay_level' column of
-- 'govt_jobs' in the schema cache". Safe + additive: run once.
-- ════════════════════════════════════════════════════════════════════

alter table public.govt_jobs add column if not exists pay_level text;

-- Keep the admin edit payload (govt-review ?action=update) and the public
-- read (/api/govt-jobs maps pay_level → payLevel) consistent.
comment on column public.govt_jobs.pay_level is 'Pay scale / pay level text as published in the notification (e.g. "Level-7 ₹44,900–1,42,400").';

-- Verify (optional):
-- select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'govt_jobs' and column_name = 'pay_level';
