# Lock-Screen Widget — Setup (iPhone)

The widget shows, **from 06:50 until the bus is gone**, the live departure of
the **D02 at Niederanven Laach** (with delay); the **rest of the day** it shows
the date + weather. Data comes from `transport?action=widget` (Edge Function).

## 1. Install Scriptable
App Store → **Scriptable** (free, by Simon Støvring).

## 2. Add the script
1. Open Scriptable → **+** (new script).
2. Name it `ian.lu` .
3. Paste the full contents of `scripts/widget-scriptable.js`.
4. Run it once (▶) — you should see the widget preview (day mode outside the
   morning window; D02 only appears on school days 06:50–09:30).

## 3. Put it on the Lock Screen
1. Long-press the Lock Screen → **Customize** → Lock Screen.
2. Tap the widget area under the clock → add **Scriptable** (rectangular, or
   inline next to the date).
3. Tap the added widget → **Script: `ian.lu`** → done.

Also works as a small Home-Screen widget (long-press Home Screen → + →
Scriptable → choose the script).

## Notes
- iOS decides when widgets refresh; the script requests every ~3 min during
  the bus window and ~30 min otherwise. Opening the widget's app view (tap)
  forces a refresh.
- Different bus/stop/window without editing the script: add query params to
  `FN_URL`, e.g. `&line=321&stop=200504001&from=06:30&until=10:00`.
- The function must be redeployed when `transport/index.ts` changes:
  `supabase functions deploy transport --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk`
