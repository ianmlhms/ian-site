-- Private ShortsFactory dashboard — full data readable only by the admin.
-- Paste into Supabase ▸ SQL Editor ▸ New query ▸ Run. (Needs messenger-setup-v2.sql first, for is_admin().)

create table if not exists public.dashboard_state (
  id         int primary key default 1,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  constraint dashboard_single_row check (id = 1)
);

alter table public.dashboard_state enable row level security;

-- Only the admin can READ the full dashboard data.
drop policy if exists dashboard_admin_read on public.dashboard_state;
create policy dashboard_admin_read on public.dashboard_state
  for select using (public.is_admin());

-- No INSERT/UPDATE policy on purpose: the Mac mini publisher writes with the
-- service_role key, which bypasses RLS. Browsers (anon/authenticated) cannot write.
