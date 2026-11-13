/* Flow — Adventskalenner (advent.html): a guest joins by name, sees the 24-door grid, opens door 1 (text), answers wrong then right,
 * sees the solved state and the Klassement; the map door must submit the Stad dot as ≈ lat 49.61 / lon 6.13;
 * every door kind (text, number, choice, order, map, wordsearch, cipher, slider, sudoku, lock) renders from DUMMY content
 * and takes its answer without page errors. A second flow checks that a signed-in ian.lu user joins automatically.
 * ALL puzzles below are dummies — the real ones live only in the database. */
import { runIfMain } from "./lib.mjs";

const NOW = "2026-12-12T09:00:00Z";          // doors 1..12 are open, 13..24 locked
const OPEN_DAYS = 12;
const GUEST_TOKEN = "tok-dummy-0001";
const PIC_URL = "https://img.example.test/pic.svg";
const PIC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="#7a9"/><circle cx="150" cy="150" r="90" fill="#c44"/></svg>`;

export const DUMMY = {
  1: { kind: "text", content: { title: "Test-Rätsel", intro: "Zeil eent\nZeil zwee", question: "Wat ass dummy?", hint: "Et fänkt mat d un" } },
  2: { kind: "map", content: { title: "Test-Kaart", question: "Wou ass d'Stad?" } },
  3: { kind: "number", content: { title: "Test-Zuel", question: "Wéi vill?", unit: "m" } },
  4: { kind: "choice", content: { title: "Test-Choix", question: "Wat?", options: [{ id: "a", label: "Optioun A" }, { id: "b", label: "Optioun B" }] } },
  5: { kind: "order", content: { title: "Test-Rei", question: "Sortéier", order_hint: "Eelst uewen", items: [{ id: "x", label: "Eent" }, { id: "y", label: "Zwee" }, { id: "z", label: "Dräi" }] } },
  6: { kind: "wordsearch", content: { title: "Test-Sich", question: "Fann d'Wierder", words: ["KAT", "HAUS"], grid: ["KATXYZ", "QWERTË", "HAUSJK", "LMNOPQ", "RSTUVW", "ABCDEF"] } },
  7: { kind: "cipher", content: { title: "Test-Chiffer", question: "Entschlësselt", cipher: "KHOOR ZRUOG" } },
  8: { kind: "slider", content: { title: "Test-Puzzel", question: "Wat gesäis du?", size: 3, image: { url: PIC_URL, credit: "Dummy Foto", link: "https://example.test/credit" } } },
  9: { kind: "sudoku", content: { title: "Test-Sudoku", question: "Rei ausfëllen", size: 6, box: [2, 3], star_row: 0, grid: ["1.....", "4.....", "..5...", "...6..", "....1.", ".....2"] } },
  11: { kind: "mystery", content: { title: "Test-Onbekannt", question: "Eppes?" } },
  10: { kind: "lock", content: { title: "Test-Schlass", question: "Code?", digits: 3, clues: [{ code: "682", text: "Eng Zuel ass richteg an op der richteger Plaz" }] } },
};

/* mock database of the player: shared by the RPC handlers, reset per run */
export function createMock({ admin = false } = {}) {
  const s = { me: null, solved: new Map(), opened: new Set(), wrongOn1: 0, checks: [] };
  const doors = () => Array.from({ length: 24 }, (_, i) => {
    const day = i + 1;
    return { day, open_at: `2026-12-${String(day).padStart(2, "0")}T00:00:00+01:00`, open: day <= OPEN_DAYS, opened: s.opened.has(day), solved: s.solved.has(day), time_s: s.solved.get(day) ?? null };
  });
  const rpc = {
    advent_overview: () => ({ now: NOW, me: s.me, admin, doors: doors() }),
    advent_join: ({ p_name }) => {
      if (p_name === null) { s.me = { name: "tester", account: true }; return { name: "tester", account: true }; }
      if (p_name === "Taken") return { error: { message: "advent: name taken" } };
      s.me = { name: p_name, account: false };
      return { name: p_name, token: GUEST_TOKEN, account: false };
    },
    advent_door: ({ p_day }) => {
      const d = DUMMY[p_day];
      if (!d) return { error: { message: "advent: bad day" } };
      s.opened.add(p_day);
      const solved = s.solved.has(p_day);
      return { day: p_day, kind: d.kind, content: d.content, preview: false, solved, wrong: 0, time_s: solved ? s.solved.get(p_day) : null, reveal: solved ? "Dummy-Erklärung" : null };
    },
    advent_check: ({ p_day, p_given }) => {
      s.checks.push({ day: p_day, given: p_given });
      if (p_day === 1 && p_given.text !== "dummy") { s.wrongOn1 += 1; return { correct: false, wrong: s.wrongOn1, penalty_s: 60 }; }
      s.solved.set(p_day, 83);
      return { correct: true, wrong: 0, time_s: 83, reveal: "Dummy-Erklärung", penalty_s: 0 };
    },
    advent_board: () => ({
      overall: [{ name: "Emma", account: true, doors: 5, total_s: 400 }, { name: s.me?.name || "x", account: false, doors: 1, total_s: 83 }],
      days: { "1": [{ name: "Emma", account: true, time_s: 41 }, { name: s.me?.name || "x", account: false, time_s: 83 }] },
    }),
  };
  return { s, rpc };
}

export async function routePicture(context) {
  await context.route(PIC_URL, (route) => route.fulfill({ status: 200, contentType: "image/svg+xml", body: PIC_SVG }));
}

const watchConsole = (h) => h.page.on("console", (msg) => {
  // network failures (CDN, analytics) are not the page's fault, see HANDOFF "site_test"
  if (msg.type() === "error" && !/Failed to load resource|net::ERR/i.test(msg.text())) h.failures.push(`console.error: ${msg.text()}`);
});

const toastText = (h) => h.page.textContent("#advToast");

async function openDoor(h, day, selector) {
  await h.page.click(`.adv-door[data-day="${day}"]`);
  await h.page.waitForSelector(`#advDoor ${selector}`, { timeout: 8000 });
}

