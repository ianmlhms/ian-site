-- =============================================================
-- security-fix-misc-v1.sql   (audit 15 Nov 2026)  -- NOT APPLIED YET
-- Run:  supabase db query --linked -f scripts/security-fix-misc-v1.sql
-- Idempotent. No client change needed.
--
-- 1. LOW  set_casino_balance(p_bal) sets the caller's FakeStake balance
--    to any number up to 1 000 000 000 and does not look at
--    profiles.can_casino (fs.html says "the real protection is server
--    side", but the check is only in the page):
--      rpc set_casino_balance {"p_bal": 999999999}
--    Play money, on no leaderboard, so low. -> only can_casino accounts.
--    Breaks: nothing for the 2 can_casino accounts; for everybody else
--    the call becomes a silent no-op (they cannot open fs.html anyway).
--
-- 2. LOW  add_notification() writes a notification with any title, body
--    and kind into the inbox of ANY player (by username), as often as
--    the caller likes:
--      rpc add_notification {"p_to_username":"<victim>","p_kind":"mention",
--          "p_title":"Admin: däi Kont gëtt geläscht","p_body":"..."}
--    The only caller is the @mention in messenger.js.
--    -> kind is always 'mention', the receiver must share a chat with
--       the sender, and the same text is not stored twice within a minute.
--    Breaks: an @mention of somebody who is not in any chat with the
--    sender no longer notifies (he could not open that chat anyway).
-- =============================================================

-- ---------- 1. FakeStake balance ----------
create or replace function public.set_casino_balance(p_bal numeric)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin perform public.assert_not_kart();
  if p_bal is null or p_bal < 0 or p_bal > 1000000000 then
    raise exception 'invalid balance';
  end if;
  update public.profiles set casino_balance = round(p_bal, 2)
   where id = auth.uid() and (can_casino or public.is_admin());
end; $function$;

-- ---------- 2. @mention notifications ----------
create or replace function public.add_notification(
  p_to_username text,
  p_kind text default null::text,
  p_title text default null::text,
  p_body text default null::text,
  p_url text default null::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  uid uuid := auth.uid();
  target uuid;
  v_title text := left(coalesce(p_title, ''), 120);
  v_body text := left(p_body, 240);
begin
  perform public.assert_not_kart();
  if uid is null or v_title = '' then return; end if;
  select p.id into target from public.profiles p
   where lower(p.username) = lower(btrim(p_to_username))
     and p.id <> uid;
  if target is null then return; end if;
  -- only somebody I share a chat with
  if not exists (
       select 1 from public.group_members mine
         join public.group_members theirs
           on theirs.group_id = mine.group_id
        where mine.user_id = uid and theirs.user_id = target) then
    return;
  end if;
  if exists (
       select 1 from public.notifications n
        where n.user_id = target and n.kind = 'mention'
          and n.title = v_title
          and n.body is not distinct from v_body
          and n.created_at > now() - interval '1 minute') then
    return;
  end if;
  insert into public.notifications (user_id, kind, title, body, url)
  values (target, 'mention', v_title, v_body,
          case when p_url ~ ('^[A-Za-z0-9._-]+[.]html'
                          || '([?][A-Za-z0-9._=&%-]*)?$')
               then left(p_url, 200) else null end);
end $function$;

-- ---------- check ----------
select proname, prosecdef, proconfig
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('set_casino_balance', 'add_notification')
 order by proname;
