-- CivilCareer V16 — contact messages (additive only)
-- Review and run in Supabase SQL editor after confirming the current schema.
create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  message text not null,
  status text not null default 'New' check (status in ('New','Read','Resolved','Spam')),
  created_at timestamptz not null default now()
);

alter table public.contact_messages enable row level security;
revoke all on table public.contact_messages from anon, authenticated;

drop policy if exists contact_messages_service_role_only on public.contact_messages;
create policy contact_messages_service_role_only
  on public.contact_messages
  for all
  to service_role
  using (true)
  with check (true);

create index if not exists contact_messages_created_at_idx on public.contact_messages(created_at desc);
create index if not exists contact_messages_status_idx on public.contact_messages(status);
