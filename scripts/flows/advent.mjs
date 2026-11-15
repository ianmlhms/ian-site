/* Flow — Adventskalenner (advent.html): daily gifts in the Arcade games.
 * Both RPCs (advent_gifts_overview, advent_gift_open) are mocked. Covers: before 1 Dec everything is locked with a countdown;
 * signed out -> tapping a door asks to log in; a December state with door 1 open -> tap -> gift revealed and kept on the door;
 * door 6 (Kleeschen); door 24 with 4 gifts; error mapping (locked / over / signin / unknown); admin preview; huge-number formatting;
 * the stale puzzle-version advent_token is removed from localStorage. */
import { runIfMain } from "./lib.mjs";

const GAME_IDS = ["cookie-clicker", "bus-tycoon", "idle-empire", "park"];
const COOKIE_GIFT = 6.03e12;            // -> "6,03 Billiounen"

/* a mutable fake of the server: tests set `now`, `signedIn`, who has opened what */
function createMock() {
  const s = { now: "2026-11-20T12:00:00Z", signedIn: false, admin: false, openUpTo: 0, opened: new Map(), openError: null, amounts: {} };
  const giftsFor = (day) => (day === 24
    ? GAME_IDS.map((game, i) => ({ game, amount: s.amounts[day]?.[i] ?? 1000 * (i + 1) }))
    : [{ game: GAME_IDS[(day - 1) % 4], amount: s.amounts[day] ?? (day === 1 ? COOKIE_GIFT : 5000 * day) }]);
  const doors = () => Array.from({ length: 24 }, (_, i) => {
    const day = i + 1;
    const door = { day, open_at: `2026-12-${String(day).padStart(2, "0")}T00:00:00+01:00`, open: day <= s.openUpTo, opened: s.signedIn && s.opened.has(day), gifts: null, preview: null };
    if (door.opened) door.gifts = s.opened.get(day);
    if (s.admin && !door.open) door.preview = giftsFor(day);
    return door;
  });
  const rpc = {
    advent_gifts_overview: () => ({ now: s.now, until: "2027-01-07T00:00:00+01:00", signed_in: s.signedIn, admin: s.admin, doors: doors() }),
    advent_gift_open: ({ p_day }) => {
      if (s.openError) return { error: { message: `advent: ${s.openError}` } };
      if (!s.signedIn) return { error: { message: "advent: signin" } };
      const fresh = !s.opened.has(p_day);
      if (fresh) s.opened.set(p_day, giftsFor(p_day));
      return { day: p_day, new: fresh, gifts: s.opened.get(p_day) };
    },
  };
  return { s, rpc };
}

const watchConsole = (h) => h.page.on("console", (msg) => {
  // network failures (CDN, analytics) are not the page's fault, see HANDOFF "site_test"
  if (msg.type() === "error" && !/Failed to load resource|net::ERR/i.test(msg.text())) h.failures.push(`console.error: ${msg.text()}`);
});

const text = async (page, selector) => (await page.textContent(selector)).replace(/\s+/g, " ").trim();
const door = (day) => `.adv-door[data-day="${day}"]`;

async function loadPage(h) {
  await h.goto("/advent.html");
  await h.page.waitForSelector(".adv-door:not([disabled])");
}

