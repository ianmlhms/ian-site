-- ===========================================================================
-- Unified Messenger Bridge v1 — shared WhatsApp/iMessage schema and storage.
-- Paste into Supabase ▸ SQL Editor ▸ New query ▸ Run. Idempotent (safe to re-run).
-- ===========================================================================

-- ---- 0) Accounts ----------------------------------------------------------
create table if not exists public.bridge_accounts (
  id           bigint generated always as identity primary key,
  owner        uuid not null default 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'
                 references auth.users(id) on delete cascade,
  service      text not null check (service in ('whatsapp', 'imessage')),
  status       text not null default 'offline',
  last_seen_at timestamptz,
  qr_payload   text,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (service)
);

-- ---- 1) Contacts ----------------------------------------------------------
create table if not exists public.bridge_contacts (
  id           bigint generated always as identity primary key,
  owner        uuid not null default 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'
                 references auth.users(id) on delete cascade,
  service      text not null check (service in ('whatsapp', 'imessage')),
  remote_id    text not null,
  display_name text,
  phone        text,
  avatar_path  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (service, remote_id)
);

-- ---- 2) Chats -------------------------------------------------------------
create table if not exists public.bridge_chats (
  id           bigint generated always as identity primary key,
  owner        uuid not null default 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'
                 references auth.users(id) on delete cascade,
  service      text not null check (service in ('whatsapp', 'imessage')),
  remote_id    text not null,
  title        text,
  is_group     boolean not null default false,
  avatar_path  text,
  last_at      timestamptz,
  last_preview text,
  last_sender  text,
  unread       boolean not null default false,
  muted        boolean not null default false,
  pinned       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (service, remote_id)
);

-- ---- 3) Messages ----------------------------------------------------------
create table if not exists public.bridge_messages (
  id                 bigint generated always as identity primary key,
  owner              uuid not null default 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'
                       references auth.users(id) on delete cascade,
  chat_id            bigint not null references public.bridge_chats(id) on delete cascade,
  service            text not null check (service in ('whatsapp', 'imessage')),
  remote_id          text not null,
  sender_remote_id   text,
  is_from_me         boolean not null default false,
  body               text,
  kind               text not null default 'text'
                       check (kind in ('text', 'image', 'video', 'audio', 'file', 'system')),
  sent_at            timestamptz not null,
  media_path         text,
  thumb_path         text,
  media_state        text not null default 'none'
                       check (media_state in ('none', 'thumb', 'requested', 'full')),
  reply_to_remote_id text,
  reply_preview      text,
  reactions          jsonb not null default '{}'::jsonb,
  edited_at          timestamptz,
  delivered_at       timestamptz,
  read_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (service, remote_id)
);
create index if not exists bridge_messages_chat_sent_idx
  on public.bridge_messages (chat_id, sent_at desc);
create index if not exists bridge_messages_body_search_idx
  on public.bridge_messages using gin (to_tsvector('simple', coalesce(body, '')));

-- ---- 4) Outbox ------------------------------------------------------------
create table if not exists public.bridge_outbox (
  id             bigint generated always as identity primary key,
  owner          uuid not null default 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'
                   references auth.users(id) on delete cascade,
  chat_id        bigint not null references public.bridge_chats(id) on delete cascade,
  service        text not null check (service in ('whatsapp', 'imessage')),
  body           text,
  media_path     text,
  status         text not null default 'queued'
                   check (status in ('queued', 'sending', 'sent', 'failed')),
  error          text,
  sent_remote_id text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (nullif(body, '') is not null or media_path is not null)
);
create index if not exists bridge_outbox_status_idx on public.bridge_outbox (status);

