-- 24 Sep 2026: the Friends "People" tab
-- (a list of every account) was removed on
-- Ian's request. Revoke the RPC so nobody
-- can still list all users. Friends are added
-- by exact username (add_friend) only.
revoke execute on function public.directory()
  from anon, authenticated, public;
