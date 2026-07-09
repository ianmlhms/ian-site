-- ==========================================
-- Waves 3-7 combined migration.
-- School hub (class-scoped exams + notes +
-- flashcards), weekly leaderboard, and in-app
-- notifications (@mentions).
-- Paste ALL into Supabase > SQL Editor > Run.
-- Idempotent. No $-quoting; lines <=56 chars.
-- Needs: profiles, my_class(), is_admin(),
-- exams, game_results (earlier scripts).
-- ==========================================

-- ---------- Wave 3a: exams -> class board ----
alter table public.exams
  add column if not exists class text;
alter table public.exams
  add column if not exists created_by uuid
  default auth.uid();

drop policy if exists exams_admin_all
  on public.exams;
drop policy if exists exams_read
  on public.exams;
drop policy if exists exams_insert
  on public.exams;
drop policy if exists exams_update
  on public.exams;
drop policy if exists exams_delete
  on public.exams;

create policy exams_read
  on public.exams
  for select to authenticated
  using (class = public.my_class());

create policy exams_insert
  on public.exams
  for insert to authenticated
  with check (
    class = public.my_class()
    and created_by = auth.uid());

create policy exams_update
  on public.exams
  for update to authenticated
  using (
    created_by = auth.uid()
    or public.is_admin())
  with check (class = public.my_class());

create policy exams_delete
  on public.exams
  for delete to authenticated
  using (
    created_by = auth.uid()
    or public.is_admin());

-- ---------- Wave 3b: notes/uploads on a test --
create table if not exists
  public.exam_notes(
    id uuid primary key
      default gen_random_uuid(),
    exam_id uuid not null
      references public.exams(id)
      on delete cascade,
    class text not null,
    body text,
    file_url text,
    file_name text,
    created_by uuid not null
      default auth.uid(),
    created_at timestamptz not null
      default now());

alter table public.exam_notes
  enable row level security;

drop policy if exists exam_notes_read
  on public.exam_notes;
create policy exam_notes_read
  on public.exam_notes
  for select to authenticated
  using (class = public.my_class());

drop policy if exists exam_notes_insert
  on public.exam_notes;
create policy exam_notes_insert
  on public.exam_notes
  for insert to authenticated
  with check (
    class = public.my_class()
    and created_by = auth.uid());

drop policy if exists exam_notes_delete
  on public.exam_notes;
create policy exam_notes_delete
  on public.exam_notes
  for delete to authenticated
  using (
    created_by = auth.uid()
    or public.is_admin());

create index if not exists
  exam_notes_exam_idx
  on public.exam_notes(exam_id);

-- ---------- Wave 3c: flashcards (Quizlet) -----
create table if not exists
  public.flashcard_decks(
    id uuid primary key
      default gen_random_uuid(),
    owner uuid not null
      default auth.uid(),
    title text not null,
    class text,
    exam_id uuid
      references public.exams(id)
      on delete set null,
    shared boolean not null
      default false,
    created_at timestamptz not null
      default now());

alter table public.flashcard_decks
  enable row level security;

drop policy if exists decks_read
  on public.flashcard_decks;
create policy decks_read
  on public.flashcard_decks
  for select to authenticated
  using (
    owner = auth.uid()
    or (shared
      and class = public.my_class()));

drop policy if exists decks_insert
  on public.flashcard_decks;
create policy decks_insert
  on public.flashcard_decks
  for insert to authenticated
  with check (owner = auth.uid());

drop policy if exists decks_update
  on public.flashcard_decks;
create policy decks_update
  on public.flashcard_decks
  for update to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid());

drop policy if exists decks_delete
  on public.flashcard_decks;
create policy decks_delete
  on public.flashcard_decks
  for delete to authenticated
  using (owner = auth.uid());

create table if not exists
  public.flashcards(
    id uuid primary key
      default gen_random_uuid(),
    deck_id uuid not null
      references public.flashcard_decks(id)
      on delete cascade,
    front text not null,
    back text not null,
    pos int not null default 0);

alter table public.flashcards
  enable row level security;

drop policy if exists cards_read
  on public.flashcards;
