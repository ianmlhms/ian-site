# Moien (day companion) — setup

`moien.html` = LB greeting + live clock, **weather** (works out of the box), and **live
public-transport departures** (needs a free key + the `transport` Edge Function).

## Weather — nothing to do
Uses **Open-Meteo** (no key, CORS-friendly), Luxembourg City coords 49.61, 6.13. Live already.

## Live departures — request a key, then deploy the proxy
The Verkéiersbond real-time API (HAFAS `departureBoard`) needs a key and has no CORS, so the
page calls the `transport` Edge Function which proxies it.

1. **Request a free API key** by email: **opendata-api@atp.etat.lu** (Administration des
   transports publics). Say it's for a small personal website showing departure boards.
2. **Deploy the function + set the key:**
   ```sh
   supabase functions deploy transport --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
   supabase secrets set TRANSPORT_API_KEY=<key> --project-ref lvksqmgfwkfbblfsozfk
   ```
3. Reload `moien.html` — the search box appears; type a stop, pick it, see live departures
   (delay in red `+N`, cancellations struck through). Your last stop is remembered locally.

Until the key is set the function returns `{configured:false}` and the page shows a friendly
"coming soon" notice — nothing errors.

## Notes
- Endpoints proxied: `location.name` (stop search) and `departureBoard` (next 90 min, ~12 runs).
- Board auto-refreshes every 45 s while the page is open.
- HOST is `https://cdt.hafas.de/opendata/apiserver`; response mapping is in `index.ts`
  (`Departure[]` → `{line,dir,time,planned,delay,cancelled}`). If the key's response shape
  differs slightly, adjust the mapping there — it's written defensively but untested until a
  real key is in.
