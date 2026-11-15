-- Kamera-Arcade (15 Nov 2026): webcam scores swing a lot between honest runs
-- (lighting, distance, body size), so the 1.5x "new #1" rule would ban real
-- players. Treat webcam-* boards like idle games: skip only the ratio rule.
create or replace function public.is_idle_game(p_game text)
returns boolean language sql immutable as $$
  select p_game in ('idle-empire', 'cookie-clicker', 'bus-tycoon', 'park')
      or p_game like 'webcam-%'
$$;
