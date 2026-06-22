# WebUntis homework sync — setup

Syncs your WebUntis homework into the site. Single-user (admin = konto@ian.lu):
the Edge Function logs in with **your** WebUntis credentials (kept as function
secrets — never in the repo or chat) and writes homework into `public.homework`,
which only you can read. `homework.html` shows it with a **Sync now** button.

## 1. Run the SQL
Supabase ▸ SQL Editor ▸ run **`scripts/homework-setup.sql`** (creates the
`homework` table + admin-only read policy).

## 2. Deploy the Edge Function
```sh
cd "~/OneDrive - Mulheims/website"
supabase functions deploy webuntis-sync --project-ref lvksqmgfwkfbblfsozfk
```
(Keep JWT verification ON — the function checks that the caller is the admin.)

## 3. Set the secrets  (uses the "Untis Mobile" SECRET — no password needed)
In WebUntis ▸ profile ▸ **Freigaben** ▸ *Zugriff über Untis Mobile* ▸ **Anzeigen**,
note **Schule** (`laml`), **Benutzer** and **Schlüssel** (the base32 secret key).
```sh
supabase secrets set --project-ref lvksqmgfwkfbblfsozfk \
  WEBUNTIS_SERVER="https://laml.webuntis.com" \
  WEBUNTIS_SCHOOL="laml" \
  WEBUNTIS_USER="<Benutzer from that screen>" \
  WEBUNTIS_SECRET="<Schlüssel / secret key>" \
  ADMIN_EMAIL="konto@ian.lu"
```
`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are injected — don't set them.
⚠️ `WEBUNTIS_SCHOOL` is the API id **`laml`** (lowercase), not the display name "Aline Mayrisch".
The secret is sensitive (a permanent login). To revoke it later: *Geräte abmelden* on that screen.

## 4. Use it
Open **https://ian.lu/homework.html** signed in as konto@ian.lu → **Sync now**.
The 📚 Hausaufgaben tile also appears on the home page when you're signed in as admin.

## 5. (Optional) Daily auto-sync
Supabase ▸ Database ▸ **Cron** (or Edge Functions ▸ Schedules) → schedule
`webuntis-sync` once a day. (Scheduled invocations come from Supabase with a
service-role JWT; if the admin check rejects it, tell me and I'll add a
cron-secret bypass header.)

## Notes / troubleshooting
WebUntis' unofficial API varies by tenant. If **Sync now** returns an error, open
Supabase ▸ Edge Functions ▸ `webuntis-sync` ▸ Logs — the function returns the
failing step (`WebUntis login failed`, `homework fetch failed` + status/body).
Paste that and I'll adjust the auth/endpoint (e.g. token vs. cookie, or the
`/api/homeworks/lessons` path) — it may need one tweak for LAML's instance.
