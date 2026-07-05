# Study Buddy — setup (AI homework tutor)

The `buddy.html` page → Supabase Edge Function `study-buddy` → Claude (Anthropic API).
Three things to do once, then it's live.

## 1. Run the SQL
Paste **`scripts/study-buddy-v1.sql`** into Supabase ▸ SQL Editor ▸ Run.
Creates `ai_usage` (per-user daily counter) + the `ai_usage_bump()` RPC. Idempotent.

## 2. Get an Anthropic API key
- Sign in at **console.anthropic.com** (this is your *API* account — separate from Claude Code).
- **Billing → set a monthly spend limit** (e.g. $20). This is the real safety net; do it first.
- **API keys → Create key**, copy the `sk-ant-...` value.

## 3. Deploy the function + secret
From the repo root (needs the Supabase CLI, `supabase login` done once):
```sh
supabase functions deploy study-buddy --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   --project-ref lvksqmgfwkfbblfsozfk
```
(`--no-verify-jwt` because the function does its own auth: it validates the caller's
Supabase user token via `auth.getUser` and rejects anyone not signed in.)

## How it works / tuning
- **Model:** Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) — cheap + vision (needed for scan mode).
- **Daily cap:** `DAILY_LIMIT = 40` messages per user per day, in `index.ts`. Change + redeploy to adjust.
- **Modes:** ask · flashcards · quiz · language · scan (photo → full worked answer). System
  prompts are the `BASE` + `MODES` constants in `index.ts`.
- **Cost:** ~½ cent per question on Haiku. Budget ~$10–20/mo; the console spend cap can't be exceeded.
- **Prompt caching:** the static `BASE` system block is marked `cache_control: ephemeral`,
  so repeated calls only pay ~10% for that part.

## Phase 2 (not built): schoolbook knowledge base
Uploading whole books doesn't fit in a prompt — the scalable way is RAG with **pgvector**:
chunk + embed the books (and answer keys) into a private table, retrieve the relevant
passages per question. Needs the actual PDFs/scans (esp. the Lösungshefte) and a private,
class-only storage bucket. The "scan a page" mode already covers most day-to-day homework
without it, so start phase 2 with one subject to prove the value.