export const flow = {
  name: "advent",
  async run(h) {
    const { page } = h;
    const mock = createMock();
    const { s } = mock;
    Object.assign(h.backend.rpc, mock.rpc);
    watchConsole(h);
    await h.context.addInitScript(() => { try { if (!localStorage.getItem("advent_token")) localStorage.setItem("advent_token", "stale-guest-token"); } catch { /* ignore */ } });

    h.step("before 1 December: 24 doors, all locked, countdown to 1 Dec 00:00, signed out");
    await loadPage(h);
    h.eq(await page.locator(".adv-door").count(), 24, "24 doors");
    h.eq(await page.locator(".adv-door.locked").count(), 24, "all locked");
    h.eq(await page.locator(".adv-door").evaluateAll((n) => n.map((x) => Number(x.dataset.day)).sort((a, b) => a - b).join(",")), Array.from({ length: 24 }, (_, i) => i + 1).join(","), "each door exactly once");
    h.eq(await text(page, `${door(20)} .adv-door-state`), "20. Dez", "a locked door shows its date");
    const header = await text(page, "#advCountdown");
    h.expect(header.startsWith("Et geet lass an 10 Deeg") && header.includes("Dier 1 op"), `header counts down to 1 Dec (${header})`);
    h.expect((await text(page, `${door(1)} .adv-next`)).startsWith("op an 10"), "door 1 carries the countdown");
    h.eq(await page.locator(".adv-next").count(), 1, "only the next door shows a countdown");
    h.eq(await page.evaluate(() => localStorage.getItem("advent_token")), null, "the stale puzzle token is removed on load");
    h.expect(await page.isVisible("#signInBtn"), "signed out: log-in button in the intro");
    h.expect((await text(page, ".adv-intro")).includes("6. Januar"), "intro mentions the 6 January deadline");
    await h.shot("before-december");

    h.step("signed out: tapping a door asks to log in");
    await page.click(door(5));
    await page.waitForSelector("#advLoginBtn");
    h.expect((await text(page, "#advSheet")).includes("Mell dech un fir deng Kaddoen"), "login prompt text");
    h.eq(h.backend.callsTo("advent_gift_open").length, 0, "no open call while signed out");
    await h.shot("login-prompt");
    await page.click("#advSheet .adv-back");
    await page.waitForSelector("#advSheet", { state: "hidden" });

    h.step("signed in before 1 December: a locked door says 'Nach net op'");
    await h.signIn();
    s.signedIn = true;
    await loadPage(h);
    h.eq(await page.isVisible("#signInBtn"), false, "signed in: no log-in button");
    await page.click(door(3));
    await page.waitForSelector("#advSheet:not([hidden])");
    const locked = await text(page, "#advSheet");
    h.expect(locked.includes("Nach net op") && locked.includes("3. Dez"), `locked sheet (${locked})`);
    h.eq(h.backend.callsTo("advent_gift_open").length, 0, "locked door: no open call");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#advSheet", { state: "hidden" });

    h.step("2 December: doors 1 + 2 open. Tap door 1 -> gift revealed");
    s.now = "2026-12-02T09:00:00Z"; s.openUpTo = 2;
    s.opened.set(2, [{ game: "bus-tycoon", amount: 321 }]);
    await loadPage(h);
    h.eq(await page.locator(".adv-door.ready").count(), 1, "one glowing door (1)");
    h.eq(await page.locator(".adv-door.done").count(), 1, "door 2 already opened");
    h.eq(await text(page, `${door(2)} .adv-door-gifts`), "🚌 +321 Passagéier", "an opened door shows its gift");
    h.expect((await text(page, "#advCountdown")).startsWith("Dier 3 geet op an 14 Stonnen"), "header counts down to door 3");
    await page.click(door(1));
    await page.waitForSelector("#advSheet .adv-gift");
    h.eq(h.backend.callsTo("advent_gift_open").at(-1).body, { p_day: 1 }, "advent_gift_open gets p_day 1");
    h.eq(await text(page, "#advSheet .adv-gift-line"), "🎁 +6,03 Billiounen Cookien am Cookie Clicker", "gift line: amount + unit + game");
    h.eq(await page.getAttribute("#advSheet .adv-gift a", "href"), "pixelbreak.html?g=cookie-clicker", "play link");
    h.eq(await text(page, "#advSheet .adv-gift a"), "Elo spillen", "play button label");
    await h.shot("gift");
    await page.click("#advSheet .adv-back");
    h.eq(await text(page, `${door(1)} .adv-door-gifts`), "🍪 +6,03 Billiounen Cookien", "door 1 now shows its gift");
    h.eq(await page.locator(".adv-door.ready").count(), 0, "nothing glows any more");
    await page.click(door(1));
    await page.waitForSelector("#advSheet .adv-gift");
    const callsBefore = h.backend.callsTo("advent_gift_open").length;
    await page.click("#advSheet .adv-back");
    await page.click(door(2));
    await page.waitForSelector("#advSheet .adv-gift");
    h.eq(await text(page, "#advSheet .adv-gift-line"), "🎁 +321 Passagéier am Bus Tycoon", "reopening a done door shows the stored gift");
    h.eq(h.backend.callsTo("advent_gift_open").length, callsBefore, "done doors need no open call");
    await page.click("#advSheet .adv-back");

    h.step("6 December (Kleeschen): bigger one, small Kleeschen touch");
    s.now = "2026-12-06T08:00:00Z"; s.openUpTo = 6;
    await loadPage(h);
    h.expect((await text(page, door(6))).includes("Kleeschen"), "door 6 is tagged Kleeschen");
    await page.click(door(6));
    await page.waitForSelector("#advSheet .adv-gift");
    h.expect((await text(page, "#advSheet .adv-title")).includes("Kleeschen"), "sheet greets from the Kleeschen");
    h.expect((await text(page, "#advSheet")).includes("méi grousse Kaddo"), "says it is a bigger gift");
    await page.click("#advSheet .adv-back");

    h.step("24 December: four gifts, one per game, each with its own play link");
    s.now = "2026-12-24T10:00:00Z"; s.openUpTo = 24; s.opened.clear();
    await loadPage(h);
    await page.click(door(24));
    await page.waitForSelector("#advSheet .adv-gift");
    h.eq(await page.locator("#advSheet .adv-gift").count(), 4, "door 24 shows 4 gifts");
    h.eq(await page.locator("#advSheet .adv-gift a").evaluateAll((a) => a.map((x) => x.getAttribute("href"))),
      GAME_IDS.map((id) => `pixelbreak.html?g=${id}`), "one play link per game");
    h.eq(await page.locator("#advSheet .adv-gift-line").allTextContents().then((t) => t.map((x) => x.replace(/\s+/g, " "))),
      ["🎁 +1 000 Cookien am Cookie Clicker", "🎁 +2 000 Passagéier am Bus Tycoon", "🎁 +3 000 Cash am Business Empire", "🎁 +4 000 Suen am Schueberfouer Tycoon"], "gift lines for every game");
    await h.shot("door-24");
    await page.click("#advSheet .adv-back");
    h.eq(await page.locator(`${door(24)} .adv-door-gifts span`).count(), 4, "door 24 lists all 4 gifts");

    h.step("errors from the server become friendly Luxembourgish text");
    const errors = { locked: "Dës Dier ass nach zou.", over: "De Kalenner ass eriwwer. Dës Dier geet net méi op.", day: "Dës Dier gëtt et net.", signin: "Mell dech fir d'éischt un.", weird: "Eppes ass schifgaang. Probéier nach eng Kéier." };
    for (const [code, expected] of Object.entries(errors)) {
      s.opened.clear(); s.openError = code;
      await loadPage(h);
      await page.click(door(7));
      await page.waitForSelector("#advSheet .adv-text");
      h.eq(await text(page, "#advSheet .adv-text"), expected, `advent: ${code} -> "${expected}"`);
      await page.click("#advSheet .adv-back");
      h.eq(await page.locator(`${door(7)}.ready`).count(), 1, `after ${code} the door is still closed`);
    }
    s.openError = null;

    h.step("huge amounts are shown compactly, never as raw exponents");
    const formatted = await page.evaluate(async () => {
      const { formatAmount } = await import("/advent-util.js?v=2");
      return [0, 1, 999, 12345, 999999, 1e6, 1.5e6, 2.5e9, 6.03e12, 999.6e12, 1e15, 1e18, 1e21, 3.3e60, 1e66, 1e220, 9.99e99, 1e22, 1e300].map(formatAmount);
    });
    h.eq(formatted, ["0", "1", "999", "12 345", "999 999", "1 Millioun", "1,5 Milliounen", "2,5 Milliarden", "6,03 Billiounen", "1 Billiard",
      "1 Billiard", "1 Trillioun", "1 Trilliard", "3,3 Dezilliounen", "1 × 10⁶⁶", "1 × 10²²⁰", "9,99 × 10⁹⁹", "10 Trilliarden", "1 × 10³⁰⁰"], "formatAmount: Luxembourgish long scale, 3 digits, × 10ⁿ past Dezillioun");
    h.expect(formatted.every((x) => !/e[+-]?\d/i.test(x)), "no raw exponent anywhere");
    s.opened.clear(); s.amounts[7] = 1e220; s.now = "2026-12-24T10:00:00Z";
    await loadPage(h);
    await page.click(door(7));
    await page.waitForSelector("#advSheet .adv-gift");
    h.eq(await text(page, "#advSheet .adv-gift-line"), "🎁 +1 × 10²²⁰ Cash am Business Empire", "a 1e220 gift renders as 1 × 10²²⁰");
    await page.click("#advSheet .adv-back");

    h.step("admin: locked doors carry a subtle preview line");
    s.opened.clear(); s.admin = true; s.now = "2026-12-02T09:00:00Z"; s.openUpTo = 2; s.amounts = {};
    await loadPage(h);
    h.expect((await text(page, `${door(4)} .adv-admin-preview`)).includes("👁"), "locked door shows the admin preview");
    h.eq(await page.locator(`${door(1)} .adv-admin-preview`).count(), 0, "open doors have no preview line");
    s.admin = false;
    await loadPage(h);
    h.eq(await page.locator(".adv-admin-preview").count(), 0, "non-admins never see a preview");

    h.step("after 7 January everything is over");
    s.now = "2027-01-08T10:00:00Z"; s.openUpTo = 0; s.opened.clear();
    await loadPage(h);
    h.expect((await text(page, "#advCountdown")).includes("eriwwer"), "header says it is over");
    await page.click(door(9));
    await page.waitForSelector("#advSheet .adv-text");
    h.expect((await text(page, "#advSheet .adv-text")).includes("eriwwer"), "locked door after the end: over");
  },
};

runIfMain(import.meta.url, flow);
