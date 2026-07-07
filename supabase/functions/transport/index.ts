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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!KEY) return json({ configured: false });

  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "board";

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
