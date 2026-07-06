-- Avatar photo upload v1
-- Lets a signed-in user store an uploaded profile picture (Supabase Storage URL)
-- in profiles.avatar, in addition to the existing emoji avatars.
--
-- Run once in the Supabase SQL editor.

-- ---- 1) Relax the avatar column: allow an emoji (<=8) OR a storage URL --------
alter table public.profiles drop constraint if exists profiles_avatar_check;
alter table public.profiles add constraint profiles_avatar_check
  check (
    avatar is null
    or char_length(avatar) <= 8                                   -- emoji
    or (avatar like 'https://%/storage/v1/object/public/avatars/%' -- uploaded photo
        and char_length(avatar) <= 400)
  );

-- ---- 2) set_avatar accepts an emoji or an avatars-bucket URL -----------------
create or replace function public.set_avatar(p_avatar text)
returns void language plpgsql security definer set search_path = public as $$
declare v text := nullif(trim(p_avatar), '');
begin
  if v is not null then
    if v like 'http%' then
      if v not like 'https://%/storage/v1/object/public/avatars/%' then
        raise exception 'avatar url not allowed';
      end if;
      if char_length(v) > 400 then
        raise exception 'avatar url too long';
      end if;
    elsif char_length(v) > 8 then
      raise exception 'avatar too long';
    end if;
  end if;
  update public.profiles set avatar = v where id = auth.uid();
end; $$;
grant execute on function public.set_avatar(text) to authenticated;

-- ---- 3) Public "avatars" storage bucket, one folder per user ----------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- anyone may read avatar images (they're shown across the site)
drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects
  for select to public using (bucket_id = 'avatars');

-- a user may only write/replace/remove files inside their own uid folder:
--   avatars/<auth.uid()>/avatar.jpg
drop policy if exists avatars_own_write on storage.objects;
create policy avatars_own_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and name like auth.uid()::text || '/%');

drop policy if exists avatars_own_update on storage.objects;
create policy avatars_own_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and name like auth.uid()::text || '/%')
  with check (bucket_id = 'avatars' and name like auth.uid()::text || '/%');

drop policy if exists avatars_own_delete on storage.objects;
create policy avatars_own_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and name like auth.uid()::text || '/%');
