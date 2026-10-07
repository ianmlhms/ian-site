-- Signed-out visitors (anon) may only read the public profile basics:
-- id, username, avatar (profile.html?u=<name> works signed out).
-- School class, casino balance, theme, account kind etc. need a signed-in account.
-- profiles has SELECT policies only, so all writes already go through RPCs.
revoke all on table public.profiles from anon;
grant select (id, username, avatar) on table public.profiles to anon;
