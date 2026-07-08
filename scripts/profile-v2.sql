-- ==========================================
-- Profile v2: editable username, server-saved
-- theme (#19), and a per-account visibility
-- restriction (Moren sees only Quinn + Ian).
-- Paste ALL into Supabase > SQL Editor > Run.
-- Idempotent. No $-quoting; lines <=56 chars
-- (SQL-editor paste rule). Needs profiles
-- (scripts/messenger-setup-v2.sql).
-- ==========================================

-- 1) Change my own username. 3-20 chars, letters
-- / digits / underscore, and must be free (case-
-- insensitive). Returns the new username, or NULL
-- if it was rejected (taken or bad shape) so the
-- client can show a message. profiles has no
-- direct UPDATE policy, so this definer RPC is
-- the only write path (like set_avatar/set_class).
create or replace function
  public.set_username(p_name text)
  returns text
  language sql
  security definer
  set search_path = public
  as '
    update public.profiles
       set username = btrim(p_name)
     where id = auth.uid()
       and btrim(p_name) ~
         ''^[A-Za-z0-9_]{3,20}$''
       and not exists (
         select 1 from public.profiles
         where lower(username)
             = lower(btrim(p_name))
           and id <> auth.uid())
    returning username';

grant execute on function
  public.set_username(text)
  to authenticated;

-- 2) Server-saved appearance (#19) so the theme
-- follows the user across devices. Small jsonb
-- ({mode, accent}); size-capped defensively.
alter table public.profiles
  add column if not exists theme jsonb;

create or replace function
  public.set_theme(p_theme jsonb)
  returns void
  language sql
  security definer
  set search_path = public
  as 'update public.profiles
        set theme = p_theme
      where id = auth.uid()
        and pg_column_size(p_theme) < 400';

grant execute on function
  public.set_theme(jsonb)
  to authenticated;

-- 3) Per-account visibility restriction. A
-- restricted viewer only "sees" an allowlist of
-- people in the people/friends/messenger lists
-- (a UX limit; RLS still protects the real data).
-- Only maureen@wiwinius.lu today -> Quinn + Ian.
-- These leak nothing but a yes/no + two ids.
create or replace function
  public.is_view_restricted()
  returns boolean
  language sql
  security definer
  stable
  set search_path = public
  as 'select lower(coalesce(
        (select email from auth.users
         where id = auth.uid()), ''''))
      = ''maureen@wiwinius.lu''';

grant execute on function
  public.is_view_restricted()
  to authenticated;

create or replace function
  public.visible_user_ids()
  returns table(user_id uuid)
  language sql
  security definer
  stable
  set search_path = public
  as 'select id from auth.users
      where public.is_view_restricted()
        and lower(email) in (
          ''quinn@mulheims.lu'',
          ''konto@ian.lu'')';

grant execute on function
  public.visible_user_ids()
  to authenticated;
