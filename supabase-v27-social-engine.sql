-- ==========================================================
-- CivilCareer v27 - SOCIAL CONTENT ENGINE (final, corrected)
--
-- Additive only: creates 4 NEW tables and 1 trigger function.
-- Nothing existing is altered, dropped or renamed.
-- Safe to re-run (every statement is IF NOT EXISTS / OR REPLACE).
-- Run once in the Supabase SQL Editor of your own project.
--
-- Tables:
--   social_suggestions   one content unit per VERIFIED source record
--   social_publishes     send ledger (one real row per suggestion x platform)
--   social_connections   NON-secret account metadata (tokens live in Vercel env only)
--   social_settings      single-row config: kill switch, approval, daily caps
--
-- Key rules the API must follow (the database cannot enforce all of them):
--   * TRUTH LOCK at publish: recompute truth_hash from the LIVE source row and
--     refuse (409) on mismatch; recompute approved_content_hash from the current
--     text and refuse (409) on mismatch. Never trust the stored truth_state alone.
--   * approved_content_hash = sha256 of title, body_telegram, body_linkedin,
--     caption_instagram, whatsapp_text, link_url, media_url (nulls as empty
--     strings, joined by the ASCII unit separator 0x1F). Edits clear it.
--   * Insert/claim the ledger row as 'publishing' BEFORE any platform call, using
--     an atomic conditional update (status guard + returning).
--   * A 'publishing' row older than 2 minutes is treated as 'uncertain'.
--     'uncertain' is NEVER auto-retried; an admin resolves it.
--   * Test sends set is_test = true; they are excluded from caps, rollup and the
--     "already published" check.
--   * Daily caps count rows by last_attempt_at on the day boundary of
--     social_settings.caps_timezone (default Asia/Kolkata); 'uncertain' counts.
--   * Redact tokens / Authorization / access_token URLs before storing
--     last_error or response_snapshot.
--   * WhatsApp is NOT a platform here: manual copy + wa.me link only.
--
-- Rollup of ledger statuses into social_suggestions.status (real rows only):
--   any 'publishing' or 'needs_second_step'            -> 'publishing'
--   >= 1 row and every row 'sent'                       -> 'published'
--   >= 1 'sent', the rest failed/uncertain/expired/cancelled -> 'partial'
--   no rows, or only 'pending'/'cancelled'/failed       -> 'approved'
--   'pending', 'rejected', 'archived' are admin-set, never rolled up.
-- ==========================================================

begin;

