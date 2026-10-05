/* Flow 4 — Stadt-Land-Fluss: play a round against a mocked second player.
 * A single-letter answer ("D" for letter D) must score 0; real words score 10, or 5 when both players wrote the same. */
import { ME_NAME, runIfMain } from "./lib.mjs";

const PEER = { key: "peer0001", name: "Emma" };
let letter = "";

export const flow = {
  name: "slf-round",
  realtime: {
    presence: (topic) => (topic.includes("slf:") ? { [PEER.key]: { name: PEER.name, role: "guest" } } : {}),
    onBroadcast: ({ event, payload, send }) => {
      if (event === "start") letter = payload.letter;
      if (event === "stop") {
        const ans = payload && letter ? [letter, `${letter}ana`, "", "", "", ""] : [];
        send("answers", { cid: PEER.key, name: PEER.name, ans });
      }
    },
  },
  async run(h) {
    const { page } = h;
    letter = "";
    await h.signIn();
    // Wikidata says yes to everything, so the only thing that can zero an answer is the one-letter rule.
    await h.context.route("https://query.wikidata.org/**", (route) => route.fulfill({
      status: route.request().method() === "OPTIONS" ? 204 : 200, contentType: "application/sparql-results+json",
      headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
      body: JSON.stringify({ head: { vars: ["item"] }, results: { bindings: [{ item: { type: "uri", value: "http://www.wikidata.org/entity/Q1" } }] } }),
    }));

    h.step("open Stadt-Land-Fluss as host (mocked room with a second player)");
    await h.goto("/slf.html?room=flowtest&role=host");
    await page.waitForSelector("#startBtn:not([disabled])");
    const lobby = await page.textContent("#app");
    h.expect(lobby.includes(PEER.name) && lobby.includes(ME_NAME), "lobby shows both players");
    await h.shot("lobby");
    await h.pause();

    h.step("start round 1");
    await page.click("#startBtn");
    await page.waitForSelector("#c0");
    const shownLetter = (await page.textContent(".letter")).trim();
    h.expect(/^[A-Z]$/.test(shownLetter), `a letter is drawn (${shownLetter})`);
    await h.pause(300);
    h.eq(shownLetter, letter, "the room got the same letter");

    h.step("Stadt: just the letter · Land: a real word, same as Emma · Fluss: a real word only I wrote");
    await page.fill("#c0", shownLetter);
    await h.pause(400);
    await page.fill("#c1", `${shownLetter}ana`);
    await h.pause(400);
    await page.fill("#c2", `${shownLetter}ivr`);
    await h.shot("play");
    await h.pause();

    h.step("Stop! → reveal");
    await page.click("#stopBtn");
    await page.waitForSelector("#nextBtn", { timeout: 15000 });
    await h.pause(1000);

    const table = await page.$$eval(".wrap table, #app table", (tables) => tables.map((t) => [...t.rows].map((r) => [...r.cells].map((c) => c.textContent.trim()))));
    const round = table.find((t) => t[0]?.[0] === "Category" || /Kategorie|Category|Catégorie/i.test(t[0]?.[0] || "")) || table[0];
    const header = round[0];
    const mine = header.indexOf(ME_NAME);
    h.expect(mine > 0, `results table has a column for ${ME_NAME}`);
    const cell = (row) => round[row]?.[mine] || "";
    h.expect(!/\+\d/.test(cell(1)), `single letter «${shownLetter}» scores nothing (cell: «${cell(1)}»)`);
    h.expect(/\+5\b/.test(cell(2)), `same word as Emma scores 5 (cell: «${cell(2)}»)`);
    h.expect(/\+10\b/.test(cell(3)), `unique word scores 10 (cell: «${cell(3)}»)`);

    const totals = await page.$$eval(".tot tr", (rows) => rows.map((r) => [...r.cells].map((c) => c.textContent.replace("👤", "").trim())));
    const total = (name) => Number((totals.find((r) => r[0].startsWith(name)) || [])[1]);
    h.eq(total(ME_NAME), 15, "my total is 15 (0 + 5 + 10)");
    h.eq(total(PEER.name), 5, "Emma's total is 5 (her single letter scored 0, her word is shared)");
    await h.shot("results");
  },
};

runIfMain(import.meta.url, flow);
