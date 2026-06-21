-- ===========================================================================
-- Messenger v4 — replies, read-state (unread badges) + chat previews,
-- and Web Push subscriptions (iPad/desktop notifications even when closed).
-- Paste into Supabase ▸ SQL Editor ▸ New query ▸ Run. Idempotent.
-- ===========================================================================

-- ---- 1) Replies -----------------------------------------------------------
-- reply_to keeps the link (nulls out if the original is deleted); reply_user /
-- reply_preview are denormalised so a quoted reply still renders without a join
-- and survives deletion of the original message.
alter table public.messages add column if not exists reply_to      bigint references public.messages(id) on delete set null;
alter table public.messages add column if not exists reply_user    text;
alter table public.messages add column if not exists reply_preview text;

-- ---- 2) Read-state (powers bold "unread" names in the chat list) ----------
create table if not exists public.chat_reads (
  user_id      uuid   not null references auth.users(id) on delete cascade,
  group_id     bigint not null references public.groups(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, group_id)
);
alter table public.chat_reads enable row level security;
drop policy if exists chat_reads_own on public.chat_reads;
create policy chat_reads_own on public.chat_reads
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Mark a chat read up to now (called when you open/receive in a chat).
create or replace function public.mark_read(p_group_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.chat_reads (user_id, group_id, last_read_at)
    values (auth.uid(), p_group_id, now())
  on conflict (user_id, group_id) do update set last_read_at = now();
end; $$;
grant execute on function public.mark_read(bigint) to authenticated;

-- ---- 3) my_chats v4: + last message preview, sender, and unread flag ------
-- Ordered by most-recent activity. Backward compatible (only adds columns).
create or replace function public.my_chats()
returns table(
  id bigint, name text, invite_code text, is_dm boolean, created_at timestamptz,
  display text, last_at timestamptz, last_preview text, last_sender text, unread boolean
)
language sql security definer stable set search_path = public as $$
  select g.id, g.name, g.invite_code, g.is_dm, g.created_at,
    case when g.is_dm
      then coalesce((select m2.username from public.group_members m2
                      where m2.group_id = g.id and m2.user_id <> auth.uid() limit 1), 'Direct message')
      else g.name end as display,
    lm.created_at as last_at,
    lm.preview    as last_preview,
    lm.username   as last_sender,
    (lm.created_at is not null
       and lm.user_id <> auth.uid()
       and lm.created_at > coalesce(cr.last_read_at, 'epoch'::timestamptz)) as unread
  from public.groups g
  join public.group_members m on m.group_id = g.id
  left join lateral (
    select created_at, user_id, username,
      case when char_length(coalesce(content, '')) > 0 then content
           when media_type = 'video' then '📹 Video'
           when media_type = 'image' then '📷 Photo'
           else '' end as preview
    from public.messages
    where group_id = g.id
    order by created_at desc
    limit 1
  ) lm on true
  left join public.chat_reads cr on cr.group_id = g.id and cr.user_id = auth.uid()
  where m.user_id = auth.uid()
  order by coalesce(lm.created_at, g.created_at) desc;
$$;
grant execute on function public.my_chats() to authenticated;

-- ---- 4) Web Push subscriptions --------------------------------------------
-- One row per device/browser endpoint. The Edge Function (service role) reads
-- every row to fan out a push; users may only see/manage their own.
create table if not exists public.push_subscriptions (
  user_id      uuid   not null references auth.users(id) on delete cascade,
  endpoint     text   not null,
  subscription jsonb  not null,
  created_at   timestamptz not null default now(),
  primary key (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subs_own on public.push_subscriptions;
create policy push_subs_own on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Save (or refresh) the current device's push subscription.
create or replace function public.save_push_subscription(p_sub jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare ep text := p_sub->>'endpoint';
begin
  if ep is null then raise exception 'subscription has no endpoint'; end if;
  insert into public.push_subscriptions (user_id, endpoint, subscription)
    values (auth.uid(), ep, p_sub)
  on conflict (user_id, endpoint) do update set subscription = excluded.subscription;
end; $$;
grant execute on function public.save_push_subscription(jsonb) to authenticated;

-- Remove a subscription (on "disable notifications" or a dead endpoint).
create or replace function public.delete_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_subscriptions where user_id = auth.uid() and endpoint = p_endpoint;
end; $$;
grant execute on function public.delete_push_subscription(text) to authenticated;
