-- Remote commands to open tabs (10 Oct 2026): admins can make open pages reload
-- (pick up a new version) or close the open arcade game (e.g. so a gift written
-- to the cloud save isn't overwritten by a running game). Pages poll
-- client_commands_since() with their presence ping and run each command once.

create table if not exists public.client_commands (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  created_by uuid,
  target_user uuid references auth.users (id) on delete cascade,   -- null = everyone
  action text not null check (action in ('reload', 'close_game')),
  game_id text,                                                     -- close_game: only this game (null = any)
  reason text check (reason is null or char_length(reason) <= 160),
  expires_at timestamptz not null default now() + interval '1 hour'
);
alter table public.client_commands enable row level security;
revoke all on table public.client_commands from anon, authenticated;

-- First call (p_since null) only returns the server time as the page's baseline;
-- later calls return the commands for this user (or everyone) created after it.
create or replace function public.client_commands_since(p_since timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  rows jsonb;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_since is null then
    return jsonb_build_object('now', now(), 'commands', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'created_at', c.created_at, 'action', c.action,
           'game_id', c.game_id, 'reason', c.reason) order by c.id), '[]'::jsonb)
    into rows
    from public.client_commands c
   where c.created_at > p_since
     and c.expires_at > now()
     and (c.target_user is null or c.target_user = uid);
  return jsonb_build_object('now', now(), 'commands', rows);
end $$;
revoke all on function public.client_commands_since(timestamptz) from public, anon;
grant execute on function public.client_commands_since(timestamptz) to authenticated;

create or replace function public.issue_client_command(
  p_action text, p_user uuid default null, p_game text default null, p_reason text default null,
  p_minutes int default 60)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  new_id bigint;
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  insert into public.client_commands (created_by, target_user, action, game_id, reason, expires_at)
  values (auth.uid(), p_user, p_action, nullif(btrim(p_game), ''), nullif(btrim(p_reason), ''),
          now() + make_interval(mins => least(greatest(coalesce(p_minutes, 60), 1), 1440)))
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.issue_client_command(text, uuid, text, text, int) from public, anon;
grant execute on function public.issue_client_command(text, uuid, text, text, int) to authenticated;
