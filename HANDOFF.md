# ian.lu — Project Handoff

Personal site + web apps for Ian Mulheims. Static front-end (HTML/CSS/vanilla JS),
backed by **Supabase** for accounts, data and realtime. No build step.

_Last updated: June 2026._

---

## 1. Where everything lives

| Thing | Location |
|---|---|
| **Working repo** | `~/OneDrive - Mulheims/website` (= `/Users/ian/Library/CloudStorage/OneDrive-Mulheims/website`). It's a git repo synced via OneDrive. |
| **GitHub** | `https://github.com/ianmlhms/ian-site` (public). `gh` authed as **ianmlhms**. Push needs `gh auth setup-git`. Pushing workflow files needs the `workflow` scope. |
| **Live site** | **https://ian.lu** (EuroDNS **Plesk** hosting, server IP `185.11.137.140`) — valid Let's Encrypt SSL, HTTP→HTTPS redirect on. |
| **Also live** | GitHub Pages mirror: `https://ianmlhms.github.io/ian-site/`. |
| **Registrar** | EuroDNS. **DNS is hosted at Microsoft 365** (nameservers `*.bdm.microsoftonline.com`). The website A record (`@` + `www`) points to the Plesk IP; **email/MX stays on Outlook — never touch it**. |

## 2. Deploy (how changes go live)

Every `git push` to `main` triggers **two** deploys automatically:
1. **GitHub Pages** (builds from `main`).
2. **Plesk via FTP** — GitHub Actions `.github/workflows/deploy.yml` uses **lftp FTPS**
   (cert verification off — Plesk self-signed) to mirror the repo into `httpdocs/`.

Standard loop:
```sh
cd "~/OneDrive - Mulheims/website"
git pull --rebase --autostash    # the Mac mini also pushes dashboard-data commits
# edit files…
git add -A && git commit -m "…" && git push
```
Then watch the run:
```sh
gh run list --repo ianmlhms/ian-site --workflow "Deploy to ian.lu (Plesk FTP)" --limit 1
```

**Repo secrets** (Settings → Secrets → Actions): `FTP_SERVER` = `185.11.137.140`,
`FTP_USERNAME` = `ftp-zlssfj7utm6y`, `FTP_PASSWORD`. ⚠️ The FTP password was exposed in
plaintext during setup — **should be rotated** in Plesk (Connection info ✏️) and the secret updated.

### ⚠️ Cache-busting (read this!)
GitHub Pages/Plesk serve assets with `cache-control: max-age=600` (10 min). A normal reload
does **not** refetch JS — so after changing a `.js` file, **bump its `?v=N`** in the `<script>`
tags that reference it (e.g. `messenger.js?v=4`), or the user keeps the old cached version.
"Nothing changed after reload" = stale cache, not a bug. To test instantly: a **private window**.
Current versions: `theme.js?v=1`, `auth.js?v=3`, `messenger.js?v=8`, `friends.js?v=4`,
`pixelbreak-records.js?v=3`, `admin.js?v=4`, `factory-auth.js?v=3`, `notify-ambient.js?v=1`
(`notify.js`/`sw.js` are imported, not query-versioned — hard-refresh or bump the importer).

## 3. Supabase

- Project URL: `https://lvksqmgfwkfbblfsozfk.supabase.co`
- **Publishable (anon) key** lives in `pixelbreak-config.js` (public-safe; RLS protects data).
- **Admin** = the account with email `konto@ian.lu` (row in `app_admins`; `is_admin()` checks the JWT email).
- **Service-role key** (secret) is set only on the **Mac mini** for the dashboard publisher — never in the repo.
- Email confirmation is **ON** by default for signups.

All SQL lives in `scripts/` and **has been run** in the Supabase SQL editor (run new migrations there manually):
`supabase-setup.sql` (scores) · `messenger-setup.sql` / `-v2` / `-v3` / **`-v4`** · `dashboard-private-setup.sql`
· `admin-users-setup.sql` · `grades-sync-setup.sql` · `social-games-setup.sql` · `social-fix.sql`.
⚠️ **`messenger-setup-v4.sql` must be run** (replies, read-state, push tables) — see §8.
⚠️ **`messenger-setup-v5.sql` must be run** (read receipts: chat_reads shared-select policy + realtime).
⚠️ **`messenger-setup-v6.sql` must be run** (emoji reactions table + realtime; `messages.edited_at` + update policy).

