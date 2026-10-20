#!/usr/bin/env node
/* Business Empire prestige simulator (20 Oct 2026). Offline tool, not part of the site.
 *
 *   node scripts/be-prestige-sim.mjs            # all three tables
 *   node scripts/be-prestige-sim.mjs times      # only time-to-tier
 *
 * It reads the real BUSINESSES table and the real prestige soft-cap function out of pb/idle-empire.html, so the numbers
 * cannot drift from the game. One prestige round starts from a reset ($10, nothing owned) at a fixed total prestige
 * multiplier. Policy: greedy "time to pay back" (wait for the money + payback of the purchase) with a look-ahead to the next
 * milestone; a new long business is bought together with its manager; short businesses (cycle <= 60 s) are run by hand at
 * 50 % uptime until a manager exists. The output is the time until the FIRST UNIT of each tier is bought. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const html = fs.readFileSync(process.env.EMPIRE || path.join(path.dirname(fileURLToPath(import.meta.url)), "../pb/idle-empire.html"), "utf8");
const BUSINESSES = new Function(`return ${html.match(/const BUSINESSES=Object\.freeze\((\[[\s\S]*?\n\])\);/)[1]}`)();
const INVESTOR_BONUS = Number(html.match(/const INVESTOR_BONUS=([\d.]+);/)[1]);
const PRESTIGE_SOFT_CAP = Number(html.match(/const PRESTIGE_SOFT_CAP=([\de.+]+);/)[1]);
const REBIRTH_THRESHOLD = 100e9;
const IdleExtras = { starBonus: 0.1 };
const block = html.match(/\/\* PRESTIGE-SOFTCAP-START[^*]*\*\/([\s\S]*?)\/\* PRESTIGE-SOFTCAP-END \*\//)[1];
const { rawPrestigeMultiplier, prestigeMultiplier } = new Function("INVESTOR_BONUS", "PRESTIGE_SOFT_CAP", "IdleExtras", `${block}; return { rawPrestigeMultiplier, prestigeMultiplier };`)(INVESTOR_BONUS, PRESTIGE_SOFT_CAP, IdleExtras);

const MILESTONES = [25, 50, 100, 200];
const PROFIT_MILESTONES = [300, 400, 500, 600, 750, 900, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000];
const speedMult = (n) => 2 ** MILESTONES.filter((m) => n >= m).length;
const profitMult = (n) => 2 ** (MILESTONES.filter((m) => n >= m).length + PROFIT_MILESTONES.filter((m) => n >= m).length);
const cost = (b, n) => b.baseCost * Math.pow(b.costGrowth, n);
const cycle = (b, n) => b.cycleSeconds / speedMult(n);
const payout = (b, n) => b.payout * n * profitMult(n);
const nextMilestone = (n) => [...MILESTONES, ...PROFIT_MILESTONES].find((m) => m > n);

export function simulate(M, { maxSeconds = 3.2e9, targetTier = BUSINESSES.length - 1, trace = false } = {}) {
  const n = BUSINESSES.map(() => 0), mgr = BUSINESSES.map(() => false), activeFrom = BUSINESSES.map(() => Infinity);
  let cash = 10, t = 0, lifetime = 0;
  const first = BUSINESSES.map(() => null);
  const rate = () => BUSINESSES.reduce((sum, b, i) => {
    if (n[i] <= 0) return sum;
    const per = payout(b, n[i]) * M / cycle(b, n[i]);
    if (mgr[i]) return t >= activeFrom[i] ? sum + per : sum;
    return b.cycleSeconds <= 60 ? sum + per * 0.5 : sum;   // short businesses are run by hand
  }, 0);
  const rateWith = (i, nn, mm) => {   // income rate if business i had nn units / manager mm
    let sum = 0;
    BUSINESSES.forEach((b, j) => {
      const count = j === i ? nn : n[j], managed = j === i ? mm : mgr[j];
      if (count <= 0) return;
      const per = payout(b, count) * M / cycle(b, count);
      if (managed) sum += (j === i || t >= activeFrom[j]) ? per : 0; else if (b.cycleSeconds <= 60) sum += per * 0.5;
    });
    return sum;
  };
  let guard = 0;
  while (t < maxSeconds && first[targetTier] === null && guard++ < 400000) {
    const r0 = rate();
    // candidate purchases
    const options = [];
    BUSINESSES.forEach((b, i) => {
      // one unit
      const c1 = cost(b, n[i]);
      if (n[i] === 0 && !mgr[i] && b.cycleSeconds > 60) {   // a brand-new long business is bought together with its manager
        options.push({ i, kind: "unit", cost: c1 + b.managerCost, gain: rateWith(i, 1, true) - r0, apply() { n[i] = 1; mgr[i] = true; activeFrom[i] = t + cycle(b, 1); } });
      } else options.push({ i, kind: "unit", cost: c1, gain: rateWith(i, n[i] + 1, mgr[i]) - r0, apply() { n[i] += 1; } });
      // up to the next milestone (bulk)
      const m = nextMilestone(n[i]);
      if (m && m - n[i] > 1 && m - n[i] <= 60) {
        let c = 0; for (let k = n[i]; k < m; k++) c += cost(b, k);
        options.push({ i, kind: "bulk", cost: c, gain: rateWith(i, m, mgr[i]) - r0, apply() { n[i] = m; } });
      }
      if (n[i] > 0 && !mgr[i]) {
        const g = rateWith(i, n[i], true) - r0 + (b.cycleSeconds <= 60 ? 0 : 0);
        options.push({ i, kind: "mgr", cost: b.managerCost, gain: g, apply() { mgr[i] = true; activeFrom[i] = t + cycle(b, n[i]); } });
      }
    });
    // pick by time-to-payback including the wait for money; managers' gain counts once their first cycle has passed
    let best = null;
    for (const o of options) {
      if (o.cost > 1e300) continue;
      const wait = Math.max(0, o.cost - cash) / Math.max(r0, 1e-9);
      const gain = Math.max(o.gain, 1e-12);
      const score = wait + o.cost / gain;
      if (!best || score < best.score) best = { ...o, score, wait };
    }
    if (!best) break;
    if (cash >= best.cost) {
      cash -= best.cost; best.apply();
      if (first[best.i] === null && best.kind !== "mgr") { first[best.i] = t; if (trace) console.error(`${BUSINESSES[best.i].id} at ${t.toFixed(1)}s`); }
      continue;
    }
    // advance: either the money arrives, or the next manager activation changes the income
    const pending = activeFrom.filter((a) => a > t && a < Infinity);
    const nextEvent = pending.length ? Math.min(...pending) : Infinity;
    const toAfford = r0 > 0 ? (best.cost - cash) / r0 : Infinity;
    const dt = Math.min(toAfford, nextEvent - t);
    if (!Number.isFinite(dt)) break;
    const step = Math.max(dt, 1e-6);
    cash += r0 * step; lifetime += r0 * step; t += step;
  }
  return { first, t, lifetime, n: [...n] };
}


const fmtTime = (s) => s === null || s === undefined ? ">100y" : s < 1 ? "<1s" : s < 90 ? s.toFixed(0) + "s" : s < 5400 ? (s / 60).toFixed(0) + "m" : s < 172800 ? (s / 3600).toFixed(1) + "h" : s < 86400 * 400 ? (s / 86400).toFixed(1) + "d" : (s / 31557600).toFixed(1) + "y";
const sci = (x) => x < 1e6 ? String(Math.round(x)) : x.toExponential(2).replace("e+", "e");
const TIERS = ["oil", "airline", "port", "tech", "space", "moon", "asteroid", "dyson", "galaxy"];
const tierIndex = TIERS.map((id) => BUSINESSES.findIndex((b) => b.id === id));
/* An account whose investors and stars are equal: (1 + 0.1x)^2 = raw  =>  x = 10 (sqrt(raw) - 1). */
const countsFor = (raw) => 10 * (Math.sqrt(raw) - 1);
const RAW = [1, 1e2, 1e4, 1e6, 1e8, 1e10, 1e12, 1e16, 1e20, 1e30, 1e50, 1e70, 1e106, 1e141];