-- ---- 5) Media requests ----------------------------------------------------
create table if not exists public.bridge_media_requests (
  id         bigint generated always as identity primary key,
  owner      uuid not null default 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'
               references auth.users(id) on delete cascade,
  message_id bigint not null references public.bridge_messages(id) on delete cascade,
  status     text not null default 'queued'
               check (status in ('queued', 'processing', 'ready', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (message_id)
);

-- ---- 6) Daemon state ------------------------------------------------------
create table if not exists public.bridge_state (
  key        text primary key,
  owner      uuid not null default 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'
               references auth.users(id) on delete cascade,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---- 7) Row-level security ------------------------------------------------
alter table public.bridge_accounts       enable row level security;
alter table public.bridge_contacts       enable row level security;
alter table public.bridge_chats          enable row level security;
alter table public.bridge_messages       enable row level security;
alter table public.bridge_outbox         enable row level security;
alter table public.bridge_media_requests enable row level security;
alter table public.bridge_state          enable row level security;

drop policy if exists bridge_accounts_select on public.bridge_accounts;
drop policy if exists bridge_accounts_insert on public.bridge_accounts;
drop policy if exists bridge_accounts_update on public.bridge_accounts;
drop policy if exists bridge_accounts_delete on public.bridge_accounts;
create policy bridge_accounts_select on public.bridge_accounts for select using (owner = auth.uid());
create policy bridge_accounts_insert on public.bridge_accounts for insert with check (owner = auth.uid());
create policy bridge_accounts_update on public.bridge_accounts for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy bridge_accounts_delete on public.bridge_accounts for delete using (owner = auth.uid());

drop policy if exists bridge_contacts_select on public.bridge_contacts;
drop policy if exists bridge_contacts_insert on public.bridge_contacts;
drop policy if exists bridge_contacts_update on public.bridge_contacts;
drop policy if exists bridge_contacts_delete on public.bridge_contacts;
create policy bridge_contacts_select on public.bridge_contacts for select using (owner = auth.uid());
create policy bridge_contacts_insert on public.bridge_contacts for insert with check (owner = auth.uid());
create policy bridge_contacts_update on public.bridge_contacts for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy bridge_contacts_delete on public.bridge_contacts for delete using (owner = auth.uid());

drop policy if exists bridge_chats_select on public.bridge_chats;
drop policy if exists bridge_chats_insert on public.bridge_chats;
drop policy if exists bridge_chats_update on public.bridge_chats;
drop policy if exists bridge_chats_delete on public.bridge_chats;
create policy bridge_chats_select on public.bridge_chats for select using (owner = auth.uid());
create policy bridge_chats_insert on public.bridge_chats for insert with check (owner = auth.uid());
create policy bridge_chats_update on public.bridge_chats for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy bridge_chats_delete on public.bridge_chats for delete using (owner = auth.uid());

drop policy if exists bridge_messages_select on public.bridge_messages;
drop policy if exists bridge_messages_insert on public.bridge_messages;
drop policy if exists bridge_messages_update on public.bridge_messages;
drop policy if exists bridge_messages_delete on public.bridge_messages;
create policy bridge_messages_select on public.bridge_messages for select using (owner = auth.uid());
create policy bridge_messages_insert on public.bridge_messages for insert with check (owner = auth.uid());
create policy bridge_messages_update on public.bridge_messages for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy bridge_messages_delete on public.bridge_messages for delete using (owner = auth.uid());

drop policy if exists bridge_outbox_select on public.bridge_outbox;
drop policy if exists bridge_outbox_insert on public.bridge_outbox;
drop policy if exists bridge_outbox_update on public.bridge_outbox;
drop policy if exists bridge_outbox_delete on public.bridge_outbox;
create policy bridge_outbox_select on public.bridge_outbox for select using (owner = auth.uid());
create policy bridge_outbox_insert on public.bridge_outbox for insert with check (owner = auth.uid());
create policy bridge_outbox_update on public.bridge_outbox for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy bridge_outbox_delete on public.bridge_outbox for delete using (owner = auth.uid());

drop policy if exists bridge_media_requests_select on public.bridge_media_requests;
drop policy if exists bridge_media_requests_insert on public.bridge_media_requests;
drop policy if exists bridge_media_requests_update on public.bridge_media_requests;
drop policy if exists bridge_media_requests_delete on public.bridge_media_requests;
create policy bridge_media_requests_select on public.bridge_media_requests for select using (owner = auth.uid());
create policy bridge_media_requests_insert on public.bridge_media_requests for insert with check (owner = auth.uid());
create policy bridge_media_requests_update on public.bridge_media_requests for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy bridge_media_requests_delete on public.bridge_media_requests for delete using (owner = auth.uid());

drop policy if exists bridge_state_select on public.bridge_state;
drop policy if exists bridge_state_insert on public.bridge_state;
drop policy if exists bridge_state_update on public.bridge_state;
drop policy if exists bridge_state_delete on public.bridge_state;
create policy bridge_state_select on public.bridge_state for select using (owner = auth.uid());
create policy bridge_state_insert on public.bridge_state for insert with check (owner = auth.uid());
create policy bridge_state_update on public.bridge_state for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy bridge_state_delete on public.bridge_state for delete using (owner = auth.uid());

-- ---- 8) Realtime ----------------------------------------------------------
do $func$
declare table_name text;
begin
  foreach table_name in array array[
    'bridge_messages', 'bridge_chats', 'bridge_outbox',
    'bridge_media_requests', 'bridge_accounts'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end
$func$;

-- ---- 9) Private media storage --------------------------------------------
insert into storage.buckets (id, name, public)
  values ('bridge-media', 'bridge-media', false)
  on conflict (id) do update set public = false;

drop policy if exists "bridge media owner read" on storage.objects;
create policy "bridge media owner read" on storage.objects for select to authenticated
  using (
    bucket_id = 'bridge-media'
    and auth.uid() = 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'::uuid
  );

drop policy if exists "bridge media service upload" on storage.objects;
create policy "bridge media service upload" on storage.objects for insert to service_role
  with check (bucket_id = 'bridge-media');

drop policy if exists "bridge media service update" on storage.objects;
create policy "bridge media service update" on storage.objects for update to service_role
  using (bucket_id = 'bridge-media') with check (bucket_id = 'bridge-media');
