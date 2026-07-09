# Personal tools — setup

`health.html`, `money.html`, `countdowns.html`, `me.html` all work **immediately with
manual entry** once `scripts/personal-tools-v1.sql` is run. Only the optional Apple
Watch health sync needs a one-time setup.

## Dropped integrations
- **Strava** — their API now requires a **paid Strava subscription** (the "Create an
  Application" page says *"available to subscribers"*), so a custom OAuth app can't read
  activities on a free account. Dropped.
- **GoCardless / bank sync** — open-banking consent requires the account holder to be
  **18+**, so it's not usable here. Dropped. `money.html` is manual entry (which is the
  main value anyway).

## Apple Watch → Health sync (no premium, no App Store)
Push Health data with an **Apple Shortcuts automation**. The phone only ever holds a
per-user token; it maps to exactly one account and can only write that account's data.

1. Run `scripts/personal-tools-v1.sql` (creates the tables + `get_health_token()`).
2. Deploy the ingest function (must allow no-JWT so Shortcuts can call it):
   ```sh
   supabase functions deploy health-ingest --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
   ```
   (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are injected automatically — no secrets to set.)
3. Open **health.html** while signed in → copy your **token** from the "Apple Watch / Health Sync" card.
4. In the **Shortcuts** app → **Automation** → **Time of Day** (e.g. 22:00 daily):
   - **Find Health Samples** → Steps (today) → save to a variable; repeat for Sleep, Weight.
   - **Get Contents of URL**:
     - URL: `https://lvksqmgfwkfbblfsozfk.functions.supabase.co/health-ingest`
       (or `https://lvksqmgfwkfbblfsozfk.supabase.co/functions/v1/health-ingest`)
     - Method: **POST**, Request Body: **JSON**
     - Fields: `token` = your token, plus any of `steps`, `sleep_h`, `weight_kg`,
       `water_ml`, and a `workouts` array `[{type,at,duration_min,distance_km,calories,ext_id}]`.
   - Turn **Ask Before Running** off so it runs unattended.

The board on health.html shows synced workouts with a ⌚ badge; daily metrics fill the
Today card. Anything the Shortcut doesn't send, you can still enter by hand.

### If you'd rather not build a Shortcut
The KartTracker2 iOS app already has HealthKit permission — it could POST the same JSON
to `health-ingest` on a background refresh. That's a change in the KartTracker2 repo; say
the word and I'll spec it there.

## Reminder
`git push` deploys the **pages**, not Edge Functions — deploy `health-ingest` with the
command above.
