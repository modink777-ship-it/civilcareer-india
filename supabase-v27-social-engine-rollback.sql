-- ═══════════════════════════════════════════════════════════════════
-- CivilCareer v27 — SOCIAL CONTENT ENGINE — ROLLBACK
--
-- USE ONLY IF you need to undo supabase-v27-social-engine.sql.
--
-- WHAT IT DOES: drops the three tables the migration added
--   (social_publishes, social_suggestions, social_connections)
--   together with their indexes, policies and grants.
--
-- WHAT IT DOES NOT DO:
--   • It does NOT touch jobs, exam_tracker or any other table —
--     the v27 migration was purely additive.
--   • It does NOT delete anything already published to
--     Telegram / LinkedIn / Instagram — those posts live on the
--     platforms themselves. This only removes the local ledger
--     that records where they went.
--   • It does NOT undo any code that reads these tables. After
--     running this, the engine API routes will report the
--     tables as missing (they fail safe with a clear error,
--     like the exam-tracker table-missing path).
--
-- HOW TO RUN: paste into the Supabase SQL Editor and run once.
-- Safe to re-run (IF EXISTS). Nothing outside these three
-- tables can be affected.
--
-- HOW TO VERIFY (run after, expect 'NULL NULL NULL' and 'no'):
--   select to_regclass('public.social_suggestions'),
--          to_regclass('public.social_publishes'),
--          to_regclass('public.social_connections');
--   select exists (select 1 from information_schema.tables
--                  where table_schema='public'
--                    and table_name='social_suggestions') as still_there;
--
-- TO RE-APPLY: run supabase-v27-social-engine.sql again.
-- ═══════════════════════════════════════════════════════════════════

begin;

-- Child first: social_publishes references social_suggestions.
drop table if exists public.social_publishes;
drop table if exists public.social_suggestions;
drop table if exists public.social_connections;

commit;

-- Verify the rollback (expect NULL, NULL, NULL):
select to_regclass('public.social_suggestions')  as suggestions,
       to_regclass('public.social_publishes')    as publishes,
       to_regclass('public.social_connections')  as connections;

-- Must print 'no' (f = false):
select exists (
  select 1 from information_schema.tables
  where table_schema = 'public'
    and table_name in ('social_suggestions','social_publishes','social_connections')
) as engine_tables_still_present;
