-- ═══════════════════════════════════════════════════════════════════
-- CivilCareer v27 — SOCIAL CONTENT ENGINE (database schema)
--
-- WHAT THIS ADDS — 3 new tables. Nothing existing is altered,
-- dropped or renamed. Existing jobs/exam data is untouched.
--
--   1. social_suggestions  one content unit per VERIFIED source
--      record (exam_tracker rows in Phase 1, published jobs from
--      Phase 2), rendered by deterministic platform templates.
--      No AI by default — `ai_assist` is opt-in, recorded, and the
--      output still passes Truth Lock + admin approval.
--
--   2. social_publishes    send ledger: exactly one row per
--      (suggestion × platform), holding the platform's own object
--      id (Telegram message_id · LinkedIn UGC URN · Instagram
--      container/media id) plus per-platform status.
--
--   3. social_connections  NON-secret metadata for connected
--      platform accounts. Access tokens live ONLY in Vercel
--      environment variables, never in this database.
--
-- PIPELINE IT SUPPORTS (Social Content Engine spec):
--   verified job/exam record
--   → deterministic platform template (no AI by default)
--   → Truth Lock (source_snapshot + truth_hash frozen at creation;
--      any later change to the source row flips truth_state to
--      'stale' and blocks approval/publish until re-locked)
--   → explicit admin approval (approved_by / approved_at)
--   → publish & track, ONE platform per request:
--       Telegram · LinkedIn · Instagram
--   WhatsApp is deliberately NOT a platform here: manual copy +
--   wa.me deep link only (no WhatsApp Business API, no auto-send).
--
-- INSTAGRAM TWO-STEP PUBLISHING (Meta container model):
--   social_publishes.status = 'needs_second_step' means the media
--   container was created (its id is in external_id) but the
--   follow-up POST …/media_publish has not happened yet. 'expired'
--   marks a container that aged out of Meta's validity window.
--
-- INSTAGRAM ROUTE NOTE (verified against Meta docs, Oct 2026):
--   - "Instagram API with Instagram Login" (graph.instagram.com,
--     Business Login for Instagram, scopes instagram_business_basic
--     + instagram_content_publish) does NOT need a Facebook Page.
--   - "Instagram API with Facebook Login" (graph.facebook.com) DOES
--     require a Facebook Page linked to the Instagram professional
--     account, and Page Publishing Authorization (PPA) if the Page
--     requires it. social_connections.route records which route the
--     deployment uses; facebook_page_id is required only for the
--     Facebook-Login route.
--
-- LINKEDIN NOTE: UGC Posts API — POST /v2/ugcPosts, author urn
--   urn:li:person:{id} or urn:li:organization:{id}, scope
--   w_member_social / w_organization_social. Member tokens expire
--   (~60 days), so token_expires_at is tracked advisory-ly.
--
-- SECURITY: mirrors the production lockdown. RLS is enabled, anon
--   and authenticated are revoked, and a service_role-only policy
--   is added — the same pattern as contact_messages (v16). All
--   engine access goes through /api/social server routes which
--   verify the ADMIN_EMAIL allowlist before touching Supabase.
--
-- DEDUPE: a partial unique index allows ONE live suggestion per
--   (source_type, source_id, template_key). Rejected/archived
--   rows are excluded, so a re-triggered event (e.g. an exam that
--   closes and re-opens applications) may create a fresh suggestion.
--
─ HOW TO RUN: paste into the Supabase SQL Editor (project
--   tnjegaqheyaukyqqighz) and run once. Safe to re-run — every
--   statement is IF [NOT] EXISTS.
--
-- HOW TO VERIFY (run after, expect the noted results):
--   select to_regclass('public.social_suggestions'),
--          to_regclass('public.social_publishes'),
--          to_regclass('public.social_connections');
--     → three non-null relation names
--   select table_name, row_security from information_schema.tables
--    where table_schema='public'
--      and table_name in ('social_suggestions','social_publishes','social_connections');
--     → row_security = true for all three
--   select has_table_privilege('anon','social_suggestions','select'),
--          has_table_privilege('authenticated','social_suggestions','select');
--     → false, false  (public lockdown intact)
--
-- ROLLBACK: supabase-v27-social-engine-rollback.sql
-- ═══════════════════════════════════════════════════════════════════

begin;

