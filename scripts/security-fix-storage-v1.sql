-- =============================================================
-- security-fix-storage-v1.sql   (audit 15 Nov 2026)  -- NOT APPLIED YET
-- Run:  supabase db query --linked -f scripts/security-fix-storage-v1.sql
-- Idempotent. No client change needed.
--
-- What it closes
-- 1. MEDIUM  Bucket "avatars" is PUBLIC and has no size and no type
--    limit. Any signed-in player can upload anything up to 50 MB under
--    avatars/<own id>/... and gets a public link on the project's
--    domain (videos, archives, a fake login page as .html ...), as many
--    files as he likes. profile.html only ever uploads one ~40 KB JPEG.
--      -> avatars: max 2 MB, only JPEG / PNG / WebP / GIF.
-- 2. LOW  Policy avatars_public_read lets everybody (also without an
--    account) LIST the bucket: every player id that has a picture.
--    A public bucket serves its files by URL without any policy; the
--    policy is only needed for list / upsert / remove, so it is narrowed
--    to the player's own folder.
-- 3. LOW  exam-files had no limit (exams.html stops at 8 MB in the
--    browser only) -> 10 MB. chat-media gets the project limit written
--    down (50 MB, so nothing changes) as a safety net.
--
-- How it could break something
-- * An avatar upload that is not JPEG/PNG/WebP/GIF or is over 2 MB is
--   refused by storage. profile.html always sends image/jpeg, 256 px.
--   Biggest avatar today: 41 KB, all 12 are image/jpeg.
-- * A page that LISTS other players' avatars through the storage API
--   would get an empty list (none in the repo: pictures are loaded by
--   their public URL, which keeps working).
-- * exam-files: a file between 10 and 50 MB uploaded with a self-made
--   request is refused (the page already refuses > 8 MB).
-- * chat-media types are NOT restricted: sending any file is a feature.
-- * If "update storage.buckets" is refused for the SQL role, set the
--   same values in Dashboard > Storage > bucket settings.
-- =============================================================

update storage.buckets
   set file_size_limit = 2 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
 where id = 'avatars';

update storage.buckets
   set file_size_limit = 10 * 1024 * 1024
 where id = 'exam-files';

update storage.buckets
   set file_size_limit = 50 * 1024 * 1024
 where id = 'chat-media';

-- list / upsert / remove need SELECT on the own objects only
drop policy if exists "avatars_public_read" on storage.objects;
drop policy if exists "avatars_own_read" on storage.objects;
create policy "avatars_own_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars'
         and name like ((auth.uid())::text || '/%'));

-- ---------- check ----------
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id in ('avatars', 'exam-files', 'chat-media')
 order by id;
