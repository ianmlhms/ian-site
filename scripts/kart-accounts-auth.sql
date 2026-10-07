-- ===========================================================================
-- Karting-only accounts (email + password) — account side + server gating.
-- Paste into Supabase SQL Editor (or: supabase db query --linked -f this file).
-- Idempotent: safe to re-run, and RE-RUN IT after adding new RPCs/tables so
-- they are gated too (new functions/tables are picked up automatically).
--
-- Ian's rule: a karting-only account may use ONLY karting (kart_* RPCs/tables
-- and its own basic account/profile). Everything social/school/game/AI is
-- refused server-side; normal ('full') accounts are unchanged and can use
-- karting as well. The web UI redirect (auth.js / theme.js) is UX only —
-- THIS file is the enforcement.
--
--  1) profiles.account_kind ('full' | 'kart', default 'full'), set at sign-up
--     from user_metadata.account_kind by handle_new_user. Users cannot change
--     it (trigger); only an admin can (admin_set_account_kind).
--  2) public.is_kart_only() — caller's profile is a karting account.
--  3) Tables: every public table (except kart_* and profiles) and
--     storage.objects get a RESTRICTIVE policy "kart_block" for
--     `authenticated` (ANDed with the existing permissive policies, which
--     stay untouched): kart accounts can neither read nor write them.
--     profiles gets a restrictive SELECT policy: kart accounts are invisible
--     to everybody except themselves and the admin, and a kart account sees
--     only its own profile.
--  4) Functions: every public function that `authenticated` can execute is
--     recreated (exact live body preserved, grants kept) with a guard that
--     raises 'not available for karting accounts' (42501) for kart accounts —
--     except kart_*, the account basics (account_exists, has_pin, is_admin,
--     set_username, set_theme, upsert_profile), and the boolean/id helpers
--     that RLS policies call (is_group_member, is_ip, is_vip, ...).
--     LANGUAGE sql functions become plpgsql (`return query`/`return`) so the
--     guard runs before anything else; `#variable_conflict use_column`
--     keeps SQL-function name resolution identical.
--  5) directory() (people list) skips kart accounts.
--  6) Kart accounts must never be a TARGET of social features either
--     (add_friend / start_dm / invite_game / add_group_member /
--     add_notification look people up by name or id): a BEFORE INSERT
--     trigger on friendships, group_members, game_invites, notifications,
--     messages and groups refuses rows that involve a kart account.
--
-- Depends on: profiles / handle_new_user, app_admins + is_admin().
-- ===========================================================================

-- ---- 1) account_kind --------------------------------------------------------
alter table public.profiles
  add column if not exists account_kind text not null default 'full'
  check (account_kind in ('full', 'kart'));

-- ---- 2) is_kart_only() ------------------------------------------------------
create or replace function public.is_kart_only()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.account_kind = 'kart' from public.profiles p where p.id = auth.uid()),
    false)
$$;
revoke all on function public.is_kart_only() from public;
grant execute on function public.is_kart_only() to anon, authenticated, service_role;

-- ---- 3) handle_new_user: same behaviour + account_kind from sign-up metadata
do $$
declare
  def text := pg_get_functiondef('public.handle_new_user()'::regprocedure);
  fixed text;
begin
  if def like '%account_kind%' then
    raise notice 'handle_new_user already sets account_kind';
    return;
  end if;
  fixed := regexp_replace(
    def,
    'insert into public\.profiles \(id, username\)\s+values \(new\.id, cand\)',
    E'insert into public.profiles (id, username, account_kind)\n    values (new.id, cand,\n      case when new.raw_user_meta_data->>''account_kind'' = ''kart''\n           then ''kart'' else ''full'' end)');
  if fixed = def then
    raise exception 'handle_new_user changed: insert statement not found, aborting';
  end if;
  execute fixed;
end $$;

-- ---- 4) users cannot change their own account_kind --------------------------
create or replace function public.profiles_protect_account_kind()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.account_kind is distinct from old.account_kind
     and auth.uid() is not null           -- service role / SQL editor have no uid
     and not public.is_admin() then
    raise exception 'account_kind can only be changed by an admin'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.profiles_protect_account_kind() from public, anon, authenticated;

drop trigger if exists profiles_protect_account_kind on public.profiles;
create trigger profiles_protect_account_kind
  before update of account_kind on public.profiles
  for each row execute function public.profiles_protect_account_kind();

-- Admin path: konto@ian.lu (is_admin) can flip an account between the kinds.
create or replace function public.admin_set_account_kind(p_user uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_kind not in ('full', 'kart') then
    raise exception 'invalid account kind';
  end if;
  update public.profiles set account_kind = p_kind where id = p_user;
end $$;
revoke all on function public.admin_set_account_kind(uuid, text) from public, anon;
grant execute on function public.admin_set_account_kind(uuid, text) to authenticated, service_role;

-- ---- 5) profiles: kart accounts are invisible to others ---------------------
-- profiles_read stays (using true); this restrictive policy narrows it.
drop policy if exists kart_profiles_visibility on public.profiles;
create policy kart_profiles_visibility on public.profiles
  as restrictive for select
  using (
    id = (select auth.uid())
    or (select public.is_admin())
    or (account_kind = 'full' and not (select public.is_kart_only()))
  );