-- ───────────────────── 1 · SOCIAL SUGGESTIONS ─────────────────────
create table if not exists public.social_suggestions (
  id uuid primary key default gen_random_uuid(),

  -- Source of truth this suggestion is rendered from.
  source_type text not null,           -- 'exam_tracker' (Phase 1) | 'job' (Phase 2)
  source_id uuid not null,             -- exam_tracker.id / jobs.id (uuid on both tables;
                                       -- no FK by design: keeps the engine source-agnostic
                                       -- and deployable against dev databases)
  template_key text not null,          -- deterministic template id, e.g.
                                       -- 'exam.application_open', 'job.published'

  -- Deterministically rendered text (template output, never AI by default).
  title text not null,                 -- headline for the admin queue + LinkedIn
  body_telegram text,                  -- Telegram message text (≤ 4,096 chars)
  body_linkedin text,                  -- LinkedIn UGC post text (≤ 3,000 chars)
  caption_instagram text,              -- Instagram caption (≤ 2,200 chars)
  whatsapp_text text,                  -- manual-copy text for WhatsApp + wa.me link
                                       -- (keep ≤ 1,000 chars: the wa.me URL must stay
                                       --  within browser/server URL length limits)
  link_url text,                       -- canonical deep link back to CivilCareer

  -- TRUTH LOCK: the frozen evidence this content was rendered from.
  source_snapshot jsonb not null default '{}'::jsonb,
                                       -- exact source fields the templates read
  truth_hash text,                     -- sha256 of canonicalised source_snapshot
                                       -- (computed by the API, sorted-key JSON)
  truth_state text not null default 'locked'
    check (truth_state in ('locked','stale','unverified')),
                                       -- 'locked'    content == verified source row
                                       -- 'stale'     source row changed after lock;
                                       --             approval/publish blocked until
                                       --             the suggestion is re-rendered
                                       -- 'unverified' created without a verified
                                       --             source row (defensive; never
                                       --             created by the pipeline)
  truth_checked_at timestamptz,

  -- AI assist is OPT-IN and always recorded. Default false = "no AI".
  ai_assist boolean not null default false,
  ai_model text,
  ai_rendered_at timestamptz,

  -- Lifecycle.
  status text not null default 'pending'
    check (status in ('pending','approved','published','partial','rejected','archived')),
                                       -- 'pending'    awaiting admin approval (Truth Locked)
                                       -- 'approved'   explicitly approved, publishable
                                       -- 'published'  every platform send succeeded
                                       -- 'partial'    some platforms sent, some failed
                                       -- 'rejected'   admin rejected (audit-kept)
                                       -- 'archived'   historical
  admin_note text,                     -- admin's reason when approving/rejecting
  created_by text,                     -- admin email | 'system:exam-tracker'
  approved_by text,
  approved_at timestamptz,
  rejected_by text,
  rejected_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live suggestion per (source, template) — duplicate-proofing
-- for repeated status transitions and double-clicks.
create unique index if not exists social_suggestions_source_dedupe
  on public.social_suggestions (source_type, source_id, template_key)
  where status not in ('rejected','archived');

create index if not exists social_suggestions_status_idx
  on public.social_suggestions (status, created_at desc);
create index if not exists social_suggestions_source_idx
  on public.social_suggestions (source_type, source_id);
create index if not exists social_suggestions_template_idx
  on public.social_suggestions (template_key);

-- ───────────────────── 2 · SOCIAL PUBLISHES ─────────────────────
create table if not exists public.social_publishes (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null
    references public.social_suggestions(id) on delete cascade,

  -- WhatsApp is intentionally not an allowed value: manual copy only.
  platform text not null
    check (platform in ('telegram','linkedin','instagram')),

  status text not null default 'pending'
    check (status in ('pending','sent','failed','needs_second_step','expired')),
                                       -- 'pending'          approved, not yet attempted
                                       -- 'sent'             platform confirmed delivery;
                                       --                  external_id captured
                                       -- 'failed'           hard failure; last_error set
                                       -- 'needs_second_step'Instagram: container created,
                                       --                  media_publish still to come
                                       -- 'expired'        Instagram container aged out
  external_id text,                    -- Telegram message_id · LinkedIn UGC URN ·
                                       -- Instagram container id (step 1) / media id (step 2)
  external_url text,                   -- platform permalink, when the API returns one
  destination_ref text,                -- where it went: Telegram chat_id (main channel
                                       -- vs TELEGRAM_TEST_CHANNEL_ID), LinkedIn author URN,
                                       -- Instagram professional account id
  attempts integer not null default 0
    check (attempts >= 0),
  last_error text,
  response_snapshot jsonb,             -- raw platform response for audit/debug
  sent_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (suggestion_id, platform)     -- one ledger row per platform per suggestion
);

create index if not exists social_publishes_status_idx
  on public.social_publishes (status, platform, created_at);
create index if not exists social_publishes_suggestion_idx
  on public.social_publishes (suggestion_id);

-- ───────────────────── 3 · SOCIAL CONNECTIONS ─────────────────────
-- Non-secret metadata ONLY. Tokens stay in Vercel env variables
-- (TELEGRAM_BOT_TOKEN, LINKEDIN_ACCESS_TOKEN, INSTAGRAM_ACCESS_TOKEN …).
create table if not exists public.social_connections (
  id uuid primary key default gen_random_uuid(),
  platform text not null
    check (platform in ('telegram','linkedin','instagram')),
  route text,                          -- 'telegram_bot' | 'linkedin_member' |
                                       -- 'linkedin_organization' | 'instagram_login'
                                       -- | 'facebook_login'
  external_id text not null,           -- Telegram channel id · LinkedIn person/org id ·
                                       -- Instagram professional account id
  display_name text,
  facebook_page_id text,               -- Instagram-via-Facebook-Login route only:
                                       -- the Page linked to the professional account
                                       -- (required by Meta on that route; see header)
  scope text,                          -- granted permissions, e.g.
                                       -- 'instagram_business_basic,instagram_content_publish'
  token_expires_at timestamptz,        -- advisory: the real token lives in env
  is_primary boolean not null default false,
  status text not null default 'active'
    check (status in ('active','disabled')),
  last_verified_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (platform, external_id)
);

create index if not exists social_connections_platform_idx
  on public.social_connections (platform, status);

-- ───────────────────── 4 · ROW LEVEL SECURITY ─────────────────────
-- Production lockdown posture: RLS on, anon + authenticated revoked,
-- service_role-only policy (same pattern as contact_messages, v16).
alter table public.social_suggestions  enable row level security;
alter table public.social_publishes    enable row level security;
alter table public.social_connections  enable row level security;

revoke all on table public.social_suggestions  from anon, authenticated;
revoke all on table public.social_publishes    from anon, authenticated;
revoke all on table public.social_connections  from anon, authenticated;

drop policy if exists social_suggestions_service_role_only on public.social_suggestions;
create policy social_suggestions_service_role_only
  on public.social_suggestions for all to service_role
  using (true) with check (true);

drop policy if exists social_publishes_service_role_only on public.social_publishes;
create policy social_publishes_service_role_only
  on public.social_publishes for all to service_role
  using (true) with check (true);

drop policy if exists social_connections_service_role_only on public.social_connections;
create policy social_connections_service_role_only
  on public.social_connections for all to service_role
  using (true) with check (true);

commit;

-- ───────────────────── 5 · VERIFY (run after) ─────────────────────
-- All three should print the table names:
select to_regclass('public.social_suggestions')  as suggestions,
       to_regclass('public.social_publishes')    as publishes,
       to_regclass('public.social_connections')  as connections;

-- row_security must be true for all three:
select table_name, row_security
from information_schema.tables
where table_schema = 'public'
  and table_name in ('social_suggestions','social_publishes','social_connections')
order by table_name;

-- Public lockdown intact — both must be false:
select has_table_privilege('anon', 'social_suggestions', 'select')        as anon_select,
       has_table_privilege('authenticated', 'social_suggestions', 'select') as auth_select;

-- Live suggestion count by status (expect 0 rows — fresh install):
select status, count(*) from public.social_suggestions group by status;

-- ═══════════════════════════════════════════════════════════════════
-- ENV FLAGS THIS ENGINE READS (set in Vercel, never in the DB):
--   LEGACY_TELEGRAM_AUTOPOST   'true'/'1' = ON (default) keeps the
--                              pre-v27 direct Telegram auto-post from
--                              the jobs publish hook ON while the
--                              engine does not yet cover jobs (Phase 2
--                              flips it OFF). The exam-tracker hook is
--                              routed into the engine regardless.
--   TELEGRAM_TEST_CHANNEL_ID   optional private channel id — the
--                              admin "Send test" button posts there
--                              first; production sends go to
--                              TELEGRAM_CHANNEL_ID.
--   ADMIN_EMAIL / ADMIN_USER_ID  server-side allowlist for /api/social.
--   TELEGRAM_BOT_TOKEN, TELEGRAM_CHANNEL_ID — existing secrets.
--   LINKEDIN_ACCESS_TOKEN, LINKEDIN_ORGANIZATION_ID — Phase 2.
--   INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID — Phase 2.
-- ═══════════════════════════════════════════════════════════════════
