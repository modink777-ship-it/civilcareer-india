-- ════════════════════════════════════════════════════════════════════
-- CivilCareer — v30: AI Job Collection + Admin Job Inbox
--
-- The collector receives material the owner INTENTIONALLY submits
-- (pasted text, screenshots/posters, PDFs, job URLs), keeps the original
-- source, extracts individual jobs, scores civil relevance, flags
-- duplicates and parks everything in an inbox that only an allowlisted
-- admin can read. Nothing reaches the public jobs table without an
-- explicit human "Approve & Publish".
--
-- Safe + additive: creates tables/columns/indexes only. Nothing dropped.
-- Every table has RLS enabled with NO public policy — only the server
-- (service-role key) can read or write, matching the rest of the site.
-- ════════════════════════════════════════════════════════════════════

-- ── batches: one per collection session ───────────────────────────────
create table if not exists public.job_import_batches (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  label text,
  status text not null default 'open',      -- open | processing | done | partial | failed
  source_count int not null default 0,
  processed_count int not null default 0,
  jobs_detected int not null default 0,
  duplicates int not null default 0,
  irrelevant int not null default 0,
  unreadable int not null default 0,
  failed_count int not null default 0,
  notes text
);
create index if not exists job_import_batches_created_idx on public.job_import_batches (created_at desc);

-- ── source items: the original material, never discarded ──────────────
create table if not exists public.job_import_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.job_import_batches(id) on delete cascade,
  created_at timestamptz not null default now(),
  kind text not null,                        -- text | url | image | pdf
  filename text,
  mime text,
  byte_size int,
  storage_path text,                         -- private bucket path (job-sources)
  source_url text,
  raw_text text,                             -- pasted text and/or OCR output
  status text not null default 'pending',    -- pending | processing | processed | needs_text | failed
  error text,
  jobs_found int not null default 0,
  extraction_method text,                    -- rules | ai | vision | url_fetch
  processed_at timestamptz
);
create index if not exists job_import_items_batch_idx on public.job_import_items (batch_id, created_at);
create index if not exists job_import_items_status_idx on public.job_import_items (status);

-- ── inbox: one row per detected job, awaiting human review ────────────
create table if not exists public.job_inbox (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references public.job_import_batches(id) on delete set null,
  item_id uuid references public.job_import_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  status text not null default 'pending',    -- pending | needs_attention | approved | rejected | failed
  title text,
  company text,
  company_url text,
  city text,
  state text,
  country text,
  location text,
  job_type text,
  work_mode text,
  department text,
  industry text,
  experience_min int,
  experience_max int,
  fresher_allowed boolean,
  experience_text text,
  degree text,
  branch text,
  qualification text,
  skills jsonb not null default '[]'::jsonb,
  salary text,
  salary_min numeric,
  salary_max numeric,
  salary_currency text,
  salary_period text,
  application_url text,
  application_email text,
  application_phone text,
  application_instructions text,
  description text,
  expiry date,

  source_type text,                          -- whatsapp_forward | linkedin_saved | telegram | employer | government | manual | url
  source_url text,
  source_file text,
  raw_text text,

  relevance_category text,
  relevance_score numeric,
  confidence_score numeric,
  confidence_reason text,

  duplicate_of uuid,
  duplicate_score numeric,
  duplicate_reasons jsonb not null default '[]'::jsonb,

  ai_provider text,
  ai_model text,
  extraction_method text,

  review_notes text,
  reject_reason text,
  admin_edited boolean not null default false,
  published_job_id uuid,
  approved_at timestamptz,
  approved_by text,
  events jsonb not null default '[]'::jsonb
);
create index if not exists job_inbox_status_idx on public.job_inbox (status, created_at desc);
create index if not exists job_inbox_batch_idx on public.job_inbox (batch_id);
create index if not exists job_inbox_duplicate_idx on public.job_inbox (duplicate_of) where duplicate_of is not null;

-- ── audit log ─────────────────────────────────────────────────────────
create table if not exists public.job_inbox_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  inbox_id uuid references public.job_inbox(id) on delete cascade,
  batch_id uuid,
  item_id uuid,
  actor text,
  event text not null,                       -- source_received | processing_started | processing_completed |
                                             -- duplicate_detected | admin_edited | approved | rejected | published | failed
  notes text,
  meta jsonb not null default '{}'::jsonb
);
create index if not exists job_inbox_events_inbox_idx on public.job_inbox_events (inbox_id, at desc);
create index if not exists job_inbox_events_at_idx on public.job_inbox_events (at desc);

-- ── RLS: server-only. The browser never talks to these tables directly. ──
alter table public.job_import_batches enable row level security;
alter table public.job_import_items   enable row level security;
alter table public.job_inbox          enable row level security;
alter table public.job_inbox_events   enable row level security;

-- ── private storage bucket for original material ──────────────────────
-- originals are NOT publicly readable; the admin UI uses short-lived signed URLs
insert into storage.buckets (id, name, public)
values ('job-sources', 'job-sources', false)
on conflict (id) do nothing;

-- Verify (optional):
-- select status, count(*) from public.job_inbox group by status;