function timesTable(label, multipliers, labels = multipliers.map(sci)) {
  console.log(`\n${label}\n${"multiplier".padEnd(20)}${TIERS.map((id) => id.padStart(9)).join("")}`);
  multipliers.forEach((m, index) => {
    const res = simulate(m);
    console.log(labels[index].padEnd(20) + tierIndex.map((i) => fmtTime(res.first[i]).padStart(9)).join(""));
  });
}

const which = process.argv[2] || "all";
if (which === "all" || which === "times") {
  timesTable("BEFORE: time until the first unit of each tier, payout multiplier = raw investors x stars bonus", RAW);
  const effective = RAW.map((raw) => { const x = countsFor(raw); return prestigeMultiplier(x, x); });
  console.log(`\nAFTER: soft cap at x${sci(PRESTIGE_SOFT_CAP)}: raw bonus -> effective bonus`);
  RAW.forEach((raw, i) => console.log(`  ${sci(raw).padStart(8)} -> ${sci(effective[i]).padStart(8)}  (${(effective[i] / raw * 100).toPrecision(3)} % of the old bonus)`));
  timesTable("AFTER: time-to-tier for the same accounts (row label: old raw bonus -> effective bonus)", effective, RAW.map((raw, i) => `${sci(raw)} -> ${sci(effective[i])}`));
}
if (which === "all" || which === "stars") {
  console.log(`\nOne more rebirth: stars gained (unchanged formula, floor(sqrt(roundEarnings / ${sci(REBIRTH_THRESHOLD)}))) and what they are worth`);
  console.log("investors".padStart(10) + "stars".padStart(10) + "round $".padStart(10) + "gain".padStart(10) + "old x".padStart(10) + "-> old".padStart(10) + "ratio".padStart(8) + "new x".padStart(10) + "-> new".padStart(10) + "ratio".padStart(8));
  for (const [inv, st, rb] of [[5, 0, 1e11], [1e3, 10, 1e15], [1e4, 1e3, 1e19], [1e5, 1e4, 1e22], [1e7, 1e5, 1e24], [1e12, 1e11, 1e35], [1e20, 1e19, 1e60], [1e71, 1e70, 1e150]]) {
    const gain = Math.floor(Math.sqrt(rb / REBIRTH_THRESHOLD));
    const oldBefore = rawPrestigeMultiplier(inv, st), oldAfter = rawPrestigeMultiplier(inv, st + gain);
    const newBefore = prestigeMultiplier(inv, st), newAfter = prestigeMultiplier(inv, st + gain);
    console.log(sci(inv).padStart(10) + sci(st).padStart(10) + sci(rb).padStart(10) + sci(gain).padStart(10) + sci(oldBefore).padStart(10) + sci(oldAfter).padStart(10) + (oldAfter / oldBefore).toPrecision(3).padStart(8) + sci(newBefore).padStart(10) + sci(newAfter).padStart(10) + (newAfter / newBefore).toPrecision(3).padStart(8));
  }
}
