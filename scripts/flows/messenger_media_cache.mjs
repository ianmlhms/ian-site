/* Flow — Messenger media egress: signed URLs are reused, media loads lazily.
 *
 * Background: every render used to call createSignedUrl() again -> a new token -> a new URL
 * -> the browser could never reuse its cached copy (628 MB in one hour on 21 Oct 2026).
 *
 * Checked here (Supabase Storage mocked, every sign call and every file fetch is recorded):
 *   - opening the same chat 3 times (+ a reload) signs every file once and always uses the same URL
 *   - off-screen photos / videos / voice messages are neither signed nor requested
 *   - tapping a photo opens the lightbox with that same URL
 *   - new uploads carry a long Cache-Control */
import { ME, ME_NAME, profilesTable, runIfMain } from "./lib.mjs";

const GID = 501, OTHER = 502;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
const uuid = (n) => `0000${String(n).padStart(4, "0")}-aaaa-4bbb-8ccc-${String(n).padStart(12, "0")}`;
const IMAGES = 30;

const messages = [];
for (let n = 1; n <= IMAGES; n++) {
  messages.push({ id: n, group_id: GID, user_id: n % 2 ? "a1" : ME, username: n % 2 ? "Emma" : ME_NAME, content: "", media_url: `${GID}/${uuid(n)}.jpg`, media_type: "image",
    created_at: new Date(Date.UTC(2026, 9, 21, 7, n)).toISOString() });
}
messages.push({ id: 31, group_id: GID, user_id: "a1", username: "Emma", content: "", media_url: `${GID}/${uuid(31)}.mp4`, media_type: "video", created_at: "2026-10-21T08:31:00Z" });
messages.push({ id: 32, group_id: GID, user_id: "a1", username: "Emma", content: "", media_url: `${GID}/${uuid(32)}.webm`, media_type: "audio", created_at: "2026-10-21T08:32:00Z" });

let token, signed, fetched, uploads;
function reset() { token = 0; signed = []; fetched = []; uploads = []; }
reset();

const filePath = (p) => decodeURIComponent(p.replace("/storage/v1/object/sign/chat-media/", "").split("?")[0]);

