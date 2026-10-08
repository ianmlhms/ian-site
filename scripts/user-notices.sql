-- One-time personal popups ("notices") shown on the next ian.lu visit, e.g. after
-- restoring lost game progress. Texts per language: {"lb": "...", "de": "...", "en": "..."}.
create table if not exists public.user_notices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      jsonb not null,
  body       jsonb not null,
  cta        jsonb,              -- optional button label, e.g. {"lb":"Spillen"}
  url        text,               -- optional same-site link for the button
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
create index if not exists user_notices_unseen on public.user_notices (user_id) where seen_at is null;
alter table public.user_notices enable row level security;   -- no policies: RPCs only
revoke all on table public.user_notices from anon, authenticated;

create or replace function public.my_notices()
returns table(id uuid, title jsonb, body jsonb, cta jsonb, url text)
language sql stable security definer set search_path = public as $$
  select n.id, n.title, n.body, n.cta, n.url
  from public.user_notices n
  where n.user_id = auth.uid() and n.seen_at is null
  order by n.created_at
  limit 3;
$$;

create or replace function public.dismiss_notice(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.user_notices set seen_at = now()
  where id = p_id and user_id = auth.uid() and seen_at is null;
$$;

revoke all on function public.my_notices() from public, anon;
revoke all on function public.dismiss_notice(uuid) from public, anon;
grant execute on function public.my_notices() to authenticated;
grant execute on function public.dismiss_notice(uuid) to authenticated;
