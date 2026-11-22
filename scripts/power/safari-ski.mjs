#!/usr/bin/env node
/* Power test (22 Nov 2026): one Ski Alpen check in REAL Safari through safaridriver (W3C WebDriver), instead of Playwright WebKit.
 *   node scripts/power/safari-ski.mjs [--root <checkout with pb/ski>] [--resort killy] [--port 4445]
 * Needs Safari > Develop > "Allow Remote Automation" (or `safaridriver --enable`, which asks for an admin password). Without it the
 * session request fails at once and this exits 3 with the reason (no window opens).
 * Checks (the ski-ipad-start flow's core): boots without an error, reaches the running free ride, the skier moves under the bot,
 * the renderer draws (renderer.info.render.frame climbs), zero page errors. Run it through browser-slot.py. */
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const ROOT = path.resolve(opt("--root", process.cwd()));
const RID = opt("--resort", "killy");
const PORT = Number(opt("--port", "4445"));
const { startServer } = await import(pathToFileURL(path.join(ROOT, "scripts/flows/lib.mjs")).href);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const driver = spawn("/usr/bin/safaridriver", ["-p", String(PORT)], { stdio: "ignore" });
const base = `http://127.0.0.1:${PORT}`;
async function wd(method, rel, body) {
  const res = await fetch(base + rel, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.value && json.value.message ? json.value.message : `HTTP ${res.status}`), { wd: json.value });
  return json.value;
}
for (let i = 0; i < 50; i++) { try { await fetch(base + "/status"); break; } catch { await sleep(100); } }

const { server, origin } = await startServer(ROOT);
let session = null, failures = [];
const expect = (ok, msg) => { console.log(`    ${ok ? "ok  " : "FAIL"} ${msg}`); if (!ok) failures.push(msg); };
try {
  try {
    session = (await wd("POST", "/session", { capabilities: { alwaysMatch: { browserName: "safari" } } })).sessionId;
  } catch (error) {
    console.log(`safaridriver: no session — ${error.message}`);
    process.exitCode = 3;
  }
  if (session) {
    const run = (script, a = []) => wd("POST", `/session/${session}/execute/sync`, { script, args: a });
    await wd("POST", `/session/${session}/window/rect`, { width: 1180, height: 820 }).catch(() => {});
    await run("window.__errs = []; return 1;");
    await wd("POST", `/session/${session}/url`, { url: `${origin}/pb/ski.html?go=1&debug=1&bot=1&q=low&weather=sun&time=midday&resort=${RID}` });
    await run("window.__errs = []; window.addEventListener('error', (e) => window.__errs.push(String(e.message))); return 1;");
    const t0 = Date.now();
    let state = null;
    while (Date.now() - t0 < 120000) {
      state = await run("const d = document.documentElement.dataset; return { running: d.skiRunning === '1', bootError: d.bootError || '' };");
      if (state.running || state.bootError) break;
      await sleep(500);
    }
    expect(state && !state.bootError, `boots without an error ${state && state.bootError ? state.bootError : ""}`);
    expect(state && state.running, `the free ride runs (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    const a = await run("const S = window.__ski; return { x: S.state.x, z: S.state.z, frame: S.renderer.info.render.frame };");
    await run("const S = window.__ski; S.setInput({ steer: 0.2, tuck: 1, brake: 0, push: 1, jump: false }); return 1;");
    await sleep(5000);
    const b = await run("const S = window.__ski; return { x: S.state.x, z: S.state.z, frame: S.renderer.info.render.frame, errs: window.__errs || [] };");
    expect(Math.hypot(b.x - a.x, b.z - a.z) > 3, `the skier moved ${Math.hypot(b.x - a.x, b.z - a.z).toFixed(1)} m in 5 s`);
    expect(b.frame - a.frame > 20, `${b.frame - a.frame} frames drawn in 5 s`);
    expect(!b.errs.length, `no page errors ${b.errs.slice(0, 2).join(" | ")}`);
  }
} finally {
  if (session) await wd("DELETE", `/session/${session}`).catch(() => {});
  driver.kill();
  server.close();
}
if (session) { console.log(failures.length ? `✘ FAIL safari-ski (${failures.length})` : "✔ PASS safari-ski"); process.exitCode = failures.length ? 1 : 0; }
