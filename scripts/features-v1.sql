-- ===========================================================================
-- Features v1 — feedback box, class polls, private exam countdowns, avatars.
-- Paste into Supabase ▸ SQL Editor ▸ New query ▸ Run. Idempotent (safe to re-run).
-- ===========================================================================

-- ---- 1) Feedback box (PixelBreak): anyone can send, only admins can read ----
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind       text not null check (kind in ('idea','bug','other')),
  message    text not null check (char_length(message) between 3 and 2000),
  page       text check (page is null or char_length(page) <= 60),
  username   text check (username is null or char_length(username) <= 60)
);
alter table public.feedback enable row level security;

drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback
  for insert to anon, authenticated
  with check (char_length(message) between 3 and 2000);

drop policy if exists feedback_admin_read on public.feedback;
create policy feedback_admin_read on public.feedback
  for select to authenticated using (public.is_admin());

drop policy if exists feedback_admin_delete on public.feedback;
create policy feedback_admin_delete on public.feedback
  for delete to authenticated using (public.is_admin());

-- ---- 2) Class polls: admin creates, signed-in users vote (one vote, changeable) ----
create table if not exists public.polls (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  question   text not null check (char_length(question) between 3 and 200),
  options    jsonb not null check (jsonb_typeof(options) = 'array'
                                   and jsonb_array_length(options) between 2 and 6),
  is_open    boolean not null default true,
  created_by uuid not null default auth.uid()
);
alter table public.polls enable row level security;

drop policy if exists polls_read on public.polls;
create policy polls_read on public.polls for select using (true);

drop policy if exists polls_admin_insert on public.polls;
create policy polls_admin_insert on public.polls
  for insert to authenticated with check (public.is_admin());

drop policy if exists polls_admin_update on public.polls;
create policy polls_admin_update on public.polls
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists polls_admin_delete on public.polls;
create policy polls_admin_delete on public.polls
  for delete to authenticated using (public.is_admin());

create table if not exists public.poll_votes (
  poll_id    uuid not null references public.polls(id) on delete cascade,
  user_id    uuid not null default auth.uid(),
  option_idx int  not null check (option_idx between 0 and 5),
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);
alter table public.poll_votes enable row level security;

-- users only ever see their OWN vote row; totals come from the RPC below
drop policy if exists poll_votes_read_own on public.poll_votes;
create policy poll_votes_read_own on public.poll_votes
  for select to authenticated using (user_id = auth.uid());

drop policy if exists poll_votes_insert on public.poll_votes;
create policy poll_votes_insert on public.poll_votes
  for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.polls p where p.id = poll_id and p.is_open));

drop policy if exists poll_votes_update on public.poll_votes;
create policy poll_votes_update on public.poll_votes
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
              and exists (select 1 from public.polls p where p.id = poll_id and p.is_open));

-- anonymous aggregate results (no user_id exposed)
create or replace function public.poll_results_all()
returns table (poll_id uuid, option_idx int, votes bigint)
language sql security definer set search_path = public stable as $$
  select poll_id, option_idx, count(*) from public.poll_votes group by 1, 2;
$$;
grant execute on function public.poll_results_all() to anon, authenticated;

-- ---- 3) Private exam countdowns (admin = Ian only) ----
create table if not exists public.exams (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  subject    text not null check (char_length(subject) between 1 and 100),
  note       text check (note is null or char_length(note) <= 200),
  at         timestamptz not null
);
alter table public.exams enable row level security;

drop policy if exists exams_admin_all on public.exams;
create policy exams_admin_all on public.exams
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---- 4) Avatars on profiles (picked on profile.html, shown in Messenger) ----
alter table public.profiles add column if not exists avatar text
  check (avatar is null or char_length(avatar) <= 8);

-- avatar-only updates go through this RPC so the username column stays locked.
-- Accepts either a short emoji OR an uploaded photo URL in the avatars bucket
-- (see scripts/avatar-upload-v1.sql, which must also run to relax the column
-- check + create the bucket). Kept in sync here so re-running this base script
-- never reverts to the emoji-only version.
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
