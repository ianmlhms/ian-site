/* Deterministic network for the layout audit.
 *
 * Pages like moien.html (Open-Meteo) and skylens.html (live ADS-B) build real
 * layout out of whatever a remote API happens to answer. Measured against the
 * live internet the audit reports a different number every run — moien's hourly
 * strip only overflows when the fetch beats the settle timer, and skylens's
 * hit-target count tracks how many aircraft are in the sky.
 *
 * So every request is answered from one of three places, and never from the
 * live internet unless it is a versioned static asset:
 *
 *   127.0.0.1              the page under test — passed through
 *   ASSET_HOSTS            pinned CDN modules (supabase-js etc.) — passed through
 *   everything else        a recorded fixture, or a refused connection
 *
 * Refusing rather than hanging matters: an unstubbed API must fail fast and the
 * same way every time, so the page settles into one deterministic state.
 */
import fs from "node:fs";
import path from "node:path";

/* Pinned, versioned module CDNs. Their bytes do not change between runs, and
 * blocking them would strip supabase-js out of every page on the site. */
const ASSET_HOSTS = new Set([
  "cdn.jsdelivr.net",
  "esm.sh",
  "unpkg.com",
]);

/** Fixtures key on host + path only: query strings carry timestamps and bboxes. */
export function fixtureName(rawUrl) {
  const url = new URL(rawUrl);
  const slug = `${url.hostname}${url.pathname}`
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return `${slug}.json`;
}

export function loadFixtures(dir) {
  if (!fs.existsSync(dir)) return new Map();
  const entries = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  return new Map(entries.map((name) => [
    name,
    JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")),
  ]));
}

function classify(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return "refuse"; }
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return "pass";
  if (ASSET_HOSTS.has(url.hostname)) return "pass";
  return "stub";
}

/* An empty body still has to be the *right kind* of empty, or the page's own
 * error handling changes the layout instead of the data doing it. */
function emptyBodyFor(resourceType) {
  if (resourceType === "Image") return { mime: "image/gif", body: "R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" };
  if (resourceType === "Script") return { mime: "application/javascript", body: "" };
  if (resourceType === "Stylesheet") return { mime: "text/css", body: "" };
  return null;
}

/* A recorded payload ages against the wall clock. skylens stamps its response
 * with `now` and greys out any aircraft older than 45s, so a fixture recorded
 * this morning renders every plane as stale by lunchtime and the audit's counts
 * drift day to day without anything changing. Re-stamp `now` on the way out so
 * the canned reply is always "just fetched". */
function refreshTimestamp(base64Body, mime) {
  if (!/json/i.test(mime || "")) return base64Body;
  try {
    const payload = JSON.parse(Buffer.from(base64Body, "base64").toString("utf8"));
    if (!payload || typeof payload !== "object" || !("now" in payload)) return base64Body;
    payload.now = typeof payload.now === "number"
      ? Date.now()
      : new Date().toISOString();
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  } catch {
    return base64Body;   // not JSON after all; serve it untouched
  }
}

/**
 * Route one paused request. Returns the CDP command to send.
 * `fixtures` maps fixtureName() -> { status, mime, body } (body base64).
 */
export function routeRequest(params, fixtures) {
  const { requestId, request, resourceType } = params;
  const verdict = classify(request.url);
  if (verdict === "pass") return { method: "Fetch.continueRequest", params: { requestId } };

  const fixture = fixtures.get(fixtureName(request.url));
  if (fixture) {
    fixture.body = refreshTimestamp(fixture.body, fixture.mime);
    return {
      method: "Fetch.fulfillRequest",
      params: {
        requestId,
        responseCode: fixture.status || 200,
        responseHeaders: [
          { name: "content-type", value: fixture.mime || "application/json" },
          { name: "access-control-allow-origin", value: "*" },
        ],
        body: fixture.body,
      },
    };
  }

  /* Images and subresources get a valid empty response so the page lays out a
   * real (if blank) element. Data APIs get a refusal, which is what the page's
   * own catch branch is written for. */
  const empty = emptyBodyFor(resourceType);
  if (empty) {
    return {
      method: "Fetch.fulfillRequest",
      params: {
        requestId,
        responseCode: 200,
        responseHeaders: [{ name: "content-type", value: empty.mime }],
        body: empty.body,
      },
    };
  }
  return {
    method: "Fetch.failRequest",
    params: { requestId, errorReason: "ConnectionRefused" },
  };
}

/* Analytics and ad networks: never recorded, always stubbed. Their responses
 * are unstable by design and an ad iframe's size is not our layout to audit. */
const NOISE_HOSTS = [
  "goatcounter.com", "googlesyndication.com", "google-analytics.com",
  "doubleclick.net", "googletagmanager.com", "adservice.google.com",
];

/** True when a URL is one we would want a recorded fixture for. */
export function wantsFixture(rawUrl, resourceType) {
  if (classify(rawUrl) !== "stub") return false;
  // Only data responses shape layout. Tiles and sprites are fixed-size boxes,
  // and recording them base64 put 1.4MB of map imagery in the repo.
  if (resourceType !== "XHR" && resourceType !== "Fetch") return false;
  const { hostname } = new URL(rawUrl);
  return !NOISE_HOSTS.some((noise) => hostname.endsWith(noise));
}

export function saveFixture(dir, rawUrl, record) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, fixtureName(rawUrl)),
    `${JSON.stringify({ url: rawUrl, ...record }, null, 2)}\n`,
  );
}
