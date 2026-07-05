# ian.lu — Project Handoff

Personal site + web apps for Ian Mulheims. Static front-end (HTML/CSS/vanilla JS),
backed by **Supabase** for accounts, data and realtime. No build step.

_Last updated: 5 July 2026._

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
`FTP_USERNAME` = `ftp-zlssfj7utm6y`, `FTP_PASSWORD` (rotated Jul 2026 after the setup-time
exposure — done ✓). `deploy.yml` has a `plesk-deploy` concurrency group so two pushes can't
run parallel FTP mirrors (that race once broke a deploy).

### ⚠️ Cache-busting (read this!)
GitHub Pages/Plesk serve assets with `cache-control: max-age=600` (10 min). A normal reload
does **not** refetch JS — so after changing a `.js` file, **bump its `?v=N`** in the `<script>`
tags that reference it (e.g. `messenger.js?v=4`), or the user keeps the old cached version.
"Nothing changed after reload" = stale cache, not a bug. To test instantly: a **private window**.
Current versions (5 Jul 2026): `theme.js?v=4`, `auth.js?v=3`, `i18n-dict.js?v=7` (same on ALL
pages — keep it unified), `i18n.js?v=1`, `messenger.js?v=13`, `friends.js?v=6`,
`pixelbreak-records.js?v=8`, `admin.js?v=4`, `factory-auth.js?v=3`, `notify-ambient.js?v=2`,
`game-common.js?v=1`, `game-common.css?v=1`, `style.css?v=6`
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
⚠️ **`wordle-setup.sql` must be run** (Wordle public leaderboard: `wordle_results` + RPCs). [run ✓]
⚠️ **`rankings-setup.sql` must be run** (cross-game rankings: `game_results` + `record_match`/`game_leaderboard`). [run ✓]
⚠️ **`homework-setup.sql`** (WebUntis homework table) + deploy `webuntis-sync` Edge Function — see `scripts/WEBUNTIS-SETUP.md`.
⚠️ **`hotel-setup.sql`** (private Hotel-Simulator cloud saves: `hotel_saves` + owner-only RLS). [run ✓]
⚠️ **`game-saves-v1.sql`** (PixelBreak cross-device game-state saves). [run ✓]
⚠️ **`security-hardening-v1.sql`** (RLS lockdown: group_members insert via RPCs only, chat-media
   scoped reads, kart_sessions locked, server-derived usernames, notify fail-closed pairing). [run ✓ Jul 2026, verified]
⚠️ **`features-v1.sql`** (feedback box, class polls, exams, profile avatars — Jul 2026).
   [run ✓ 5 Jul 2026 — verified live: polls/poll_votes/exams/feedback tables +
   `poll_results_all()` RPC + `profiles.avatar` column all present]
✅ **`study-buddy-v1.sql`** (AI tutor daily-usage cap: `ai_usage` + `ai_usage_bump()` RPC — Jul 2026).
   [run ✓; `study-buddy` Edge Function deployed ✓. **Per-request model routing** (`pickModel()`):
   Ian (`konto@ian.lu` only) → Claude Sonnet 4.6 (no cap); everyone else (incl. test acct
   `ian@ian.lu`) msgs 1–10/day →
   Claude Haiku 4.5, msgs 11+/day → Gemini 2.5 Flash-Lite (best budget LB; GPT-5 nano's LB was
   garbled so it's not routed to). Keys set: `ANTHROPIC_API_KEY` + `GEMINI_API_KEY` (+ optional
   `OPENAI_API_KEY`). See `scripts/STUDY-BUDDY-SETUP.md`.]
⚠️ **`study-buddy-conversations-v1.sql`** (saved chats: `buddy_conversations`, owner-only RLS,
   14-day pg_cron purge — Jul 2026). [PENDING run. Page persists/resumes conversations + a
   read filter hides >14d even if pg_cron isn't enabled. buddy.html also now does multi-image
   upload in every mode + a redesigned mode picker.]

Key tables: `profiles` (auto-created per user via `handle_new_user` trigger), `scores`,
`groups`/`group_members`/`messages`, `dashboard_state` (admin-only), `app_admins`,
`grade_sheets`, `friendships`, `game_invites`. Most access is via `SECURITY DEFINER` RPCs
(`is_admin`, `my_chats`, `start_dm`, `add_friend`, `directory`, `invite_game`, `admin_*`, …).
Realtime publication includes `messages`, `game_invites`, `group_members`.

## 4. Pages / features

