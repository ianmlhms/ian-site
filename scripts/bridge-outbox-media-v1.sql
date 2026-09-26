-- Unified Messenger: let Ian's own clients upload attachments for sending.
-- Clients upload to bridge-media/outbox/<uuid>/<file>, then insert a
-- bridge_outbox row with media_path pointing at it; the owning bridge
-- daemon downloads it with the service role and sends it.
-- Scoped to the owner and to the outbox/ folder only: clients can never
-- overwrite the thumbnails/media the bridges write.

drop policy if exists "bridge media owner outbox upload" on storage.objects;
create policy "bridge media owner outbox upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'bridge-media'
    and auth.uid() = 'a40ba59a-3460-4ef2-a8e8-3db0c91eac66'::uuid
    and (storage.foldername(name))[1] = 'outbox'
  );
