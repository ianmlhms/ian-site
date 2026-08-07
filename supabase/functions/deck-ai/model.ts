import { SYSTEM_PROMPT } from "./prompt.ts";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 12000;
type ImageBlock = { media_type: string; data: string };

function balancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let isString = false;
  let isEscaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (isEscaped) { isEscaped = false; continue; }
    if (character === "\\" && isString) { isEscaped = true; continue; }
    if (character === '"') { isString = !isString; continue; }
    if (isString) continue;
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth === 0) return text.slice(start, index + 1);
  }
  return null;
}

function modelPrompt(request: any): string {
  const { images: _images, ...prompt } = request;
  const tasks: Record<string, string> = {
    outline: "Create the complete deck JSON now.",
    slide: "Return exactly one replacement slide JSON now.",
    translate: "Translate the deck and return the complete deck JSON now.",
  };
  return JSON.stringify({ task: tasks[request.action] || tasks.outline, ...prompt });
}

export async function anthropicJson(request: any, apiKey: string): Promise<unknown> {
  if (!apiKey) throw new Error("Anthropic key missing");
  const content = [
    ...(request.images || []).map((image: ImageBlock) => ({ type: "image",
      source: { type: "base64", media_type: image.media_type, data: image.data } })),
    { type: "text", text: modelPrompt(request) },
  ];
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }] }),
  });
  if (!response.ok) {
    console.error("deck-ai anthropic", response.status, (await response.text()).slice(0, 300));
    throw new Error(`Anthropic returned ${response.status}`);
  }
  const data = await response.json();
  const text = (data?.content ?? []).filter((block: any) => block.type === "text")
    .map((block: any) => block.text).join("");
  const objectText = balancedObject(text);
  if (!objectText) throw new Error("The model did not return a JSON object");
  try { return JSON.parse(objectText); }
  catch { throw new Error("The model returned malformed JSON"); }
}
