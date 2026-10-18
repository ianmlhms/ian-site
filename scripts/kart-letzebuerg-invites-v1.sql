-- kart-letzebuerg-invites-v1.sql (Oct 2026)
-- Lets a Kart Lëtzebuerg lobby host invite friends from inside the game (pb/kart-letzebuerg.html).
-- The lobby code is chosen by the game (it is the Realtime room name), so the invite has to carry THAT room,
-- not the random one invite_game() makes up. invite_game() itself is left untouched.
--
-- Run:  supabase db query --linked -f scripts/kart-letzebuerg-invites-v1.sql
-- Until it has run, the in-game "Invite friends" button reports "could not invite" and the share link / room code still work.

-- 1. game_invites.game check: allow the new game (NOT VALID like the others: enforced for new rows only)
alter table public.game_invites drop constraint if exists game_invites_game_ck;
alter table public.game_invites
  add constraint game_invites_game_ck check (
    game in ('connect4', 'slf', 'battleship',
      'color', 'draw', 'reversi', 'dots',
      'tictactoe', 'checkers', 'maumau',
      'dice-duel', 'kart-letzebuerg')) not valid;

-- 2. invite a friend into an existing lobby code
create or replace function public.invite_game_room(
    p_to uuid, p_game text, p_room text)
  returns public.game_invites
  language plpgsql
  security definer
  set search_path = public
  as '
declare
  gi public.game_invites;
  me text;
  is_friend boolean;
begin
  if p_game is distinct from ''kart-letzebuerg'' then
    raise exception ''unknown game'';
  end if;
  if p_room is null or p_room !~ ''^[a-z0-9]{4,10}$'' then
    raise exception ''bad room'';
  end if;
  select true into is_friend
    from public.friendships f
   where f.status = ''accepted''
     and ((f.requester = auth.uid() and f.addressee = p_to)
       or (f.addressee = auth.uid() and f.requester = p_to))
   limit 1;
  if is_friend is not true then
    raise exception ''not friends'';
  end if;
  select username into me from public.profiles where id = auth.uid();
  insert into public.game_invites (from_user, from_name, to_user, game, room)
    values (auth.uid(), coalesce(me, ''?''), p_to, p_game, p_room)
    returning * into gi;
  return gi;
end';
grant execute on function public.invite_game_room(uuid, text, text) to authenticated;
