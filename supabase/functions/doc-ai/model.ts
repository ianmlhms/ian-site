import { balancedObject } from "../_shared/studio.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 12_000;
type ImageBlock = { media_type: string; data: string };

function taskFor(request: any): string {
  if (request.action === "revise") {
    return "Apply the instruction across the complete document and return the complete document JSON now. Preserve block ids and order unless the instruction explicitly requests a structural change.";
  }
  if (request.action === "rewrite" && request.scope === "block") {
    return "Rewrite the target block and return exactly one replacement block JSON now.";
  }
  if (request.action === "rewrite") return "Rewrite and return the complete document JSON now.";
  return "Create and return the complete document JSON now.";
}

function modelPrompt(request: any): string {
  const { images: _images, ...prompt } = request;
  return JSON.stringify({ task: taskFor(request), ...prompt });
}

function imageContent(images: ImageBlock[]): any[] {
  return images.map((image) => ({ type: "image",
    source: { type: "base64", media_type: image.media_type, data: image.data } }));
}

export async function anthropicDocument(request: any, apiKey: string): Promise<unknown> {
  if (!apiKey) throw new Error("Anthropic key missing");
  const content = [...imageContent(request.images || []), { type: "text", text: modelPrompt(request) }];
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }] }),
  });
  if (!response.ok) {
    console.error("doc-ai anthropic", response.status, (await response.text()).slice(0, 300));
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
