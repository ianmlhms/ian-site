-- Messenger: invite people to a group by picking them from a name search.
-- Any member of a group (not a DM) can add another user; the new member's
-- client sees the group_members INSERT and the group appears in their list.
-- Run with: supabase db query --linked -f scripts/messenger-invite-v1.sql

create or replace function public.add_group_member(p_group_id bigint, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare g public.groups; uname text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into g from public.groups where id = p_group_id;
  if g.id is null then raise exception 'No such group'; end if;
  if g.is_dm then raise exception 'You cannot add people to a direct message'; end if;
  if not exists (select 1 from public.group_members m
                 where m.group_id = g.id and m.user_id = auth.uid()) then
    raise exception 'You are not a member of this group';
  end if;
  -- restricted viewers may only add the people they are allowed to see
  if public.is_view_restricted()
     and p_user_id not in (select v.user_id from public.visible_user_ids() v) then
    raise exception 'This person is not available';
  end if;
  select username into uname from public.profiles where id = p_user_id;
  if uname is null then raise exception 'No user with that id'; end if;
  insert into public.group_members (group_id, user_id, username)
    values (g.id, p_user_id, uname)
    on conflict (group_id, user_id) do nothing;
  return uname;
end; $function$;

revoke all on function public.add_group_member(bigint, uuid) from public, anon;
grant execute on function public.add_group_member(bigint, uuid) to authenticated;
