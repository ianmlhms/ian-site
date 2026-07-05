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

## Model routing (per request — in `pickModel()` in `index.ts`)
Model is chosen per message, not by a single global switch:

| Who / when | Model | Why |
|---|---|---|
| **Ian** (`konto@ian.lu` only) — always | **Claude Sonnet 4.6** | owner gets the best; no daily cap. `ian@ian.lu` is a test account = normal user |
| Everyone else, **messages 1–10/day** | **Claude Haiku 4.5** | premium taste, good LB |
| Everyone else, **messages 11+/day** | **Gemini 2.5 Flash-Lite** | best budget LB, ~10× cheaper, native vision |

Keys required as secrets: **`ANTHROPIC_API_KEY`** (Sonnet + Haiku) and **`GEMINI_API_KEY`**.
`OPENAI_API_KEY` is optional — the GPT-5-nano adapter is still in the code but nothing routes
to it (its Luxembourgish tested poorly). To change the tiers/models/emails, edit the constants
at the top of `index.ts` (`FREE_CLAUDE`, `MODEL_*`, `IAN_EMAILS`) and redeploy.
**Set a monthly spend cap in each provider's console** — that is the real safety net.

## How it works / tuning
- **Daily cap:** `DAILY_LIMIT = 40` messages per user per day (Ian exempt), in `index.ts`.
- **Modes:** ask · flashcards · quiz · language · scan (photo → full worked answer). System
  prompts are the `BASE` + `MODES` constants in `index.ts`.
- **Cost:** ~½ cent/question on Haiku, ~10–15× less on GPT-5 nano / Gemini Flash-Lite.
- **Prompt caching:** Anthropic only — the static `BASE` block is marked `cache_control: ephemeral`.

## Phase 2 (not built): schoolbook knowledge base
Uploading whole books doesn't fit in a prompt — the scalable way is RAG with **pgvector**:
chunk + embed the books (and answer keys) into a private table, retrieve the relevant
passages per question. Needs the actual PDFs/scans (esp. the Lösungshefte) and a private,
class-only storage bucket. The "scan a page" mode already covers most day-to-day homework
without it, so start phase 2 with one subject to prove the value.
