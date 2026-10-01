-- ─────────────────────────────────────────────────────────────────────
-- CivilCareer — RLS audit (P1 A5)
--
-- READ-ONLY. Run in the Supabase SQL editor (as owner/postgres).
-- Returns metadata only — never row data.
--
-- Deliberately uses pg_tables.rowsecurity and has_table_privilege().
-- Do NOT "fix" this to use information_schema.tables.row_security:
-- that view reports misleading values in Supabase (the same mistake
-- the frozen v27 migration's verify section makes — it is the
-- owner's applied file and is left untouched; see docs/00-gap-report.md).
--
-- Expected result on a hardened deployment:
--   §1  every table: rowsecurity = true
--   §2  zero rows (no table with RLS off)
--   §3  zero rows OR only the rows the owner explicitly accepted
--       (public read-only tables are served through the API with
--       RLS policies, not table-level grants)
--   §4  anon/authenticated have NO table-level privileges
--   §5  every policy's qual/with_check scopes rows to auth.uid()
--       (or is an intentional read-only public policy)
-- ─────────────────────────────────────────────────────────────────────

-- §1. Every table in public: is RLS enabled?
SELECT schemaname,
       tablename,
       rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY rowsecurity, tablename;

-- §2. FOLLOW-UP LIST: tables with RLS OFF. Must be empty.
-- Any row here is a data-exposure risk: without RLS the role's
-- table-level grants (if any) apply to every row in the table.
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND NOT rowsecurity
ORDER BY tablename;

-- §3. Table-level GRANTS to the public API roles.
-- Supabase best practice (used by the v19+ migrations here):
--   revoke all on table public.<t> from anon, authenticated;
--   grant all on table public.<t> to service_role;
-- Access for anon/authenticated users happens through RLS
-- policies, not table grants. Review every row below.
SELECT grantee,
       table_name,
       privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, table_name, privilege_type;

-- §4. Effective privileges cross-check via has_table_privilege.
-- What anon/authenticated can actually do on each table today.
-- All columns expected false for every table.
SELECT t.tablename,
       has_table_privilege('anon',         format('%I.%I', t.schemaname, t.tablename), 'SELECT') AS anon_select,
       has_table_privilege('anon',         format('%I.%I', t.schemaname, t.tablename), 'INSERT') AS anon_insert,
       has_table_privilege('anon',         format('%I.%I', t.schemaname, t.tablename), 'UPDATE') AS anon_update,
       has_table_privilege('anon',         format('%I.%I', t.schemaname, t.tablename), 'DELETE') AS anon_delete,
       has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'SELECT') AS auth_select,
       has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'INSERT') AS auth_insert,
       has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'UPDATE') AS auth_update,
       has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'DELETE') AS auth_delete
FROM pg_tables t
WHERE t.schemaname = 'public'
ORDER BY t.tablename;

-- §5. Policy inventory: verify row scoping.
-- Every policy on a user-owned table (candidate_profiles,
-- candidate_saved_jobs, candidate_job_applications,
-- candidate_job_events, subscribers) must qualify rows with
-- auth.uid() = user_id (or equivalent) in qual/with_check.
-- Read-only public tables (jobs, seo pages) may intentionally
-- allow anon SELECT — confirm each one is publish-filtered.
SELECT tablename,
       policyname,
       roles,
       cmd,
       qual,
       with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- §6. Verdict: tables failing the audit (RLS off, or any
-- effective anon/authenticated privilege). Expected: zero rows.
WITH flags AS (
  SELECT t.tablename,
         (NOT t.rowsecurity) AS rls_off,
         (has_table_privilege('anon',          format('%I.%I', t.schemaname, t.tablename), 'SELECT')
       OR has_table_privilege('anon',          format('%I.%I', t.schemaname, t.tablename), 'INSERT')
       OR has_table_privilege('anon',          format('%I.%I', t.schemaname, t.tablename), 'UPDATE')
       OR has_table_privilege('anon',          format('%I.%I', t.schemaname, t.tablename), 'DELETE')) AS anon_access,
         (has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'SELECT')
       OR has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'INSERT')
       OR has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'UPDATE')
       OR has_table_privilege('authenticated', format('%I.%I', t.schemaname, t.tablename), 'DELETE')) AS auth_access
  FROM pg_tables t
  WHERE t.schemaname = 'public'
)
SELECT tablename,
       rls_off,
       anon_access,
       auth_access
FROM flags
WHERE rls_off OR anon_access OR auth_access
ORDER BY tablename;
