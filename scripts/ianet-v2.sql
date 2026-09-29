-- IanNet remote v2: manage the boards from ian.lu (status, commands, chat bridge).
-- Commands are created ONLY by the admin (is_admin()); boards read them through the
-- ianet-upload edge function with their device key. No table is writable by anyone else.

-- Heartbeat: one row per board, upserted by the edge function.
create table if not exists public.ianet_status (
  board         text primary key check (board ~ '^[a-z0-9_-]{1,32}$'),
  version       text,
  uptime_s      bigint,
  online        int,
  rssi          int,
  sd_free_mb    int,
  pending       int,
  last_error    text,
  seen_at       timestamptz not null default now()
);
alter table public.ianet_status enable row level security;
drop policy if exists ianet_status_admin_read on public.ianet_status;
create policy ianet_status_admin_read on public.ianet_status for select using (public.is_admin());

-- Command queue: admin → board.
create table if not exists public.ianet_commands (
  id            bigint generated always as identity primary key,
  board         text not null check (board ~ '^[a-z0-9_-]{1,32}$'),
  kind          text not null check (kind in ('chat', 'delete', 'restart', 'firmware')),
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  delivered_at  timestamptz,
  done_at       timestamptz,
  result        text,
  -- kind-specific shape, validated here so a malformed command never reaches a board
  constraint ianet_commands_payload_ok check (
    (kind = 'chat' and length(payload->>'text') between 1 and 300 and length(coalesce(payload->>'name', '')) <= 20)
    or (kind = 'delete' and payload->>'item_kind' in ('chat', 'photo', 'file', 'guestbook')
        and (payload->>'item_id') ~ '^[A-Za-z0-9_-]{1,64}$')
    or (kind = 'restart')
    or (kind = 'firmware' and (payload->>'path') ~ '^firmware/[A-Za-z0-9._-]{1,80}\.bin$'
        and (payload->>'sha256') ~ '^[0-9a-f]{64}$'
        and (payload->>'size')::bigint between 1 and 6291456)
  )
);
create index if not exists ianet_commands_pending_idx on public.ianet_commands (board, id) where done_at is null;
alter table public.ianet_commands enable row level security;
drop policy if exists ianet_commands_admin_all on public.ianet_commands;
create policy ianet_commands_admin_all on public.ianet_commands
  for all using (public.is_admin()) with check (public.is_admin());

-- Chat now also flows board → ian.lu.
alter table public.ianet_items drop constraint if exists ianet_items_kind_check;
alter table public.ianet_items add constraint ianet_items_kind_check
  check (kind in ('photo', 'file', 'guestbook', 'chat'));

-- Firmware images live in the same private bucket under firmware/; the admin uploads them.
drop policy if exists ianet_objects_admin_insert on storage.objects;
create policy ianet_objects_admin_insert on storage.objects
  for insert with check (bucket_id = 'ianet' and name like 'firmware/%' and public.is_admin());
