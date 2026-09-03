-- pro_sites: the index behind ian.lu/pro/.
-- Readable only by Ian.
--
-- The ten preview pages stay reachable by URL, since
-- each business must open its own link without an
-- account. What is private is the LIST itself: which
-- businesses have a preview at all.
--
-- So the list cannot sit in the static HTML, where
-- view-source would defeat any gate. It lives here,
-- and RLS gives anon exactly nothing.
--
-- Idempotent. No dollar-quoting, lines under 56
-- chars, so an editor paste cannot mangle it.

create table if not exists public.pro_sites (
  slug       text primary key,
  name       text not null,
  tagline    text not null default '',
  town       text not null default '',
  brand      text not null default '',
  hero       text not null default '',
  is_demo    boolean not null default false,
  sort_key   text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.pro_sites
  enable row level security;

-- Read: admins only. public.is_admin() is the
-- existing helper over public.app_admins, which
-- contains konto@ian.lu alone.
drop policy if exists pro_sites_admin_read
  on public.pro_sites;
create policy pro_sites_admin_read
  on public.pro_sites for select
  using (public.is_admin());

-- Write: admins only, so a rebuild can refresh it.
drop policy if exists pro_sites_admin_write
  on public.pro_sites;
create policy pro_sites_admin_write
  on public.pro_sites for all
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.pro_sites
  to anon, authenticated;