-- 1. SOCIAL SUGGESTIONS
create table if not exists public.social_suggestions (
  id uuid primary key default gen_random_uuid(),

  source_type text not null
    check (source_type in ('exam_tracker','job','govt_job')),
  source_id uuid not null,            -- no FK by design (source-agnostic)
  template_key text not null,         -- '<entity>.<event>.<discriminator>'

  title text not null,
  body_telegram text,                 -- <= 4096 chars
  body_linkedin text,                 -- <= 3000 chars
  caption_instagram text,             -- <= 2200 chars, <= 30 hashtags
  whatsapp_text text,                 -- manual copy; keep <= 1000 chars
  link_url text,                      -- host must match SITE_URL host
  media_url text,                     -- public JPEG URL (Instagram needs JPEG)

  source_snapshot jsonb not null default '{}'::jsonb,
  truth_hash text,
  truth_state text not null default 'locked'
    check (truth_state in ('locked','stale','unverified')),
  truth_checked_at timestamptz,

  approved_content_hash text,         -- see header
  edited_at timestamptz,
  edited_by text,

  ai_assist boolean not null default false,
  ai_model text,
  ai_rendered_at timestamptz,

  status text not null default 'pending'
    check (status in ('pending','approved','publishing','published','partial','rejected','archived')),
  admin_note text,
  created_by text,
  approved_by text,
  approved_at timestamptz,
  rejected_by text,
  rejected_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists social_suggestions_source_dedupe
  on public.social_suggestions (source_type, source_id, template_key)
  where status not in ('rejected','archived');
create index if not exists social_suggestions_status_idx
  on public.social_suggestions (status, created_at desc);
create index if not exists social_suggestions_source_idx
  on public.social_suggestions (source_type, source_id);
create index if not exists social_suggestions_template_idx
  on public.social_suggestions (template_key);

-- 2. SOCIAL PUBLISHES (send ledger)
create table if not exists public.social_publishes (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null
    references public.social_suggestions(id) on delete restrict,

  platform text not null
    check (platform in ('telegram','linkedin','instagram')),

  status text not null default 'pending'
    check (status in ('pending','publishing','sent','failed','uncertain','cancelled','needs_second_step','expired')),

  is_test boolean not null default false,

  external_id text,                   -- Telegram message_id / LinkedIn post URN / Instagram container or media id
  external_url text,
  destination_ref text,               -- Telegram chat id (main vs test) / LinkedIn author URN / Instagram account id
  attempts integer not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  last_error text,                    -- REDACTED before storage
  response_snapshot jsonb,            -- REDACTED before storage
  sent_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One REAL ledger row per platform per suggestion (test rows are exempt).
create unique index if not exists social_publishes_one_real_per_platform
  on public.social_publishes (suggestion_id, platform)
  where is_test = false;
create index if not exists social_publishes_status_idx
  on public.social_publishes (status, platform, updated_at);
create index if not exists social_publishes_suggestion_idx
  on public.social_publishes (suggestion_id);
create index if not exists social_publishes_platform_day_idx
  on public.social_publishes (platform, last_attempt_at desc);

-- 3. SOCIAL CONNECTIONS (non-secret metadata only)
create table if not exists public.social_connections (
  id uuid primary key default gen_random_uuid(),
  platform text not null
    check (platform in ('telegram','linkedin','instagram')),
  route text,                         -- telegram_bot | linkedin_member | linkedin_organization | instagram_login | facebook_login
  external_id text not null,
  display_name text,
  facebook_page_id text,              -- only for the Facebook Login route
  scope text,                         -- e.g. instagram_business_basic,instagram_business_content_publish
  token_expires_at timestamptz,       -- advisory; the real token lives in env
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
create unique index if not exists social_connections_one_primary
  on public.social_connections (platform)
  where is_primary = true;

-- 4. SOCIAL SETTINGS (single row)
create table if not exists public.social_settings (
  id smallint primary key default 1 check (id = 1),
  kill_switch boolean not null default false,
  require_approval boolean not null default true,
  per_platform_daily_caps jsonb not null
    default '{"telegram": 5, "linkedin": 2, "instagram": 2}'::jsonb,
  caps_timezone text not null default 'Asia/Kolkata',
  default_hashtags text[] not null default '{}',
  footer text,
  site_url text,
  updated_at timestamptz not null default now()
);

insert into public.social_settings (id) values (1)
  on conflict (id) do nothing;

-- 5. UPDATED_AT TRIGGER (uniquely named function)
create or replace function public.social_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists social_suggestions_touch on public.social_suggestions;
create trigger social_suggestions_touch
  before update on public.social_suggestions
  for each row execute function public.social_set_updated_at();

drop trigger if exists social_publishes_touch on public.social_publishes;
create trigger social_publishes_touch
  before update on public.social_publishes
  for each row execute function public.social_set_updated_at();

drop trigger if exists social_connections_touch on public.social_connections;
create trigger social_connections_touch
  before update on public.social_connections
  for each row execute function public.social_set_updated_at();

drop trigger if exists social_settings_touch on public.social_settings;
create trigger social_settings_touch
  before update on public.social_settings
  for each row execute function public.social_set_updated_at();

-- 6. ROW LEVEL SECURITY (production lockdown: service_role only)
alter table public.social_suggestions enable row level security;
alter table public.social_publishes   enable row level security;
alter table public.social_connections enable row level security;
alter table public.social_settings    enable row level security;

revoke all on table public.social_suggestions from anon, authenticated;
revoke all on table public.social_publishes   from anon, authenticated;
revoke all on table public.social_connections from anon, authenticated;
revoke all on table public.social_settings    from anon, authenticated;

grant all on table public.social_suggestions, public.social_publishes,
                 public.social_connections, public.social_settings
  to service_role;

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

drop policy if exists social_settings_service_role_only on public.social_settings;
create policy social_settings_service_role_only
  on public.social_settings for all to service_role
  using (true) with check (true);

commit;
