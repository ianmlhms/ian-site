-- Who is on ian.lu right now (admin panel "Online" tab).
-- Every signed-in page calls touch_presence(page) about once a minute while visible;
-- only admins can read it (admin_online). One row per user = also "last seen".
create table if not exists public.site_presence (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  page       text not null,
  last_seen  timestamptz not null default now(),
  started_at timestamptz not null default now()
);
alter table public.site_presence enable row level security;   -- no policies: RPCs only
revoke all on table public.site_presence from anon, authenticated;

create or replace function public.touch_presence(p_page text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_page text := left(coalesce(nullif(btrim(p_page), ''), '/'), 120);
begin
  if v_uid is null then return; end if;
  if left(v_page, 1) <> '/' then v_page := '/'; end if;
  insert into public.site_presence as sp (user_id, page, last_seen, started_at)
  values (v_uid, v_page, now(), now())
  on conflict (user_id) do update
    set page = excluded.page,
        last_seen = now(),
        -- a gap of more than 3 minutes starts a new visit
        started_at = case when sp.last_seen < now() - interval '3 minutes' then now() else sp.started_at end;
end $$;
revoke all on function public.touch_presence(text) from public, anon;
grant execute on function public.touch_presence(text) to authenticated;

-- Everyone seen in the last p_minutes; online = seen in the last 150 s.
create or replace function public.admin_online(p_minutes int default 15)
returns table(user_id uuid, username text, class text, avatar text, account_kind text,
              page text, last_seen timestamptz, started_at timestamptz, online boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
    select sp.user_id, p.username, nullif(btrim(p.class), ''), p.avatar, p.account_kind,
           sp.page, sp.last_seen, sp.started_at,
           sp.last_seen > now() - interval '150 seconds'
    from public.site_presence sp
    left join public.profiles p on p.id = sp.user_id
    where sp.last_seen > now() - make_interval(mins => least(greatest(coalesce(p_minutes, 15), 1), 1440))
    order by sp.last_seen desc;
end $$;
revoke all on function public.admin_online(int) from public, anon;
grant execute on function public.admin_online(int) to authenticated;
