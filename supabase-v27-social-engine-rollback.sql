-- ==========================================================
-- CivilCareer v27 - SOCIAL CONTENT ENGINE - ROLLBACK
-- DO NOT RUN unless you need to undo supabase-v27-social-engine.sql.
--
-- Section A (SOFT, active): renames the 4 tables to *_bak_<YYYYMMDD>.
--   Nothing is deleted; the publish ledger survives.
-- Section B (HARD, commented out): drops everything.
--   WARNING: dropping the ledger erases the record of what was posted.
--   If v27 is re-applied later, the engine has no memory of past sends
--   and could publish DUPLICATE posts. Export the tables to CSV first.
-- Run exactly ONE section, never both.
-- Posts already published on Telegram / LinkedIn / Instagram are NOT deleted.
-- ==========================================================

-- SECTION A - SOFT ROLLBACK
begin;

drop trigger if exists social_suggestions_touch on public.social_suggestions;
drop trigger if exists social_publishes_touch   on public.social_publishes;
drop trigger if exists social_connections_touch on public.social_connections;
drop trigger if exists social_settings_touch    on public.social_settings;

drop function if exists public.social_set_updated_at();

-- Explicitly named indexes keep their names after a table rename and would make
-- a later re-apply silently skip them. Drop them first (backups need no indexes).
drop index if exists public.social_suggestions_source_dedupe;
drop index if exists public.social_suggestions_status_idx;
drop index if exists public.social_suggestions_source_idx;
drop index if exists public.social_suggestions_template_idx;
drop index if exists public.social_publishes_one_real_per_platform;
drop index if exists public.social_publishes_status_idx;
drop index if exists public.social_publishes_suggestion_idx;
drop index if exists public.social_publishes_platform_day_idx;
drop index if exists public.social_connections_platform_idx;
drop index if exists public.social_connections_one_primary;

do $$
declare
  day text := to_char(current_date, 'YYYYMMDD');
begin
  if to_regclass('public.social_publishes_bak_'   || day) is not null
     or to_regclass('public.social_suggestions_bak_' || day) is not null
     or to_regclass('public.social_connections_bak_' || day) is not null
     or to_regclass('public.social_settings_bak_'    || day) is not null then
    raise exception 'A backup from today (%) already exists. Rename or drop it first.', day;
  end if;

  if to_regclass('public.social_publishes') is not null then
    execute 'alter table public.social_publishes rename to social_publishes_bak_' || day;
  end if;
  if to_regclass('public.social_suggestions') is not null then
    execute 'alter table public.social_suggestions rename to social_suggestions_bak_' || day;
  end if;
  if to_regclass('public.social_connections') is not null then
    execute 'alter table public.social_connections rename to social_connections_bak_' || day;
  end if;
  if to_regclass('public.social_settings') is not null then
    execute 'alter table public.social_settings rename to social_settings_bak_' || day;
  end if;
end;
$$;

commit;

-- SECTION B - HARD ROLLBACK (commented out; uncomment to use instead of A)
-- begin;
-- drop table if exists public.social_publishes;
-- drop table if exists public.social_suggestions;
-- drop table if exists public.social_connections;
-- drop table if exists public.social_settings;
-- drop function if exists public.social_set_updated_at();
-- commit;
