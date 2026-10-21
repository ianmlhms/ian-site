/* chat-media.js — signed URLs + lazy loading for the private `chat-media` bucket.
 *
 * Why this exists (egress): createSignedUrl() returns a NEW token on every call, so the
 * browser never recognised a photo it had already downloaded and re-fetched it on every
 * render / chat open. Here a URL is signed once per path (batched, de-duplicated), kept in
 * memory + localStorage until shortly before it expires, and media is only requested once
 * its bubble is near the viewport. Same URL => the browser HTTP cache (and the object's
 * long Cache-Control, see UPLOAD_CACHE_SECONDS) does the rest.
 *
 *   const media = createMediaUrls(() => supabaseClient, () => currentUserId);
 *   media.loadInto(imgEl, "116/uuid.jpg");            // lazy, sets img.src when near view
 *   media.loadInto(linkEl, path, { attr: "href" });
 *   await media.signedUrl(path);                       // one URL (cached)
 */
export const BUCKET = "chat-media";
export const URL_TTL_SECONDS = 7 * 24 * 3600;      // signed URL lifetime
export const UPLOAD_CACHE_SECONDS = "31536000";    // Cache-Control max-age for new uploads (paths are unique uuids)
const REFRESH_MARGIN_MS = 5 * 60 * 1000;           // re-sign when < 5 min left
const BATCH_DELAY_MS = 40;                          // coalesce sign requests of one render pass
const STORE_KEY = "cm_urls_v1";
const STORE_MAX = 600;                              // entries kept in localStorage
/* Paths made by the compressing uploader: "<gid>/i_<uuid>.<ext>" (photo) or "<gid>/v_<uuid>.<ext>" (video)
 * sit next to a thumbnail "<gid>/t_<uuid>.jpg". Older files have neither prefix and no thumbnail. */
const THUMBED = /^(\d+)\/[iv]_([0-9a-f-]{36})\.[a-z0-9]+$/;
export const thumbPathFor = (path) => { const m = THUMBED.exec(path || ""); return m ? `${m[1]}/t_${m[2]}.jpg` : null; };
export const newMediaPaths = (gid, uuid, ext, kind, withThumb) =>
  withThumb ? { full: `${gid}/${kind === "video" ? "v" : "i"}_${uuid}.${ext}`, thumb: `${gid}/t_${uuid}.jpg` } : { full: `${gid}/${uuid}.${ext}`, thumb: null };
const NEAR_VIEWPORT = "400px 0px";                  // start loading this far before a bubble is visible

