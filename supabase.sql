create extension if not exists pgcrypto;

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  source_url text not null unique,
  role text not null,
  company text,
  location text,
  description text,
  employment_type text,
  salary text,
  date_posted date,
  valid_through timestamptz,
  source text,
  published boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.jobs enable row level security;

-- The browser never talks to Supabase directly. Vercel server functions use the service key.
-- RLS therefore remains locked down to protect owner data.
create index if not exists jobs_created_at_idx on public.jobs (created_at desc);
