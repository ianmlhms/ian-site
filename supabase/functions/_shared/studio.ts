import { createClient } from "npm:@supabase/supabase-js@2";

const HEARTBEAT_MAX_AGE_MS = 90_000;
const STUCK_JOB_AGE_MS = 5 * 60 * 1000;
const JOB_ID = /^[0-9a-f-]{36}$/i;
const OWNER_EMAILS = new Set(["konto@ian.lu"]);
const LANGS = new Set(["lb", "de", "en", "fr"]);
const SCHOOL_YEARS = new Set(["7e", "6e", "5e", "4e"]);
const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

export const CORS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "content-type": "application/json" },
});

export type StudioUser = { id: string; email: string };
export type VoiceSelection = { schoolYear?: unknown; lang?: unknown; authenticity?: unknown };
export type OwnerResult = { user: StudioUser | null; response: Response | null };
export type JobNormaliser = (request: any, result: any) => unknown | null;
export type JobOptions = {
  stopped: string;
  invalid: string;
  logPrefix: string;
  response?: (row: any, result: unknown | null) => unknown;
};

const VOICE_LEVELS = Object.freeze({
  "7e": { lb: "mother tongue", de: "B1", en: "A2–B1", fr: "A2–B1" },
  "6e": { lb: "mother tongue", de: "B1+/B2", en: "B1", fr: "B1" },
  "5e": { lb: "mother tongue", de: "C1", en: "B2", fr: "B2" },
  "4e": { lb: "mother tongue", de: "C1", en: "B2+", fr: "B2+" },
});

/** Extract the first complete JSON object while ignoring braces inside strings. */
export function balancedObject(text: string): string | null {
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

export function cleanString(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function userFromRequest(req: Request): Promise<StudioUser | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: (data.user.email ?? "").toLowerCase() };
}

/** Apply the identical anonymous and non-owner gates in every studio function. */
export async function ownerFromRequest(req: Request): Promise<OwnerResult> {
  const user = await userFromRequest(req);
  if (!user) return { user: null, response: json({ error: "sign in first" }, 401) };
  if (!OWNER_EMAILS.has(user.email)) {
    return { user: null, response: json({ error: "This tool is private." }, 403) };
  }
  return { user, response: null };
}

/** Resolve trusted selections into model instructions; clients never supply prompt text. */
export function resolveVoice(selection: VoiceSelection): string {
  const schoolYear = SCHOOL_YEARS.has(selection?.schoolYear as string)
    ? selection.schoolYear as keyof typeof VOICE_LEVELS : "4e";
  const lang = LANGS.has(selection?.lang as string)
    ? selection.lang as "lb" | "de" | "en" | "fr" : "de";
  const raw = Number(selection?.authenticity);
  const authenticity = Number.isFinite(raw) ? Math.min(100, Math.max(0, Math.round(raw))) : 75;
  const level = VOICE_LEVELS[schoolYear][lang];
  const strength = languageStrength(lang);
  const tone = authenticityTone(authenticity);
  return `Write ${lang} at the normal ${schoolYear} level (${level}). ${strength} Authenticity ${authenticity}/100. ${tone} Never output raw markdown or the banned AI templates.`;
}

function languageStrength(lang: string): string {
  if (lang === "de") return "German is Ian's strongest written language.";
  if (lang === "fr") return "French is Ian's weakest language; never write above the stated level.";
  if (lang === "lb") return "Luxembourgish is native and natural for notes and slide bullets.";
  return "";
}

function authenticityTone(authenticity: number): string {
  const authentic = "Telegraphic, warm and sincere; z.b. in German, a French-style space before :, an occasional comma splice, and an occasional Luxembourgish word in German are natural. Never manufacture errors.";
  if (authenticity >= 85) return `Use Ian's most authentic, slightly informal voice. ${authentic}`;
  if (authenticity >= 60) return `Write mostly like Ian, with light cleanup. ${authentic}`;
  return "Use cleaner, more formal phrasing, while staying recognisably Ian and strictly within the stated level; never manufacture errors or become uniformly elevated.";
}

export async function miniIsAlive(logPrefix = "studio"): Promise<boolean> {
  try {
    const { data, error } = await admin.from("service_heartbeats").select("beat_at")
      .eq("service", "deckworker").maybeSingle();
    if (error || !data?.beat_at) return false;
    const beatAt = Date.parse(data.beat_at);
    return Number.isFinite(beatAt) && beatAt > Date.now() - HEARTBEAT_MAX_AGE_MS;
  } catch (error) {
    console.error(`${logPrefix} heartbeat`, (error as Error)?.message);
    return false;
  }
}

export async function queueMiniJob(request: any, userId: string): Promise<string> {
  if (!request?.kind) throw new Error("The job kind is missing");
  const { data, error } = await admin.from("deck_jobs")
    .insert({ user_id: userId, status: "queued", request }).select("id").single();
  if (error || !data?.id) throw new Error(error?.message || "The job could not be queued");
  return data.id;
}

export async function readMiniJob(
  payload: any,
  userId: string,
  normalise: JobNormaliser,
  options: JobOptions,
): Promise<Response> {
  const jobId = cleanString(payload?.jobId, 80);
  if (!JOB_ID.test(jobId)) return json({ error: "Invalid job id." }, 400);
  await reclaimJob(jobId, userId, options);
  const { data, error } = await admin.from("deck_jobs").select("status,result,error,request")
    .eq("id", jobId).eq("user_id", userId).maybeSingle();
  if (error) return json({ error: "The job could not be read." }, 502);
  if (!data) return json({ error: "Job not found." }, 404);
  const result = data.status === "done" ? normalise(data.request, data.result) : null;
  if (data.status === "done" && !result) return invalidateJob(jobId, userId, options.invalid);
  const body = options.response ? options.response(data, result)
    : { status: data.status, result, error: data.error || null };
  return json(body);
}

async function reclaimJob(jobId: string, userId: string, options: JobOptions): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_JOB_AGE_MS).toISOString();
  const { error } = await admin.from("deck_jobs")
    .update({ status: "error", error: options.stopped, updated_at: new Date().toISOString() })
    .eq("id", jobId).eq("user_id", userId).eq("status", "running").lt("updated_at", cutoff);
  if (error) console.error(`${options.logPrefix} reclaim`, error.message);
}

async function invalidateJob(jobId: string, userId: string, message: string): Promise<Response> {
  await admin.from("deck_jobs").update({ status: "error", error: message, updated_at: new Date().toISOString() })
    .eq("id", jobId).eq("user_id", userId).eq("status", "done");
  return json({ status: "error", result: null, error: message });
}
