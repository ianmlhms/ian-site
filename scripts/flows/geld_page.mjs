/* Flow — Geld (geld.html): owner-only Trade Republic page, all data FAKE.
 * Other accounts see a notice and cause NO geld_* request; the owner sees the
 * cards, category bars, the chart, positions; changing a category locks the row,
 * saves a merchant rule and re-applies it to unlocked rows of that merchant. */
import { runIfMain } from "./lib.mjs";

const SESSION_KEY = "sb-lvksqmgfwkfbblfsozfk-auth-token";
const NOW = new Date();
const iso = (daysAgo, hour = 12) => new Date(NOW.getTime() - daysAgo * 86400000 + (hour - 12) * 3600000).toISOString();
const day = (daysAgo) => new Date(NOW.getTime() - daysAgo * 86400000).toISOString().slice(0, 10);
const tx = (id, daysAgo, amount, kind, type, merchant, cat, extra = {}) => ({
  id, at: iso(daysAgo), amount, kind, account: "Trade Republic", source: "tr", type, merchant, isin: null, shares: null,
  cat, cat_locked: false, is_transfer: false, status: "EXECUTED", event_type: null, ...extra,
});

let rows = [];
let rules = [];
const reset = () => {
  rows = [
    tx("t1", 0, 12.5, "out", "card", "Fake Cafe", "food"),
    tx("t2", 0, 40, "out", "card", "Fake Cafe", null),
    tx("t3", 0, 30, "out", "card", "Fake Cafe", "food", { cat_locked: true }),
    tx("t4", 0, 100, "out", "savings_plan", "Fake World ETF", "investment", { isin: "XX0000000001", shares: 1.5 }),
    tx("t5", 0, 5, "in", "card_refund", "Fake Shop", "shopping"),
    tx("t6", 0, 25, "out", "card", "Fake Shop", "shopping"),
    { ...tx("l1", 0, 9, "out", null, "Legacy Kiosk", "groceries"), account: "Sparkonto", source: "legacy" },
  ];
  rules = [];
};

const matchesRule = (url) => {
  const ilike = (url.searchParams.get("merchant") || "").replace(/^ilike\./, "");
  return ilike.toLowerCase();
};

export const flow = {
  name: "geld-page",
  ...(process.env.GELD_PHONE ? { viewport: { width: 390, height: 844 }, touch: true } : {}),
  backend: {
    tables: {
      geld_tx: ({ url, method, body }) => {
        if (method === "PATCH") {
          const id = (url.searchParams.get("id") || "").replace(/^eq\./, "");
          const merchant = matchesRule(url);
          rows = rows.map((r) => {
            const byId = id && r.id === id;
            const byRule = merchant && r.merchant.toLowerCase() === merchant && !r.cat_locked && r.id !== (url.searchParams.get("id") || "").replace(/^neq\./, "");
            return byId || byRule ? { ...r, ...body } : r;
          });
          return [];
        }
        const typeFilter = url.searchParams.get("type") || "";
        return typeFilter.startsWith("in.") ? rows.filter((r) => ["buy", "sell", "savings_plan"].includes(r.type)) : rows;
      },
      geld_rules: ({ method, body }) => { if (method === "POST") rules = [...rules, body]; return []; },
      geld_positions: () => [
        { isin: "XX0000000001", name: "Fake World ETF", qty: 3, avg_cost: 100, buy_cost: 300, value: 330, price: 110 },
        { isin: "XX0000000002", name: "Fake Tech", qty: 1, avg_cost: 50, buy_cost: 50, value: 40, price: 40 },
      ],
      geld_daily: () => [30, 20, 10, 0].map((d, i) => ({ day: day(d), depot_value: 340 + i * 10, invested: 350, cash: 12.34 })),
      geld_budgets: () => [{ cat: "_total", monthly_limit: 100 }, { cat: "food", monthly_limit: 50 }],
      geld_sync: () => [{ id: 1, last_ok_at: iso(0, 11), last_attempt_at: iso(0, 11), last_error: null, needs_login: true, events_total: 7 }],
    },
  },
  async run(h) {
    const { page, context } = h;
    reset();
    await h.signIn();

    h.step("signed in as a different account: notice and no geld request");
    await h.goto("/geld.html");
    await page.waitForFunction(() => /nëmme fir den Ian/.test(document.body.textContent));
    h.eq(h.backend.calls.filter((c) => /^geld_/.test(c.name)).length, 0, "no geld_* request for a stranger");

    h.step("as the owner");
    await context.addInitScript((key) => {
      try {
        const s = JSON.parse(localStorage.getItem(key));
        localStorage.setItem(key, JSON.stringify({ ...s, user: { ...s.user, email: "konto@ian.lu" } }));
      } catch { /* no stored session */ }
    }, SESSION_KEY);
    await h.goto("/geld.html");
    await page.waitForSelector("#txList .g-row");
    const text = await page.textContent("#wrap");
    h.expect(/Confirméier de Login/.test(text), "needs_login banner shown");
    // spending = 12.5 + 40(null→other) + 30 + (25 - 5) + 9 = 111.5 ; investment excluded
    h.expect(/111,50\s*€/.test(text), "month spending is 111,50 € (investment excluded, refund netted)");
    h.expect(/112 % vun 100,00\s*€/.test(text), "total budget progress 112 %");
    h.expect(/370,00\s*€/.test(text), "depot value 370,00 € from positions");
    h.expect(/\+20,00\s*€/.test(text), "total gain +20,00 €");
    h.eq(await page.$$eval("#chart polyline.val", (e) => e.length), 1, "value chart drawn");
    h.eq(await page.$$eval(".g-table tbody tr", (e) => e.length), 2, "two positions listed");
    h.expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal overflow");
    await h.shot("owner");
    if (process.env.GELD_FULL) await page.screenshot({ path: process.env.GELD_FULL, fullPage: true });

    h.step("filter: other accounts");
    await page.click('[data-filter="other"]');
    h.eq(await page.$$eval("#txList .g-row", (e) => e.length), 1, "only the legacy account row");
    await page.click('[data-filter="all"]');

    h.step("pick a category on the uncategorised row");
    await page.click('[data-pick="t2"]');
    await page.waitForSelector("dialog.g-pick[open]");
    await page.click('dialog.g-pick [data-cat="leisure"]');
    await page.waitForFunction(() => !document.querySelector("dialog.g-pick"));
    for (let i = 0; i < 50 && !h.backend.callsTo("geld_tx").some((c) => /neq\./.test(c.query || "")); i++) await h.pause(100);
    await h.pause(300);
    const t2 = rows.find((r) => r.id === "t2");
    h.eq([t2.cat, t2.cat_locked], ["leisure", true], "row set and locked");
    h.eq(rules.map((r) => [r.merchant_key, r.cat]), [["fake cafe", "leisure"]], "merchant rule saved (lower-cased)");
    h.eq(rows.find((r) => r.id === "t1").cat, "leisure", "unlocked row of the same merchant re-categorised");
    h.eq(rows.find((r) => r.id === "t3").cat, "food", "hand-locked row of the same merchant untouched");
    if (process.env.GELD_DEBUG) console.log(JSON.stringify(h.backend.calls.filter((c) => /geld_(rules|tx)/.test(c.name) && c.method !== "GET")));
    await h.shot("after-pick");
  },
};

runIfMain(import.meta.url, flow);