async function answerAndClose(h, day) {
  await h.page.click("#advDoor .adv-submit");
  await h.page.waitForSelector("#advDoor .adv-solved");
  h.expect((await h.page.textContent("#advDoor .adv-solved")).includes("Richteg!"), `door ${day}: solved view`);
  await h.page.click("#advDoor .adv-solved .gt-btn");
  await h.page.waitForSelector("#advDoor", { state: "hidden" });
}

export const flow = {
  name: "advent",
  async run(h) {
    const { page } = h;
    const mock = createMock();
    Object.assign(h.backend.rpc, mock.rpc);
    watchConsole(h);
    await routePicture(h.context);

    h.step("open the page as a stranger: intro + 24 locked-looking doors");
    await h.goto("/advent.html");
    await page.waitForSelector(".adv-door");
    h.eq(await page.locator(".adv-door").count(), 24, "24 doors");
    h.expect(await page.isVisible("#advIntro"), "intro is shown before joining");
    h.eq((await page.locator('.adv-door[data-day="20"] .adv-door-state').textContent()).trim(), "20. Dez", "a locked door shows its date");
    h.eq(await page.locator(".adv-door").evaluateAll((nodes) => nodes.map((n) => Number(n.dataset.day)).slice().sort((a, b) => a - b).join(",")), Array.from({ length: 24 }, (_, i) => i + 1).join(","), "the shuffled grid holds each door exactly once");
    await h.shot("intro");
    await page.click('.adv-door[data-day="1"]');
    h.expect((await toastText(h)).includes("mat"), "tapping a door before joining asks to join first");

    h.step("a bad name is refused, a good one joins");
    await page.fill("#joinName", "x");
    await page.click("#joinBtn");
    h.expect((await page.textContent("#joinErr")).includes("Numm"), "too short name -> friendly error, no request");
    h.eq(h.backend.callsTo("advent_join").length, 0, "no join request for an invalid name");
    await page.fill("#joinName", "Test Gast");
    await page.click("#joinBtn");
    await page.waitForSelector("#advMe:not([hidden])");
    h.eq((await page.textContent("#advName")).trim(), "Test Gast", "header shows the name");
    h.eq((await page.textContent("#advSolved")).trim(), "0/24", "0/24 solved");
    h.expect((await page.textContent("#advCountdown")).startsWith("Dier 13 geet op an"), "countdown to the next door");
    h.eq(await page.evaluate(() => localStorage.getItem("advent_token")), GUEST_TOKEN, "the guest token is stored");
    h.eq(h.backend.callsTo("advent_overview").at(-1).body.p_token, GUEST_TOKEN, "later calls send the token");
    h.eq(h.backend.callsTo("advent_overview")[0].body.p_token, null, "the first call has no token");
    await h.shot("joined");

    h.step("a locked door only toasts");
    await page.click('.adv-door[data-day="20"]');
    h.expect((await toastText(h)).includes("Geet den 20. Dezember op"), "locked door -> toast with its date");
    h.eq(await page.isVisible("#advDoor"), false, "no door sheet for a locked door");

    h.step("door 1: wrong answer, then right answer");
    await openDoor(h, 1, ".adv-input");
    h.expect(page.url().endsWith("advent.html?d=1"), "URL is ?d=1");
    h.expect((await page.textContent("#advDoor .adv-text")).includes("Zeil eent"), "intro text rendered");
    await page.click("#advDoor .adv-hint-btn");
    h.expect(await page.isVisible("#advDoor .adv-hint"), "the Tipp button shows the hint");
    h.eq(await page.isDisabled("#advDoor .adv-submit"), true, "submit is off while the field is empty");
    await page.fill("#advDoor .adv-input", "falsch");
    await page.click("#advDoor .adv-submit");
    await page.waitForFunction(() => document.querySelector("#advDoor .adv-feedback")?.textContent.includes("falsch"));
    h.eq((await page.textContent("#advDoor .adv-feedback")).trim(), "Leider falsch – +1 Minutt", "wrong answer feedback");
    await h.shot("wrong");
    await page.fill("#advDoor .adv-input", "dummy");
    await answerAndClose(h, 1);
    h.eq(h.backend.callsTo("advent_check").at(-1).body.p_given, { text: "dummy" }, "the answer was sent as {text}");
    await page.waitForFunction(() => document.querySelector('.adv-door[data-day="1"]').classList.contains("solved"));
    h.eq((await page.locator('.adv-door[data-day="1"] .adv-door-state').textContent()).trim(), "✓ 1:23", "door 1 shows ✓ and its time");
    h.eq((await page.textContent("#advSolved")).trim(), "1/24", "1/24 solved");
    h.expect(!page.url().includes("d=1"), "closing the door removes ?d=");

    h.step("a solved door opens read-only");
    await page.click('.adv-door[data-day="1"]');
    await page.waitForSelector("#advDoor .adv-solved");
    h.eq(await page.locator("#advDoor .adv-input").count(), 0, "no input on a solved door");
    h.expect((await page.textContent("#advDoor .adv-solved")).includes("Dummy-Erklärung"), "the reveal text is shown");
    await page.click("#advDoor .adv-solved .gt-btn");

    h.step("Klassement: Meeschte Dieren + Séierst pro Dag");
    await page.click("#advBoardBtn");
    await page.waitForSelector("#advBoard .adv-table");
    h.expect((await page.textContent("#advBoard .adv-table")).includes("Emma"), "overall table lists players");
    h.expect(await page.isVisible("#advBoard .adv-badge"), "account players carry the ian.lu badge");
    h.eq(await page.locator("#advBoard tr.me").count(), 1, "my row is highlighted");
    await page.click("#advBoard .adv-tab:nth-child(2)");
    await page.waitForSelector("#advBoard .adv-days");
    h.eq(await page.locator("#advBoard .adv-daybtn").count(), OPEN_DAYS, "the day picker has one button per open day");
    await page.click('#advBoard .adv-daybtn:text-is("1")');
    h.expect((await page.textContent("#advBoard .adv-table")).includes("0:41"), "day table shows m:ss times");
    await h.shot("board");
    await page.click("#advBoard .adv-back");

    h.step("menu: the guest code + share");
    await page.click("#advMenuBtn");
    await page.waitForSelector("#advMenu .adv-code");
    h.eq(await page.inputValue("#advMenu .adv-code"), GUEST_TOKEN, "the menu shows the code");
    await page.click("#advMenu .adv-back");

    h.step("map door: tapping the Stad dot submits ≈ 49.61 / 6.13");
    await openDoor(h, 2, ".adv-map-svg");
    h.eq(await page.isDisabled("#advDoor .adv-submit"), true, "no pin yet -> submit off");
    const box = await page.locator('#advDoor [data-ref="Lëtzebuerg-Stad"]').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    h.eq(await page.locator("#advDoor .adv-map-label").allTextContents().then((t) => t.slice().sort()), ["Esch-Uelzecht", "Ettelbréck", "Lëtzebuerg-Stad"], "only the three reference towns are labelled");
    h.eq((await page.textContent("#advDoor .adv-submit")).trim(), "Hei!", "map submit button says Hei!");
    await h.shot("map");
    await page.click("#advDoor .adv-submit");
    await page.waitForSelector("#advDoor .adv-solved");
    const given = h.backend.callsTo("advent_check").at(-1).body.p_given;
    h.expect(Math.abs(given.lat - 49.61) < 0.05 && Math.abs(given.lon - 6.13) < 0.05, `Stad tap -> lat ${given.lat}, lon ${given.lon}`);
    h.expect(typeof given.lat === "number" && typeof given.lon === "number", "lat/lon are numbers");
    await page.click("#advDoor .adv-solved .gt-btn");

    h.step("number door");
    await openDoor(h, 3, ".adv-number");
    h.expect((await page.textContent("#advDoor .adv-unit")).trim() === "m", "unit label");
    await page.fill("#advDoor .adv-input", "560");
    await answerAndClose(h, 3);
    h.eq(h.backend.callsTo("advent_check").at(-1).body.p_given, { n: "560" }, "number answer {n}");

    h.step("choice door");
    await openDoor(h, 4, ".adv-choice");
    h.eq(await page.isDisabled("#advDoor .adv-submit"), true, "choice: nothing picked -> submit off");
    await page.click('#advDoor .adv-choice:text-is("Optioun B")');
    await answerAndClose(h, 4);
    h.eq(h.backend.callsTo("advent_check").at(-1).body.p_given, { choice: "b" }, "choice answer {choice}");

    h.step("order door");
    await openDoor(h, 5, ".adv-order");
    h.expect((await page.textContent("#advDoor .adv-order-hint")).includes("Eelst uewen"), "order hint");
    await page.click('#advDoor [data-focus="x:down"]');
    await answerAndClose(h, 5);
    h.eq(h.backend.callsTo("advent_check").at(-1).body.p_given, { order: ["y", "x", "z"] }, "order answer {order}");

    h.step("wordsearch door: tap first + last letter, spare letters appear");
    await openDoor(h, 6, ".adv-ws");
    await page.click('#advDoor .adv-ws-cell[data-i="0"]');
    await page.click('#advDoor .adv-ws-cell[data-i="2"]');
    h.eq(await page.locator("#advDoor .adv-ws-cell.found").count(), 3, "KAT found (3 cells)");
    await page.click('#advDoor .adv-ws-cell[data-i="15"]');   // HAUS read backwards: S ... H
    await page.click('#advDoor .adv-ws-cell[data-i="12"]');
    h.eq(await page.locator("#advDoor .adv-words .done").count(), 2, "both words struck through");
    h.expect(await page.isVisible("#advDoor .adv-strip"), "unused letters strip shown");
    h.eq((await page.textContent("#advDoor .adv-strip")).replace(/\s/g, "").length, 36 - 7, "strip holds the 29 unused letters");
    await page.reload();
    await page.waitForSelector("#advDoor .adv-ws");
    h.eq(await page.locator("#advDoor .adv-ws-cell.found").count(), 7, "found words survive a reload (sessionStorage)");
    await page.fill("#advDoor .adv-input", "losung");
    await answerAndClose(h, 6);

    h.step("cipher door: wheel + live preview");
    await openDoor(h, 7, ".adv-wheel-svg");
    await page.fill("#advDoor .adv-range", "3");
    h.eq((await page.textContent("#advDoor .adv-decoded")).trim(), "HELLO WORLD", "shift 3 decodes the dummy cipher");
    await page.click('#advDoor .adv-step[aria-label="Ee Schrëtt viir"]');
    h.eq((await page.textContent("#advDoor .adv-shift")).trim(), "4", "the stepper moves the shift");
    await page.fill("#advDoor .adv-input", "hello world");
    await answerAndClose(h, 7);

    h.step("slider door: starts shuffled, moves, solvable by construction");
    await openDoor(h, 8, ".adv-slider-tile");
    h.eq(await page.locator("#advDoor .adv-slider-tile").count(), 8, "8 tiles + 1 blank");
    h.eq(await page.locator("#advDoor .adv-figure").count(), 0, "the photo is not shown as a normal image (it would spoil the puzzle)");
    const solvable = await page.evaluate(async () => {
      const { shuffledTiles, isSolvedTiles, slideTiles } = await import("/advent-games.js?v=1");
      let ok = true;
      for (const n of [2, 3, 4, 5]) for (let run = 0; run < 60; run++) {
        const tiles = shuffledTiles(n);
        const flat = tiles.filter(Boolean);
        const inversions = flat.reduce((sum, v, i) => sum + flat.slice(i + 1).filter((w) => w < v).length, 0);
        const blankRow = Math.floor(tiles.indexOf(0) / n);
        const solvableBoard = n % 2 ? inversions % 2 === 0 : (inversions + (n - blankRow)) % 2 === 1;
        if (isSolvedTiles(tiles) || !solvableBoard) ok = false;
      }
      return ok && slideTiles([1, 2, 3, 4, 5, 6, 7, 8, 0], 3, 5)?.join("") === "123450786" && slideTiles([1, 2, 3, 4, 5, 6, 7, 8, 0], 3, 0) === null;
    });
    h.expect(solvable, "shuffles are solvable, never already solved; slide logic is right");
    // slide the first tile that touches the blank
    const adjacent = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll("#advDoor .adv-slider > *")];
      const blank = tiles.findIndex((t) => t.classList.contains("adv-slider-blank"));
      return [blank - 3, blank + 3, blank % 3 ? blank - 1 : -1, (blank + 1) % 3 ? blank + 1 : -1].find((i) => i >= 0 && i < 9);
    });
    await page.locator("#advDoor .adv-slider > *").nth(adjacent).click();
    h.eq((await page.textContent("#advDoor .adv-slider-wrap .adv-small")).trim(), "1 Zich", "a move is counted");
    h.expect((await page.textContent("#advDoor .adv-credit")).includes("Dummy Foto"), "photo credit shown");
    for (const index of solveSlider(await readBoard(page))) await page.locator("#advDoor .adv-slider > *").nth(index).click();
    await page.waitForSelector("#advDoor .adv-slider-full");
    h.expect(await page.isVisible("#advDoor img.adv-slider-full"), "solved -> the full photo is shown");
    await page.fill("#advDoor .adv-input", "kreesch");
    await answerAndClose(h, 8);

    h.step("sudoku door: conflicts are marked, the star row is submitted");
    await openDoor(h, 9, ".adv-sudoku");
    h.eq(await page.locator("#advDoor .adv-cell.given").count(), 6, "6 givens");
    await page.click('#advDoor .adv-cell.given');
    await page.click('#advDoor .adv-pad-key:text-is("5")');
    h.eq(await page.locator("#advDoor .adv-cell.bad").count(), 0, "a given cell cannot be changed");
    await page.locator("#advDoor .adv-cell").nth(1).click();
    await page.click('#advDoor .adv-pad-key:text-is("1")');
    h.eq(await page.locator("#advDoor .adv-cell.bad").count(), 2, "1 twice in the row -> both cells marked");
    await page.click('#advDoor .adv-pad-key:text-is("2")');
    h.eq(await page.locator("#advDoor .adv-cell.bad").count(), 0, "conflict gone after changing the digit");
    h.eq(await page.isDisabled("#advDoor .adv-submit"), true, "star row not full -> submit off");
    h.eq((await page.textContent("#advDoor .adv-submit")).trim(), "Rei ofginn", "sudoku submit says Rei ofginn");
    for (const [cell, digit] of [[2, "3"], [3, "4"], [4, "5"], [5, "6"]]) {
      await page.locator("#advDoor .adv-cell").nth(cell).click();
      await page.click(`#advDoor .adv-pad-key:text-is("${digit}")`);
    }
    await answerAndClose(h, 9);
    h.eq(h.backend.callsTo("advent_check").at(-1).body.p_given, { text: "123456" }, "sudoku answer = the star row joined");

    h.step("lock door: wheels");
    await openDoor(h, 10, ".adv-wheels");
    h.expect((await page.textContent("#advDoor .adv-clues")).includes("682"), "clue list shown");
    const wheelBtn = (wheel, dir) => `#advDoor .adv-wheel:nth-child(${wheel}) .adv-wheel-btn:${dir}`;
    await page.click(wheelBtn(1, "first-child")); await page.click(wheelBtn(1, "first-child"));
    await page.click(wheelBtn(2, "first-child"));
    await page.click(wheelBtn(3, "last-child"));
    await answerAndClose(h, 10);
    h.eq(h.backend.callsTo("advent_check").at(-1).body.p_given, { text: "219" }, "lock answer = digits as a string (▼ on 0 wraps to 9)");

    h.step("an unknown kind falls back to a text answer");
    await openDoor(h, 11, ".adv-input");
    await page.fill("#advDoor .adv-input", "egal");
    await answerAndClose(h, 11);

    h.step("reloading ?d=7 reopens that door (solved, read-only)");
    await h.goto("/advent.html?d=7");
    await page.waitForSelector("#advDoor .adv-solved");
    h.expect(page.url().endsWith("?d=7"), "URL kept");
    await page.goBack();
    await page.waitForSelector("#advDoor", { state: "hidden" }).catch(() => {});
    await h.shot("end");
  },
};