export const flow = {
  name: "messenger-media-cache",
  backend: {
    rpc: {
      has_pin: () => true,
      is_view_restricted: () => false,
      my_chats: () => [
        { id: GID, display: "Medien", is_dm: false, invite_code: "med501", unread: 0 },
        { id: OTHER, display: "Leer", is_dm: false, invite_code: "emp502", unread: 0 },
      ],
    },
    tables: {
      profiles: profilesTable,
      group_members: () => [{ user_id: ME, username: ME_NAME, joined_at: "2026-10-01T08:00:00Z" }],
      messages: ({ url, method, body }) => {
        if (method === "GET") return url.search.includes(`group_id=eq.${GID}`) ? messages : [];
        return [];
      },
    },
    functions: { "auth-pin": () => ({ hasPin: true, isLegacy: false }) },
    storage: ({ url, method, body, raw }) => {
      const p = url.pathname;
      if (method === "POST" && p === "/storage/v1/object/sign/chat-media") {          // createSignedUrls (batch)
        signed.push(...body.paths);
        return body.paths.map((path) => ({ path, error: null, signedURL: `/object/sign/chat-media/${path}?token=t${++token}` }));
      }
      if (method === "POST" && p.startsWith("/storage/v1/object/sign/chat-media/")) {  // createSignedUrl (single)
        const path = filePath(p); signed.push(path);
        return { signedURL: `/object/sign/chat-media/${path}?token=t${++token}` };
      }
      if (method === "GET" && p.startsWith("/storage/v1/object/sign/chat-media/")) {   // the file itself
        fetched.push(filePath(p) + "?" + url.searchParams.get("token"));
        return { raw: { status: 200, contentType: "image/png", body: PNG, headers: { "cache-control": "max-age=3600" } } };
      }
      if (method === "POST" && p.startsWith("/storage/v1/object/chat-media/")) {       // upload
        uploads.push({ path: filePath(p), bytes: raw ? raw.length : 0 });
        return { Key: "chat-media/" + filePath(p) };
      }
      return {};
    },
  },
  async run(h) {
    const { page } = h;
    reset();
    page.on("console", (msg) => { if (msg.type() === "error") h.failures.push(`console error: ${msg.text()}`); });
    await h.signIn();

    const loadedImgs = () => page.$$eval("#messages img.media[src]", (els) => els.length);
    const srcByPath = () => page.$$eval("#messages img.media[src]", (els) => Object.fromEntries(els.map((e) => [decodeURIComponent(new URL(e.src).pathname.split("/chat-media/")[1]), e.src])));
    const openChat = async (name) => {
      await page.click(`.grp-open:has-text("${name}")`);
      if (name === "Medien") await page.waitForFunction((n) => document.querySelectorAll("#messages .msg").length >= n, IMAGES + 2);
      await h.pause(700);
    };
    const scrollAll = async () => {            // walk the whole chat top -> bottom so everything has been near the viewport once
      const height = await page.$eval("#messages", (b) => b.scrollHeight);
      for (let y = 0; y <= height; y += 500) { await page.$eval("#messages", (b, top) => { b.scrollTop = top; }, y); await h.pause(120); }
      await page.$eval("#messages", (b) => { b.scrollTop = b.scrollHeight; });
      await h.pause(500);
    };

    h.step("open the messenger, then the chat with 30 photos + a video + a voice message");
    await h.goto("/messenger.html");
    await page.waitForSelector(".grp-open");
    await openChat("Medien");

    h.step("lazy loading: only the photos near the viewport were signed and requested");
    const firstView = await loadedImgs();
    h.expect(firstView > 0 && firstView <= 14, `${firstView} of ${IMAGES} photos loaded on open (expected 1..14)`);
    h.expect(signed.length <= 18, `${signed.length} files signed on open (expected <= 18, not ${IMAGES + 2})`);
    h.expect(fetched.length <= 14, `${fetched.length} files fetched on open (expected <= 14)`);
    h.expect(!fetched.some((f) => /\.(mp4|webm)\?/.test(f)), "the video and the voice message are not downloaded (preload=none)");
    h.expect(await page.$eval("#messages img.media:not([src])", (e) => e.classList.contains("pending")).catch(() => false), "off-screen photos keep a placeholder box");
    await h.shot("first-view");

    h.step("scroll to the top: the remaining photos load as they come near");
    await scrollAll();
    h.eq(await loadedImgs(), IMAGES, "all photos loaded after scrolling through the chat");

    h.step("open the same chat 3 times in total: the same URLs, nothing is signed again");
    const urls1 = await srcByPath();
    const signedAfterFirst = signed.length;
    const fetchedAfterFirst = fetched.length;
    for (let i = 0; i < 2; i++) {
      await openChat("Leer");
      await openChat("Medien");
      await scrollAll();
    }
    const urls3 = await srcByPath();
    h.eq(urls3, urls1, "every photo has exactly the same URL on the 3rd open (browser cache can hit)");
    h.eq(signed.length, signedAfterFirst, "no file was signed again on the 2nd/3rd open");
    h.eq(new Set(signed).size, signed.length, "every file was signed exactly once");
    const distinct = new Map();
    for (const f of fetched) { const [path, tok] = f.split("?"); distinct.set(path, (distinct.get(path) || new Set()).add(tok)); }
    h.expect([...distinct.values()].every((t) => t.size === 1), "no file was requested under two different URLs");
    h.expect(fetched.length >= fetchedAfterFirst, "photos are still shown after re-opening");

    h.step("tap a photo: the lightbox opens with the same URL");
    await page.$eval("#messages", (b) => { b.scrollTop = 0; });
    await h.pause(300);
    const firstImg = page.locator("#messages img.media[src]").first();
    const firstSrc = await firstImg.getAttribute("src");
    await firstImg.click();
    await page.waitForSelector("#lightbox.open");
    h.eq(await page.$eval("#lbImg", (i) => i.getAttribute("src")), firstSrc, "lightbox shows the same URL (no extra download)");
    await page.click("#lbX");
    await page.waitForSelector("#lightbox:not(.open)", { state: "attached" });

    h.step("reload: URLs survive in localStorage, so nothing is signed again");
    await h.pause(800);       // let the debounced save run
    const signedBeforeReload = signed.length;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".grp-open");
    await openChat("Medien");
    await scrollAll();
    h.eq(signed.length, signedBeforeReload, "after a reload no file is signed again");
    h.eq(await srcByPath(), urls1, "and the photos keep their URLs across the reload");
    await h.shot("after-reload");
  },
};

runIfMain(import.meta.url, flow);
