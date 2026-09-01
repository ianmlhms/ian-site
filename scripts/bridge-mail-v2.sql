-- ===========================================================================
-- Unified Messenger Bridge — Mail v2.
-- Microsoft 365 dropped password-based IMAP, so ian@mulheims.lu is synced
-- through Microsoft Graph instead. Graph message ids are opaque strings, not
-- IMAP UIDs, so we keep the id alongside the hashed uid that forms the
-- natural key — it is what a later "fetch this attachment" pass needs.
-- Paste into Supabase SQL Editor and Run. Idempotent.
-- ===========================================================================

alter table public.bridge_mail_messages
  add column if not exists remote_id text;

comment on column public.bridge_mail_messages.remote_id is
  'Provider message id (Microsoft Graph); null for IMAP mailboxes.';

-- Lets the daemon find a Graph message again without a table scan.
create index if not exists bridge_mail_messages_remote_idx
  on public.bridge_mail_messages (account_id, remote_id);

-- The mulheims mailbox was parked while it had no working credentials.
update public.bridge_mail_accounts
   set enabled = true,
       status = 'offline',
       error = null,
       updated_at = now()
 where label = 'mulheims';
