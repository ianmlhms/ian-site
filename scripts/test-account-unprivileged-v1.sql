-- 24 Sep 2026: ian@ian.lu is Ian's TEST account
-- and must behave like a normal user. Drop its
-- admin row; konto@ian.lu stays the only admin
-- (plus whoever else is listed). Safe to re-run.
delete from public.app_admins
  where lower(email) = 'ian@ian.lu';

select email from public.app_admins;
