-- mp-invite-resend-v1.sql (27 Nov 2026)
-- Ski Alpen bug (Ian, school iPad): a friend who declined / pressed "later" / missed the invite could never be invited into the SAME lobby again
-- (mp_invite answered already_invited for ever; a rematch reuses the lobby code). Now only a still-pending invite younger than 45 s counts as
-- "already invited" (double taps, the flaky-network resend); an older or answered one is replaced by a new row, the 10-minute / 20-invite rate
-- limit still applies. Same signature, idempotent.
-- Run:  supabase db query --linked -f scripts/mp-invite-resend-v1.sql

create or replace function public.mp_invite(p_game text, p_room text, p_to uuid[])
  returns jsonb
  language plpgsql
  security definer
  set search_path = public
  as '
declare
  me uuid := auth.uid();
  my_name text;
  g public.mp_games;
  target uuid;
  seen uuid[] := ''{}'';
  results jsonb := ''[]''::jsonb;
  st text;
  sent_recently integer;
  sender_restricted boolean;
  max_per_window constant integer := 20;
begin
  if me is null then
    raise exception ''not signed in'';
  end if;
  if public.is_kart_only() then
    raise exception ''not allowed'';            -- karting-only accounts stay out of the social features (kart_block policy)
  end if;
  select * into g from public.mp_games where id = p_game and enabled;
  if g.id is null then
    raise exception ''unknown game'';
  end if;
  if p_room is null or p_room !~ ''^[a-z0-9]{4,10}$'' then
    raise exception ''bad room'';
  end if;
  if p_to is null or coalesce(array_length(p_to, 1), 0) not between 1 and 8 then
    raise exception ''bad recipients'';
  end if;
  select username into my_name from public.profiles where id = me;
  if my_name is null then
    raise exception ''no profile'';
  end if;
  sender_restricted := public.is_view_restricted();
  select count(*) into sent_recently from public.game_invites
   where from_user = me and created_at > now() - interval ''10 minutes'';

  foreach target in array p_to loop
    if target is null then
      continue;
    end if;
    if target = any(seen) then
      continue;                                   -- same person twice in one call: report once
    end if;
    seen := seen || target;
    if target = me then
      st := ''self'';
    elsif not exists (select 1 from public.profiles where id = target) then
      st := ''unknown_user'';
    elsif sender_restricted
          and target not in (select v.user_id from public.visible_user_ids() v) then
      st := ''not_allowed'';
    elsif public.mp_is_restricted(target) and not public.mp_are_friends(me, target) then
      st := ''not_allowed'';                        -- a restricted account is only reachable by its friends
    elsif exists (select 1 from public.game_invites
                   where from_user = me and to_user = target and game = g.id and room = p_room
                     and status = ''pending'' and created_at > now() - interval ''45 seconds'') then
      st := ''already_invited'';
    elsif sent_recently >= max_per_window then
      st := ''rate_limited'';
    else
      insert into public.game_invites (from_user, from_name, to_user, game, room)
        values (me, my_name, target, g.id, p_room);
      sent_recently := sent_recently + 1;
      st := ''sent'';
    end if;
    results := results || jsonb_build_array(jsonb_build_object(''user_id'', target, ''status'', st));
  end loop;
  return results;
end';
revoke all on function public.mp_invite(text, text, uuid[]) from public, anon;
grant execute on function public.mp_invite(text, text, uuid[]) to authenticated;
