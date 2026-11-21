// dev only (not committed): node scripts/ski/_lmshot.mjs OUT.png "query" ["query" ...] -> one PNG per query, stacked
import { launchBrowser, startServer } from "../flows/lib.mjs";
const [out, ...queries] = process.argv.slice(2);
const browser = await launchBrowser({ fullChromium: true });
const { server, origin } = await startServer();
try {
  const page = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e)));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("[page]", m.text()); });
  let i = 0;
  for (const q of queries) {
    await page.goto(`${origin}/pb/ski/_lmtest.html?${q}`);
    await page.waitForFunction(() => document.title.startsWith("ok"), null, { timeout: 30000 });
    await page.screenshot({ path: out.replace(/\.png$/, `-${i++}.png`) });
    console.log(q, await page.title());
  }
} finally { await browser.close(); server.close(); }
