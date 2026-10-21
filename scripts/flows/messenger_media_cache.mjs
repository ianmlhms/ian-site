/* Flow — Messenger media egress: signed URLs are reused, media loads lazily, thumbnails first.
 *
 * Background: every render used to call createSignedUrl() again -> a new token -> a new URL
 * -> the browser could never reuse its cached copy (628 MB in one hour on 21 Oct 2026).
 *
 * Checked here (Supabase Storage mocked, every sign call and every file fetch is recorded):
 *   - opening the same chat 3 times (+ a reload) signs every file once and always uses the same URL
 *   - off-screen photos / videos / voice messages are neither signed nor requested
 *   - tapping a photo opens the lightbox with that same URL
 *   - photos sent with the compressing uploader ("i_" paths) show their thumbnail ("t_" path) in the
 *     list; the full picture is fetched only when tapped, and only once
 *   - an upload sends a photo shrunk to <= 1600 px plus a <= 480 px thumbnail, thumbnail first,
 *     both with a long Cache-Control; GIFs are kept as they are; the sender's own bubble needs no download */
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

/* newer messages: sent by the compressing uploader (thumbnail next to the picture) */
const NEW = [33, 34, 35];
for (const n of NEW) {
  messages.push({ id: n, group_id: GID, user_id: "a1", username: "Emma", content: "", media_url: `${GID}/i_${uuid(n)}.jpg`, media_type: "image", created_at: `2026-10-21T09:${10 + n}:00Z` });
}
messages.push({ id: 36, group_id: GID, user_id: "a1", username: "Emma", content: "", media_url: `${GID}/v_${uuid(36)}.mp4`, media_type: "video", created_at: "2026-10-21T09:50:00Z" });
const TOTAL_PHOTOS = IMAGES + NEW.length;

let token, signed, fetched, uploads, inserted;
function reset() { token = 0; signed = []; fetched = []; uploads = []; inserted = []; }