Key tables: `profiles` (auto-created per user via `handle_new_user` trigger), `scores`,
`groups`/`group_members`/`messages`, `dashboard_state` (admin-only), `app_admins`,
`grade_sheets`, `friendships`, `game_invites`. Most access is via `SECURITY DEFINER` RPCs
(`is_admin`, `my_chats`, `start_dm`, `add_friend`, `directory`, `invite_game`, `admin_*`, …).
Realtime publication includes `messages`, `game_invites`, `group_members`.

## 4. Pages / features

| Page | Files | What it is |
|---|---|---|
| **Home** | `index.html`, `style.css`, `main.js` | Launcher with tiles (admin-only tiles appear when signed in as admin). |
| **PixelBreak** | `pixelbreak.html`, `pixelbreak-records.js`, `pixelbreak-config.js` | 31 embedded single-player games + accounts, high-score capture, leaderboards. Home button top-left. |
| **ShortsFactory stats** | `stats.html` | Public sanitized stats, reads `data/factory.json`. |
| **ShortsFactory dashboard** | `factory.html`, `factory-auth.js` | Full dashboard, **admin-only** (Supabase login + `is_admin`), reads `dashboard_state`. |
| **Messenger** | `messenger.html`, `messenger.js` | Groups + 1:1 DMs (by username), member lists, leave, photo/video (private `chat-media` bucket, signed URLs), 30-sec delete, realtime. `?dm=username` deep-links a DM. **Tap a photo → fullscreen lightbox. Swipe a message (or long-press) to reply** (denormalised `reply_*` cols; quoted bubble jumps to original). **Unread chats show the name in bold + a dot + last-message preview** (`chat_reads`/`mark_read`, `my_chats` v4 returns `unread`/`last_preview`). **🔔 Notify** button = Web Push opt-in. **Read receipts**: own messages show ✓ (sent) → blue ✓✓ "Gelies" once all other members have read (`chat_reads` + v5 select policy + realtime). **❓** header link → `notify-help.html`. **v6 features**: emoji **reactions** (`message_reactions` table + realtime; 🙂 button/pop), **edit** own messages (✏️, `edited_at`, realtime UPDATE), **typing indicator** (broadcast on the chat channel), **online dots** (global `online` presence channel keyed by username), **per-chat mute** (localStorage `mutedChats`; honoured by `notify.js` ambient — NOT server push), **chat search** (sidebar filter), **voice messages** (MediaRecorder → `chat-media`, `media_type:'audio'`). |
| **Notifications** | `notify.js`, `notify-ambient.js`, `sw.js`, `manifest.webmanifest` | Shared module. `initAmbient()` (loaded via `notify-ambient.js` on most pages) shows live in-app toasts + system notifications for new messages while you're elsewhere on the site (e.g. in a game) — no server. `enablePush()` subscribes the device for **Web Push** (closed-app notifications) via the `notify` Edge Function. See **§8**. |
| **Admin** | `admin.html`, `admin.js` | Read all groups/DMs/messages; delete group/message; add/remove members; **Users tab**: list/delete users, reset password (can't view — bcrypt). |
| **Grades** | `grades.html` | Luxembourg grade calc: Year → Track/Section (7e–1ère, official MEN coefficients), "what do I need next", **account sync** (`grade_sheets`) + local fallback. |
| **Friends** | `friends.html`, `friends.js` | Add by username, **People** directory, sent/received requests, Message (→ DM) or invite to a game. |
| **Games hub** | `games.html` | New category (separate from PixelBreak). Start/Join by code, or invite a friend. |
| **Connect 4** | `connect4.html` | 1v1, realtime broadcast (`c4:<room>`). **`?ai=1`** = local single-player vs a minimax/alpha-beta computer (no network). |
| **Stadt-Land-Fluss** | `slf.html` | 2+ players, realtime (`slf:<room>`), letter→categories→uniqueness scoring. |
| **Battleship** | `battleship.html` | 1v1, realtime (`bs:<room>`), manual ship placement (H/V toggle) + Shuffle. **`?ai=1`** = local single-player vs a hunt/target computer (random fleet, checkerboard hunt). |
| **Colour Dial** | `color.html` | dialed.gg-style: everyone matches the same target colour with R/G/B sliders, closest match wins the round; host sets the round count **and mode** in the lobby. Two modes: **👁 visible** (target stays on screen) and **⚡ flash** (target shown ~3s then hidden — match from memory). Realtime (`col:<room>`), **host-authoritative** scoring (host computes + broadcasts `reveal`). 2+ players. |
| **Theme** | `theme.js` | Floating 🎨 picker (dark/light + accent) on every page; sets CSS vars on `:root`, localStorage. |
| **Shared auth** | `auth.js` | Supabase client + account button + sign-in modal (loads supabase-js from jsDelivr UMD global, **not** esm.sh — that broke in Safari). |

**Multiplayer games** use Supabase **Realtime Broadcast** (channel per room, presence by role/clientId) —
no DB tables, no extra SQL. Players join via room code or friend invite. Name = account username or a prompt.

## 5. ShortsFactory dashboard data pipeline (Mac mini)

The full ShortsFactory data is **private** (admin-only). On the **Mac mini**, `scripts/publish_factory.py`
(copied into the ShortsFactory project) runs after each pipeline run via `scripts/publish-dashboard.sh`:
it writes a **sanitized** `data/factory.json` (public stats) to this repo and pushes the **full** data to
Supabase `dashboard_state` using the service-role key (`SUPABASE_SERVICE_KEY` env on the Mac mini).
Old full data was scrubbed from git history.

## 6. Gotchas / conventions

- **One Supabase client only.** `auth.js` caches its client on `window.__pbAuth`, so every
  import (even mismatched `auth.js` vs `auth.js?v=3`) shares ONE GoTrue. Two session-managing
  clients on the same localStorage race on token refresh → "signed in but everything 401s"
  (no chats, no admin link). Realtime-only clients (the game pages' own `createClient`) must pass
  `{ auth:{ persistSession:false, autoRefreshToken:false } }` so they don't touch the session.
  `notify-ambient.js` is deliberately NOT on `pixelbreak.html` (it runs its own login client there).
- **Bump `?v=` on any JS change** (see §2) — the #1 source of "it didn't update".
- **`git pull --rebase` before pushing** — the Mac mini commits dashboard refreshes to the same repo.
- After any **git history rewrite**, every clone must `git reset --hard` (never plain pull) or old commits return.
- New Supabase features need their SQL **run manually** in the dashboard.
- Realtime `postgres_changes`: register `.on()` **before** `.subscribe()`, and don't double-subscribe the same channel.
- `iOS Safari` quirks handled: `100dvh` for full-height pages; UMD supabase-js (not esm.sh); theme uses CSS vars.

## 7. Open items

- **Rotate the FTP password** (exposed during setup) + update `FTP_PASSWORD` secret.
- ~~Finish Web Push~~ **DONE (Jun 2026):** v4 SQL run; `notify` Edge Function deployed
  (`--no-verify-jwt`); VAPID + `NOTIFY_SECRET` secrets set; DB webhook on `messages` INSERT live
  (header `x-notify-secret`); verified arriving on the iPad home-screen PWA. (Function logs in the
  dashboard lag a few min via Logflare — delivery itself is instant.)
- A proper **PNG `apple-touch-icon`** would render nicer on the iOS Home Screen than the SVG.
- Light mode swaps core CSS vars site-wide; a few deeply-custom spots may still look dark — tune as reported.
- Possible next features discussed: live class quiz; manual-placement polish; per-section upper-cycle grade coefficients (currently a general editable base for 3e–1ère).

## 8. Notifications (in-app + Web Push)

Two layers:
1. **In-app / foreground** (no server): `notify.js` `initAmbient()` — loaded via
   `notify-ambient.js` on most pages (index, games, connect4, slf, battleship, friends,
   grades, pixelbreak) — subscribes to `messages` INSERTs over Realtime (RLS scopes it to
   your chats) and shows a toast + a system Notification (if permission granted). This is the
   "get messenger notifications while you're in a game" piece.
2. **Web Push / closed-app** (needs backend): `sw.js` + `manifest.webmanifest` +
   `push_subscriptions` table + the **`notify` Edge Function** (`supabase/functions/notify`).
   The 🔔 Notify button in Messenger calls `enablePush()` → stores the device subscription;
   a **DB webhook on `messages` INSERT** calls the function, which signs a push with the
   **VAPID** keypair and fans it out to every group member's devices.

VAPID **public** key is in `pixelbreak-config.js` (`vapidPublicKey`); the **private** key +
`NOTIFY_SECRET` are Supabase function secrets only (never committed — repo is public).
**Full deploy walkthrough: `scripts/PUSH-SETUP.md`.** iOS only delivers push to the site once
it's **Added to Home Screen** (iOS 16.4+).
