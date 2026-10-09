-- ════════════════════════════════════════════════════════════════
-- CivilCareer v35 — SAVED COURSES (bookmarks)
-- Run once in the Supabase SQL editor, after v32/v34 (courses table).
-- Additive only: creates one new table; no existing table is altered.
--
-- Why:
--   Signed-in visitors can bookmark a course ("★ Save") on the course
--   cards and the course detail screen. The row stores ONLY ids and a
--   timestamp — no personal data beyond the owning user_id, which the
--   account API already scopes the same way for jobs.
--
--   RLS note: the service_role key is the only writer used here (same
--   pattern as candidate_saved_jobs), so RLS can stay fully locked:
--   enable RLS and no anon policy is created on purpose. All reads and
--   writes go through the server, always scoped user_id = the verified
--   bearer owner.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.candidate_saved_courses (
  user_id uuid not null,
  course_id uuid not null references public.courses(id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

create index if not exists candidate_saved_courses_user_idx
  on public.candidate_saved_courses(user_id, saved_at desc);

alter table public.candidate_saved_courses enable row level security;

comment on table public.candidate_saved_courses is
  'Course bookmarks. One row per (user, course). Written only by the server with the service-role key, always scoped to the verified bearer owner; RLS stays closed to anon.';
