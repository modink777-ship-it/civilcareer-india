-- ════════════════════════════════════════════════════════════════
-- CivilCareer v34 — COURSE DIRECTORY: CIVIL ENGINEERING SCOPE
-- Run once in the Supabase SQL editor, after v32-courses.sql (already
-- applied). Additive only: `alter table ... add column if not exists`
-- — no column is dropped or retyped, and existing rows keep working.
--
-- Why:
--   The /courses directory is now scope-locked to Civil Engineering
--   courses from Udemy and Coursera. Three facts about a course were
--   not representable before:
--
--   description      — the short factual blurb shown on a card. Comes
--                      from the provider feed or the admin's own text.
--                      NULL when nobody supplied one; nothing is ever
--                      generated to fill the gap.
--   specialization   — which Civil Engineering specialization the
--                      course teaches (AutoCAD & Civil 3D, STAAD.Pro,
--                      Quantity Surveying, GATE Civil Engineering …).
--                      This is the public filter AND the admin's
--                      "correct the classification" control. NULL means
--                      unclassified — the course must not be published
--                      until a human classifies it (enforced in
--                      _api/courses.js, not here, so the reason is
--                      visible as an API message).
--   civil_verified   — the admin has explicitly confirmed this IS a
--                      Civil Engineering course. Set only from the
--                      admin Courses tab; it overrides the automatic
--                      classifier for courses whose wording the
--                      classifier cannot read. Never set by an import,
--                      so an untouched draft can never reach /courses.
--
-- Scope notes:
--   * `provider` is deliberately NOT constrained by a CHECK constraint.
--     The directory surfaces only Udemy and Coursera today, enforced in
--     lib/course-civil.js, and a CHECK would need another migration the
--     day a third platform is legitimately added.
--   * RLS is unchanged: `courses_published_read` (anon/authenticated
--     SELECT WHERE is_published = true) from v32 remains the only
--     policy, so these new columns are readable publicly only on
--     published rows and writable only by the service role.
-- ════════════════════════════════════════════════════════════════

alter table public.courses add column if not exists description    text;
alter table public.courses add column if not exists specialization text;
alter table public.courses add column if not exists civil_verified boolean not null default false;

-- The public page filters by specialization and the admin queue sorts
-- by "needs a decision". Both are bounded scans today (the catalogue is
-- small), so plain btree indexes are enough.
create index if not exists courses_specialization_idx  on public.courses (specialization);
create index if not exists courses_civil_verified_idx  on public.courses (civil_verified);
create index if not exists courses_review_queue_idx    on public.courses (is_published, updated_at desc);

comment on column public.courses.description is
  'Short factual course description from the provider or the admin. NULL when not supplied — never auto-generated.';
comment on column public.courses.specialization is
  'Civil Engineering specialization label (filter + admin classification). NULL = unclassified, must not be published.';
comment on column public.courses.civil_verified is
  'Admin confirmed this is a Civil Engineering course; overrides the automatic classifier. Only the admin Courses tab sets it.';

-- ── price_inr becomes "unknown"-aware ──────────────────────────
-- v32 declared price_inr NOT NULL DEFAULT 0, so a course whose provider
-- did not publish a price was indistinguishable from a free one — the
-- catalogue would then show FREE for a price nobody ever supplied. The
-- directory spec forbids inventing prices, so 0 now means "this course
-- is free" and NULL means "the provider did not tell us". is_free stays
-- the explicit flag; nothing is derived from a missing price.
-- No data is changed: every existing row keeps its current value.
alter table public.courses alter column price_inr drop not null;
alter table public.courses alter column price_inr drop default;

comment on column public.courses.price_inr is
  '0 = free (or explicitly free); NULL = price not provided by the provider. Never inferred from a missing value.';

-- Verification (optional, read-only):
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'courses'
--      and column_name in ('description','specialization','civil_verified')
--    order by column_name;
