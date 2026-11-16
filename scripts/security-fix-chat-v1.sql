-- =============================================================
-- security-fix-chat-v1.sql   (audit 15 Nov 2026)  -- NOT APPLIED YET
-- Run:  supabase db query --linked -f scripts/security-fix-chat-v1.sql
-- Idempotent. Deploy messenger.js (same commit) together with it.
--
-- What it closes
-- 1. HIGH  join_group() accepted the invite code of ANY group, also of
--    direct messages (every DM row has a 6-hex invite_code too), and had
--    no attempt limit. 6 hex = 16.7 M codes, 113 chats -> one hit every
--    ~150 000 guesses, a few minutes of scripted RPC calls. The caller
--    becomes a member and can read the whole chat (messages_read policy).
--      -> DMs can no longer be joined by code at all,
--      -> 10 wrong codes per 10 minutes per account,
--      -> new groups get a 12-character code (old codes keep working).
-- 2. MEDIUM  policy messages_update_own only checks user_id, and the
--    username trigger only runs on INSERT. With one PATCH a member can
--    show his own message under ANOTHER member's name in any chat he is
--    in, give it any date, or move it between his chats:
--      PATCH /rest/v1/messages?id=eq.<mine>
--            {"username":"Ian","created_at":"2026-01-01","group_id":<other chat of mine>}
--    (Moving it into a chat he is NOT in is already stopped by the
--    messages_read policy - tested.) "Ian wrote ..." in the class chat
--    that Ian never wrote.
--      -> clients may only UPDATE content + edited_at (what messenger.js
--         sends); created_at is always the server time on INSERT.
--
-- How it could break something
-- * A wrong code no longer raises: join_group returns NULL (the miss has
--   to be committed to count). The messenger.js in this commit shows
--   "No group with that code"; an OLD cached messenger.js just does
--   nothing on a wrong code (no alert). Right codes work in both.
-- * Somebody who mistypes 10 codes in 10 minutes waits up to 10 minutes.
-- * Any client that updates other message columns than content/edited_at
--   gets "permission denied for table messages". messenger.js:494 is the
--   only UPDATE in the repo. merge_accounts() is SECURITY DEFINER (owner
--   postgres) and is not affected.
-- =============================================================

-- ---------- 1. join by code ----------
create table if not exists public.join_code_misses(
  user_id uuid primary key
    references auth.users(id) on delete cascade,
  window_start timestamptz not null default now(),
  misses integer not null default 0
);
alter table public.join_code_misses enable row level security;
revoke all on public.join_code_misses from public, anon, authenticated;
grant all on public.join_code_misses to service_role;

create or replace function public.join_group(p_code text, p_username text)
 returns public.groups
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c_max_misses constant integer := 10;
  c_window constant interval := interval '10 minutes';
  c_max_code_length constant integer := 32;
  uid uuid := auth.uid();
  v_code text := lower(btrim(coalesce(p_code, '')));
  g public.groups;
  miss public.join_code_misses;
begin
  perform public.assert_not_kart();
  if uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into miss from public.join_code_misses where user_id = uid;
  if found and miss.window_start > now() - c_window
     and miss.misses >= c_max_misses then
    raise exception 'Too many wrong codes. Try again in a few minutes.';
  end if;
  if v_code <> '' and char_length(v_code) <= c_max_code_length then
    -- a direct message is never joined by code
    select * into g from public.groups
     where invite_code = v_code and not is_dm;
  end if;
  if g.id is null then
    -- No exception here: an exception would roll the counter back.
    insert into public.join_code_misses as m (user_id, window_start, misses)
    values (uid, now(), 1)
    on conflict (user_id) do update
      set misses = case when m.window_start > now() - c_window
                        then m.misses + 1 else 1 end,
          window_start = case when m.window_start > now() - c_window
                              then m.window_start else now() end;
    return null;
  end if;
  insert into public.group_members (group_id, user_id, username)
    values (g.id, uid, p_username)
    on conflict (group_id, user_id) do nothing;
  return g;
end; $function$;

-- New groups: 12 random hex characters (48 bits) instead of 6.
-- Existing codes stay as they are, so codes already passed on keep working.
alter table public.groups
  alter column invite_code
  set default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);

-- OPTIONAL (Ian decides): the 21 existing group codes are still 6 hex.
-- With the attempt limit that is ~800 000 guesses per hit at 10 per
-- 10 minutes per account. To close it fully, give them new codes (members
-- see the new code in the chat header; codes passed on earlier stop working):
--   update public.groups
--      set invite_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)
--    where char_length(invite_code) < 12;

-- ---------- 2. messages: what a client may change ----------
revoke update on public.messages from anon, authenticated;
grant update (content, edited_at) on public.messages to authenticated;

create or replace function public.messages_server_time()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  new.created_at := now();
  new.edited_at := null;
  return new;
end $function$;

drop trigger if exists messages_server_time on public.messages;
create trigger messages_server_time
  before insert on public.messages
  for each row execute function public.messages_server_time();

-- ---------- check ----------
select 'join_group refuses DMs' as check,
       position('not is_dm' in pg_get_functiondef(
         'public.join_group(text,text)'::regprocedure)) > 0 as ok
union all
select 'messages: clients update content+edited_at only',
       not has_table_privilege('authenticated', 'public.messages', 'UPDATE')
       and has_column_privilege('authenticated', 'public.messages', 'content', 'UPDATE')
       and not has_column_privilege('authenticated', 'public.messages', 'group_id', 'UPDATE');
