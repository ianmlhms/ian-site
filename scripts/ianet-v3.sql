-- IanNet remote v3: update SD pages from home (sdfile / sddelete commands).
alter table public.ianet_commands drop constraint if exists ianet_commands_kind_check;
alter table public.ianet_commands add constraint ianet_commands_kind_check
  check (kind in ('chat', 'delete', 'restart', 'firmware', 'sdfile', 'sddelete'));

alter table public.ianet_commands drop constraint if exists ianet_commands_payload_ok;
alter table public.ianet_commands add constraint ianet_commands_payload_ok check (
  (kind = 'chat' and length(payload->>'text') between 1 and 300 and length(coalesce(payload->>'name', '')) <= 20)
  or (kind = 'delete' and payload->>'item_kind' in ('chat', 'photo', 'file', 'guestbook')
      and (payload->>'item_id') ~ '^[A-Za-z0-9_-]{1,64}$')
  or (kind = 'restart')
  or (kind = 'firmware' and (payload->>'path') ~ '^firmware/[A-Za-z0-9._-]{1,80}\.bin$'
      and (payload->>'sha256') ~ '^[0-9a-f]{64}$'
      and (payload->>'size')::bigint between 1 and 6291456)
  -- SD page updates: target path must stay under /www (no "..", no "//"), object is content-addressed.
  or (kind = 'sdfile' and (payload->>'path') ~ '^/www/[A-Za-z0-9._/-]{1,180}$'
      and (payload->>'path') !~ '\.\.' and (payload->>'path') !~ '//'
      and (payload->>'object') ~ '^sd/[0-9a-f]{64}$'
      and (payload->>'sha256') = substr(payload->>'object', 4)
      and (payload->>'size')::bigint between 0 and 20971520)
  or (kind = 'sddelete' and (payload->>'path') ~ '^/www/[A-Za-z0-9._/-]{1,180}$'
      and (payload->>'path') !~ '\.\.' and (payload->>'path') !~ '//')
);

-- The admin can also stage SD objects from the browser; push.py stages through the function.
drop policy if exists ianet_objects_admin_insert on storage.objects;
create policy ianet_objects_admin_insert on storage.objects
  for insert with check (bucket_id = 'ianet' and (name like 'firmware/%' or name like 'sd/%') and public.is_admin());
