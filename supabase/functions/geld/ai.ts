/* Model call for categorising TR rows. Same prompt and taxonomy as finance-ai
 * (../_shared/finance_cats.ts); only the model differs. */
import { parseCats, prepareBatch, SYS } from "../_shared/finance_cats.ts";
import type { CatItem } from "../_shared/finance_cats.ts";

export const MODEL = Deno.env.get("GELD_AI_MODEL") ?? "claude-haiku-5-5";
export const BATCH_SIZE = 80;
const MAX_TOKENS = 8000;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export async function categoriseBatch(apiKey: string, items: CatItem[]): Promise<{ id: string; cat: string }[]> {
  const { realIds, payload } = prepareBatch(items, BATCH_SIZE);
  if (!payload.length) return [];
  const response = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: SYS, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: JSON.stringify({ transactions: payload }) }],
    }),
  });
  if (!response.ok) {
    console.error("geld: anthropic", response.status, (await response.text()).slice(0, 300));
    throw new Error(`provider ${response.status}`);
  }
  const data = await response.json();
  const reply = (data?.content ?? [])
    // deno-lint-ignore no-explicit-any
    .filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  return parseCats(reply, realIds);
}
