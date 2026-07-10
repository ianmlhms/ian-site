// Supabase Edge Function: briefing
// The "Moies-Briefing": one Web Push to Ian every morning with the day's
// weather, his next countdowns and what ShortsFactory did overnight.
// (No bus line — Ian explicitly left transport out of the briefing.)
//
// Triggered by pg_cron + pg_net (see scripts/briefing-v1.sql):
//   cron '0 5 * * *' UTC = 07:00 Luxembourg in summer (06:00 in winter — adjust
//   the cron to '0 6 * * *' after the October DST switch if the hour matters).
//
// Auth: the caller must send  x-briefing-secret: <BRIEFING_SECRET>  (function
// secret). Fails closed when the secret is unset. Deploy:
//   supabase functions deploy briefing --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
//   supabase secrets set BRIEFING_SECRET=... --project-ref lvksqmgfwkfbblfsozfk
// (VAPID_* secrets are project-wide and already set for the notify function.)
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const BRIEFING_SECRET = Deno.env.get("BRIEFING_SECRET") ?? "";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:konto@ian.lu";
const IAN_EMAIL = "konto@ian.lu";
// Niederanven (Ian's home) — for the day's forecast
const LAT = 49.646, LON = 6.256;
const TZ = "Europe/Luxembourg";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// WMO weather code → emoji + short LB label
function wmo(code: number): [string, string] {
  if (code === 0) return ["☀️", "Sonn"];
  if (code <= 2) return ["🌤️", "Deelweis sonneg"];
  if (code === 3) return ["☁️", "Bedeckt"];
  if (code <= 48) return ["🌫️", "Niwwel"];
  if (code <= 57) return ["🌦️", "Nieselreen"];
  if (code <= 67) return ["🌧️", "Reen"];
  if (code <= 77) return ["🌨️", "Schnéi"];
  if (code <= 82) return ["🌧️", "Reeschaueren"];
  if (code <= 86) return ["🌨️", "Schnéischaueren"];
  return ["⛈️", "Gewitter"];
}

async function ianUid(): Promise<string | null> {
  // Small user base — one page is plenty. GoTrue has no lookup-by-email.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
  if (error) { console.error("listUsers", error.message); return null; }
  const u = (data?.users ?? []).find((x) => (x.email ?? "").toLowerCase() === IAN_EMAIL);
  return u?.id ?? null;
}

async function weatherLine(): Promise<string | null> {
  try {
    const u = new URL("https://api.open-meteo.com/v1/forecast");
    u.searchParams.set("latitude", String(LAT));
    u.searchParams.set("longitude", String(LON));
    u.searchParams.set("daily", "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code");
    u.searchParams.set("timezone", TZ);
    u.searchParams.set("forecast_days", "1");
    const d = await (await fetch(u)).json();
    const day = d?.daily;
    if (!day?.temperature_2m_max?.length) return null;
    const [icon, label] = wmo(Number(day.weather_code?.[0] ?? 3));
    const max = Math.round(day.temperature_2m_max[0]);
    const min = Math.round(day.temperature_2m_min[0]);
    const rain = Number(day.precipitation_probability_max?.[0] ?? 0);
    let line = `${icon} ${label}, ${min}°–${max}°`;
    if (rain >= 30) line += ` · ${rain}% Reen`;
    return line;
  } catch (e) { console.error("weather", e?.message); return null; }
}

async function countdownLines(uid: string): Promise<string[]> {
  try {
    const { data } = await admin.from("countdowns")
      .select("title,emoji,at").eq("user_id", uid)
      .gte("at", new Date().toISOString()).order("at").limit(2);
    return (data ?? []).map((c) => {
      const days = Math.ceil((new Date(c.at).getTime() - Date.now()) / 86400000);
      const when = days <= 0 ? "haut" : days === 1 ? "muer" : `an ${days} Deeg`;
      return `${c.emoji || "⏳"} ${c.title} ${when}`;
    });
  } catch (e) { console.error("countdowns", e?.message); return []; }
}

async function shortsLine(): Promise<string | null> {
  try {
    const d = await (await fetch("https://ian.lu/data/factory.json")).json();
    const vids = Array.isArray(d?.videos) ? d.videos : [];
    const dayAgo = Date.now() - 86400000;
    const fresh = vids.filter((v: any) =>
      v?.status === "posted" && new Date(v.created_at).getTime() >= dayAgo);
    if (!fresh.length) return null;
    const first = fresh[0]?.title ? ` («${String(fresh[0].title).slice(0, 40)}»)` : "";
    return `🎬 ${fresh.length} Short${fresh.length > 1 ? "s" : ""} gepost${first}`;
  } catch (e) { console.error("shorts", e?.message); return null; }
}

Deno.serve(async (req) => {
  // Fails closed: with BRIEFING_SECRET unset, nobody can trigger a push.
  if (!BRIEFING_SECRET || req.headers.get("x-briefing-secret") !== BRIEFING_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const uid = await ianUid();
  if (!uid) return json({ error: "user not found" }, 500);

  const [weather, countdowns, shorts] = await Promise.all([
    weatherLine(), countdownLines(uid), shortsLine(),
  ]);
  const lines = [weather, ...countdowns, shorts].filter(Boolean) as string[];
  if (!lines.length) lines.push("Schéinen Dag! 🙂");

  const { data: subs } = await admin.from("push_subscriptions")
    .select("endpoint, subscription").eq("user_id", uid);
  if (!subs?.length) return json({ ok: true, sent: 0, note: "no push subscriptions" });

  const payload = JSON.stringify({
    title: "☀️ Gudde Moien, Ian!",
    body: lines.join("\n"),
    tag: "briefing",
    url: "me.html",
  });
  let sent = 0;
  await Promise.all(subs.map(async (s: any) => {
    try { await webpush.sendNotification(s.subscription, payload); sent++; }
    catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      } else console.error("push failed", e?.statusCode, e?.body ?? e?.message);
    }
  }));
  return json({ ok: true, sent, lines });
});
