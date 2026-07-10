// Supabase Edge Function: transport
// Proxies Luxembourg public-transport real-time data (Verkéiersbond / HAFAS ReST)
// for moien.html. The API key must stay server-side and the HAFAS host has no CORS,
// so the browser calls this function instead.
//
// Request a free key by email (opendata-api@atp.etat.lu), then:
//   supabase functions deploy transport --no-verify-jwt --project-ref lvksqmgfwkfbblfsozfk
//   supabase secrets set TRANSPORT_API_KEY=... --project-ref lvksqmgfwkfbblfsozfk
//
// Actions (query string):
//   ?action=nearby&lat=49.61&lon=6.13  → stops near a coordinate → [{id,name,dist}]
//   ?action=board&id=<stopId>[&date=YYYY-MM-DD&time=HH:MM]
//                                      → departures (buses & trains) from now or a later moment
//                                      → [{line,num,cat,dir,platform,time,planned,delay,cancelled}]
// (The full stop-by-stop itinerary for a departure is fetched client-side from
//  transitous/MOTIS — this HAFAS key cannot do journeyDetail.)
// This Luxembourg HAFAS key only exposes departureBoard + location.nearbystops
// (there is NO free-text location.name search), so stop selection is by geolocation.
// If TRANSPORT_API_KEY is unset it returns {configured:false} so the page shows a friendly notice.

const KEY = Deno.env.get("TRANSPORT_API_KEY") ?? "";
const HOST = "https://cdt.hafas.de/opendata/apiserver";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

const hhmm = (t?: string) => (t ? t.slice(0, 5) : "");
function delayMin(planned?: string, rt?: string): number {
  if (!planned || !rt) return 0;
  const p = planned.split(":").map(Number), r = rt.split(":").map(Number);
  if (p.length < 2 || r.length < 2) return 0;
  let d = (r[0] * 60 + r[1]) - (p[0] * 60 + p[1]);
  if (d < -720) d += 1440;  // crossed midnight
  return d;
}

async function hafas(path: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ accessId: KEY, format: "json", ...params });
  const r = await fetch(`${HOST}/${path}?${qs}`);
  if (!r.ok) throw new Error("hafas " + r.status);
  return r.json();
}

/* ---- lock-screen widget (?action=widget) --------------------------------
 * Feeds the Scriptable widget on Ian's iPhone (scripts/widget-scriptable.js).
 * From `from` (06:50) until the bus is gone (or `until`, 09:30): the live
 * departure of `line` (D02) at `stop` (Niederanven Laach). Rest of the day:
 * date + weather. Works without TRANSPORT_API_KEY (then always day mode). */
