-- Daily ian.lu traffic, aggregated from GoatCounter.
--
-- This lives in Postgres rather than a file under data/ because the site is
-- static and public: anything committed there is readable by anyone who
-- guesses the URL, which would make a "private" traffic page cosmetic.
-- Rows are written by scripts/fetch_visitors.py through the Supabase CLI,
-- which connects as the owner and so bypasses RLS; only admins can read.

create table if not exists public.site_traffic (
  day date primary key,
  unique_visitors integer not null default 0
    check (unique_visitors >= 0),
  pageviews integer not null default 0
    check (pageviews >= 0),
  -- [{"path": "/", "views": 41, "visitors": 22}, ...] for that day
  top_pages jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.site_traffic enable row level security;

drop policy if exists site_traffic_admin_read on public.site_traffic;
create policy site_traffic_admin_read
  on public.site_traffic
  for select
  to authenticated
  using (public.is_admin());

comment on table public.site_traffic is
  'Daily aggregate traffic from GoatCounter; admin-read only.';

-- traffic_writer is a plain role, not the owner, so RLS applies to it too and
-- the admin-read policy alone left every insert refused. These are scoped to
-- that database role, so they widen nothing for anyone signing in to the site.
drop policy if exists site_traffic_writer_select on public.site_traffic;
create policy site_traffic_writer_select
  on public.site_traffic for select to traffic_writer using (true);

drop policy if exists site_traffic_writer_insert on public.site_traffic;
create policy site_traffic_writer_insert
  on public.site_traffic for insert to traffic_writer with check (true);

drop policy if exists site_traffic_writer_update on public.site_traffic;
create policy site_traffic_writer_update
  on public.site_traffic for update to traffic_writer
  using (true) with check (true);
