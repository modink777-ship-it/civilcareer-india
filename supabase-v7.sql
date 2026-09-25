alter table public.jobs add column if not exists qualification text;
alter table public.jobs add column if not exists posted_date date default current_date;
alter table public.jobs add column if not exists application_method text;
alter table public.jobs add column if not exists contact_info text;
alter table public.jobs add column if not exists featured boolean not null default false;
alter table public.jobs add column if not exists last_verified date;
alter table public.jobs add column if not exists status text not null default 'Active';
alter table public.jobs add column if not exists vacancy_count integer;
alter table public.jobs add column if not exists age_limit text;
alter table public.jobs add column if not exists application_fee text;
alter table public.jobs add column if not exists application_start date;
alter table public.jobs add column if not exists recruitment_authority text;
alter table public.exams add column if not exists last_verified date;
alter table public.materials add column if not exists author text;

create table if not exists public.employer_submissions (
 id uuid primary key default gen_random_uuid(), company_name text not null, job_title text not null,
 location text, description text, experience text, qualification text, employment_type text,
 salary text, application_method text, official_url text not null, contact_info text,
 status text not null default 'Pending', created_at timestamptz not null default now()
);
create table if not exists public.resource_submissions (
 id uuid primary key default gen_random_uuid(), title text not null, category text not null,
 description text, resource_url text not null, author text, permission_confirmed boolean not null default false,
 status text not null default 'Pending', created_at timestamptz not null default now()
);
create table if not exists public.content_reports (
 id uuid primary key default gen_random_uuid(), report_type text not null, content_url text,
 details text, contact_email text, status text not null default 'Open', created_at timestamptz not null default now()
);
create table if not exists public.analytics_events (
 id bigint generated always as identity primary key, visitor_id text not null, event_type text not null default 'pageview',
 path text not null, event_label text, referrer_domain text, device_type text, country text,
 created_at timestamptz not null default now()
);
alter table public.employer_submissions enable row level security;
alter table public.resource_submissions enable row level security;
alter table public.content_reports enable row level security;
alter table public.analytics_events enable row level security;
create index if not exists analytics_created_idx on public.analytics_events(created_at desc);
create index if not exists analytics_visitor_idx on public.analytics_events(visitor_id);
create index if not exists employer_status_idx on public.employer_submissions(status);
create index if not exists resources_status_idx on public.resource_submissions(status);
create index if not exists reports_status_idx on public.content_reports(status);

create or replace function public.civilcareer_analytics_summary()
returns jsonb language sql security definer set search_path=public as $$
select jsonb_build_object(
 'total_page_views',(select count(*) from analytics_events where event_type='pageview'),
 'unique_visitors',(select count(distinct visitor_id) from analytics_events where event_type='pageview'),
 'visitors_today',(select count(distinct visitor_id) from analytics_events where event_type='pageview' and created_at>=current_date),
 'visitors_week',(select count(distinct visitor_id) from analytics_events where event_type='pageview' and created_at>=current_date-interval '6 days'),
 'visitors_month',(select count(distinct visitor_id) from analytics_events where event_type='pageview' and created_at>=date_trunc('month',now())),
 'searches_month',(select count(*) from analytics_events where event_type='search' and created_at>=date_trunc('month',now())),
 'top_pages',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (select path,count(*)::int as views from analytics_events where event_type='pageview' group by path order by views desc limit 8)x),
 'traffic_sources',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (select coalesce(nullif(referrer_domain,''),'Direct') source,count(*)::int visits from analytics_events where event_type='pageview' group by 1 order by visits desc limit 8)x),
 'devices',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (select coalesce(device_type,'Unknown') device,count(*)::int visits from analytics_events where event_type='pageview' group by 1 order by visits desc)x),
 'countries',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from (select coalesce(country,'Unknown') country,count(*)::int visits from analytics_events where event_type='pageview' group by 1 order by visits desc limit 8)x),
 'daily',(select jsonb_agg(to_jsonb(x) order by view_date) from (select d::date as view_date,(select count(*)::int from analytics_events where event_type='pageview' and created_at>=d and created_at<d+interval '1 day') as views from generate_series(current_date-interval '6 days',current_date,interval '1 day') as d)x)
);
$$;
revoke all on function public.civilcareer_analytics_summary() from public;
grant execute on function public.civilcareer_analytics_summary() to service_role;
