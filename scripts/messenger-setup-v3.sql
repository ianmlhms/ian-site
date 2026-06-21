-- ===========================================================================
-- Messenger v3 — delete-own-message (30s window) + admin moderation.
-- Paste into Supabase ▸ SQL Editor ▸ New query ▸ Run. Idempotent.
-- ===========================================================================

-- Needed so realtime DELETE events carry group_id (not just the PK), otherwise
-- the per-group subscription filter can't match deletions.
alter table public.messages replica identity full;

-- A user may delete their OWN message within 30 seconds of sending it.
drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages for delete
  using (user_id = auth.uid() and created_at > now() - interval '30 seconds');

-- ---- Admin moderation (all guarded by is_admin()) -------------------------
create or replace function public.admin_delete_group(p_group_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  delete from public.groups where id = p_group_id;            -- cascades members + messages
end; $$;
grant execute on function public.admin_delete_group(bigint) to authenticated;

create or replace function public.admin_delete_message(p_message_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  delete from public.messages where id = p_message_id;
end; $$;
grant execute on function public.admin_delete_message(bigint) to authenticated;

create or replace function public.admin_remove_member(p_group_id bigint, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  delete from public.group_members where group_id = p_group_id and user_id = p_user_id;
end; $$;
grant execute on function public.admin_remove_member(bigint, uuid) to authenticated;

create or replace function public.admin_add_member(p_group_id bigint, p_username text)
returns public.group_members language plpgsql security definer set search_path = public as $$
declare uid uuid; uname text; row public.group_members;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select id, username into uid, uname from public.profiles where lower(username) = lower(trim(p_username)) limit 1;
  if uid is null then raise exception 'No user with that username'; end if;
  insert into public.group_members (group_id, user_id, username)
    values (p_group_id, uid, uname) on conflict (group_id, user_id) do nothing;
  select * into row from public.group_members where group_id = p_group_id and user_id = uid;
  return row;
end; $$;
grant execute on function public.admin_add_member(bigint, text) to authenticated;
