-- ===========================================================================
-- Security hardening v1 — closes the gaps found in the July 2026 site audit.
-- Paste into Supabase ▸ SQL Editor ▸ Run. Idempotent.
--
--  1) group_members: no direct client inserts (join only via the definer RPCs
--     create_group / join_group / start_dm / admin_add_member — they validate
--     the invite code / DM pairing / admin). The old policy let any signed-in
--     user add themselves to ANY group by its sequential id.
--  2) chat-media storage: reads and uploads scoped to members of the group the
--     file belongs to (paths are "<group_id>/<uuid>.<ext>"); admin keeps read.
--  3) kart_sessions: no more world-listable SELECT — readers must present the
--     full session UUID via kart_get(); admin lists via kart_list(). Inserts/
--     updates stay open for the iPhone app (anon key), which is acceptable once
--     UUIDs can no longer be enumerated.
--  4) usernames on messages / reactions / members are derived server-side from
--     profiles (no display-name spoofing via hand-crafted inserts).
--  5) record_wordle: username from profiles, day clamped to today ±1.
--
-- Depends on: messenger-setup.sql (+v2), kart-setup.sql, wordle-setup.sql.
-- After running: no client changes needed except kart.html / karts.html
-- (updated in the same commit as this file).
-- ===========================================================================

-- ---- 1) group_members: force joins through the RPCs ------------------------
drop policy if exists members_self_insert on public.group_members;
-- (members_read / members_self_delete stay; the definer RPCs bypass RLS.)

-- ---- 2) chat-media: membership-scoped storage policies ---------------------
-- Media paths are "<group_id>/<uuid>.<ext>", so the first folder names the group.
drop policy if exists "chat media upload" on storage.objects;
create policy "chat media upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] ~ '^[0-9]+$'
    and public.is_group_member(((storage.foldername(name))[1])::bigint)
  );

drop policy if exists "chat media read" on storage.objects;
create policy "chat media read" on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-media'
    and (
      public.is_admin()
      or (
        (storage.foldername(name))[1] ~ '^[0-9]+$'
        and public.is_group_member(((storage.foldername(name))[1])::bigint)
      )
    )
  );

-- ---- 3) kart_sessions: read by full UUID only ------------------------------
drop policy if exists kart_read on public.kart_sessions;

-- Public-by-link viewer (kart.html?s=<uuid>): the UUID is the capability.
create or replace function public.kart_get(p_id uuid)
returns jsonb language sql security definer stable set search_path = public as $$
  select payload from public.kart_sessions where id = p_id;
$$;
grant execute on function public.kart_get(uuid) to anon, authenticated;

-- Admin session list (karts.html).
create or replace function public.kart_list()
returns table(id uuid, payload jsonb, created_at timestamptz)
language sql security definer stable set search_path = public as $$
  select k.id, k.payload, k.created_at from public.kart_sessions k
  where public.is_admin()
  order by k.created_at desc;
$$;
grant execute on function public.kart_list() to authenticated;

-- ---- 4) server-derived usernames -------------------------------------------
create or replace function public.set_username_from_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  select username into uname from public.profiles where id = new.user_id;
  if uname is not null then new.username := uname; end if;
  return new;
end $$;

drop trigger if exists messages_set_username on public.messages;
create trigger messages_set_username before insert on public.messages
  for each row execute function public.set_username_from_profile();

drop trigger if exists reactions_set_username on public.message_reactions;
create trigger reactions_set_username before insert on public.message_reactions
  for each row execute function public.set_username_from_profile();

drop trigger if exists members_set_username on public.group_members;
create trigger members_set_username before insert on public.group_members
  for each row execute function public.set_username_from_profile();

-- ---- 5) wordle: RPC-only writes, profile username, sane day ----------------
drop policy if exists wordle_insert on public.wordle_results;   -- RPC only

create or replace function public.record_wordle(p_username text, p_lang text, p_day int, p_guesses int)
returns void language plpgsql security definer set search_path = public as $$
declare
  uname text;
  today int := floor(extract(epoch from now()) / 86400)::int;
begin
  if auth.uid() is null then return; end if;
  if p_lang not in ('lb', 'de') then return; end if;
  if p_day is null or abs(p_day - today) > 1 then return; end if;   -- today ±1 (timezone slack)
  select username into uname from public.profiles where id = auth.uid();
  insert into public.wordle_results (user_id, username, lang, day, guesses)
  values (auth.uid(), coalesce(uname, nullif(trim(p_username), ''), 'player'),
          p_lang, p_day, greatest(0, least(6, p_guesses)))
  on conflict (user_id, lang, day) do nothing;
end $$;
grant execute on function public.record_wordle(text, text, int, int) to authenticated;
