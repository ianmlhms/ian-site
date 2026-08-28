-- ===========================================================================
-- Unified Messenger Bridge — Mail v1.
-- Adds the e-mail half of the bridge: four IMAP mailboxes, their messages,
-- attachments and an SMTP outbox. Deliberately separate from the bridge_chats
-- / bridge_messages tables: mail has subjects, threads, recipients and folders
-- that a chat row cannot carry, and Ian asked for a separate Mail section.
-- Paste into Supabase ▸ SQL Editor ▸ New query ▸ Run. Idempotent.
-- ===========================================================================

-- ---- 0) Mail accounts -----------------------------------------------------
create table if not exists public.bridge_mail_accounts (
  id           bigint generated always as identity primary key,
  owner        uuid not null default 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'
                 references auth.users(id) on delete cascade,
  label        text not null,
  address      text not null,
  provider     text not null
                 check (provider in ('m365', 'google', 'icloud', 'other')),
  imap_host    text not null,
  imap_port    integer not null default 993,
  smtp_host    text not null,
  smtp_port    integer not null default 587,
  aliases      text[] not null default '{}',
  enabled      boolean not null default true,
  status       text not null default 'offline',
  last_seen_at timestamptz,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (label)
);

-- ---- 1) Mail messages -----------------------------------------------------
-- (account_id, folder, uid) is the natural key IMAP gives us and is what makes
-- the daemon idempotent across restarts. rfc_message_id is kept separately
-- because it is what threads replies together across folders and accounts.
create table if not exists public.bridge_mail_messages (
  id              bigint generated always as identity primary key,
  owner           uuid not null default 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'
                    references auth.users(id) on delete cascade,
  account_id      bigint not null
                    references public.bridge_mail_accounts(id) on delete cascade,
  folder          text not null default 'INBOX',
  uid             bigint not null,
  rfc_message_id  text,
  thread_key      text,
  in_reply_to     text,
  subject         text,
  from_name       text,
  from_addr       text,
  to_addrs        text[] not null default '{}',
  cc_addrs        text[] not null default '{}',
  sent_at         timestamptz not null,
  snippet         text,
  body_text       text,
  body_html_path  text,
  has_attachments boolean not null default false,
  is_read         boolean not null default false,
  is_flagged      boolean not null default false,
  is_from_me      boolean not null default false,
  is_bulk         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (account_id, folder, uid)
);
create index if not exists bridge_mail_messages_sent_idx
  on public.bridge_mail_messages (sent_at desc);
create index if not exists bridge_mail_messages_thread_idx
  on public.bridge_mail_messages (thread_key, sent_at desc);
create index if not exists bridge_mail_messages_unread_idx
  on public.bridge_mail_messages (is_read, sent_at desc);
create index if not exists bridge_mail_messages_search_idx
  on public.bridge_mail_messages using gin (
    to_tsvector('simple',
      coalesce(subject, '') || ' ' ||
      coalesce(from_name, '') || ' ' ||
      coalesce(from_addr, '') || ' ' ||
      coalesce(snippet, ''))
  );

-- ---- 2) Attachments -------------------------------------------------------
-- Same "thumbnail now, full file on tap" contract as chat media: the daemon
-- records the metadata immediately and only uploads bytes when state flips to
-- 'requested', so a mailbox full of PDFs does not fill the bucket.
create table if not exists public.bridge_mail_attachments (
  id           bigint generated always as identity primary key,
  owner        uuid not null default 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'
                 references auth.users(id) on delete cascade,
  message_id   bigint not null
                 references public.bridge_mail_messages(id) on delete cascade,
  part_index   integer not null,
  filename     text,
  mime_type    text,
  size_bytes   bigint,
  storage_path text,
  state        text not null default 'none'
                 check (state in ('none', 'requested', 'ready', 'failed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (message_id, part_index)
);

-- ---- 3) Mail outbox -------------------------------------------------------
create table if not exists public.bridge_mail_outbox (
  id             bigint generated always as identity primary key,
  owner          uuid not null default 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'
                   references auth.users(id) on delete cascade,
  account_id     bigint not null
                   references public.bridge_mail_accounts(id) on delete cascade,
  to_addrs       text[] not null,
  cc_addrs       text[] not null default '{}',
  subject        text,
  body           text,
  in_reply_to    text,
  reply_refs     text[] not null default '{}',
  status         text not null default 'queued'
                   check (status in ('queued', 'sending', 'sent', 'failed')),
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (array_length(to_addrs, 1) > 0)
);
create index if not exists bridge_mail_outbox_status_idx
  on public.bridge_mail_outbox (status);

-- ---- 4) Row-level security ------------------------------------------------
alter table public.bridge_mail_accounts    enable row level security;
alter table public.bridge_mail_messages    enable row level security;
alter table public.bridge_mail_attachments enable row level security;
alter table public.bridge_mail_outbox      enable row level security;

