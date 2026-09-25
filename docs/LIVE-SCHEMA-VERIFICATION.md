# P1 live-schema verification checklist

This checklist must be completed in the Supabase project before any SQL migration is run.

## Record the live schema

In Supabase SQL Editor, run read-only inspection queries appropriate to the project. Record the results privately; do not commit production data.

```sql
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;
```

```sql
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;
```

```sql
select conrelid::regclass as table_name,
       conname,
       contype,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace
order by table_name, conname;
```

## Record data size and counts

```sql
select count(*) as jobs_count from public.jobs;
```

```sql
select pg_size_pretty(pg_total_relation_size('public.jobs')) as jobs_total_size;
```

Also record counts for tables used by the deployed APIs, such as exams, materials, submissions, reports, analytics and candidate interaction tables when they exist.

## Compare with repository code

Pay special attention to fields used by:

- `api/jobs.js`
- `api/sitemap.js`
- `api/agent.js`
- `api/exams.js`
- `api/materials.js`
- `lib/discovery-*`
- `v8.js`
- `app.js`

Any field used by code but absent from production must be treated as a deployment blocker for that feature, not silently guessed or added destructively.

## Approval gate

Do not create indexes or add columns until:

- the backup is verified;
- the live schema is recorded;
- the migration is additive and reversible;
- the expected API behavior is documented;
- a post-migration verification query is prepared.