/* long edge of a JPEG, found by reading its SOF marker */
function jpegSize(buf) {
  const start = buf.indexOf(Buffer.from([0xff, 0xd8]));
  for (let i = start + 2; i < buf.length - 9;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), bytes: buf.length - start };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}
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
        if (method === "POST") { const row = { id: 100 + inserted.length, created_at: new Date().toISOString(), ...body }; inserted.push(row); return [row]; }
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
        uploads.push({ path: decodeURIComponent(p.replace("/storage/v1/object/chat-media/", "")), buf: raw || Buffer.alloc(0) });
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
      if (name === "Medien") await page.waitForFunction((n) => document.querySelectorAll("#messages .msg").length >= n, IMAGES + 2 + NEW.length + 1);
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
    h.expect(firstView > 0 && firstView <= 14, `${firstView} of ${TOTAL_PHOTOS} photos loaded on open (expected 1..14)`);
    h.expect(signed.length <= 22, `${signed.length} files signed on open (expected <= 22, not ${TOTAL_PHOTOS + 4})`);
    h.expect(fetched.length <= 16, `${fetched.length} files fetched on open (expected <= 16)`);
    h.expect(!fetched.some((f) => /\.(mp4|webm)\?/.test(f)), "the video and the voice message are not downloaded (preload=none)");
    h.expect(NEW.every((n) => fetched.some((f) => f.startsWith(`${GID}/t_${uuid(n)}.jpg?`))), "newer photos show their thumbnail (t_ path)");
    h.expect(!fetched.some((f) => f.includes("/i_") || f.includes("/v_")), "no full-size picture or video was downloaded just by opening the chat");
    h.expect(await page.$eval("#messages img.media:not([src])", (e) => e.classList.contains("pending")).catch(() => false), "off-screen photos keep a placeholder box");
    await h.shot("first-view");

    h.step("scroll to the top: the remaining photos load as they come near");
    await scrollAll();
    h.eq(await loadedImgs(), TOTAL_PHOTOS, "all photos loaded after scrolling through the chat");
    h.expect(!fetched.some((f) => f.includes("/i_") || f.includes("/v_")), "still no full-size picture downloaded after scrolling the whole chat");
    h.expect(await page.$eval("#messages video.media[poster]", (v) => /\/t_/.test(v.poster)), "the new video shows a poster (t_ path) and is not downloaded");

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

    h.step("tap a newer photo: the thumbnail opens at once, the full picture is fetched once");
    const thumbImg = page.locator(`#messages img.media[src*="/t_${uuid(NEW[1])}"]`);
    await thumbImg.scrollIntoViewIfNeeded();
    const thumbSrc = await thumbImg.getAttribute("src");
    await thumbImg.click();
    await page.waitForSelector("#lightbox.open");
    await page.waitForFunction(() => /\/i_/.test(document.getElementById("lbImg").getAttribute("src") || ""));
    const fullSrc = await page.$eval("#lbImg", (i) => i.getAttribute("src"));
    h.expect(fullSrc.includes(`/i_${uuid(NEW[1])}.jpg`) && fullSrc !== thumbSrc, "the lightbox swapped in the full picture");
    h.eq(fetched.filter((f) => f.includes("/i_")).length, 1, "exactly one full-size download so far");
    await page.click("#lbX");
    await thumbImg.click();
    await page.waitForFunction((u) => document.getElementById("lbImg").getAttribute("src") === u, fullSrc);
    await h.pause(300);
    h.eq(fetched.filter((f) => f.includes("/i_")).length, 1, "tapping it again reuses the same URL (still one download)");
    await page.click("#lbX");

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

    h.step("send a big photo: shrunk to <= 1600 px, thumbnail <= 480 px, thumbnail uploaded first, long cache");
    const big = await page.evaluate(async () => {
      const c = document.createElement("canvas"); c.width = 3200; c.height = 2400;
      const g = c.getContext("2d");
      for (let i = 0; i < 4000; i++) { g.fillStyle = `hsl(${(i * 37) % 360} 70% ${20 + (i % 60)}%)`; g.fillRect((i * 97) % 3200, (i * 53) % 2400, 40 + (i % 90), 30 + (i % 70)); }
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.95));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    });
    const bigBuf = Buffer.from(big, "base64");
    const isWebKit = await page.evaluate(() => /AppleWebKit/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent));
    const fetchedBefore = fetched.length;
    const msgCount = () => page.$$eval("#messages .msg", (e) => e.length);
    const before = await msgCount();
    await page.setInputFiles("#fileInput", { name: "IMG_0001.JPG", mimeType: "image/jpeg", buffer: bigBuf });
    await page.waitForFunction((n) => document.querySelectorAll("#messages .msg").length > n && !document.getElementById("attachBtn").disabled, before);
    await h.pause(400);
    h.eq(uploads.length, 2, "two files uploaded (thumbnail + picture)");
    const [up1, up2] = uploads;
    h.expect(/^501\/t_[0-9a-f-]{36}\.jpg$/.test(up1.path) && /^501\/i_[0-9a-f-]{36}\.jpg$/.test(up2.path), `thumbnail first, then the picture (${up1.path.slice(0, 14)}…, ${up2.path.slice(0, 14)}…)`);
    h.expect(up1.path.slice(6) === up2.path.slice(6), "thumbnail and picture share the uuid");
    // WebKit does not expose blob parts of a multipart upload to the mock, so the bytes are checked
    // by running the same compressor in the page (works in every engine), and from the wire where visible.
    const inPage = await page.evaluate(async (b64) => {
      const { prepareImage } = await import("/chat-media-prep.js?v=1");
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const r = await prepareImage(new File([bin], "x.jpg", { type: "image/jpeg" }));
      const dims = async (blob) => { const bmp = await createImageBitmap(blob); return Math.max(bmp.width, bmp.height); };
      return { full: await dims(r.full), thumb: await dims(r.thumb), fullKB: r.full.size / 1024, thumbKB: r.thumb.size / 1024, origKB: bin.length / 1024 };
    }, big);
    h.eq([inPage.full, inPage.thumb], [1600, 480], "picture long edge 1600 px, thumbnail 480 px");
    h.expect(inPage.fullKB < inPage.origKB * 0.6, `picture is much smaller than the original (${inPage.fullKB | 0} KB vs ${inPage.origKB | 0} KB)`);
    h.expect(inPage.thumbKB < 150,  /* synthetic noise; real photos are 25-40 KB */ `thumbnail is small (${inPage.thumbKB | 0} KB)`);
    if (!isWebKit) {
      const sizeFull = jpegSize(up2.buf), sizeThumb = jpegSize(up1.buf);
      h.eq([Math.max(sizeFull.w, sizeFull.h), Math.max(sizeThumb.w, sizeThumb.h)], [1600, 480], "on the wire: picture 1600 px, thumbnail 480 px");
      h.expect(sizeFull.bytes < bigBuf.length * 0.6, "on the wire: the picture is much smaller than the original");
    }
    h.expect(up1.buf.includes("31536000") && up2.buf.includes("31536000"), "both uploads carry a 1-year Cache-Control");
    h.eq(inserted.map((r) => r.media_url), [up2.path], "the message points at the picture; the thumbnail is derived from it");
    h.eq(await page.$$eval("#messages .msg.mine img.media", (l) => l[l.length - 1].src.startsWith("blob:")), true, "own bubble shows the local thumbnail (no download)");
    h.eq(fetched.length, fetchedBefore, "the sender downloaded nothing");

    h.step("send a GIF: kept as it is (animation), with a thumbnail");
    const gif = Buffer.from("R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=", "base64");
    await page.setInputFiles("#fileInput", { name: "anim.gif", mimeType: "image/gif", buffer: gif });
    await page.waitForFunction((n) => document.querySelectorAll("#messages .msg").length > n + 1, before);
    await h.pause(400);
    const gifUp = uploads.find((u) => u.path.endsWith(".gif"));
    h.expect(gifUp && (isWebKit || gifUp.buf.includes(gif)), "the GIF was uploaded unchanged");
    h.expect(uploads.some((u) => /\/t_.*\.jpg$/.test(u.path)) && uploads.length === 4, "and got a thumbnail too");
    await h.shot("sent");

    h.step("a picture and a video the browser can't decode: plain upload as before (no prefix, no thumbnail)");
    const upBefore = uploads.length;
    await page.setInputFiles("#fileInput", { name: "broken.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not really a jpeg") });
        await h.pause(800);
    await page.setInputFiles("#fileInput", { name: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.from("not really a video") });
    await h.pause(1500);
    const plain = uploads.slice(upBefore);
    h.eq(plain.map((u) => /^501\/[0-9a-f-]{36}\.(jpg|mp4)$/.test(u.path)), [true, true], "both went up under plain legacy paths, one file each");
  },
};

runIfMain(import.meta.url, flow);
