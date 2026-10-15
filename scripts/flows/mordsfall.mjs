/* Flow — Mordsfall (light redesign + pencil marks): list, a case played with real pointer input:
 *   tap = pencil letter, tap again removes it, swipe across 3 cells writes 3 letters, ✕ mode, eraser (tap / hold),
 *   hold = place (with the notes of that person cleared elsewhere), double-tap = place, undo covers notes,
 *   tooltip with the object's name, light theme even when the site is set to dark, hint, wrong check, win screen + murderer,
 *   saved progress, owner test mode, room names fit at phone width, loupe during a hold on small cells.
 * Also re-runs the data check (scripts/mordsfall_check.mjs): every shipped case has exactly one solution. */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { REPO, runIfMain } from "./lib.mjs";

const SAVE_KEY = "pb_save_mordsfall";
const seen = () => { localStorage.setItem("pb_save_mordsfall", JSON.stringify({ v: 2, seen: true })); localStorage.setItem("site_theme", JSON.stringify({ mode: "dark" })); };
const LM = 44, PAD = 16;

async function cellXY(page, cell) {
  await page.evaluate(() => document.querySelector(".mf-board").scrollIntoView({ block: "center" })); // the tools sit below the board on tablets: make sure the board is on screen
  const n = Number(await page.locator(".mf-board").getAttribute("data-n"));
  const box = await page.locator(".mf-board").boundingBox();
  const k = box.width / (n * 100 + LM + PAD);
  return [box.x + (LM + (cell % n) * 100 + 50) * k, box.y + (LM + Math.floor(cell / n) * 100 + 50) * k];
}
async function pick(page, p) {
  const chip = page.locator(`.mf-pchip[data-p="${p}"]`);
  if (await chip.isVisible()) await chip.click(); else await page.locator(`.mf-portraitbtn[data-p="${p}"]`).click();
}
const state = (page) => page.evaluate(() => window.__mordsfall.state());
const marksOf = async (page, p) => (await state(page)).marks.filter((k) => k.startsWith(p + ":")).map((k) => Number(k.split(":")[1])).sort((a, b) => a - b);
async function tap(page, cell) { const [x, y] = await cellXY(page, cell); await page.mouse.click(x, y); }
async function hold(page, cell, ms) { const [x, y] = await cellXY(page, cell); await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up(); }
async function swipe(page, cells) {
  const [x0, y0] = await cellXY(page, cells[0]);
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (const c of cells.slice(1)) { const [x, y] = await cellXY(page, c); await page.mouse.move(x, y, { steps: 5 }); }
  await page.mouse.up();
}

