const LEAFLET_CSS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_CSS_INTEGRITY = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
const LEAFLET_JS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_JS_INTEGRITY = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";

let leafletPromise = null;

function matchingElement(selector, url) {
  return [...document.querySelectorAll(selector)].find((element) => element.src === url || element.href === url);
}

function loadStylesheet() {
  const existing = matchingElement('link[rel="stylesheet"]', LEAFLET_CSS_URL);
  if (existing?.sheet) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const link = existing || document.createElement("link");
    link.addEventListener("load", resolve, { once: true });
    link.addEventListener("error", () => reject(new Error("Leaflet stylesheet failed to load")), { once: true });
    if (existing) return;

    link.rel = "stylesheet";
    link.href = LEAFLET_CSS_URL;
    link.integrity = LEAFLET_CSS_INTEGRITY;
    link.crossOrigin = "anonymous";
    document.head.append(link);
  });
}

function loadScript() {
  if (window.L) return Promise.resolve(window.L);
  const existing = matchingElement("script[src]", LEAFLET_JS_URL);

  return new Promise((resolve, reject) => {
    const script = existing || document.createElement("script");
    script.addEventListener("load", () => {
      if (window.L) resolve(window.L);
      else reject(new Error("Leaflet loaded without exposing window.L"));
    }, { once: true });
    script.addEventListener("error", () => reject(new Error("Leaflet script failed to load")), { once: true });
    if (existing) return;

    script.src = LEAFLET_JS_URL;
    script.integrity = LEAFLET_JS_INTEGRITY;
    script.crossOrigin = "anonymous";
    document.head.append(script);
  });
}

export function loadLeaflet() {
  if (!leafletPromise) {
    leafletPromise = Promise.all([loadStylesheet(), loadScript()]).then(([, Leaflet]) => Leaflet);
  }
  return leafletPromise;
}
