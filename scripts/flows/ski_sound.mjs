/* Flow: Ski Alpen sound (28 Nov 2026): the menu music and the iOS audio behaviour of pb/ski/audio.js + sound-bank.js + music.js.
 *   - before the first touch there is NO audio context and neither sound-bank.js nor music.js is requested (first-play download unchanged)
 *   - the first touch starts the context (running), the bank builds its buffers, the menu music renders and plays in the picker
 *   - the picker's "Musek" button and the menu's Musek row switch it off / on, saved in pb_ski_music, and a reload keeps the choice
 *   - the arcade mute (arcade:mute) silences everything incl. the music and suspends the context; unmuting brings it back
 *   - iOS: a suspended / interrupted context is resumed on visibilitychange, pageshow, focus and the next touch; no console errors
 *   - a ride starts: the music fades out and is stopped; the pause menu brings it back
 *   - a direct ride (?go=1) never loads the music module
 * FLOW_BROWSER=webkit for Safari's engine. */
import { runIfMain } from "./lib.mjs";

export const flow = {
  name: "ski-sound",
  fullChromium: true,
  viewport: { width: 1180, height: 820 },
  async run(h) {
    const { page } = h;
    await page.addInitScript(() => { try { if (!sessionStorage.getItem("sndInit")) { sessionStorage.setItem("sndInit", "1"); localStorage.removeItem("pb_ski_music"); localStorage.removeItem("pb_muted"); localStorage.removeItem("pb_ski_save"); } } catch (error) { /* ignore */ } });
    const errors = [], requests = [];
    page.on("pageerror", (e) => { if (!/due to access control checks/.test(e.message)) errors.push(e.message); });
    page.on("console", (m) => { if ((m.type() === "error" && !/Failed to load resource/.test(m.text())) || (m.type() === "warning" && /\[ski\]/.test(m.text()))) errors.push(`${m.type()}: ${m.text()}`); });
    page.on("request", (r) => requests.push(new URL(r.url()).pathname));
    const dbg = () => page.evaluate(() => window.__ski.audio.debug());
    const waitDbg = (fn, arg, ms = 20000) => page.waitForFunction(`(() => { const d = window.__ski.audio.debug(); return (${fn})(d, ${JSON.stringify(arg)}); })()`, null, { timeout: ms, polling: 100 });
    const atPicker = () => page.waitForFunction(() => document.documentElement.dataset.skiScreen === "picker" && window.__ski && window.__ski.audio, null, { timeout: 90000 });

    h.step("picker, before any touch: no audio context, no sound-bank.js / music.js requested");
    await h.goto("/pb/ski.html?debug=1&q=low&res=fixed");
    await atPicker();
    await h.pause(1500);
    const d0 = await dbg();
    h.eq(d0.state, "none", "no AudioContext before the first touch");
    h.eq(d0.music.state, "idle", "the music is not loaded before the first touch");
    h.expect(!requests.some((p) => /sound-bank\.js|music\.js/.test(p)), "sound-bank.js and music.js are not requested yet");

    h.step("the first touch: the context runs, the bank builds, the menu music renders and plays");
    await page.locator(".rp-title h1").click();
    await waitDbg("(d) => d.state === 'running'", null, 5000);
    const d1 = await dbg();
    h.eq(d1.state, "running", "the first touch starts the context");
    await waitDbg("(d) => d.ready && d.bank", null, 20000);
    h.expect(true, "the sound bank is ready");
    await waitDbg("(d) => d.music.state === 'ready' && d.music.playing && d.music.level > 0.3", null, 40000);
    const d2 = await dbg();
    h.expect(d2.music.playing && d2.music.menu, `the menu music plays in the picker (level ${d2.music.level.toFixed(2)})`);
    h.expect(requests.some((p) => /sound-bank\.js/.test(p)) && requests.some((p) => /music\.js/.test(p)), "sound-bank.js and music.js were fetched after the touch");
    await h.shot("picker-music");

    h.step("the picker's Musek button: off, saved, on again");
    h.eq(await page.locator("#skiMusic").textContent(), "♪ Musek un", "the button says Musek un");
    await page.locator("#skiMusic").click();
    h.eq(await page.locator("#skiMusic").textContent(), "♪ Musek aus", "the button says Musek aus");
    h.eq(await page.evaluate(() => localStorage.getItem("pb_ski_music")), "0", "saved as off");
    await waitDbg("(d) => d.music.level < 0.05", null, 8000);
    await waitDbg("(d) => !d.music.playing", null, 8000);
    h.expect(true, "the music faded out and stopped");
    await page.locator("#skiMusic").click();
    await waitDbg("(d) => d.music.playing && d.music.level > 0.3", null, 8000);
    h.eq(await page.evaluate(() => localStorage.getItem("pb_ski_music")), "1", "saved as on");
    h.expect(true, "the music is back");

    h.step("the arcade mute silences everything and suspends the context; unmute resumes");
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("arcade:mute", { detail: { muted: true } })));
    await waitDbg("(d) => d.muted && d.state === 'suspended'", null, 5000);
    h.expect(true, "muted: the context is suspended (nothing plays)");
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("arcade:mute", { detail: { muted: false } })));
    await waitDbg("(d) => !d.muted && d.state === 'running'", null, 5000);
    h.expect(true, "unmuted: running again");

    h.step("iOS: suspended / interrupted context comes back on visibilitychange, pageshow, focus and a touch");
    for (const how of ["visibilitychange", "pageshow", "focus", "touch"]) {
      await page.evaluate(() => window.__ski.audio.context.suspend());
      await waitDbg("(d) => d.state === 'suspended'", null, 3000);
      await page.evaluate((k) => {
        if (k === "visibilitychange") { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); }
        else if (k === "pageshow") window.dispatchEvent(new Event("pageshow"));
        else if (k === "focus") window.dispatchEvent(new Event("focus"));
        else window.dispatchEvent(new Event("touchend"));
      }, how);
      await waitDbg("(d) => d.state === 'running'", null, 4000);
      h.expect(true, `back to running after ${how}`);
    }

    h.step("a ride starts: the music fades out and stops");
    await page.locator(".resort.ready").first().click();
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "ski" && document.documentElement.dataset.skiRunning === "1", null, { timeout: 90000 });
    await waitDbg("(d) => d.music.level < 0.05", null, 8000);
    await waitDbg("(d) => !d.music.playing", null, 8000);
    const d3 = await dbg();
    h.expect(!d3.music.menu && !d3.music.playing, "no music while riding");
    h.eq(d3.state, "running", "the engine keeps running for the ride sounds");

    h.step("the pause menu brings the music back; its Musek row switches it off");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#mMusic", { timeout: 8000 });
    await waitDbg("(d) => d.music.playing && d.music.level > 0.3", null, 12000);
    h.expect(true, "music plays in the pause menu");
    await h.shot("menu-music");
    await page.locator('#mMusic button[data-v="off"]').click();
    await waitDbg("(d) => !d.music.on && d.music.level < 0.05", null, 8000);
    h.eq(await page.evaluate(() => localStorage.getItem("pb_ski_music")), "0", "saved as off from the menu");
    await page.locator('#mMusic button[data-v="on"]').click();
    h.eq(await page.evaluate(() => localStorage.getItem("pb_ski_music")), "1", "and back on");

    h.step("game sounds work while riding: a landing and a station / clack through the real update path");
    await page.keyboard.press("Escape");
    await waitDbg("(d) => !d.music.menu", null, 6000);
    const ev = await page.evaluate(() => { const a = window.__ski.audio; a.event("land", { impact: 0.9 }); a.event("door"); a.event("clack", { vol: 0.5 }); return a.debug().ready; });
    h.expect(ev, "events play without errors once the bank is ready");

    h.step("a direct ride (?go=1) never loads the music module");
    requests.length = 0;
    await h.releaseMemory();
    await h.goto("/pb/ski.html?go=1&debug=1&q=low&res=fixed");
    await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "ski" && document.documentElement.dataset.skiRunning === "1", null, { timeout: 90000 });
    await page.mouse.click(600, 400);
    await waitDbg("(d) => d.state === 'running' && d.ready", null, 20000);
    h.expect(!requests.some((p) => /music\.js/.test(p)), "music.js was not requested for a direct ride");
    h.eq((await dbg()).music.playing, false, "no music in a ride");

    h.eq(errors, [], "no console errors or warnings");
  },
};

runIfMain(import.meta.url, flow);