export const flow = {
  name: "mordsfall",
  async run(h) {
    const { page } = h;
    h.step("data check: every shipped case has exactly one solution");
    let out = "";
    try { out = execFileSync("node", [path.join(REPO, "scripts/mordsfall_check.mjs")], { encoding: "utf8" }); } catch (error) { out = String(error.stdout || error.message); }
    const passLine = out.split("\n").find((l) => l.startsWith("PASS")) || out.split("\n").slice(-3).join(" | ");
    h.expect(/^PASS: 30 cases/.test(passLine), "mordsfall_check: " + passLine);

    h.step("case list (paper case files), light even though the site is set to dark");
    await page.context().addInitScript(seen);
    await h.goto("/mordsfall.html");
    await page.waitForSelector(".mf-file");
    h.eq(await page.locator(".mf-file").count(), 30, "30 case files are listed");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number));
    h.expect(bg[0] > 220 && bg[1] > 210 && bg[2] > 190, `the page background is light paper (rgb ${bg.slice(0, 3)}) although site_theme=dark`);
    h.eq(await page.evaluate(() => getComputedStyle(document.body).colorScheme), "light", "color-scheme is light");
    await page.locator('[data-filter="ex"]').click();
    h.eq(await page.locator(".mf-file").count(), 6, "the Expert filter shows 6 cases");
    await page.locator('[data-filter="ve"]').click();
    h.eq(await page.locator(".mf-file").count(), 6, "the Very easy filter shows 6 cases");
    await h.shot("list");

    h.step("open ve1: portraits, clues with bold key words, tools");
    await page.locator('[data-case="ve1"]').click();
    await page.waitForSelector(".mf-board");
    const s0 = await state(page);
    h.eq(s0.id, "ve1", "ve1 is open");
    h.eq(await page.locator(".mf-card").count(), 5, "five suspect cards (4 suspects + victim)");
    h.expect(await page.locator(".mf-card .mf-portrait").count() === 5, "every card has a portrait");
    h.expect(await page.locator(".mf-cluebox b").count() >= 5, "the clues carry bold key words");
    h.expect(/victim|Affer|Opfer/i.test(await page.locator(".mf-card.victim .mf-cluebox").innerText()), "the victim card says «The victim …»");
    h.expect(await page.locator('[data-act="check"][aria-disabled="true"]').count() === 1, "Check is disabled until everybody is placed");
    h.expect(/everyone first|jiddereen|alle/i.test(await page.locator('[data-act="check"]').getAttribute("aria-label")), "the disabled Check button says to place everyone first (aria-label; the long text shows on wide screens)");
    // a blocked cell is refused
    const blocked = await page.evaluate(() => window.__mordsfall.blockedCell());
    await pick(page, 1);
    await tap(page, blocked);
    h.eq((await marksOf(page, 1)).length, 0, "no pencil letter on a blocking object");
    h.expect((await page.locator(".mf-msg").innerText()).length > 0, "tapping a blocking object explains why");

    h.step("pencil marks on a 7x7 case: tap, tap again, swipe over 3 cells, two people in one cell");
    await page.evaluate(() => window.__mordsfall.openCase("me1"));
    await page.waitForSelector(".mf-board");
    const cells = await page.evaluate(() => window.__mordsfall.rowCells(3));
    h.eq(cells.length, 3, "found 3 neighbouring free cells");
    await pick(page, 2);
    await tap(page, cells[0]);
    h.eq(await marksOf(page, 2), [cells[0]], "tap writes the person's letter in the cell");
    h.expect(await page.locator(".mf-board .letter").count() === 1, "the letter is drawn on the board");
    const lsz = await page.$$eval(".mf-board .letter", (els) => els.map((e) => Number(e.getAttribute("font-size"))));
    h.expect(lsz.every((x) => x <= 28), `a single pencil letter stays small (font-size ${lsz})`);
    await page.waitForTimeout(450); // (two taps within ~0.3 s are a double-tap, which places the person)
    await tap(page, cells[0]);
    h.eq(await marksOf(page, 2), [], "tapping the same cell again removes the letter");
    await page.waitForTimeout(450);
    await swipe(page, cells);
    h.eq(await marksOf(page, 2), [...cells].sort((a, b) => a - b), "swiping across 3 cells writes 3 letters");
    await pick(page, 3);
    await tap(page, cells[1]);
    h.eq(await marksOf(page, 3), [cells[1]], "a second person's letter joins the first in one cell");
    h.expect(await page.locator(".mf-board .letter").count() === 4, "four letters are on the board");
    await h.shot("pencil");

    h.step("✕ mode, eraser tap (this cell) and eraser hold (all notes), undo brings notes back");
    await page.locator('[data-act="cross"]').click();
    const free = await page.evaluate(() => window.__mordsfall.rowCells(2).slice(0, 2));
    await swipe(page, free);
    const crosses = (await state(page)).marks.filter((k) => k.startsWith("-1:"));
    h.expect(crosses.length >= 2, `✕ mode swipe marks ${crosses.length} cells as «nobody here»`);
    await page.locator('[data-act="cross"]').click();
    await pick(page, 2);
    await tap(page, cells[1]); // moves the cursor to cells[1] (and toggles person 2's letter off there)
    await page.waitForTimeout(450);
    const before = (await state(page)).marks.length;
    await page.locator('[data-act="erase"]').click();
    const afterCell = (await state(page)).marks;
    h.expect(afterCell.length < before && !afterCell.some((k) => k.endsWith(":" + cells[1])), "eraser tap clears the notes of the selected cell only");
    const eb = await page.locator('[data-act="erase"]').boundingBox();
    await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2); await page.mouse.down();
    await page.waitForTimeout(250);
    h.expect(await page.locator('[data-act="erase"].holding').count() === 1, "the eraser shows its fill animation while held");
    await page.waitForTimeout(800); await page.mouse.up();
    h.eq((await state(page)).marks, [], "holding the eraser ~0.8 s clears every note");
    await page.locator('[data-act="undo"]').click();
    h.expect((await state(page)).marks.length > 0, "undo brings the notes back");

    h.step("tooltip names the object under the mouse");
    const objCell = await page.evaluate(() => window.__mordsfall.blockedCell());
    const [ox, oy] = await cellXY(page, objCell);
    await page.mouse.move(ox, oy); await page.waitForTimeout(150);
    h.expect(await page.locator("#mfTip:not([hidden])").count() === 1 && (await page.locator("#mfTip").innerText()).length > 1, `a tooltip shows the object's name («${await page.locator("#mfTip").innerText()}»)`);

    h.step("keyboard: a person's letter writes a note on the hovered cell, a digit picks, Enter places, Backspace erases");
    await page.evaluate(() => window.__mordsfall.reset());
    const sk = await state(page);
    const spot = await page.evaluate(() => window.__mordsfall.rowCells(1)[0]);
    const [kx, ky] = await cellXY(page, spot);
    await page.mouse.move(kx, ky); await page.waitForTimeout(100);
    await page.keyboard.press(sk.names[4][0].toLowerCase());
    h.eq(await marksOf(page, 4), [spot], "pressing a person's letter writes their note on the hovered cell");
    await page.keyboard.press(sk.names[4][0].toUpperCase());
    h.eq(await marksOf(page, 4), [], "pressing it again removes the note");
    await page.keyboard.press("2");
    h.eq((await state(page)).sel, 1, "a digit key picks a person");
    await page.keyboard.press("Enter");
    h.eq((await state(page)).pos[1], spot, "Enter places the picked person on the hovered cell");
    await page.keyboard.press("Control+z");
    h.eq((await state(page)).pos[1], -1, "Ctrl+Z undoes the placement");

    h.step("hold places the person (and clears their other notes), double-tap places too, tapping the token removes");
    await page.evaluate(() => window.__mordsfall.reset());
    const sm = await state(page);
    const elsewhere = await page.evaluate(() => window.__mordsfall.rowCells(2));
    await pick(page, 2);
    await swipe(page, elsewhere);
    h.eq((await marksOf(page, 2)).length, 2, "person 2 has two notes");
    await page.waitForTimeout(450);
    await hold(page, sm.solution[2], 650);
    h.eq((await state(page)).pos[2], sm.solution[2], "press-and-hold places the person on that cell");
    h.eq((await marksOf(page, 2)).length, 0, "placing clears that person's notes elsewhere");
    await page.waitForTimeout(450);
    await pick(page, 3);
    const [dx, dy] = await cellXY(page, sm.solution[3]);
    await page.mouse.dblclick(dx, dy);
    h.eq((await state(page)).pos[3], sm.solution[3], "double-tap places the person");
    h.eq((await marksOf(page, 3)).length, 0, "the double-tap leaves no note behind");
    await page.waitForTimeout(450);
    await tap(page, sm.solution[3]);
    h.eq((await state(page)).pos[3], -1, "tapping the selected person's token takes it off");
    await h.shot("placed");

    h.step("check too early, then with two people swapped");
    await page.evaluate(() => window.__mordsfall.reset());
    await page.locator('[data-act="check"]').click({ force: true });
    h.expect((await page.locator(".mf-msg").innerText()).length > 0, "checking before everyone is placed gives a message");
    await page.evaluate(() => window.__mordsfall.placeAll());
    await page.evaluate(() => window.__mordsfall.swap(3, 4));
    await page.locator('[data-act="check"]').click({ force: true });
    h.expect(/2/.test(await page.locator(".mf-msg").innerText()), "a wrong placement reports 2 people in the wrong place");
    h.eq((await state(page)).status, "playing", "the case is still open after a wrong check");

    h.step("hint explains a deduction");
    await page.evaluate(() => window.__mordsfall.openCase("ve1"));
    await page.evaluate(() => window.__mordsfall.reset());
    await page.locator('[data-act="hint"]').click();
    await page.waitForSelector(".mf-hintbox");
    h.expect((await page.locator(".mf-hintbox").innerText()).length > 20, "the hint box has an explanation");
    h.eq((await state(page)).hints, 1, "using the hint is counted");

    h.step("solve → win screen reveals the murderer");
    await page.evaluate(() => window.__mordsfall.reset());
    await page.evaluate(() => window.__mordsfall.solve());
    await page.waitForSelector(".mf-win");
    const s1 = await state(page);
    h.eq(s1.status, "won", "the case is won");
    const who = await page.locator(".mf-win .who").innerText();
    h.expect(who.includes(s1.names[s1.murderer]), `win screen names the murderer (${s1.names[s1.murderer]}): «${who}»`);
    h.expect(s1.murderer !== 0, "the murderer is not the victim");
    h.eq(await page.evaluate(() => window.__mordsfall.sharesVictimRoom()), s1.names[s1.murderer], "the murderer is the other person in the victim's room");
    await h.shot("win");
    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "{}"), SAVE_KEY);
    h.expect(stored.done && stored.done.ve1 && stored.done.ve1.t >= 1, "the solved case and its time are saved");
    await page.locator('[data-win="next"]').click();
    await page.waitForSelector(".mf-board");
    h.eq((await state(page)).id, "ve2", "Next case opens the next unsolved case (same tier first)");
    await page.locator('[data-act="cases"]').click();
    h.expect(await page.locator('[data-case="ve1"].solved').count() === 1, "the case file shows the SOLVED stamp");

    h.step("phone: room names fit in all languages; a hold on small cells shows the loupe");
    const phone = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    await phone.addInitScript(seen);
    const p3 = await phone.newPage();
    p3.on("pageerror", (e) => h.failures.push("phone page error: " + e.message));
    await p3.goto(h.origin + "/mordsfall.html", { waitUntil: "domcontentloaded" });
    await p3.waitForSelector(".mf-file");
    const cut = [];
    for (const lang of ["lb", "de", "en"]) {
      await p3.locator(`[data-lang="${lang}"]`).click();
      for (const id of await p3.evaluate(() => window.__mordsfall.cases.map((c) => c.id))) {
        await p3.evaluate((i) => window.__mordsfall.openCase(i), id);
        const texts = await p3.$$eval(".room-lbl", (els) => els.map((e) => e.textContent));
        texts.filter((x) => x.endsWith("…")).forEach((x) => cut.push(`${lang} ${id} ${x}`));
      }
    }
    h.eq(cut, [], "no truncated room name in 30 cases x 3 languages at 390px");
    await p3.locator('[data-lang="lb"]').click();
    await p3.evaluate(() => window.__mordsfall.openCase("ex1"));
    const s3 = await state(p3);
    await pick(p3, 2);
    await p3.evaluate(() => document.querySelector(".mf-board").scrollIntoView({ block: "center" }));
    const [tx, ty] = await cellXY(p3, s3.solution[2]);
    const ptr = (type, x, y) => p3.evaluate(([type, x, y]) => (type === "pointerdown" ? document.querySelector(".mf-board") : window).dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerType: "touch", pointerId: 7, isPrimary: true, button: 0 })), [type, x, y]);
    await ptr("pointerdown", tx, ty);
    await p3.waitForTimeout(250);
    h.eq(await p3.locator(".mf-loupe").count(), 1, "while the hold is filling, a loupe shows the cell under the finger");
    h.expect(await p3.locator("#mfRing .ring").count() === 1, "the hold shows a filling ring");
    await p3.waitForTimeout(450);
    h.eq((await state(p3)).pos[2], s3.solution[2], "the hold placed the person");
    h.eq(await p3.locator(".mf-loupe").count(), 1, "the loupe stays while the finger is down after placing");
    if (process.env.FLOW_SHOTS_DIR) await p3.screenshot({ path: process.env.FLOW_SHOTS_DIR + "/mordsfall.loupe-phone.png" });
    await ptr("pointerup", tx, ty);
    h.eq(await p3.locator(".mf-loupe").count(), 0, "the loupe disappears when the finger lifts");
    // a plain tap on small cells must NOT show a loupe
    await pick(p3, 3);
    const free3 = await p3.evaluate(() => window.__mordsfall.rowCells(1)[0]);
    const [fx, fy] = await cellXY(p3, free3);
    await ptr("pointerdown", fx, fy); await ptr("pointerup", fx, fy);
    h.eq(await p3.locator(".mf-loupe").count(), 0, "a quick tap (pencil letter) shows no loupe");
    h.eq((await marksOf(p3, 3)).length, 1, "the quick tap wrote a pencil letter");
    await phone.close();

    h.step("360px phone: all six tool buttons fit, nothing overflows horizontally");
    const narrow = await page.context().browser().newContext({ viewport: { width: 360, height: 740 }, serviceWorkers: "block" });
    await narrow.addInitScript(seen);
    const p4 = await narrow.newPage();
    p4.on("pageerror", (e) => h.failures.push("360px page error: " + e.message));
    await p4.goto(h.origin + "/mordsfall.html?case=ex1", { waitUntil: "domcontentloaded" });
    await p4.waitForSelector(".mf-tool");
    const tools = await p4.$$eval(".mf-tool", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), clipped: e.scrollWidth > e.clientWidth + 1, label: e.querySelector(".lb")?.scrollWidth > e.querySelector(".lb")?.clientWidth + 1 }; }));
    h.eq(tools.length, 6, "six tool buttons");
    h.expect(tools.every((x) => x.l >= 0 && x.r <= 360), `every tool button lies inside 360px (${tools.map((x) => x.l + "-" + x.r).join(" ")})`);
    h.expect(tools.every((x) => !x.clipped && !x.label), "no tool button or label is clipped");
    h.eq(await p4.evaluate(() => document.documentElement.scrollWidth <= 360), true, "no horizontal scroll at 360px");
    const widths = tools.map((x) => x.r - x.l);
    h.expect(Math.max(...widths) - Math.min(...widths) <= 1, `the six buttons have equal widths (${widths})`);
    await narrow.close();

    h.step("owner test mode: nothing is read or written");
    const ctx2 = await page.context().browser().newContext({ viewport: { width: 820, height: 1180 }, serviceWorkers: "block" });
    await ctx2.addInitScript(() => { window.__pbTestMode = true; });
    const p2 = await ctx2.newPage();
    p2.on("pageerror", (e) => h.failures.push("test-mode page error: " + e.message));
    await p2.goto(h.origin + "/mordsfall.html", { waitUntil: "domcontentloaded" });
    await p2.waitForSelector(".mf-file");
    await p2.evaluate(() => window.__mordsfall.openCase("ea1"));
    await p2.evaluate(() => window.__mordsfall.solve());
    await p2.waitForSelector(".mf-win");
    h.eq(await p2.evaluate(() => window.__mordsfall.state().status), "won", "test mode can still be played to the end");
    const keys = await p2.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("pb_save_mordsfall") || k.startsWith("pb_best_mordsfall")));
    h.eq(keys, [], "test mode writes no pb_save_/pb_best_ key");
    await ctx2.close();
  },
};

runIfMain(import.meta.url, flow);