create policy cards_read
  on public.flashcards
  for select to authenticated
  using (exists (
    select 1
    from public.flashcard_decks d
    where d.id = deck_id
      and (d.owner = auth.uid()
        or (d.shared
          and d.class
            = public.my_class()))));

drop policy if exists cards_write
  on public.flashcards;
create policy cards_write
  on public.flashcards
  for all to authenticated
  using (exists (
    select 1
    from public.flashcard_decks d
    where d.id = deck_id
      and d.owner = auth.uid()))
  with check (exists (
    select 1
    from public.flashcard_decks d
    where d.id = deck_id
      and d.owner = auth.uid()));

create index if not exists
  flashcards_deck_idx
  on public.flashcards(deck_id, pos);

-- ---------- Wave 3d: exam-files bucket --------
insert into storage.buckets(id, name, public)
  values ('exam-files','exam-files',true)
  on conflict (id) do nothing;

drop policy if exists exam_files_insert
  on storage.objects;
create policy exam_files_insert
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'exam-files'
    and (storage.foldername(name))[1]
        = auth.uid()::text);

drop policy if exists exam_files_delete
  on storage.objects;
create policy exam_files_delete
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'exam-files'
    and owner = auth.uid());

-- ---------- Wave 5: weekly leaderboard --------
create or replace function
  public.game_leaderboard_window(
    p_game text default null,
    p_days int default 7)
  returns table(
    username text, wins int,
    losses int, draws int,
    total int, winpct int)
  language sql
  security definer
  stable
  set search_path = public
  as '
    select r.username,
      count(*) filter
        (where r.result = ''win'')::int,
      count(*) filter
        (where r.result = ''loss'')::int,
      count(*) filter
        (where r.result = ''draw'')::int,
      count(*)::int,
      round(100.0 * count(*)
        filter (where r.result = ''win'')
        / nullif(count(*), 0))::int
    from public.game_results r
    where (p_game is null
        or r.game = p_game)
      and (p_days is null
        or r.created_at
           > now()
           - (p_days || '' days'')
             ::interval)
    group by r.user_id, r.username
    order by count(*) filter
      (where r.result = ''win'') desc
    limit 100';

grant execute on function
  public.game_leaderboard_window(text, int)
  to anon, authenticated;

-- ---------- Wave 6: in-app notifications ------
create table if not exists
  public.notifications(
    id uuid primary key
      default gen_random_uuid(),
    user_id uuid not null,
    kind text not null,
    title text not null,
    body text,
    url text,
    seen boolean not null default false,
    created_at timestamptz not null
      default now());

alter table public.notifications
  enable row level security;

drop policy if exists notif_read
  on public.notifications;
create policy notif_read
  on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists notif_update
  on public.notifications;
create policy notif_update
  on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists notif_delete
  on public.notifications;
create policy notif_delete
  on public.notifications
  for delete to authenticated
  using (user_id = auth.uid());

create index if not exists
  notifications_user_idx
  on public.notifications(
    user_id, created_at desc);

-- Insert a notification FOR another user (by
-- username), e.g. an @mention. Definer, since
-- clients have no insert policy. Never notifies
-- yourself. Caps length defensively.
create or replace function
  public.add_notification(
    p_to_username text,
    p_kind text,
    p_title text,
    p_body text default null,
    p_url text default null)
  returns void
  language sql
  security definer
  set search_path = public
  as '
    insert into public.notifications(
      user_id, kind, title, body, url)
    select p.id,
           left(p_kind, 24),
           left(p_title, 120),
           left(p_body, 240),
           left(p_url, 200)
    from public.profiles p
    where lower(p.username)
        = lower(btrim(p_to_username))
      and p.id <> auth.uid()';

grant execute on function
  public.add_notification(
    text, text, text, text, text)
  to authenticated;

create or replace function
  public.notif_unseen()
  returns int
  language sql
  security definer
  stable
  set search_path = public
  as 'select count(*)::int
      from public.notifications
      where user_id = auth.uid()
        and not seen';

grant execute on function
  public.notif_unseen()
  to authenticated;

create or replace function
  public.mark_notifs_seen()
  returns void
  language sql
  security definer
  set search_path = public
  as 'update public.notifications
        set seen = true
      where user_id = auth.uid()
        and not seen';

grant execute on function
  public.mark_notifs_seen()
  to authenticated;
