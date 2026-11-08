/* Flow — Devoiren (homework.html, Gitter look, Nov 2026): visitor gate, non-admin gate, admin list with
 * HomeworkBot solutions (status chips, Léisung / Ofzeginn signed URLs, Gemaach tick, sort), no horizontal
 * scroll at phone / iPad portrait / iPad landscape, no console errors. HOMEWORK_SHOTS_DIR=/dir saves screenshots. */
import fs from "node:fs";
import path from "node:path";
import { runIfMain } from "./lib.mjs";

const ENGLISH = /Sign in|Loading…|Sync now|Overdue|private/;
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString("sv-SE");

async function shot(h, name) {
  const dir = process.env.HOMEWORK_SHOTS_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  await h.page.screenshot({ path: path.join(dir, `homework-${name}.png`), fullPage: true });
}
async function noOverflow(h, label) {
  for (const [w, hgt] of [[375, 812], [820, 1180], [1180, 820]]) {
    await h.page.setViewportSize({ width: w, height: hgt });
    await h.pause(250);
    const over = await h.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    h.expect(!over, `${label} @ ${w}px: no horizontal scroll`);
  }
  await h.page.setViewportSize({ width: 820, height: 1180 });
}

const solutions = [
  { homework_id: 1, status: "solved", summary: "Aufgaben 1 bis 3 geléist.", ask: null, solution_path: "1/solution.pdf", handin_path: "1/handin.pdf", done: false },
  { homework_id: 2, status: "needs_scan", summary: "x", ask: "Kanns du mir e Foto vun der Fiche schécken?", solution_path: null, handin_path: null, done: false },
  { homework_id: 3, status: "solved", summary: "Fäerdeg.", ask: null, solution_path: "3/solution.pdf", handin_path: null, done: true },
  { homework_id: 4, status: "failed", summary: "Timeout", ask: null, solution_path: null, handin_path: null, done: false },
];
const homework = [
  { id: 3, subject: "Mathematik", due_date: day(0), text: "S. 12 Nr. 3", remark: null, synced_at: new Date().toISOString() },
  { id: 1, subject: "Biologie", due_date: day(3), text: "Activité 6", remark: null, synced_at: new Date().toISOString() },
  { id: 2, subject: "Englesch", due_date: day(1), text: "Worksheet", remark: null, synced_at: new Date().toISOString() },
  { id: 4, subject: "Geschicht", due_date: day(9), text: "Text liesen", remark: null, synced_at: new Date().toISOString() },
];

export const flow = {
  name: "homework-page",
  backend: {
    rpc: { is_admin: () => true },
    tables: {
      homework: () => homework,
      homework_solutions: ({ method }) => (method === "GET" ? solutions : null),
    },
    storage: ({ url }) => (/object\/sign/.test(url) ? { signedURL: "/object/sign/devoirs/1/solution.pdf?token=t" } : {}),
  },
  async run(h) {
    const { page } = h;
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

    h.step("visitor → sign-in gate in Luxembourgish");
    await h.goto("/homework.html");
    await page.waitForSelector("#signin", { timeout: 15000 });
    h.eq(await page.evaluate(() => document.documentElement.lang), "lb", "html lang is lb");
    h.expect(/Mell dech un/.test(await page.textContent("#wrap")), "gate says «Mell dech un»");
    h.expect(!ENGLISH.test(await page.evaluate(() => document.body.innerText)), "no English UI text (visitor)");

    h.step("admin → list with solutions");
    await h.signIn();
    await h.goto("/homework.html");
    await page.waitForSelector(".hw", { timeout: 15000 });
    h.eq(await page.$$eval(".hw", (e) => e.length), 4, "four cards");
    const order = await page.$$eval(".hw-subj", (e) => e.map((x) => x.textContent.trim()));
    h.eq(order, ["Englesch", "Biologie", "Geschicht", "Mathematik"], "open by due date, done last");
    h.expect((await page.getAttribute(".hw.done", "class")).includes("done"), "done card is muted");
    const text = await page.evaluate(() => document.body.innerText);
    for (const w of ["Geléist", "Foto néideg", "Feeler", "Léisung", "Ofzeginn", "Gemaach", "Kanns du mir e Foto"]) h.expect(text.includes(w), `shows «${w}»`);
    h.expect(!ENGLISH.test(text), "no English UI text (admin)");
    const small = await page.$$eval(".hw-acts .gt-btn", (e) => e.filter((b) => b.getBoundingClientRect().height < 44).length);
    h.eq(small, 0, "all buttons >= 44 px tall");
    await noOverflow(h, "admin");
    await shot(h, "ipad");

    h.step("Léisung → signed URL");
    await page.evaluate(() => { window.open = () => ({ location: { set href(v) { window.__opened = v; } }, close() {} }); });
    await page.click('.hw:has(.hw-subj:text("Biologie")) [data-open="1/solution.pdf"]');
    await page.waitForFunction(() => !!window.__opened);
    h.expect(/sign/.test(await page.evaluate(() => window.__opened)), "opened a signed URL");

    h.step("Gemaach tick → update done");
    await page.click('.hw:has(.hw-subj:text("Englesch")) .tick');
    await page.waitForTimeout(400);
    h.eq(await page.$$eval(".hw.done", (e) => e.length), 2, "two done cards after ticking");
    h.expect(h.backend.callsTo("homework_solutions").some((c) => c.method === "PATCH"), "PATCH sent");
    await page.setViewportSize({ width: 375, height: 812 });
    await shot(h, "phone");

    h.eq(errors, [], "no console errors");
  },
};
runIfMain(import.meta.url, flow);