drop policy if exists bridge_mail_accounts_select on public.bridge_mail_accounts;
drop policy if exists bridge_mail_accounts_insert on public.bridge_mail_accounts;
drop policy if exists bridge_mail_accounts_update on public.bridge_mail_accounts;
drop policy if exists bridge_mail_accounts_delete on public.bridge_mail_accounts;
create policy bridge_mail_accounts_select on public.bridge_mail_accounts for select using (owner = auth.uid());
create policy bridge_mail_accounts_insert on public.bridge_mail_accounts for insert with check (owner = auth.uid());
create policy bridge_mail_accounts_update on public.bridge_mail_accounts for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy bridge_mail_accounts_delete on public.bridge_mail_accounts for delete using (owner = auth.uid());

drop policy if exists bridge_mail_messages_select on public.bridge_mail_messages;
drop policy if exists bridge_mail_messages_insert on public.bridge_mail_messages;
drop policy if exists bridge_mail_messages_update on public.bridge_mail_messages;
drop policy if exists bridge_mail_messages_delete on public.bridge_mail_messages;
create policy bridge_mail_messages_select on public.bridge_mail_messages for select using (owner = auth.uid());
create policy bridge_mail_messages_insert on public.bridge_mail_messages for insert with check (owner = auth.uid());
create policy bridge_mail_messages_update on public.bridge_mail_messages for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy bridge_mail_messages_delete on public.bridge_mail_messages for delete using (owner = auth.uid());

drop policy if exists bridge_mail_attachments_select on public.bridge_mail_attachments;
drop policy if exists bridge_mail_attachments_insert on public.bridge_mail_attachments;
drop policy if exists bridge_mail_attachments_update on public.bridge_mail_attachments;
drop policy if exists bridge_mail_attachments_delete on public.bridge_mail_attachments;
create policy bridge_mail_attachments_select on public.bridge_mail_attachments for select using (owner = auth.uid());
create policy bridge_mail_attachments_insert on public.bridge_mail_attachments for insert with check (owner = auth.uid());
create policy bridge_mail_attachments_update on public.bridge_mail_attachments for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy bridge_mail_attachments_delete on public.bridge_mail_attachments for delete using (owner = auth.uid());

drop policy if exists bridge_mail_outbox_select on public.bridge_mail_outbox;
drop policy if exists bridge_mail_outbox_insert on public.bridge_mail_outbox;
drop policy if exists bridge_mail_outbox_update on public.bridge_mail_outbox;
drop policy if exists bridge_mail_outbox_delete on public.bridge_mail_outbox;
create policy bridge_mail_outbox_select on public.bridge_mail_outbox for select using (owner = auth.uid());
create policy bridge_mail_outbox_insert on public.bridge_mail_outbox for insert with check (owner = auth.uid());
create policy bridge_mail_outbox_update on public.bridge_mail_outbox for update using (owner = auth.uid()) with check (owner = auth.uid());
create policy bridge_mail_outbox_delete on public.bridge_mail_outbox for delete using (owner = auth.uid());

-- ---- 5) Realtime ----------------------------------------------------------
do $func$
declare table_name text;
begin
  foreach table_name in array array[
    'bridge_mail_messages', 'bridge_mail_accounts',
    'bridge_mail_outbox', 'bridge_mail_attachments'
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

-- ---- 6) Seed the four mailboxes -------------------------------------------
-- Credentials never live here; the daemon reads app passwords from
-- ~/.messengerbridge/mail.env (0600). ian@mulheims.lu is the real mailbox
-- behind konto@ian.lu and ian@ian.lu, which both forward into it.
insert into public.bridge_mail_accounts
  (label, address, provider, imap_host, smtp_host, smtp_port, aliases)
values
  ('mulheims', 'ian@mulheims.lu', 'm365',
   'outlook.office365.com', 'smtp.office365.com', 587,
   array['konto@ian.lu', 'ian@ian.lu']),
  ('icloud', 'ianmulheims@icloud.com', 'icloud',
   'imap.mail.me.com', 'smtp.mail.me.com', 587, '{}'),
  ('gmail', 'iamulheims@gmail.com', 'google',
   'imap.gmail.com', 'smtp.gmail.com', 587, '{}'),
  ('school', 'im9141@elaml.lu', 'google',
   'imap.gmail.com', 'smtp.gmail.com', 587, '{}')
on conflict (label) do update set
  address   = excluded.address,
  provider  = excluded.provider,
  imap_host = excluded.imap_host,
  smtp_host = excluded.smtp_host,
  smtp_port = excluded.smtp_port,
  aliases   = excluded.aliases;
