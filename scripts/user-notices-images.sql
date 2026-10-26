-- user_notices: optional pictures above the popup text (26 Oct 2026).
-- images = [{"src": "/pb/thumbs/mtb.webp", "url": "/pixelbreak.html?g=mtb", "alt": {"lb": "...", "de": "...", "en": "..."}}], same-site paths only (site-notice.js checks).
alter table public.user_notices add column if not exists images jsonb;

drop function if exists public.my_notices();
create function public.my_notices()
returns table(id uuid, title jsonb, body jsonb, cta jsonb, url text, images jsonb)
language sql stable security definer set search_path = public as $$
  select n.id, n.title, n.body, n.cta, n.url, n.images
  from public.user_notices n
  where n.user_id = auth.uid() and n.seen_at is null
  order by n.created_at
  limit 3;
$$;
revoke all on function public.my_notices() from public, anon;
grant execute on function public.my_notices() to authenticated;

-- The arcade news popup sent earlier today: add the two game pictures and restore the paragraph break.
update public.user_notices
set images = '[{"src":"/pb/thumbs/mtb.webp","url":"/pixelbreak.html?g=mtb","alt":{"lb":"MTB Mëllerdall","de":"MTB Mëllerdall","en":"MTB Mëllerdall"}},{"src":"/pb/thumbs/park.webp","url":"/pixelbreak.html?g=park","alt":{"lb":"Schueberfouer Tycoon","de":"Schueberfouer Tycoon","en":"Schueberfouer Tycoon"}}]'::jsonb,
    body = jsonb_build_object(
      'lb', replace(body->>'lb', 'Schéissendëmpel. An d''', E'Schéissendëmpel.\n\nAn d'''),
      'de', replace(body->>'de', 'Schiessentümpel. Und', E'Schiessentümpel.\n\nUnd'),
      'en', replace(body->>'en', 'Schiessentümpel. And', E'Schiessentümpel.\n\nAnd'))
where url = '/pixelbreak.html' and title->>'en' like '%New in the arcade: MTB%';
select count(*) filter (where images is not null) as with_images, count(*) filter (where seen_at is null) as unseen from public.user_notices where title->>'en' like '%New in the arcade: MTB%';
