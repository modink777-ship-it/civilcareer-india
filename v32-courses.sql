-- ════════════════════════════════════════════════════════════════
-- CivilCareer v32 — COURSE AGGREGATOR
-- Run once in the Supabase SQL editor (same procedure as the other
-- root-level phase*.sql / v*.sql files). Additive only: nothing is
-- dropped, nothing existing is modified.
--
-- Model:
--   courses        — curated civil-engineering learning resources.
--                    Default is_published = false: every row is a
--                    draft until an admin reviews and publishes it.
--   course_clicks  — aggregate outbound-click counters. NO personal
--                    data: no IP, no user id, no cookies. The server
--                    (service role) is the only writer.
--
-- RLS:
--   public/anon may SELECT published courses and nothing else.
--   They cannot insert, update, delete, publish, or touch
--   affiliate_url. All writes go through the server-side APIs
--   (/api/courses, /api/course-discovery) which authenticate the
--   admin session and use the service-role key.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.courses (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  provider           text not null,
  instructor         text,
  category           text,
  target_roles       text[] not null default '{}',
  career_stage       text,
  price_inr          integer not null default 0,
  original_price_inr integer,
  rating             numeric,
  enrollment_count   integer,
  duration_hours     numeric,
  language           text,
  thumbnail_url      text,
  course_url         text not null,
  affiliate_url      text,
  external_id        text,
  source             text not null default 'manual',
  is_free            boolean not null default false,
  is_published       boolean not null default false,
  is_featured        boolean not null default false,
  -- section 35: a temporarily failing external link is a warning,
  -- never a reason to delete a row automatically.
  url_status         text not null default 'unchecked',
  url_checked_at     timestamptz,
  admin_notes        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Indexes for the list page filters and the admin queue (section 33).
create index if not exists courses_provider_idx        on public.courses (provider);
create index if not exists courses_category_idx        on public.courses (category);
create index if not exists courses_career_stage_idx    on public.courses (career_stage);
create index if not exists courses_is_published_idx    on public.courses (is_published);
create index if not exists courses_is_featured_idx     on public.courses (is_featured);
create index if not exists courses_is_free_idx         on public.courses (is_free);
create index if not exists courses_external_id_idx     on public.courses (external_id);
create index if not exists courses_created_at_idx      on public.courses (created_at desc);
create index if not exists courses_target_roles_idx    on public.courses using gin (target_roles);

-- Duplicate strategy (section 33/34): provider + external_id is unique
-- when an external id exists. NULL external_id rows (manual entries
-- without one) are exempt — Postgres treats NULLs as distinct.
create unique index if not exists courses_provider_external_uidx
  on public.courses (provider, external_id)
  where external_id is not null;

-- updated_at maintenance.
create or replace function public.courses_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists courses_touch on public.courses;
create trigger courses_touch
  before update on public.courses
  for each row execute function public.courses_touch_updated_at();

-- ── course_clicks: aggregate behaviour only ────────────────────
create table if not exists public.course_clicks (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid not null references public.courses (id) on delete cascade,
  created_at timestamptz not null default now(),
  referrer   text,
  source     text
);

create index if not exists course_clicks_course_id_idx on public.course_clicks (course_id);
create index if not exists course_clicks_created_at_idx on public.course_clicks (created_at desc);

-- ── RLS ────────────────────────────────────────────────────────
alter table public.courses enable row level security;
alter table public.course_clicks enable row level security;

-- Public reads see published rows only. Drafts (is_published =
-- false) are invisible to anon/authenticated: an unpublished course
-- can never leak through PostgREST even if a client guesses the URL.
drop policy if exists courses_published_read on public.courses;
create policy courses_published_read
  on public.courses
  for select
  to anon, authenticated
  using (is_published = true);

-- No insert/update/delete policies for anon or authenticated at
-- all: every write happens through the service role in the
-- server-side APIs, so nobody without admin authorization can
-- publish, edit, change affiliate_url, or delete.

-- course_clicks deliberately has NO policies: anon cannot read or
-- write click rows; the server records clicks with the service role.
