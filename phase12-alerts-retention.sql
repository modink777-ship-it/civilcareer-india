-- CivilCareer Phase 7 — alerts and notification queue.
-- Safe additive migration. Do not run automatically in deployment.
alter table public.job_alerts add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.job_alerts add column if not exists keywords text not null default '';
alter table public.job_alerts add column if not exists role text not null default '';
alter table public.job_alerts add column if not exists state text not null default '';
alter table public.job_alerts add column if not exists city text not null default '';
alter table public.job_alerts add column if not exists work_type text not null default '';
alter table public.job_alerts add column if not exists frequency text not null default 'daily';
alter table public.job_alerts add column if not exists unsubscribe_token text;
alter table public.job_alerts add column if not exists last_evaluated_at timestamptz;
create index if not exists job_alerts_user_idx on public.job_alerts(user_id,created_at desc);
create index if not exists job_alerts_frequency_idx on public.job_alerts(active,frequency,last_evaluated_at);
create unique index if not exists job_alerts_user_one_idx on public.job_alerts(user_id) where user_id is not null;
create table if not exists public.job_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.job_alerts(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  error text,
  unique(alert_id,job_id)
);
create index if not exists job_alert_deliveries_pending_idx on public.job_alert_deliveries(status,created_at);
alter table public.job_alerts enable row level security;
alter table public.job_alert_deliveries enable row level security;
drop policy if exists job_alerts_owner on public.job_alerts;
create policy job_alerts_owner on public.job_alerts for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
drop policy if exists job_alert_deliveries_owner on public.job_alert_deliveries;
create policy job_alert_deliveries_owner on public.job_alert_deliveries for select using (exists(select 1 from public.job_alerts a where a.id=alert_id and a.user_id=auth.uid()));
