import { launchBrowser, runFlow, startServer, videoDir } from "/Users/Ian/Library/Caches/website-zstations/scripts/flows/lib.mjs";
import { flow } from "/Users/Ian/Library/Caches/website-zstations/scripts/flows/train_sim.mjs";
const [browser, { server, origin }] = await Promise.all([launchBrowser({ fullChromium: !!flow.fullChromium }), startServer("/Users/Ian/Library/Caches/website-zstations")]);
try { const r = await runFlow(flow, { browser, origin }); console.log(r.ok ? "PASS" : "FAIL", r.failures.join("\n")); } finally { await browser.close(); server.close(); }
