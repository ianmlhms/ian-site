/* Flow 7 — Presence + notices + admin Online tab:
 * a signed-in page pings touch_presence and shows a one-time notice (OK marks
 * it seen); the admin page's 🟢 Online tab lists who is online / recently seen. */
import { runIfMain } from "./lib.mjs";

const NOTICE = {
  id: "n1",
  title: { lb: "🍪 Däi Cookie Clicker ass erëm do!", de: "🍪 Dein Cookie Clicker ist wieder da!", en: "🍪 Your Cookie Clicker is back!" },
  body: { lb: "Mir hunn en erëmhiergestallt.", de: "Wiederhergestellt.", en: "Restored." },
  cta: { lb: "Spillen", de: "Spielen", en: "Play" },
  url: "/pixelbreak.html?g=cookie-clicker",
};
const minsAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const ONLINE = [
  { user_id: "o1", username: "Ian", class: "4C6", avatar: "😎", account_kind: "full", page: "/pixelbreak.html?g=cookie-clicker", last_seen: minsAgo(0), started_at: minsAgo(12), online: true },
  { user_id: "p1", username: "Emma", class: "4C6", avatar: "🙂", account_kind: "full", page: "/messenger.html", last_seen: minsAgo(1), started_at: minsAgo(3), online: true },
  { user_id: "k1", username: "Racer", class: null, avatar: null, account_kind: "kart", page: "/kart-account.html", last_seen: minsAgo(6), started_at: minsAgo(9), online: false },
];
let noticeSeen = false;

async function setTheme(h, mode) {
  await h.page.evaluate((m) => localStorage.setItem("site_theme", JSON.stringify({ mode: m })), mode);
}

export const flow = {
  name: "admin-online-notice",
  backend: {
    rpc: {
      my_notices: () => (noticeSeen ? [] : [NOTICE]),
      dismiss_notice: () => { noticeSeen = true; return null; },
      touch_presence: () => null,
      is_admin: () => true,
      admin_online: () => ONLINE,
      admin_groups: () => [],
      leaderboard_tags: () => [{ user_id: "o1", username: "Ian", class: "4C6", is_admin: true, is_owner: true }],
      admin_user_ids: () => [{ user_id: "o1" }],
    },
  },
  async run(h) {
    const { page, backend } = h;
    noticeSeen = false;
    await h.signIn();

    h.step("home page: notice popup + presence ping");
    await h.goto("/index.html");
    await page.waitForSelector(".site-notice", { timeout: 10000 });
    const title = await page.textContent(".site-notice__title");
    h.expect(/Cookie Clicker/.test(title || ""), `notice title shown (${title})`);
    h.expect(await page.isVisible('.site-notice [data-act="go"]'), "notice has the Play button");
    await h.shot("notice");
    await page.click('.site-notice [data-act="ok"]');
    await page.waitForSelector(".site-notice", { state: "detached", timeout: 5000 });
    h.expect(backend.callsTo("dismiss_notice").length === 1, "OK marks the notice as seen");
    await page.waitForFunction(() => true);
    await h.pause(500);
    const pings = backend.callsTo("touch_presence");
    h.expect(pings.length >= 1 && /^\/(index\.html)?$/.test(pings[0].body?.p_page || ""), `presence ping sent (${JSON.stringify(pings[0]?.body)})`);

    h.step("reload: the notice does not come back");
    await h.goto("/index.html");
    await h.pause(2000);
    h.expect(!(await page.$(".site-notice")), "no notice after it was seen");

    for (const mode of ["dark", "light"]) {
      h.step(`admin Online tab (${mode})`);
      await setTheme(h, mode);
      await h.goto("/admin.html");
      await page.waitForSelector("#tabOnline", { state: "visible", timeout: 10000 });
      await page.click("#tabOnline");
      await page.waitForSelector(".online-row", { timeout: 8000 });
      const rows = await page.$$eval(".online-row", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ").trim()));
      h.expect(rows.length === 3, `three people listed (got ${rows.length})`);
      h.expect(/Ian.*Admin.*4C6.*Arcade · cookie-clicker.*online for 12 min/.test(rows[0] || ""), `Ian row: tags, page, time (${rows[0]})`);
      h.expect(rows.some((r) => /Racer.*Kart.*seen 6 min ago/.test(r)), "kart account shown as recently seen");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      h.expect(!overflow, "no horizontal scroll");
      await h.shot(`online-${mode}`);
    }
  },
};

runIfMain(import.meta.url, flow);
