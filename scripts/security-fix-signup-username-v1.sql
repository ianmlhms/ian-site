-- =============================================================
-- security-fix-signup-username-v1.sql  (audit 15 Nov 2026)  -- NOT APPLIED YET
-- Run:  supabase db query --linked -f scripts/security-fix-signup-username-v1.sql
-- Idempotent. No client change needed.
--
-- What it closes
-- MEDIUM  set_username() only allows ^[A-Za-z0-9_]{3,20}$, but the name a
--   NEW account gets is taken unchecked from the signup metadata
--   (handle_new_user) or from upsert_profile(p_username):
--     POST /auth/v1/signup {"email":..,"password":..,
--          "data":{"username":"<img src=x onerror=...>"}}        (or 1 MB of text,
--          or "Ian" + an invisible character to pose as somebody else)
--   That name is then shown on every leaderboard, in the friends list,
--   the messenger and in notifications of 150 players. Any page that
--   forgets to escape a username once is a stored XSS for everybody.
--   (Today: 0 profiles with < > " ' &, longest name 20.)
--     -> new accounts: control characters, invisible/bidi characters and
--        < > & " ' ` are removed, at most 24 characters.
--
-- How it could break something
-- * Nothing is refused: a name that is empty after cleaning falls back
--   to the e-mail name, then to "user" (the old fallbacks). A signup can
--   not fail because of this.
-- * Existing usernames are NOT touched (20 of them have spaces, dots,
--   accents or emoji: all of those stay allowed for new accounts too).
-- * A signup form that sends more than 24 characters gets a cut name.
-- =============================================================

create or replace function public.clean_username(p_name text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select left(btrim(regexp_replace(
    regexp_replace(coalesce(p_name, ''),
      -- control chars, zero-width + bidi marks, HTML / quote characters
      U&'[[:cntrl:]\200B-\200F\202A-\202E\2060-\2064\FEFF<>&"''`]', '', 'g'),
    '\s+', ' ', 'g')), 24)
$function$;

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare base text; cand text; n int := 0;
begin
  base := coalesce(
    nullif(public.clean_username(new.raw_user_meta_data->>'username'), ''),
    nullif(public.clean_username(split_part(new.email, '@', 1)), ''),
    'user');
  cand := base;
  while exists (select 1 from public.profiles
                where lower(username) = lower(cand)) loop
    n := n + 1; cand := base || n::text;
  end loop;
  insert into public.profiles (id, username, account_kind)
    values (new.id, cand,
      case when new.raw_user_meta_data->>'account_kind' = 'kart'
           then 'kart' else 'full' end)
    on conflict (id) do nothing;
  -- Write the final name back, so every page
  -- shows the same username.
  update auth.users
     set raw_user_meta_data =
       coalesce(raw_user_meta_data, '{}'::jsonb)
       || jsonb_build_object('username', cand)
   where id = new.id;
  return new;
end $function$;

create or replace function public.upsert_profile(p_username text)
 returns public.profiles
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  base text := nullif(public.clean_username(p_username), '');
  cand text; n int := 0; row public.profiles;
begin
  select * into row from public.profiles where id = auth.uid();
  if row.id is not null then return row; end if;
  if base is null then base := 'user'; end if;
  cand := base;
  while exists (select 1 from public.profiles where lower(username) = lower(cand)) loop
    n := n + 1; cand := base || n::text;
  end loop;
  insert into public.profiles (id, username) values (auth.uid(), cand) returning * into row;
  return row;
end; $function$;

-- ---------- check (no rows changed) ----------
select public.clean_username('  <img src=x onerror=alert(1)>  ') as html_gone,
       public.clean_username(E'Ian​') as invisible_gone,
       public.clean_username('Jean-Luc é 🌀 :)') as normal_kept,
       char_length(public.clean_username(repeat('a', 500))) as capped_24,
       (select count(*) from public.profiles
         where username is distinct from public.clean_username(username)) as existing_names_the_cleaner_would_change;