/* ---- slider helpers: read the board from the page and solve it (BFS), so the solved state can be tested ---- */
const readBoard = (page) => page.evaluate(() => [...document.querySelectorAll("#advDoor .adv-slider > *")]
  .map((node) => (node.classList.contains("adv-slider-blank") ? 0 : Number(node.textContent))));

/* returns the list of grid indexes to click, in order */
function solveSlider(tiles, n = 3) {
  const goal = [...Array(n * n - 1).keys()].map((i) => i + 1).concat(0).join(",");
  const startKey = tiles.join(",");
  const parents = new Map([[startKey, null]]);
  const queue = [tiles];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    const key = current.join(",");
    if (key === goal) break;
    const blank = current.indexOf(0);
    for (const next of [blank - n, blank + n, blank % n ? blank - 1 : -1, (blank + 1) % n ? blank + 1 : -1]) {
      if (next < 0 || next >= current.length) continue;
      const moved = [...current];
      [moved[blank], moved[next]] = [moved[next], moved[blank]];
      const movedKey = moved.join(",");
      if (parents.has(movedKey)) continue;
      parents.set(movedKey, { from: key, click: next });
      queue.push(moved);
    }
  }
  const clicks = [];
  for (let key = goal, step = parents.get(key); step; key = step.from, step = parents.get(key)) clicks.unshift(step.click);
  return clicks;
}

/* ---- second flow: a signed-in ian.lu user joins by itself ---- */
export const flowAccount = {
  name: "advent-account",
  async run(h) {
    const { page } = h;
    const mock = createMock();
    Object.assign(h.backend.rpc, mock.rpc);
    watchConsole(h);
    await h.signIn();
    h.step("signed in, no player yet -> advent_join is called with p_name null, no intro");
    await h.goto("/advent.html");
    await page.waitForSelector("#advMe:not([hidden])");
    h.eq(h.backend.callsTo("advent_join")[0].body, { p_name: null }, "auto-join without a name");
    h.expect(!(await page.isVisible("#advIntro")), "the intro stays hidden");
    h.eq((await page.textContent("#advName")).trim(), "tester", "header shows the username");
    h.expect(await page.isVisible("#advAccount"), "ian.lu badge in the header");
    await h.shot("account");
  },
};

runIfMain(import.meta.url, flow);
