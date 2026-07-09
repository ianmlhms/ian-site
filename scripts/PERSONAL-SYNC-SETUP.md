# Personal tools — sync setup (Strava + bank)

The pages `health.html`, `money.html`, `countdowns.html`, `me.html` work **immediately
with manual entry** once `scripts/personal-tools-v1.sql` is run. The two *sync*
integrations are optional and need a one-time setup by you — I never handle any
credentials, and no secret ever lives in the public repo.

## 0. Run the SQL (required, unlocks all four pages)
Paste `scripts/personal-tools-v1.sql` into Supabase ▸ SQL Editor ▸ Run. It creates
own-only tables (`countdowns`, `health_days`, `workouts`, `finance_tx`,
`subscriptions`) and `user_integrations` (tokens — no client access) + the
`integration_status()` helper.

## 1. Strava (health.html) — no Strava premium needed
The free Strava API returns all your activities, including Apple Watch workouts you
record into Strava.

1. Create an API app: https://www.strava.com/settings/api
   - **Authorization Callback Domain:** `ian.lu`
   - Note the **Client ID** and **Client Secret**.
2. Put the Client ID (public) into `pixelbreak-config.js` → `stravaClientId: "..."` and push.
3. Set the secrets + deploy the function:
   ```sh
   supabase secrets set STRAVA_CLIENT_ID=xxxxx STRAVA_CLIENT_SECRET=xxxxxxxx --project-ref lvksqmgfwkfbblfsozfk
   supabase functions deploy strava-sync --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
   ```
4. On health.html tap **"Mat Strava verbannen"** → authorize once → your activities import.

### Apple Watch without Strava
If you don't want to route through Strava, the alternative is to push HealthKit data
from the **KartTracker2 iOS app** (it already has HealthKit permission for heart rate)
straight into the `workouts` table with the anon key. That's an iOS-side change in the
KartTracker2 repo, not here — say the word and I'll spec it there.

## 2. Bank sync (money.html) — read-only, via GoCardless Bank Account Data
Free, covers Luxembourg banks. **You consent on your own bank's page; I never see your
bank login.** It is read-only — it can only *read* transactions, never move money.

1. Free account: https://bankaccountdata.gocardless.com → **Secrets** → get
   **SECRET_ID** + **SECRET_KEY**.
2. Find your bank's institution id (one-off): with an access token from
   `POST /api/v2/token/new/`, call `GET /api/v2/institutions/?country=lu` and copy the
   `id` of your bank (e.g. Spuerkeess/BCEE).
3. Set secrets + deploy:
   ```sh
   supabase secrets set GC_SECRET_ID=xxx GC_SECRET_KEY=xxx BANK_INSTITUTION_ID=SPUERKEESS_XXX --project-ref lvksqmgfwkfbblfsozfk
   supabase functions deploy bank-sync --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
   ```
4. On money.html tap **"Bankkont verbannen"** → you're sent to your bank to approve →
   back on the page it pulls your transactions.

> ⚠️ Note on being a student/minor: GoCardless consent happens through your bank's own
> online-banking login, so it only works if you have online banking. If the bank blocks
> it, stick with manual entry — the tracker is fully usable without the sync.

## Reminders
- `git push` deploys the **pages** (Plesk/Pages) but **not** Edge Functions — deploy those
  with the `supabase functions deploy` commands above.
- Tokens live only in `user_integrations` (no client RLS policy) — the browser asks
  `integration_status(provider)` for a yes/no and never receives a token.
