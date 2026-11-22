#!/usr/bin/env node
/* R8c: one long-lived browser page driven over HTTP (for look checks spot by spot). Starts its own static server on the worktree.
 *   node scripts/ski/r8c-drv.mjs <webkit|chromium> <port> <out dir> [WxH] [dpr]      (run through browser-slot.py: ONE browser)
 *   POST /eval  body = JS (async fn body, `return` a value)        GET /goto?q=<query string for pb/ski.html>
 *   GET  /shot?name=foo -> <out>/<engine>-foo.png                  GET /logs   GET /quit */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { startServer, launchBrowser } from "../flows/lib.mjs";

const [engine, port, out, size = "1180x820", dpr = "1"] = process.argv.slice(2);
process.env.FLOW_BROWSER = engine;
fs.mkdirSync(out, { recursive: true });
const { server, origin } = await startServer();
const browser = await launchBrowser({ fullChromium: true, args: engine === "webkit" ? [] : ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const [w, h] = size.split("x").map(Number);
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: Number(dpr) });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) logs.push(`${m.type()}: ${m.text().slice(0, 400)}`); });
page.on("pageerror", (e) => logs.push(`pageerror: ${String(e).slice(0, 400)}`));
const body = (req) => new Promise((res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => res(b)); });
const quit = async () => { await browser.close().catch(() => {}); server.close(); process.exit(0); };
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    let result = null;
    if (u.pathname === "/eval") result = await page.evaluate(`(async () => { ${await body(req)} })()`);
    else if (u.pathname === "/shot") { const f = path.join(out, `${engine}-${u.searchParams.get("name")}.png`); await page.screenshot({ path: f, timeout: 60000 }); result = f; }
    else if (u.pathname === "/goto") {
      await page.goto(`${origin}/pb/ski.html?${u.searchParams.get("q") || ""}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction("document.documentElement.dataset.skiRunning === '1' || !!document.documentElement.dataset.bootError", null, { timeout: 240000 });
      result = await page.evaluate(() => document.documentElement.dataset.bootError || "ok");
    } else if (u.pathname === "/logs") result = logs.splice(0);
    else if (u.pathname === "/quit") { res.end("bye"); await quit(); return; }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(result));
  } catch (e) {
    res.statusCode = 500; res.end(JSON.stringify({ error: String(e).slice(0, 1500) }));
  }
});
srv.listen(Number(port), "127.0.0.1", () => console.log(`driver ${engine} on ${port}, site ${origin}`));
setTimeout(quit, 3 * 3600 * 1000);          // never left running