export function createMediaUrls(getClient, getScope = () => "", { now = () => Date.now() } = {}) {
  const mem = new Map();        // path -> { url, exp }  (exp = ms epoch; Infinity for local blob: URLs)
  const inflight = new Map();   // path -> Promise<string|null>
  let pending = null;           // { paths:Set, waiters:Map<path,[resolve]>, timer }
  let loadedScope = null;
  let saveTimer = null;

  /* ---- persistence (best effort: private mode / quota / blocked storage must not break anything) ---- */
  function readStore(scope) {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (raw && raw.scope === scope && raw.items && typeof raw.items === "object") return raw.items;
    } catch { /* ignore */ }
    return {};
  }
  function hydrate() {
    const scope = String(getScope() || "");
    if (loadedScope === scope) return;
    // account switched (shared school iPad): forget the other account's URLs
    if (loadedScope !== null) { for (const [p, v] of mem) if (v.exp !== Infinity) mem.delete(p); }
    loadedScope = scope;
    const t = now();
    const items = readStore(scope);
    for (const [path, v] of Object.entries(items)) {
      if (Array.isArray(v) && typeof v[0] === "string" && v[1] - REFRESH_MARGIN_MS > t && !mem.has(path)) mem.set(path, { url: v[0], exp: v[1] });
    }
  }
  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        const t = now();
        const live = [...mem].filter(([, v]) => v.exp !== Infinity && v.exp - REFRESH_MARGIN_MS > t)
          .sort((a, b) => b[1].exp - a[1].exp).slice(0, STORE_MAX);
        const items = {};
        for (const [p, v] of live) items[p] = [v.url, v.exp];
        localStorage.setItem(STORE_KEY, JSON.stringify({ scope: loadedScope || "", items }));
      } catch { /* quota / private mode */ }
    }, 500);
  }

  const fresh = (e) => e && e.exp - REFRESH_MARGIN_MS > now();
  const remember = (path, url) => { mem.set(path, { url, exp: now() + URL_TTL_SECONDS * 1000 }); scheduleSave(); };

  /* ---- signing ---- */
  async function flush(batch) {
    const paths = [...batch.paths];
    const settle = (path, url) => { for (const r of batch.waiters.get(path) || []) r(url); };
    let signed = null;
    try {
      const sb = getClient();
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(paths, URL_TTL_SECONDS);
      if (!error && Array.isArray(data)) signed = data;
    } catch { /* fall through to single requests */ }
    if (signed) {
      const byPath = new Map(signed.map((d) => [d.path, d]));
      for (const path of paths) {
        const d = byPath.get(path);
        if (d && d.signedUrl && !d.error) { remember(path, d.signedUrl); settle(path, d.signedUrl); }
        else settle(path, null);
      }
      return;
    }
    // batch endpoint failed: sign one by one so a single bad path can't hide the rest
    await Promise.all(paths.map(async (path) => {
      try {
        const { data, error } = await getClient().storage.from(BUCKET).createSignedUrl(path, URL_TTL_SECONDS);
        if (error || !data) return settle(path, null);
        remember(path, data.signedUrl); settle(path, data.signedUrl);
      } catch { settle(path, null); }
    }));
  }

  function signedUrl(path) {
    if (!path) return Promise.resolve(null);
    hydrate();
    const hit = mem.get(path);
    if (fresh(hit)) return Promise.resolve(hit.url);
    if (inflight.has(path)) return inflight.get(path);
    if (!pending) {
      const batch = { paths: new Set(), waiters: new Map(), timer: null };
      batch.timer = setTimeout(() => { if (pending === batch) pending = null; flush(batch); }, BATCH_DELAY_MS);
      pending = batch;
    }
    const batch = pending;
    batch.paths.add(path);
    const p = new Promise((resolve) => {
      const list = batch.waiters.get(path) || [];
      list.push(resolve); batch.waiters.set(path, list);
    }).finally(() => inflight.delete(path));
    inflight.set(path, p);
    return p;
  }

  /* Several paths at once (one REST call for everything not cached yet). */
  function signedUrls(paths) {
    return Promise.all(paths.map((p) => signedUrl(p)));
  }

  /* Use a local blob: URL for a path we just uploaded ourselves (the sender never re-downloads it). */
  function seed(path, url) { mem.set(path, { url, exp: Infinity }); }
  function forget(path) { mem.delete(path); scheduleSave(); }

  /* ---- lazy loading ---- */
  let io = null;
  const jobs = new WeakMap();
  function observer() {
    if (io || typeof IntersectionObserver === "undefined") return io;
    io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        const list = jobs.get(en.target) || [];
        jobs.delete(en.target);
        if (en.target.isConnected) for (const job of list) job();
      }
    }, { rootMargin: NEAR_VIEWPORT });
    return io;
  }
  /* Run `job` once `el` is near the viewport (immediately without IntersectionObserver). */
  function whenVisible(el, job) {
    const o = observer();
    if (!o) { job(); return; }
    const list = jobs.get(el);
    if (list) { list.push(job); return; }       // several loads on one element (video: poster + file)
    jobs.set(el, [job]);
    o.observe(el);
  }

  /* Sign `path` when `el` is near the viewport, then put the URL into el[attr]. A failed load
   * (expired / evicted URL) is retried once with a freshly signed URL. */
  function loadInto(el, path, { attr = "src", lazy = true, onUrl } = {}) {
    const apply = (url) => { if (attr === "href") el.href = url; else if (attr === "poster") el.poster = url; else el.src = url; if (onUrl) onUrl(url); };
    const run = () => {
      signedUrl(path).then((url) => {
        if (!url) return;
        if (attr === "src") {
          let retried = false;
          el.addEventListener("error", () => {
            if (retried) return; retried = true;
            forget(path);
            signedUrl(path).then((u2) => { if (u2) apply(u2); });
          });
        }
        apply(url);
      });
    };
    if (lazy) whenVisible(el, run); else run();
  }

  return { signedUrl, signedUrls, seed, forget, loadInto, whenVisible };
}