const TZ = "Europe/Luxembourg";
const LB_DAYS = ["Sonndeg", "Méindeg", "Dënschdeg", "Mëttwoch", "Donneschdeg", "Freideg", "Samschdeg"];
const LB_MONTHS = ["Januar", "Februar", "Mäerz", "Abrëll", "Mee", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const normLine = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
function luxNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, weekday: "short", day: "numeric", month: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    dateLb: `${LB_DAYS[wd] ?? ""}, ${Number(get("day"))}. ${LB_MONTHS[Number(get("month")) - 1] ?? ""}`,
  };
}
const hmToMin = (s: string) => { const [h, m] = s.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
// WMO weather code → emoji
function wmoIcon(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 67) return "🌧️";
  if (code <= 77) return "🌨️";
  if (code <= 86) return "🌧️";
  return "⛈️";
}
async function widgetWeather() {
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.searchParams.set("latitude", "49.646");   // Niederanven
  u.searchParams.set("longitude", "6.256");
  u.searchParams.set("current", "temperature_2m,weather_code");
  u.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
  u.searchParams.set("timezone", TZ);
  u.searchParams.set("forecast_days", "1");
  const d = await (await fetch(u)).json();
  return {
    temp: Math.round(d?.current?.temperature_2m ?? 0),
    icon: wmoIcon(Number(d?.current?.weather_code ?? 3)),
    min: Math.round(d?.daily?.temperature_2m_min?.[0] ?? 0),
    max: Math.round(d?.daily?.temperature_2m_max?.[0] ?? 0),
  };
}
async function widget(url: URL) {
  const stop = url.searchParams.get("stop") ?? "200504002";  // Niederanven Laach
  const line = normLine(url.searchParams.get("line") ?? "D02");
  const from = hmToMin(url.searchParams.get("from") ?? "06:50");
  const until = hmToMin(url.searchParams.get("until") ?? "09:30");
  const now = luxNow();

  if (KEY && now.minutes >= from && now.minutes < until) {
    try {
      const data = await hafas("departureBoard", { id: stop, maxJourneys: "20", duration: "120", lang: "de" });
      for (const d of data?.Departure ?? []) {
        const prod = Array.isArray(d?.Product) ? d.Product[0] : d?.Product;
        const cands = [prod?.line, prod?.num, prod?.displayNumber, d?.name];
        if (!cands.some((c) => normLine(c) === line)) continue;
        const planned = hhmm(d.time), rt = hhmm(d.rtTime);
        return json({
          mode: "bus", line: prod?.line ?? d.name ?? line,
          time: rt || planned, planned, delay: delayMin(planned, rt),
          cancelled: !!d.cancelled,
        });
      }
      // no run of that line on the board (departed / holidays / weekend) → day mode
    } catch (e) { console.error("widget board", (e as Error)?.message); }
  }
  try {
    const w = await widgetWeather();
    return json({ mode: "day", date: now.dateLb, ...w });
  } catch (e) {
    console.error("widget weather", (e as Error)?.message);
    return json({ mode: "day", date: now.dateLb, temp: null, icon: "🌡️", min: null, max: null });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "board";
  if (action === "widget") return widget(url);   // works even without the HAFAS key
  if (!KEY) return json({ configured: false });

  try {
    if (action === "nearby") {
      const lat = url.searchParams.get("lat") ?? "";
      const lon = url.searchParams.get("lon") ?? "";
      if (!/^-?\d+\.?\d*$/.test(lat) || !/^-?\d+\.?\d*$/.test(lon)) return json({ configured: true, stops: [] });
      const data = await hafas("location.nearbystops", {
        originCoordLat: lat, originCoordLong: lon, maxNo: "12", r: "3000", lang: "de",
      });
      const raw = data?.stopLocationOrCoordLocation ?? [];
      const stops = raw
        .map((x: any) => x?.StopLocation ?? x?.stopLocation ?? x)
        .filter((s: any) => (s?.extId || s?.id) && s?.name)
        .map((s: any) => ({ id: s.extId ?? s.id, name: s.name, dist: s.dist ?? null }));
      return json({ configured: true, stops });
    }

    // default: departure board
    const id = url.searchParams.get("id") ?? "";
    if (!id) return json({ configured: true, departures: [] });
    const params: Record<string, string> = { id, maxJourneys: "12", duration: "90", lang: "de" };
    // optional future moment (buses & trains); empty = live "now"
    const date = url.searchParams.get("date") ?? "";
    const time = url.searchParams.get("time") ?? "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) params.date = date;
    if (/^\d{2}:\d{2}$/.test(time)) params.time = time;
    const data = await hafas("departureBoard", params);
    const departures = (data?.Departure ?? []).map((d: any) => {
      const planned = hhmm(d.time), rt = hhmm(d.rtTime);
      const prod = Array.isArray(d?.Product) ? d.Product[0] : d?.Product;
      return {
        line: prod?.line ?? d.name ?? "?",
        num: prod?.num ?? prod?.displayNumber ?? "",
        cat: prod?.catOutL ?? "",
        dir: d.direction ?? d.directionFlag ?? "",
        platform: d?.rtPlatform?.text ?? d?.platform?.text ?? d.rtTrack ?? d.track ?? "",
        time: rt || planned,
        planned,
        delay: delayMin(planned, rt),
        cancelled: !!d.cancelled,
      };
    });
    return json({ configured: true, stop: data?.stopLocationOrCoordLocation?.[0]?.name, departures });
  } catch (e: any) {
    console.error("transport", e?.message);
    return json({ configured: true, error: "fetch failed" }, 502);
  }
});