| Page | Files | What it is |
|---|---|---|
| **Home** | `index.html`, `style.css`, `main.js` | Play-first hero ("40 Spiller…", LB/DE/EN via i18n) + live **summer-holiday countdown** (target `2026-07-09T12:40+02:00`, inline script at the bottom of index.html) + launcher tiles (admin-only tiles appear when signed in as admin). |
| **PixelBreak** | `pixelbreak.html`, `pb/*.html` (31 games), `pixelbreak-records.js`, `pixelbreak-config.js`, `pixelbreak.webmanifest` | Hub + 31 single-player games as separate files in `pb/` (fetched into a sandboxed iframe srcdoc; `robots.txt` disallows `/pb/`). **Per-game URLs** `?g=<id>` (pushState + dynamic title/canonical/meta-description; all 31 in sitemap.xml). Accounts, high scores, cloud game-saves, PB.net multiplayer relay. **Install-as-app** button (`beforeinstallprompt`; iOS hint toast). **Feedback box** (💬 FAB → `feedback` table). **Sound+haptics shim** injected into every game by `PB.instrument` (score-up blip + vibration, running-counter suppression, 🔊/🔇 in game bar, localStorage `pb_muted`). Chill Drive is a true-3D three.js game (see pb/chill-drive.html). Word Scramble + Typing have 🇱🇺 LB toggles. |
| **Study Buddy** | `buddy.html`, `supabase/functions/study-buddy`, `scripts/study-buddy-v1.sql` | **AI homework tutor** (Claude Haiku 4.5 via Edge Function). Sign-in gated; 5 modes picked up front: ask/explain · flashcards · quiz-me · language help · **scan & solve** (photo of a homework page → full worked answer, vision). Subject picker. Per-user **daily cap** (`DAILY_LIMIT=40`, `ai_usage` + `ai_usage_bump()`), hard spend cap set in the Anthropic console. System prompt = `BASE`+`MODES` in `index.ts`. Setup: `scripts/STUDY-BUDDY-SETUP.md`. Phase 2 (not built): schoolbook RAG via pgvector. |
| **Moien** | `moien.html`, `supabase/functions/transport` | **Luxembourg day companion.** LB greeting + live clock/date, **weather** via Open-Meteo (no key, live now), and **live public-transport departures** via the `transport` Edge Function (proxies the Verkéiersbond/HAFAS `departureBoard`+`location.name`). Transport is dormant until `TRANSPORT_API_KEY` is set — request a free key from opendata-api@atp.etat.lu; page shows a "coming soon" notice meanwhile. Setup: `scripts/MOIEN-SETUP.md`. Public page (no login). |
| **Polls** | `polls.html` | Class polls: admin creates/closes/deletes (RLS-gated), signed-in users vote (one changeable vote, `poll_votes` PK), anonymous totals via `poll_results_all()` RPC. Needs `features-v1.sql`. |
| **Exams** | `exams.html` | **Admin-only** exam countdowns (subject/date/note, live tick, red <3 days, auto-hides >1 day past). `exams` table, admin RLS. Not indexed (robots + noindex). Needs `features-v1.sql`. |
| **Profile** | `profile.html` | Avatar picker (24 emoji presets → `profiles.avatar` via `set_avatar` RPC) + player stats (game_leaderboard + local Wordle stats). Messenger renders avatars next to bubbles/member list (`avatarMap` in messenger.js, fails quietly pre-migration). Needs `features-v1.sql`. |
| **ShortsFactory stats** | `stats.html` | Public sanitized stats, reads `data/factory.json`. |
| **ShortsFactory dashboard** | `factory.html`, `factory-auth.js` | Full dashboard, **admin-only** (Supabase login + `is_admin`), reads `dashboard_state`. |
| **Messenger** | `messenger.html`, `messenger.js` | Groups + 1:1 DMs (by username), member lists, leave, photo/video (private `chat-media` bucket, signed URLs), 30-sec delete, realtime. `?dm=username` deep-links a DM. **Tap a photo → fullscreen lightbox. Swipe a message (or long-press) to reply** (denormalised `reply_*` cols; quoted bubble jumps to original). **Unread chats show the name in bold + a dot + last-message preview** (`chat_reads`/`mark_read`, `my_chats` v4 returns `unread`/`last_preview`). **🔔 Notify** button = Web Push opt-in. **Read receipts**: own messages show ✓ (sent) → blue ✓✓ "Gelies" once all other members have read (`chat_reads` + v5 select policy + realtime). **❓** header link → `notify-help.html`. **v6 features**: emoji **reactions** (`message_reactions` table + realtime; 🙂 button/pop), **edit** own messages (✏️, `edited_at`, realtime UPDATE), **typing indicator** (broadcast on the chat channel), **online dots** (global `online` presence channel keyed by username), **per-chat mute** (localStorage `mutedChats`; honoured by `notify.js` ambient — NOT server push), **chat search** (sidebar filter), **voice messages** (MediaRecorder → `chat-media`, `media_type:'audio'`). |
| **Notifications** | `notify.js`, `notify-ambient.js`, `sw.js`, `manifest.webmanifest` | Shared module. `initAmbient()` (loaded via `notify-ambient.js` on most pages) shows live in-app toasts + system notifications for new messages while you're elsewhere on the site (e.g. in a game) — no server. `enablePush()` subscribes the device for **Web Push** (closed-app notifications) via the `notify` Edge Function. See **§8**. |
| **Admin** | `admin.html`, `admin.js` | Read all groups/DMs/messages; delete group/message; add/remove members; **Users tab**: list/delete users, reset password (can't view — bcrypt). |
| **Grades** | `grades.html` | Luxembourg grade calc: Year → Track/Section (7e–1ère, official MEN coefficients), "what do I need next", **account sync** (`grade_sheets`) + local fallback. |
| **Hausaufgaben** | `homework.html` | **Admin-only** WebUntis homework. "Sync now" invokes the **`webuntis-sync` Edge Function** (logs in with WebUntis creds from function secrets, upserts into `homework`). `homework` table is admin-read. Home tile is admin-only. Deploy/secrets: `scripts/WEBUNTIS-SETUP.md`. School = Aline Mayrisch / `laml.webuntis.com`. |
| **Friends** | `friends.html`, `friends.js` | Add by username, **People** directory, sent/received requests, Message (→ DM) or invite to a game. |
| **Games hub** | `games.html` | Now just a redirect to `pixelbreak.html` — the hub lists the online 1v1 games as `o-*` entries alongside the arcade games. |
| **Connect 4** | `connect4.html` | 1v1, realtime broadcast (`c4:<room>`). **`?ai=1`** = local single-player vs a minimax/alpha-beta computer (no network). |
| **Stadt-Land-Fluss** | `slf.html` | 2+ players, realtime (`slf:<room>`), letter→categories→uniqueness scoring. **Answers are fact-checked against Wikidata at the reveal** (host queries query.wikidata.org per answer — city/country/river/given-name/animal/profession class checks — and broadcasts verdicts; invalid answers score 0, shown struck-through). The host gets a "✓ count it" override next to each rejected answer (re-scores the round incl. duplicates, broadcast to guests). Fails open on API errors/timeouts so the game never blocks. |
| **Battleship** | `battleship.html` | 1v1, realtime (`bs:<room>`), manual ship placement (H/V toggle) + Shuffle. **`?ai=1`** = local single-player vs a hunt/target computer (random fleet, checkerboard hunt). |
| **Colour Dial** | `color.html` | dialed.gg-style: everyone matches the same target colour with R/G/B sliders, closest match wins the round; host sets the round count **and mode** in the lobby. Two modes: **👁 visible** (target stays on screen) and **⚡ flash** (target shown ~3s then hidden — match from memory). Realtime (`col:<room>`), **host-authoritative** scoring. **`?ai=1`** = solo vs two bots (🤖 Pixel / 🤖 Byte) that guess with random error. 2+ players. |
| **Molerei (draw & guess)** | `draw.html` | Skribbl-style realtime: one player draws a secret word (canvas strokes broadcast as normalised segments on `draw:<room>`), everyone else guesses in a chat box. **Host-authoritative** (host picks word options/validates guesses/scores/rotates drawer over `LAPS=2` laps, 75s turns). Drawer rotates each turn; speed-based scoring. Targeted DOM updates during a turn so the canvas isn't wiped. 2+ players. |
| **Wuertspill (Wordle)** | `wordle.html` | Single-player daily Wordle in **Lëtzebuergesch + Deutsch** (language toggle). Deterministic daily word per language, 6 guesses, on-screen QWERTZ keyboard (incl. ÄÖÜËÉ), emoji-grid share, local stats/streak. **Public leaderboard** (🏆 Top, signed-in results → `wordle_results`, `record_wordle`/`wordle_leaderboard`). Home tile "🟩 Wuertspill". Word lists are editable arrays at the top of the file (LB list is conservative — expand it). |
| **Reversi** | `reversi.html` | 1v1 Othello, realtime (`rev:<room>`), legal-move hints + pass handling. **`?ai=1`** = vs computer (alpha-beta minimax, positional weights + mobility, depth-8 endgame). Records to leaderboard. |
| **Dots & Boxes** | `dots.html` | 1v1, realtime (`dab:<room>`), 4×4 boxes; complete a box → go again. **`?ai=1`** = vs computer (greedy chain-aware heuristic). Records to leaderboard. |
| **Tic-Tac-Toe** | `tictactoe.html` | 1v1, realtime (`ttt:<room>`). **`?ai=1`** = vs computer (perfect minimax). Records to leaderboard. |
| **Hotel-Simulator** | `hotel.html`, `scripts/hotel-setup.sql` | **PRIVATE** German hotel-builder (Quinn's project). Email-allowlist gate (`konto@ian.lu` + `quinn@mulheims.lu`) via shared `auth.js`; home tile hidden from others. Cloud saves in `hotel_saves` (owner-only RLS, separate per account) replacing the original localStorage. B1 privacy: not listed/usable without an allowed login, but HTML is still fetchable by direct URL. |
| **Leaderboard** | `leaderboard.html` | Cross-game rankings (All / Connect 4 / Battleship / Colour Dial / Reversi / Dots / Tic-Tac-Toe), public read. Players **self-report their own win/loss** via the shared authed client (`window.__pbAuth.sb`) on match end — only when signed in. `game_results` table + `record_match`/`game_leaderboard`. Linked from the Games hub. SLF excluded (endless). |
| **Theme** | `theme.js` | Floating 🎨 picker (dark/light + accent) on every page; sets CSS vars on `:root`, localStorage. |
| **Shared auth** | `auth.js` | Supabase client + account button + sign-in modal (loads supabase-js from jsDelivr UMD global, **not** esm.sh — that broke in Safari). |

**Multiplayer games** use Supabase **Realtime Broadcast** (channel per room, presence by role/clientId) —
no DB tables, no extra SQL. Players join via room code or friend invite. Name = account username or a prompt.

**`game-common.js` + `game-common.css` (Jul 2026):** shared plumbing for the 1v1 board games
(connect4, tictactoe, reversi, dots, battleship). Provides the sanitised `room`/`role`/`AI`
context, the realtime channel factory (persistSession:false enforced), `joinRoom()` with
refresh-safe state resync (a rejoining client sends `gc-req`; a peer whose game has progressed
answers `gc-state` — the host never pushes a fresh board over a live one) and seat-collision
detection, plus `recordResult` and the AI difficulty picker. Battleship additionally persists
its local view in sessionStorage (the opponent never knows your fleet, so it can't be restored
from the peer). color/draw/slf still run their own host-authoritative protocols but track
`role` in presence and show a "host left" notice to guests.

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
- **Never inline node scripts with single quotes in `bash node -e '…'`** — zsh strips them
  silently (string matches fail without error). Write patch scripts to a temp file with a
  `must()` guard before any `writeFileSync` (pattern: earlier sessions' `patch-*.js`).
- **Headless testing** works well: `python3 -m http.server 8123` + Chrome
  `--headless --disable-gpu --virtual-time-budget=6000 --dump-dom/--screenshot`
  (WebGL needs `--enable-unsafe-swiftshader`, budgets ≤9000ms). Game-AI changes were validated
  with a Node harness (ctx Proxy + rAF pump + seeded RNG) compared old-vs-new via `git stash`.

## 7. Status & open items (as of 5 Jul 2026)

**Wave 3 (Jul 2026) — DONE & LIVE** (commits up to "Site features: countdown hero, polls, …"):
- **Security audit closed out**: `security-hardening-v1.sql` run ✓, `notify` Edge Function
  redeployed fail-closed ✓ (verified: anon `kart_sessions` select returns `[]`, notify → 401),
  FTP password rotated ✓.
- **Analytics**: GoatCounter on all 19 public pages (site code **`ianm`** →
  https://ianm.goatcounter.com; account owned by Ian). PixelBreak counts each game open as its
  own pageview (`/pixelbreak.html?g=<id>`). Private pages (admin/grades/homework/hotel/factory/
  stats/exams) deliberately have NO counter.
- **SEO**: 31 per-game URLs + polls in `sitemap.xml`; per-game canonical/title/description;
  Wordle titled "Wordle op Lëtzebuergesch" (near-zero keyword competition).
- **PixelBreak games split** from one giant base64 HTML into `pb/*.html` + per-game URLs.
- **Chill Drive rebuilt in 3D** (three.js r160 UMD, 3 endless worlds + 20 levels, traffic/zen
  mode pills, sim constants preserved so old level saves work).
- **Game AI fixes** (all validated with a headless Node harness, old-vs-new): Tank Wars routes
  around walls, Neon Pong aims returns away from the player, Air Hockey strikes along the
  goal line (no more own-goals), Pixel Fighters climbs platforms to reach a camping player.
- **Features wave**: homepage hero + holiday countdown, class polls, private exam countdowns,
  profile avatars (shown in Messenger), PWA install, universal game sounds/haptics,
  LB modes in Word Scramble/Typing, feedback box, real daily Wordle streaks + native share.

**Open items after Wave 3:**
- ✅ **`scripts/features-v1.sql` run** (5 Jul 2026, verified live — see §3). Remaining manual test:
  create a poll, pick an avatar, check the Messenger avatar, add an exam.
- **Countdown date**: Ian asked for "9th June 12:40" which was already past — implemented as
  **9 July 2026 12:40**; confirm with him.
- **Google Search Console**: suggested but not set up. Verify ian.lu (DNS record or HTML file
  in repo root) and submit `https://ian.lu/sitemap.xml` so the 31 game pages get crawled.
- **AdSense**: script + `ads.txt` present on index/about/pixelbreak, **awaiting Google
  approval — do not remove**; after approval add real `<ins>` ad units (PixelBreak hub is the
  highest-session-time spot).
- **Feedback reading UI**: submissions land in the `feedback` table (admin-only read); there's
  no admin.html tab for it yet — read via Supabase Table Editor, or build a third admin tab.

## 7b. Older status (Jun 2026)

**All SQL migrations have been run** by the user: messenger v2–v6, grades-sync, social-games,
social-fix, admin-users, dashboard-private, `wordle-setup`, `rankings-setup`, `homework-setup`.
Web Push is fully live (see §8). Latest cache versions are in §2.

**Wave 2 (games) — DONE.** messenger v6 (reactions/edit/typing/online/mute/search/voice),
**Wordle** (`wordle.html`, +public leaderboard), **Colour Dial AI** (`color.html?ai=1`),
**Connect4/Battleship AI** (`?ai=1`), **cross-game leaderboard** (`leaderboard.html`),
**Molerei** draw-&-guess (`draw.html`), and the remaining **1v1 AI games — Reversi
(`reversi.html`), Dots & Boxes (`dots.html`), Tic-Tac-Toe (`tictactoe.html`)** — all with
`?ai=1` + leaderboard recording, registered in games hub / friends.js (`?v=6`) / leaderboard tabs.

**Private Hotel-Simulator — DONE & LIVE:** `hotel.html` (Quinn's German hotel-builder) gated to
`konto@ian.lu` + `quinn@mulheims.lu`, with Supabase cloud saves (`hotel_saves`, separate per
account). `hotel-setup.sql` run ✓; Quinn's account (`quinn@mulheims.lu`) created ✓.

**Needs real-device playtesting:** Molerei (`draw.html`) and Colour Dial — multiplayer was not
tested with 2+ devices. Watch for stroke lag, scoring, drawer rotation.

**WebUntis homework — PARKED (blocked by the school):** table/page/Edge Function are built
(`homework.html`, `supabase/functions/webuntis-sync`, `scripts/homework-setup.sql` run) but LAML
has **`publicAppAccessAllowed:false`** + IAM SSO (`urn:x-iam-education-lu:auth`), so the mobile-secret
(TOTP) login is rejected server-side ("bad credentials") even with correct creds. Verified: TOTP code
is correct, no clock skew. Revisit if the school enables app access, else make `homework.html`
manual-entry. School API id = `laml` (NOT "Aline Mayrisch"); user `Mulla383`, Schulnummer 6349000.

**Smaller open items:**
- ~~Rotate the FTP password~~ done ✓ Jul 2026.
- ~~PNG apple-touch-icon~~ done ✓ (`apple-touch-icon.png` 180px + `icon-192.png`/`icon-512.png`
  rasterized from favicon.svg for the manifests `site.webmanifest`/`pixelbreak.webmanifest`).
- Per-chat **mute** only affects in-app notifications, not server Web Push (would need a server-side mute table).
- Light mode: a few deeply-custom spots may still look dark — tune as reported.
- **Luxembourgish Wordle word list** in `wordle.html` (`WORDS.lb`) is a conservative starter — expand/verify it.

## 8. Notifications (in-app + Web Push)

Two layers:
1. **In-app / foreground** (no server): `notify.js` `initAmbient()` — loaded via
   `notify-ambient.js` on most pages (index, games hub, every multiplayer game page,
   leaderboard, friends, grades — but NOT pixelbreak/wordle/messenger) — subscribes to
   `messages` INSERTs over Realtime (RLS scopes it to
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
