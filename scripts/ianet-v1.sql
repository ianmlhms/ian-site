-- IanNet uplink v1: photos / files / guestbook entries uploaded by Ian's IanNet boards.
-- Admin-only (konto@ian.lu via public.is_admin()); the boards never read anything back.
-- Writes happen only in the ianet-upload edge function with the service role.

create table if not exists public.ianet_items (
  id            text primary key,              -- the board's own item id (idempotent re-uploads)
  board         text not null check (board ~ '^[a-z0-9_-]{1,32}$'),
  kind          text not null check (kind in ('photo', 'file', 'guestbook')),
  name          text,                          -- file name (photo/file)
  author        text,                          -- the name typed on the iPad
  body          text,                          -- guestbook text
  size_bytes    bigint check (size_bytes is null or size_bytes >= 0),
  content_type  text,
  storage_path  text,                          -- ianet bucket path (photo/file)
  created_ms    bigint,                        -- board-side timestamp if it had a wall clock
  uploaded_at   timestamptz,                   -- set when the file actually landed in storage
  received_at   timestamptz not null default now()
);

create index if not exists ianet_items_received_idx on public.ianet_items (received_at desc);

alter table public.ianet_items enable row level security;

drop policy if exists ianet_items_admin_read on public.ianet_items;
create policy ianet_items_admin_read on public.ianet_items
  for select using (public.is_admin());

drop policy if exists ianet_items_admin_delete on public.ianet_items;
create policy ianet_items_admin_delete on public.ianet_items
  for delete using (public.is_admin());

-- Private bucket; 25 MB cap per object (boards cap files at 20 MB).
insert into storage.buckets (id, name, public, file_size_limit)
values ('ianet', 'ianet', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists ianet_objects_admin_read on storage.objects;
create policy ianet_objects_admin_read on storage.objects
  for select using (bucket_id = 'ianet' and public.is_admin());

drop policy if exists ianet_objects_admin_delete on storage.objects;
create policy ianet_objects_admin_delete on storage.objects
  for delete using (bucket_id = 'ianet' and public.is_admin());