-- ---- 6) every other table: restrictive block for kart accounts --------------
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and c.relname not like 'kart\_%'
      and c.relname <> 'profiles'
  loop
    execute format('drop policy if exists kart_block on public.%I', t.relname);
    execute format(
      'create policy kart_block on public.%I as restrictive for all to authenticated '
      || 'using ((select not public.is_kart_only())) '
      || 'with check ((select not public.is_kart_only()))', t.relname);
  end loop;
end $$;

-- Storage (chat media, avatars, wardrobe, exam files, ...): no kart buckets exist.
drop policy if exists kart_block on storage.objects;
create policy kart_block on storage.objects
  as restrictive for all to authenticated
  using ((select not public.is_kart_only()))
  with check ((select not public.is_kart_only()));

-- ---- 7) kart accounts are never the target of social rows -------------------
create or replace function public.kart_block_social_rows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  j jsonb := to_jsonb(new);
  col text;
  uid uuid;
begin
  foreach col in array array['requester', 'addressee', 'from_user', 'to_user', 'user_id', 'created_by']
  loop
    continue when (j ->> col) is null;
    uid := (j ->> col)::uuid;
    if exists (select 1 from public.profiles p where p.id = uid and p.account_kind = 'kart') then
      raise exception 'not available for karting accounts' using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.kart_block_social_rows() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['friendships', 'group_members', 'game_invites', 'notifications', 'messages', 'groups']
  loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists kart_block_social on public.%I', t);
    execute format(
      'create trigger kart_block_social before insert on public.%I '
      || 'for each row execute function public.kart_block_social_rows()', t);
  end loop;
end $$;

-- ---- 8) directory(): skip kart accounts -------------------------------------
do $$
declare
  def text := pg_get_functiondef('public.directory()'::regprocedure);
  fixed text;
begin
  if def like '%account_kind%' then return; end if;
  fixed := regexp_replace(def, 'where p\.id <> auth\.uid\(\)',
                          'where p.id <> auth.uid() and p.account_kind = ''full''');
  if fixed = def then
    raise exception 'directory() changed: where clause not found, aborting';
  end if;
  execute fixed;
end $$;

-- ---- 9) gate every function `authenticated` can execute ---------------------
do $$
declare
  guard constant text :=
    'if public.is_kart_only() then raise exception ''not available for karting accounts'' '
    || 'using errcode = ''42501''; end if;';
  -- account basics + helpers that RLS / the UI call; everything else is gated.
  allow constant text[] := array[
    'account_exists', 'has_pin', 'is_admin', 'set_username', 'set_theme',
    'upsert_profile', 'is_kart_only', 'admin_set_account_kind',
    'is_group_member', 'is_ip', 'is_vip', 'is_view_restricted',
    'owner_user_id', 'admin_user_ids', 'ip_user_ids', 'vip_user_ids',
    'visible_user_ids'];
  r record;
  m text[];
  hdr text; body text; tail text; lang text; res text; fixed text;
  gated text[] := '{}';
begin
  for r in
    select p.oid, p.proname, pg_get_functiondef(p.oid) as def,
           pg_get_function_result(p.oid) as res, l.lanname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and p.prokind = 'f'
      and (has_function_privilege('authenticated', p.oid, 'execute') or p.proname = 'directory')
      and p.proname not like 'kart\_%'
      and p.proname <> all (allow)
      and pg_get_function_result(p.oid) <> 'trigger'
    order by p.proname
  loop
    if r.def like '%is_kart_only()%' then continue; end if;   -- already gated
    m := regexp_match(r.def, '^(.*?AS \$function\$)(.*)(\$function\$\s*)$');
    if m is null then
      raise exception 'cannot parse definition of %', r.proname;
    end if;
    hdr := m[1]; body := m[2]; tail := m[3]; res := r.res;
    if r.lanname = 'plpgsql' then
      if body !~* '\mbegin\M' then
        raise exception 'no BEGIN found in %', r.proname;
      end if;
      body := regexp_replace(body, '\mbegin\M', 'begin ' || guard, 'i');
    elsif r.lanname = 'sql' then
      body := regexp_replace(btrim(body, E' \t\r\n'), ';\s*$', '');
      hdr := replace(hdr, E'\n LANGUAGE sql', E'\n LANGUAGE plpgsql');
      if hdr not like '%LANGUAGE plpgsql%' then
        raise exception 'cannot switch language of %', r.proname;
      end if;
      if res = 'void' then
        body := E'\n#variable_conflict use_column\nbegin\n  ' || guard || E'\n  ' || body || E';\nend;\n';
      elsif res like 'TABLE(%' or res like 'SETOF %' then
        body := E'\n#variable_conflict use_column\nbegin\n  ' || guard || E'\n  return query ' || body || E';\nend;\n';
      else
        body := E'\n#variable_conflict use_column\nbegin\n  ' || guard || E'\n  return (' || body || E');\nend;\n';
      end if;
    else
      raise exception 'unsupported language % in %', r.lanname, r.proname;
    end if;
    execute hdr || body || tail;
    gated := gated || r.proname::text;
  end loop;
  raise notice 'gated functions: %', gated;
end $$;
