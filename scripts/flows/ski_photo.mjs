/* Flow: Ski Alpen photo mode (28 Nov 2026). The 📷 button / P: the game pauses, the HUD is gone, a free orbit camera circles the skier
 * (drag turns, wheel / pinch zooms), looks none / warm / black-and-white, "Foto späicheren" makes a PNG in the page (download, or the share
 * sheet on a touch device) and shows it in a card (long press saves it where nothing else works). Nothing is uploaded: the flow counts
 * outgoing requests while saving. Shots: FLOW_SHOTS_DIR (~/Library/Caches/ski-work/replay/). FLOW_BROWSER=webkit for Safari's engine. */
import fs from "node:fs";
import path from "node:path";
import { runIfMain } from "./lib.mjs";

const PNG_MAGIC = "89504e47";

export const flow = {
  name: "ski-photo",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => { try { localStorage.setItem("pb_ski_weather", "sun"); localStorage.setItem("pb_ski_time", "midday"); } catch (error) { /* ignore */ } });
    const errors = [], requests = [];
    page.on("pageerror", (e) => { if (!/due to access control checks/.test(e.message)) errors.push(e.message); });
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on("request", (r) => { if (r.method() !== "GET") requests.push(`${r.method()} ${r.url()}`); });
    const shotsDir = process.env.FLOW_SHOTS_DIR || "";

    h.step("free ride, the skier on the snow, P opens the photo mode");
    await h.goto("/pb/ski.html?resort=killy&go=1&debug=1&q=medium&res=fixed");
    await page.waitForFunction(() => window.__ski && window.__ski.game.mode === "freeride" && window.__ski.game.phase === "running" && document.documentElement.dataset.skiScreen === "ski", null, { timeout: 120000 });
    const spot = await page.evaluate(() => {
      const k = window.__ski, L = k.pistes.list.filter((p) => (p.diff === "red" || p.diff === "blue") && p.length > 1200);
      const p = L[Math.floor(L.length / 2)], a = p.at(p.length * 0.3, {});
      k.place(a.x, a.z, Math.atan2(a.dz, a.dx));
      return { x: a.x, z: a.z };
    });
    await page.evaluate(({ x, z }) => window.__ski.streamer.ready(x, z, 400), spot);
    await page.evaluate(() => window.__ski.setInput({ steer: 0.4, tuck: 1, brake: 0, push: 1, jump: false }));
    await h.pause(3500);
    await page.keyboard.press("p");
    await page.waitForFunction(() => document.documentElement.dataset.skiPhoto === "1", null, { timeout: 4000 });
    const open = await page.evaluate(() => { const k = window.__ski; return { paused: k.game.paused, hud: getComputedStyle(document.getElementById("hud")).display, touch: getComputedStyle(document.getElementById("touchControls")).display, active: k.photo.active, body: k.skier.root.visible }; });
    h.expect(open.paused && open.active, "the game is paused in the photo mode");
    h.eq([open.hud, open.touch], ["none", "none"], "HUD and touch controls hidden");
    h.expect(open.body, "the skier is drawn (the orbit looks at him)");
    await h.shot("photo-open");

    h.step("orbit: drag turns, wheel zooms, two fingers pinch and lift");
    const p0 = await page.evaluate(() => ({ ...window.__ski.photo.params, cx: window.__ski.camera.position.x, cz: window.__ski.camera.position.z }));
    await page.mouse.move(590, 300); await page.mouse.down(); await page.mouse.move(790, 280, { steps: 8 }); await page.mouse.up();
    await h.pause(300);
    const p1 = await page.evaluate(() => ({ ...window.__ski.photo.params, cx: window.__ski.camera.position.x, cz: window.__ski.camera.position.z }));
    h.expect(Math.abs(p1.yaw - p0.yaw) > 0.5, `dragging turned the view (${(p1.yaw - p0.yaw).toFixed(2)} rad)`);
    h.expect(Math.hypot(p1.cx - p0.cx, p1.cz - p0.cz) > 1, "the camera moved round the skier");
    await page.mouse.move(590, 300); await page.mouse.wheel(0, 400);
    await h.pause(200);
    const p2 = await page.evaluate(() => window.__ski.photo.params);
    h.expect(p2.dist > p1.dist * 1.2, `wheel out: ${p1.dist.toFixed(1)} -> ${p2.dist.toFixed(1)} m`);
    await page.evaluate(() => {
      const s = document.querySelector(".phsurf"), ev = (t, id, x, y) => s.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: "touch" }));
      ev("pointerdown", 11, 500, 400); ev("pointerdown", 12, 700, 400);
      ev("pointermove", 11, 450, 400); ev("pointermove", 12, 750, 400);       // spread the fingers: closer (a pinch together = further away)
      ev("pointerup", 11, 450, 400); ev("pointerup", 12, 750, 400);
    });
    const p3 = await page.evaluate(() => window.__ski.photo.params);
    h.expect(p3.dist < p2.dist * 0.8, `fingers spread: ${p2.dist.toFixed(1)} -> ${p3.dist.toFixed(1)} m`);
    await page.evaluate(() => window.__ski.photo.zoom(0.45));
    await h.pause(300);
    const cam = await page.evaluate(() => { const k = window.__ski, c = k.camera; return c.position.y - k.surface.height(c.position.x, c.position.z); });
    h.expect(cam > 0.3, `the camera stays over the snow (${cam.toFixed(2)} m)`);
    await h.shot("photo-orbit");

    h.step("looks: warm and black-and-white (CSS look on the screen)");
    await page.click('.phlooks [data-v="warm"]');
    h.expect((await page.evaluate(() => document.getElementById("skiCanvas").style.filter)).includes("sepia"), "warm: the canvas has the warm look");
    await h.shot("photo-warm");
    await page.click('.phlooks [data-v="bw"]');
    h.expect((await page.evaluate(() => document.getElementById("skiCanvas").style.filter)).includes("grayscale"), "black and white: the canvas is grey");
    await h.shot("photo-bw");

    h.step("Foto späicheren: a real PNG, a download, a card, nothing uploaded");
    const before = requests.length;
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.click('.phbar [data-a="save"]')]);
    const file = await dl.path();
    const bytes = fs.readFileSync(file);
    h.eq(bytes.subarray(0, 4).toString("hex"), PNG_MAGIC, "the download is a PNG");
    h.expect(/^ski-alpen-\d{8}-\d{6}\.png$/.test(dl.suggestedFilename()), `file name ${dl.suggestedFilename()}`);
    const w = bytes.readUInt32BE(16), hh = bytes.readUInt32BE(20);
    const cv = await page.evaluate(() => [document.getElementById("skiCanvas").width, document.getElementById("skiCanvas").height]);
    h.eq([w, hh], cv, "the picture has the canvas's own size (power mode draws a smaller canvas, so no fixed minimum)");
    h.expect(w >= 300 && hh >= 200 && bytes.length > 15000, `${w}x${hh} px, ${(bytes.length / 1024).toFixed(0)} KB`);
    if (shotsDir) { fs.mkdirSync(shotsDir, { recursive: true }); fs.copyFileSync(file, path.join(shotsDir, "ski-photo.saved-bw.png")); }
    await page.waitForSelector(".phcard img");
    h.expect(await page.evaluate(() => { const i = document.querySelector(".phcard img"); return i.complete && i.naturalWidth > 100; }), "the card shows the picture (long press saves it)");
    h.eq(requests.length, before, "no upload: no POST / PUT while saving");
    await h.shot("photo-card");
    await page.click('.phcard [data-a="x"]');

    h.step("touch device: the share sheet gets the file (navigator.share mocked), the grey look is in the pixels");
    await page.evaluate(() => {
      Object.defineProperty(navigator, "maxTouchPoints", { value: 5, configurable: true });
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q) => (/pointer:\s*coarse/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q));
      navigator.canShare = () => true;
      window.__shared = null;
      navigator.share = async (d) => { window.__shared = d.files.map((f) => ({ name: f.name, type: f.type, size: f.size })); };
    });
    await page.click('.phlooks [data-v="warm"]');
    await page.click('.phbar [data-a="save"]');
    await page.waitForFunction(() => !!window.__shared, null, { timeout: 15000 });
    const shared = await page.evaluate(() => window.__shared);
    h.expect(shared.length === 1 && shared[0].type === "image/png" && shared[0].size > 15000, `shared ${shared[0].name} (${shared[0].size} bytes)`);
    await page.click('.phcard [data-a="x"]');

    h.step("pixel look: black-and-white really is grey");
    const grey = await page.evaluate(async () => {
      const k = window.__ski;
      k.photo.setLook("bw");
      let blobUrl = null;
      const orig = URL.createObjectURL; URL.createObjectURL = (b) => { blobUrl = orig(b); return blobUrl; };
      navigator.canShare = () => false;
      await k.photo.save();
      URL.createObjectURL = orig;
      const img = new Image(); img.src = blobUrl; await img.decode();
      const c = document.createElement("canvas"); c.width = 200; c.height = 120; const g = c.getContext("2d"); g.drawImage(img, 0, 0, 200, 120);
      const d = g.getImageData(0, 0, 200, 120).data; let off = 0;
      for (let i = 0; i < d.length; i += 4) off = Math.max(off, Math.abs(d[i] - d[i + 1]), Math.abs(d[i + 1] - d[i + 2]));
      return off;
    });
    h.expect(grey <= 3, `saved black-and-white picture: largest colour channel difference ${grey}`);
    await page.click('.phcard [data-a="x"]').catch(() => {});

    h.step("Esc closes: the game runs again, the look is gone");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.documentElement.dataset.skiPhoto, null, { timeout: 3000 });
    const back = await page.evaluate(() => ({ paused: window.__ski.game.paused, filter: document.getElementById("skiCanvas").style.filter, hud: getComputedStyle(document.getElementById("hud")).display }));
    h.expect(!back.paused && back.filter === "" && back.hud !== "none", "game resumes, canvas look removed, HUD back");
    await page.click("#hPhoto");
    await page.waitForFunction(() => document.documentElement.dataset.skiPhoto === "1", null, { timeout: 3000 });
    await page.click('.phbar [data-a="x"]');
    h.expect(!(await page.evaluate(() => window.__ski.photo.active)), "the 📷 button opens it and Zou closes it");

    h.eq(errors, [], "zero page errors");
  },
};

runIfMain(import.meta.url, flow);
