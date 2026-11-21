/* Look-sheet steps for the game modes (a --script for shot.mjs, opened on the piste map with ?map=1&debug=1):
 *   stars   the piste map with a seeded, half-played save (stars, locks)
 *   park    the snow park: the drop-in, a kicker from the side, the rails / boxes, the halfpipe */
export default async function steps(page, { shoot, wait }) {
  // a save with stars on the first pistes: written, then the page is loaded again so the map reads it
  await page.evaluate(async () => {
    const { starKey } = await import("/pb/ski/modes/challenges.js");
    const S = window.__ski, rid = new URL(location.href).searchParams.get("resort") || "killy";
    const save = { v: S.progress().v, best: {}, ghosts: {}, runs: {}, stars: {}, park: { [rid]: 18450 }, bestHash: {}, last: { resort: rid, piste: null }, ghostOrder: [] };
    S.pistes.list.filter((p) => p.diff === "green" || p.diff === "blue").slice(0, 16).forEach((p, i) => { save.stars[starKey(rid, p.id)] = [7, 3, 1, 3, 7, 1][i % 6]; });
    localStorage.setItem("pb_ski_save", JSON.stringify(save));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.dataset.skiScreen === "map", null, { timeout: 90000 });
  await page.waitForTimeout(wait);
  await shoot("stars");
  await page.click('.modetabs [data-mode="park"]');
  await page.waitForSelector("#parkStart");
  await page.waitForFunction(() => document.documentElement.dataset.skiParkReady === "1", null, { timeout: 60000 });
  await page.click("#parkStart");
  await page.waitForFunction(() => window.__ski.game.phase === "running", null, { timeout: 20000 });
  const L = await page.evaluate(() => { const l = window.__ski.parkLayout; return { len: l.len, kickers: l.kickers.map((k) => ({ lip: k.lip, v: k.v })), rails: l.rails.map((r) => ({ s0: r.s0, v: r.v })), pipe: l.pipe ? { s0: l.pipe.s0, s1: l.pipe.s1 } : null }; });
  const hold = () => page.evaluate(() => { const s = window.__ski; s.game.bot = null; s.setInput({ steer: 0, tuck: 0, brake: 1, push: 0, jump: false }); });
  const view = async (name, s, angle, dist, h, fov) => {
    await page.evaluate(([a, b, c, d, e]) => { const S = window.__ski; S.orbit(null); S.teleport(a); if (b !== null) S.orbit(b, c, d, e); }, [s, angle, dist, h, fov]);
    await hold();
    await page.waitForTimeout(wait);
    await shoot(name);
  };
  await view("park", 4, null);                                                  // the drop-in, chase camera
  const big = L.kickers[L.kickers.length - 1];
  if (big) await view("park-kicker", Math.max(2, big.lip - 16), 205, 13, 3.4, 50);    // the biggest kicker from behind and beside
  if (L.rails[0]) await view("park-rails", Math.max(2, L.rails[0].s0 - 10), 200, 9, 2.6, 52);
  if (L.pipe) await view("park-pipe", L.pipe.s0 + 6, 180, 10, 4.5, 58);
}
