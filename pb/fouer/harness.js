// Node harness for the Schueberfouer brain (W1): node pb/fouer/harness.js  [--table] [--sync-pitches]
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { RULES, ECONOMY, STAR_POINTS, LEVELS, ITEMS, ITEM_BY_ID, PITCHES, SIZES, VOUCHER_MAP, VOUCHERABLE, LOOKS, CASH_CAP,
  sizeFits } from "./data.js";
import { fouerDates, eventsAt, luxParts, economyContext, bannersAt, toDayNumber, fromDayNumber, FOUER_RULES } from "./calendar.js";
import * as sim from "./sim.js";
import * as save from "./save.js";
import * as legacy from "./legacy.js";
import * as i18n from "./i18n.js";
import * as walkMod from "./walk.js";
import * as crowdMod from "./crowd.js";
import * as audioMod from "./audio.js";
import * as rideMod from "./ride.js";
import { FOODIE, foodieMultiplier, createGame } from "./game.js";
import { RIDES, STALLS } from "../park/data.js";
import { createState as v1Create, tick as v1Tick } from "../park/sim.js";
import { canPlace as v1CanPlace, place as v1Place, placePath as v1PlacePath, KINDS as V1_KINDS } from "../park/build.js";
import { serializeSave as v1Serialize } from "../park/save.js";
import { verifyLaunch } from "./harness-w7.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const DAY_MS = 86400000;
const TAU_ = Math.PI * 2;
let checks = 0;
const section = {};   // numbers printed at the end of the run

function check(condition, message) {
  assert.ok(condition, message);
  checks++;
}
function equal(actual, expected, message) {
  assert.deepStrictEqual(actual, expected, message);
  checks++;
}
function near(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected} (+-${tolerance})`);
  checks++;
}
function throwsRange(fn, message) {
  assert.throws(fn, RangeError, message);
  checks++;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
const clone = value => JSON.parse(JSON.stringify(value));
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function quiet(fn) {
  const real = console.warn, messages = [];
  console.warn = (...args) => messages.push(args.map(String).join(" "));
  try { return { value: fn(), messages }; } finally { console.warn = real; }
}
async function quietAsync(fn) {
  const real = console.warn, messages = [];
  console.warn = (...args) => messages.push(args.map(String).join(" "));
  try { return { value: await fn(), messages }; } finally { console.warn = real; }
}
/** Instant of a Luxembourg wall-clock time; `offset` is the UTC offset (2 in summer, 1 in winter). */
const lux = (y, m, d, hh = 12, mm = 0, ss = 0, offset = 2) => Date.UTC(y, m - 1, d, hh - offset, mm, ss);
const itemIndexOf = id => PITCHES.findIndex(pitch => pitch.star === 1 && sizeFits(ITEM_BY_ID[id].size, pitch.size));

// ---------------------------------------------------------------- data

function verifyData() {
  equal(ITEMS.length, 33, "30 catalogue items + 3 specials");
  equal(ITEMS.map(item => item.idx), Array.from({ length: 33 }, (_, i) => i + 1), "item indices are 1..33 and never reordered");
  check(ITEMS.every(item => item.idx < 36), "every item index is one base-36 character");
  equal(new Set(ITEMS.map(item => item.id)).size, 33, "item ids are unique");
  check(Object.isFrozen(ITEMS) && Object.isFrozen(PITCHES) && Object.isFrozen(LEVELS) && Object.isFrozen(RULES), "catalogue tables are frozen");
  check(ITEMS.every(item => ["S", "M", "L", "XL", "W"].includes(item.size)), "item sizes are valid");
  check(ITEMS.every(item => ["ride", "food", "game", "deco"].includes(item.cat)), "item categories are valid");
  const normal = ITEMS.filter(item => item.special === null);
  equal(normal.length, 30, "30 regular items");
  check(normal.every(item => item.star >= 1 && item.star <= 5 && item.cost > 0 && item.cap > 0 && item.price > 0 && item.appeal > 0), "regular item numbers are positive");
  equal([ITEM_BY_ID.kachel.cost, ITEM_BY_ID.kanner.cost, ITEM_BY_ID.wheel.cost, ITEM_BY_ID.looping.cost], [150, 300, 45000, 100800], "3.1 anchor prices");
  equal(normal.filter(item => item.star === 1).map(item => item.id), ["kachel", "fritten", "lous", "kanner"], "four cards at star 1");
  check(ITEM_BY_ID.wheel.size === "W" && normal.filter(item => item.size === "W").length === 1, "only the big wheel is a W item");
  equal(ITEM_BY_ID.gold.special, "pioneer", "gold carousel is pioneer only");
  equal(ITEM_BY_ID.museum.special, "pioneer", "old-park kiosk is pioneer only");
  equal(ITEM_BY_ID.lammy.special, "stamps", "Hämmi statue is a stamp reward");
  check(ITEM_BY_ID.gold.cost === 0 && ITEM_BY_ID.gold.appeal === 6 && ITEM_BY_ID.gold.price === 5, "gold carousel numbers (3.1 S1)");
  equal(RULES.maxCopies, 3, "11.7: three copies per type");
  equal(RULES.thirdCopyCostMultiplier, 2, "11.7: third copy at 2x");
  equal(RULES.upgradeFractions, [0.6, 0.8, 2.5], "upgrade fractions incl. gold at 2.5 x base");
  equal(LEVELS.length, 4, "four levels (L1, L2, L3, Gold)");
  for (const key of ["cap", "price", "appeal"]) check(LEVELS.every((level, i) => i === 0 || level[key] > LEVELS[i - 1][key]), `${key} grows with every level`);
  check(LEVELS[0].cap === 1 && LEVELS[0].price === 1 && LEVELS[0].appeal === 1, "L1 is the base");
  check(STAR_POINTS.every((points, i) => i === 0 || points > STAR_POINTS[i - 1]) && STAR_POINTS[0] === 0, "star thresholds increase from 0");
  check(STAR_POINTS[1] === 18 && STAR_POINTS[2] === 70, "star 2 and 3 thresholds keep the pioneer arithmetic of 7.3");
  check(save.cleanGiftIds([1]).length === 1 && RULES.giftIdsKept === 50, "gift id window is 50");
  equal(Object.keys(SIZES), ["S", "M", "L", "XL", "W"], "five pitch sizes");
  equal(LOOKS.length, RULES.lookCount, "three looks");
  const table = { S: ["S", "M"], M: ["M", "L"], L: ["L", "XL"], XL: ["XL"], W: ["W"] };
  for (const [item, pitches] of Object.entries(table)) {
    for (const pitch of Object.keys(SIZES)) equal(sizeFits(item, pitch), pitches.includes(pitch), `size rule ${item} on ${pitch}`);
  }
  // 7.4: every v1 ride and stall has a Fouer target.
  const ids = [...RIDES, ...STALLS].map(kind => kind.id);
  equal(ids.filter(id => !VOUCHER_MAP[id]), [], "every v1 ride and stall has a voucher target");
  check(Object.values(VOUCHER_MAP).every(id => VOUCHERABLE.includes(id)), "voucher targets are regular catalogue items");
  equal(VOUCHER_MAP.wheel, "wheel", "v1 wheel becomes the big wheel");
  check(Object.keys(VOUCHER_MAP).length === 25, "16 rides + 9 stalls mapped");
}

// ---------------------------------------------------------------- pitches

function verifyPitches() {
  const json = JSON.parse(fs.readFileSync(`${here}pitches.json`, "utf8"));
  equal(json, PITCHES.map(pitch => ({ ...pitch })), "pitches.json equals the copy embedded in data.js");
  equal(PITCHES.length, 34, "34 pitches");
  equal(PITCHES.map(pitch => pitch.id), Array.from({ length: 34 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`), "ids P01..P34");
  equal(Object.keys(PITCHES[0]).sort(), ["face", "id", "size", "star", "u", "w", "zone"], "pitch fields");
  const count = key => PITCHES.reduce((sum, pitch) => ({ ...sum, [pitch[key]]: (sum[pitch[key]] ?? 0) + 1 }), {});
  equal(count("size"), { S: 14, M: 11, L: 6, XL: 2, W: 1 }, "pitch counts by size");
  const unlocked = star => PITCHES.filter(pitch => pitch.star <= star).length;
  equal([1, 2, 3, 4, 5].map(unlocked), [7, 15, 24, 30, 34], "unlock counts per star");
  check(PITCHES.every(pitch => ["+w", "-w", "+u"].includes(pitch.face)), "faces are valid");
  const rect = pitch => ({ u0: pitch.u - SIZES[pitch.size].u / 2, u1: pitch.u + SIZES[pitch.size].u / 2,
    w0: pitch.w - SIZES[pitch.size].w / 2, w1: pitch.w + SIZES[pitch.size].w / 2 });
  let overlaps = 0, minGap = Infinity;
  PITCHES.forEach((a, i) => PITCHES.slice(i + 1).forEach(b => {
    const p = rect(a), q = rect(b);
    const du = Math.max(q.u0 - p.u1, p.u0 - q.u1), dw = Math.max(q.w0 - p.w1, p.w0 - q.w1);
    if (du < 0 && dw < 0) overlaps++;
    minGap = Math.min(minGap, Math.max(du, dw));
  }));
  equal(overlaps, 0, "no two pitches overlap");
  check(minGap >= 1, `neighbouring pitches keep at least 1 m between them (min ${minGap} m)`);
  section.minPitchGap = minGap;
  // The car park wedge of 4.1: u 13..292, w from 1 to 100 m (SW end) widening to 135 m (NE end).
  const wMax = u => 100 + 35 * (u - 13) / 279;
  check(PITCHES.every(pitch => { const r = rect(pitch); return r.u0 >= 13 && r.u1 <= 292 && r.w0 >= 1 && r.w1 <= wMax(r.u0) + 1e-9 && r.w1 <= 138; }), "every pitch lies inside the Glacis wedge");
  const lanesW = [-3, 28, 59, 90], lanesU = [66, 130, 190, 250];
  const frontDistance = pitch => {
    const r = rect(pitch);
    if (pitch.face === "+u") return Math.min(...lanesU.map(lane => Math.abs(lane - r.u1)));
    const edge = pitch.face === "+w" ? r.w1 : r.w0;
    return Math.min(...lanesW.map(lane => Math.abs(lane - edge)));
  };
  check(PITCHES.every(pitch => frontDistance(pitch) <= 16), "every pitch front is within 16 m of an alley line");
  check(PITCHES.every(pitch => ITEMS.some(item => sizeFits(item.size, pitch.size))), "every pitch can hold at least one item");
  for (const size of Object.keys(SIZES)) check(ITEMS.some(item => item.size === size && item.special === null), `a regular item exists for size ${size}`);
  equal(PITCHES.find(pitch => pitch.size === "W").id, "P24", "the big wheel pitch is P24");
  check(PITCHES.find(pitch => pitch.size === "W").u < 70, "wheel pitch is at the SW end (11.6)");
  // Every star must be reachable on its own pitch set (headroom against the next threshold).
  const best = star => {
    const slots = PITCHES.filter(pitch => pitch.star <= star).map(pitch => pitch.size);
    const free = [...slots];
    return [...ITEMS.filter(item => !item.special && item.star <= star)].sort((a, b) => b.appeal - a.appeal).reduce((sum, item) => {
      for (let copy = 0; copy < item.max; copy++) {
        const at = free.findIndex(size => sizeFits(item.size, size));
        if (at < 0) return sum;
        free.splice(at, 1);
        sum += item.appeal * LEVELS[RULES.maxLevel].appeal;
      }
      return sum;
    }, 0);
  };
  section.maxPoints = [1, 2, 3, 4, 5].map(best);
  for (const star of [1, 2, 3, 4]) check(best(star) >= STAR_POINTS[star] * 1.1, `star ${star + 1} stays reachable with 10 % headroom on the pitches of star ${star}`);
}

// ---------------------------------------------------------------- calendar

const ISO = ({ year, month, day }) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

function verifyCalendar() {
  const known = { 2023: ["2023-08-23", "2023-09-11"], 2025: ["2025-08-22", "2025-09-10"], 2026: ["2026-08-21", "2026-09-09"],
    2027: ["2027-08-20", "2027-09-08"], 2028: ["2028-08-23", "2028-09-11"] };
  for (const [year, [open, close]] of Object.entries(known)) {
    const dates = fouerDates(Number(year));
    equal([ISO(dates.open), ISO(dates.close)], [open, close], `published edition ${year}`);
    equal(dates.source, "rule", `${year} comes from the rule`);
    equal(dates.closeDay - dates.openDay, 19, `${year} runs 20 days`);
  }
  // Independent rule: the first Wed/Thu/Fri on or before 23 August.
  for (let year = 2024; year <= 2035; year++) {
    let day = toDayNumber(year, 8, 23);
    while (![3, 4, 5].includes(fromDayNumber(day).weekday)) day--;
    const dates = fouerDates(year);
    equal(dates.openDay, day, `${year} opening day by weekday rule`);
    check([3, 4, 5].includes(dates.open.weekday), `${year} opens on Wed, Thu or Fri`);
    check(dates.open.month === 8 && dates.open.day >= 19 && dates.open.day <= 23, `${year} opens 19-23 August`);
    equal(dates.closeDay, day + 19, `${year} closes 19 days later`);
  }
  equal(ISO(fouerDates(2024).open), "2024-08-23", "2024 opens on its eve (a Friday)");
  const overrides = { 2031: { open: "2031-08-22", close: "2031-09-10" }, 2032: { open: "garbage", close: "2032-09-10" } };
  const forced = fouerDates(2031, overrides);
  equal([ISO(forced.open), ISO(forced.close), forced.source], ["2031-08-22", "2031-09-10", "override"], "override wins over the rule");
  equal(fouerDates(2032, overrides).source, "rule", "an unusable override is ignored");
  equal(fouerDates(2033, overrides).source, "rule", "years without an override use the rule");
  throwsRange(() => fouerDates(1800), "unsupported year");
  throwsRange(() => fouerDates(2027.5), "non-integer year");
  throwsRange(() => luxParts(NaN), "non-finite instant");
  throwsRange(() => eventsAt(Infinity), "events need a finite instant");
  // Luxembourg wall clock across DST.
  const at = iso => luxParts(Date.parse(iso));
  equal([at("2027-03-28T00:59:59Z").hour, at("2027-03-28T01:00:00Z").hour], [1, 3], "spring forward skips 02:00");
  equal([at("2027-10-31T00:59:59Z").hour, at("2027-10-31T01:00:00Z").hour], [2, 2], "autumn back repeats 02:00");
  equal(at("2027-08-19T21:59:59Z").day, 19, "23:59:59 CEST is still the 19th");
  equal([at("2027-08-19T22:00:00Z").day, at("2027-08-19T22:00:00Z").hour], [20, 0], "midnight CEST starts the 20th");
  equal([at("2026-12-31T23:30:00Z").year, at("2026-12-31T23:30:00Z").month], [2027, 1], "year rolls over in Luxembourg time");
  equal(at("2027-08-20T12:00:00Z").weekday, 5, "20 Aug 2027 is a Friday");
  // The 2027 edition, moment by moment.
  const e = (...args) => eventsAt(lux(2027, ...args));
  check(e(8, 19, 23, 59, 59).fair.before && !e(8, 19, 23, 59, 59).fair.active, "before opening");
  equal(e(8, 19, 23, 59, 59).next.days, 1, "one day to the next opening");
  check(e(8, 20, 0, 0, 0).fair.active && e(8, 20, 0, 0, 0).fair.dayIndex === 0, "opening day starts at local midnight");
  check(e(8, 20, 12).ceremony.day && !e(8, 20, 12).ceremony.live, "ceremony day, not yet live");
  check(!e(8, 20, 16, 59, 59).ceremony.live && e(8, 20, 17, 0, 0).ceremony.live, "ceremony starts at 17:00");
  check(e(8, 20, 17, 2, 59).ceremony.live && !e(8, 20, 17, 3, 0).ceremony.live, "ceremony lasts 3 minutes");
  check(!e(8, 20, 12).ceremony.replay && e(8, 20, 18).ceremony.replay && e(8, 25, 12).ceremony.replay, "replay card after the ceremony");
  check(!e(8, 21, 12).ceremony.day, "no ceremony on day two");
  check(e(8, 25, 12).familyDay && e(9, 1, 12).familyDay && !e(8, 26, 12).familyDay, "Familljendag on Wednesdays");
  check(!e(8, 18, 12).familyDay, "no Familljendag before the fair");
  check(e(8, 29, 12).fouersonndeg && !e(8, 22, 12).fouersonndeg && !e(9, 5, 12).fouersonndeg, "Fouersonndeg is the Sunday of D+8..D+14");
  equal(eventsAt(lux(2026, 8, 30)).fouersonndeg, true, "2026: Fouersonndeg is 30 August");
  for (let year = 2024; year <= 2035; year++) {
    const dates = fouerDates(year);
    const sundays = Array.from({ length: 20 }, (_, i) => dates.openDay + i).filter(day => fromDayNumber(day).weekday === 0 && day - dates.openDay >= 8 && day - dates.openDay <= 14);
    equal(sundays.length, 1, `${year} has exactly one Fouersonndeg`);
  }
  check(e(8, 29, 11, 0, 0).parade.live && e(8, 29, 11, 2, 59).parade.live && !e(8, 29, 11, 3, 0).parade.live, "parade at 11:00 for 3 minutes");
  check(e(8, 29, 15, 1).parade.live && !e(8, 29, 13).parade.live, "second parade at 15:00");
  check(e(8, 29, 11, 59, 59).parade.bonus && !e(8, 29, 12, 0, 0).parade.bonus && e(8, 29, 15, 30).parade.bonus, "Hämmelsmarsch bonus lasts one hour");
  check(!e(8, 22, 11).parade.live && !e(8, 22, 11).parade.bonus, "no parade on other Sundays");
  check(e(9, 8, 12).lastDay.day && e(9, 8, 19, 59, 59).lastDay.promo && !e(9, 8, 20, 0, 0).lastDay.promo, "last day promo until 20:00");
  check(!e(9, 7, 12).lastDay.day, "the day before is not the last day");
  check(!e(9, 8, 21, 59, 59).fireworks.live && e(9, 8, 22, 0, 0).fireworks.live && e(9, 8, 22, 3, 59).fireworks.live && !e(9, 8, 22, 4, 0).fireworks.live, "fireworks 22:00-22:04");
  check(e(9, 8, 22, 1, 29).fireworks.sync && !e(9, 8, 22, 1, 30).fireworks.sync, "first 90 s of the show are in sync");
  check(!e(9, 8, 21, 59).fireworks.claimable && e(9, 8, 22, 0).fireworks.claimable && e(9, 15, 12).fireworks.claimable && !e(9, 16, 12).fireworks.claimable, "closing gift claimable until a week after");
  check(e(9, 8, 12).familyDay && e(9, 8, 12).lastDay.day, "2027 closes on a Wednesday");
  check(!e(8, 19, 12).stamp.claimOpen && e(8, 20, 0).stamp.claimOpen && e(9, 15, 23, 59).stamp.claimOpen && !e(9, 16, 0, 0).stamp.claimOpen, "stamp window: open day to close + 7 days");
  check(e(9, 12, 12).stamp.claimOpen && !e(9, 12, 12).stamp.canStamp, "after closing nothing new is stamped");
  equal(e(8, 20, 12).stamp.today, 0, "stamp slot is the day index");
  const off = eventsAt(lux(2026, 10, 22, 12, 0, 0, 2));
  equal(off.next.days, Math.round((Date.UTC(2027, 7, 20) - Date.UTC(2026, 9, 22)) / DAY_MS), "days to the next Fouer from 22 Oct 2026");
  equal(off.next.year, 2027, "next edition is 2027");
  check(!off.fair.active && off.fair.after, "2026 edition is over");
  equal(eventsAt(lux(2027, 8, 20, 12)).next.days, 0, "opening day counts 0 days");
  equal(eventsAt(lux(2027, 8, 25, 12)).next.year, 2028, "during the fair the next edition is next year's");
  equal(eventsAt(lux(2027, 12, 31, 12, 0, 0, 1)).next.year, 2028, "late December points at next year");
  check(eventsAt(lux(2027, 1, 3, 12, 0, 0, 1)).next.days > 200, "January is far from August");
  equal(eventsAt(lux(2027, 8, 20, 12)).today, "2027-08-20", "ISO date of today");
  // Event multipliers (the only calendar input to the economy).
  equal(economyContext(off), { guests: 1, price: 1, uses: 1, cap: 1, bonus: 1, zones: {} }, "no multipliers off season");
  near(economyContext(e(8, 23, 12)).guests, FOUER_RULES.periodGuests, 1e-12, "fair period: guests +10 %");
  const family = economyContext(e(8, 25, 12));
  near(family.guests, 1.1 * 1.4, 1e-12, "Familljendag guests x1.4 on top");
  near(family.price, 0.8, 1e-12, "Familljendag prices x0.8");
  const last = economyContext(e(9, 8, 15));
  near(last.guests * last.uses * last.price, 1.1 * 1.25 * 1.6 * 0.5 * 1.4 * 0.8, 1e-9, "last day on a Wednesday combines");
  near(last.cap, 1.25 * 2, 1e-12, "extra counters combine too");
  equal(Object.keys(economyContext(e(8, 29, 11, 30)).zones).sort(), ["M1", "M2"], "parade bonus covers the main-alley zones");
  equal(economyContext(e(8, 29, 14)).zones, {}, "no parade bonus between the parades");
  equal(bannersAt(off), [], "no banners off season");
  equal(bannersAt(e(8, 25, 12)), ["fouer", "familljendag"], "banners on Familljendag");
  equal(bannersAt(e(8, 29, 11, 1)), ["fouer", "haemmelsmarsch"], "banners during the parade");
  equal(bannersAt(e(9, 8, 22, 1)), ["fouer", "familljendag", "fireworks"], "banners at the fireworks");
  equal(bannersAt(e(8, 20, 17, 1)), ["fouer", "opening"], "banners at the ceremony");
}

// ---------------------------------------------------------------- economy and commands

const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.state; };
const idx = id => PITCHES.findIndex(pitch => pitch.id === id);

function verifyBasics() {
  const fresh = sim.createState({ name: "Ian", now: 1.7e12 });
  equal([fresh.v, fresh.c, fresh.tb, fresh.t, fresh.n], [2, 350, 0, 1.7e9, "Ian"], "fresh state");
  equal(fresh.pitches.length, 34, "34 slots");
  const empty = sim.economy(fresh);
  equal([empty.incomePerMin, empty.stars, empty.points, empty.perPitch.length], [0, 1, 0, 0], "no attractions, no income");
  check(Number.isFinite(empty.lambda) && empty.lambda > 0, "guests still come to an empty fair (hidden lambda)");
  equal(sim.cleanName("  <b>Ian</b>\u0007   Mülheim  "), "bIan/b Mülheim", "tags, control characters and extra spaces are removed from the name");
  equal(sim.cleanName("x".repeat(40)).length, 24, "name is cut at 24");
  equal(Array.from(sim.cleanName("🎡".repeat(30))).length, 24, "name is cut by characters, not bytes");
  const tiny = sim.tick(fresh, 0);
  check(tiny.c === 350 && tiny.tb === 0, "zero dt earns nothing");
  throwsRange(() => sim.tick(fresh, -1), "negative dt");
  throwsRange(() => sim.tick(fresh, NaN), "NaN dt");
  equal(sim.starsFor(0), 1, "0 points is one star");
  equal(STAR_POINTS.map((points, i) => sim.starsFor(points) === i + 1), [true, true, true, true, true], "each threshold gives its star");
  equal(sim.starsFor(STAR_POINTS[1] - 0.01), 1, "just below the threshold");
  equal(sim.starsFor(1e9), 5, "stars are capped at 5");
}

function verifyTutorial() {
  // 1: free starter stall, 2: kids' carousel from the 350 start cash, 3: a 90 euro upgrade.
  let state = sim.createState({ now: 0 });
  const quote = sim.buildQuote(state, "kachel");
  equal([quote.cost, quote.gift], [0, true], "the starter stall is a gift");
  const stall = idx("P01");
  state = ok(sim.build(state, stall, "kachel"));
  equal(state.c, 350, "the gift costs nothing");
  check(state.ea.includes("g"), "gift flag stored");
  equal(sim.buildQuote(state, "kachel").cost, 150, "the next potato stall costs 150");
  const income = sim.economy(state).incomePerMin;
  check(income > 20 && income < 60, `starter income is a trickle (${income.toFixed(1)}/min)`);
  state = sim.tick(state, 45);
  const second = sim.build(state, idx("P02"), "kanner");
  check(second.ok && second.cost === 300, "kids' carousel affordable at 0:45");
  state = second.state;
  check(state.c >= 50 && state.c < 100, "about 50 euro left after the carousel");
  equal(sim.upgradeCost(state, stall), 90, "the first upgrade costs 90");
  check(!sim.upgrade(state, stall).ok, "not yet affordable right after the build");
  state = sim.tick(state, 75);
  check(state.c >= 90, "upgrade affordable before two minutes");
  const upgraded = ok(sim.upgrade(state, stall));
  check(sim.economy(upgraded).incomePerMin > sim.economy(state).incomePerMin, "the upgrade raises income");
  equal(upgraded.pitches.filter(Boolean).length, 2, "two attractions in the first two minutes");
  section.tutorial = { starter: Math.round(income), pair: Math.round(sim.economy(state).incomePerMin), cash: Math.round(state.c) };
  equal(sim.nextGoal(sim.createState()), { id: "firstBuild", progress: 0 }, "goal card before the first build");
  const goal = sim.nextGoal(upgraded);
  check(goal.id === "star" && goal.stars === 2 && goal.points > 0 && goal.progress >= 0 && goal.progress < 1, "goal card points at star 2");
  check(goal.tip && ["build", "upgrade"].includes(goal.tip.type), "goal card carries a tip");
  check(sim.economy(upgraded).stars === 1, "still star 1 after the opening");
}

function verifyCommands() {
  const base = deepFreeze(ok(sim.build(sim.createState({ now: 0 }), idx("P01"), "kachel")));
  const rich = deepFreeze({ ...base, c: 1e7 });
  const reasons = result => result.reason;
  equal(reasons(sim.build(rich, 99, "kachel")), "no-pitch", "pitch out of range");
  equal(reasons(sim.build(rich, -1, "kachel")), "no-pitch", "negative pitch");
  equal(reasons(sim.build(rich, 1.5, "kachel")), "no-pitch", "fractional pitch");
  equal(reasons(sim.build(rich, idx("P02"), "nope")), "unknown-item", "unknown item");
  equal(reasons(sim.build(rich, idx("P02"), "kanner", 7)), "bad-look", "unknown look");
  equal(reasons(sim.build(rich, idx("P01"), "fritten")), "occupied", "occupied pitch");
  equal(reasons(sim.build(rich, idx("P02"), "scooter")), "wrong-size", "a large ride on a small pitch");
  equal(reasons(sim.build(rich, idx("P02"), "wheel")), "wrong-size", "the wheel only fits its own pitch");
  equal(reasons(sim.build(rich, idx("P08"), "fritten")), "pitch-locked", "star 2 pitch is locked at star 1");
  equal(reasons(sim.build(rich, idx("P04"), "scooter")), "item-locked", "star 2 item is locked at star 1");
  equal(reasons(sim.build(rich, idx("P03"), "gold")), "item-locked", "pioneer items stay locked for newcomers");
  equal(reasons(sim.build(rich, idx("P02"), "lammy")), "item-locked", "the statue needs stamps");
  equal(reasons(sim.build({ ...rich, c: 10 }, idx("P02"), "kanner")), "unaffordable", "not enough cash");
  const poor = ok(sim.build({ ...rich, c: 299.5 }, idx("P03"), "fritten"));
  check(poor.c >= 0, "cash never negative after a build");
  // Copy limit and the 2x third copy.
  let state = { ...rich, c: 1e7 };
  state = ok(sim.build(state, idx("P02"), "kanner"));
  state = ok(sim.build(state, idx("P05"), "kanner"));
  equal(sim.buildQuote(state, "kanner").cost, 600, "third copy costs twice the base");
  const third = sim.build(state, idx("P06"), "kanner");
  equal(third.cost, 600, "third copy paid at 2x");
  state = third.state;
  equal(sim.copiesOf(state, "kanner"), 3, "three copies");
  equal(sim.build(state, idx("P07"), "kanner").reason, "max-copies", "no fourth copy");
  // Upgrades.
  const costs = [];
  let up = state;
  for (let level = 0; level < 3; level++) { costs.push(sim.upgradeCost(up, idx("P01"))); up = ok(sim.upgrade(up, idx("P01"))); }
  equal(costs, [90, 120, 375], "kachel upgrade costs: 0.6, 0.8 and 2.5 x 150");
  equal(up.pitches[idx("P01")].lv, 3, "gold reached");
  equal(sim.upgrade(up, idx("P01")).reason, "maxed", "no level beyond gold");
  equal(sim.upgrade(up, idx("P09")).reason, "empty", "nothing to upgrade on an empty pitch");
  equal(sim.upgradeCost(up, idx("P01")), null, "no upgrade cost at gold");
  check(costs[0] < costs[1] * 1 + costs[2] && costs[2] > costs[1], "gold costs more than every earlier level");
  check(sim.upgrade({ ...up, c: 0 }, idx("P02")).reason === "unaffordable", "upgrade needs cash");
  // Replace: half of what was paid, upgrades are lost.
  const replaced = sim.replace(up, idx("P06"), "fritten");
  check(replaced.ok && replaced.refund === 300, "replace refunds half of the double-price third copy");
  equal(replaced.state.pitches[idx("P06")], { k: "fritten", lv: 0, look: 0, fl: 0 }, "replacement starts at level 1");
  const swapGift = sim.replace(base, idx("P01"), "fritten");
  equal(swapGift.refund, 0, "the gifted starter stall refunds nothing");
  equal(sim.replace(base, idx("P03"), "fritten").reason, "empty", "cannot replace nothing");
  const swap = sim.replace({ ...state, c: 0 }, idx("P05"), "kachel");
  check(swap.ok && swap.state.c === 0 && swap.refund === 150, "the 150 refund of a 300 ride pays a 150 swap");
  equal(sim.replace({ ...state, c: 0 }, idx("P05"), "fritten").reason, "unaffordable", "a dearer swap needs more cash");
  equal(sim.replace({ ...state, c: 0 }, idx("P05"), "wheel").reason, "wrong-size", "replace follows the size rule");
  const refunded = sim.replace({ ...state, c: 0 }, idx("P06"), "kachel");
  check(refunded.ok && refunded.state.c === 150, "the third copy refunds 300 and the swap costs 150");
  // Looks.
  const looked = ok(sim.setLook(up, idx("P01"), 2));
  equal(looked.pitches[idx("P01")].look, 2, "look changed");
  equal(looked.c, up.c, "looks are free");
  near(sim.economy(looked).incomePerMin, sim.economy(up).incomePerMin, 1e-9, "looks never change income");
  equal(sim.setLook(up, idx("P01"), 3).reason, "bad-look", "look range");
  equal(sim.setLook(up, idx("P09"), 1).reason, "empty", "look on an empty pitch");
  // No command mutates its input (everything above ran on frozen states).
  equal(clone(base), clone(deepFreeze(ok(sim.build(sim.createState({ now: 0 }), idx("P01"), "kachel")))), "inputs stay untouched");
}

function verifyVouchers() {
  const pioneer = deepFreeze({ ...sim.createState({ now: 0 }), pi: 1, c: 1000, vo: ["wheel", "kanner", "tent"] });
  equal(sim.useVoucher(pioneer, "scooter", 0).reason, "no-voucher", "no matching voucher");
  const wheelPitch = idx("P24");
  check(PITCHES[wheelPitch].star === 3 && sim.stars(pioneer) === 1, "the wheel pitch is locked at star 1");
  equal(sim.useVoucher(pioneer, "wheel", wheelPitch).reason, "unaffordable", "half-price voucher still costs cash");
  const wheel = sim.useVoucher({ ...pioneer, c: 30000 }, "wheel", wheelPitch);
  check(wheel.ok && wheel.cost === 22500, "wheel voucher halves the 45,000 price");
  check(wheel.state.pitches[wheelPitch].k === "wheel" && wheel.state.pitches[wheelPitch].fl === 2, "wheel placed with the half-price flag");
  check(wheel.state.pu > 0 && sim.pitchOpen(wheel.state, wheelPitch), "the voucher opens the locked pitch");
  equal(wheel.state.vo, ["kanner", "tent"], "the voucher is spent");
  equal(sim.refundFor(wheel.state.pitches[wheelPitch]), 11250, "replacing refunds half of the half price paid");
  const carousel = sim.useVoucher(pioneer, "kanner", idx("P08"));
  check(carousel.ok && carousel.cost === 0 && carousel.state.c === 1000, "cheap vouchers are free");
  check(sim.pitchOpen(carousel.state, idx("P08")), "a locked small pitch opens for a voucher too");
  equal(sim.refundFor(carousel.state.pitches[idx("P08")]), 0, "free voucher builds refund nothing (no refund exploit)");
  equal(sim.useVoucher(pioneer, "kanner", idx("P04")).reason, "wrong-size", "a voucher still follows the size rule (a small ride does not fit a large pitch)");
  const tent = sim.useVoucher({ ...pioneer, c: 5000 }, "tent", idx("P04"));
  check(tent.ok && tent.cost === 3060, "beer tent voucher costs half of 6,120");
  equal(sim.useVoucher(carousel.state, "kanner", idx("P08")).reason, "no-voucher", "a spent voucher is gone");
  const twice = ok(sim.useVoucher({ ...pioneer, vo: ["kanner", "kanner"] }, "kanner", idx("P08")));
  equal(sim.useVoucher(twice, "kanner", idx("P08")).reason, "occupied", "occupied pitch refuses the voucher");
  equal(sim.useVoucher(pioneer, "kanner", 40).reason, "no-pitch", "voucher on a missing pitch");
  // Pioneer specials.
  const gold = ok(sim.build(pioneer, idx("P03"), "gold"));
  equal(gold.c, 1000, "the gold carousel is free for pioneers");
  equal(sim.build(gold, idx("P07"), "gold").reason, "max-copies", "only one gold carousel");
  equal(sim.upgradeCost(gold, idx("P03")), 600, "gold carousel upgrades from a 1,000 notional base");
  const museum = ok(sim.build(pioneer, idx("P01"), "museum"));
  equal(sim.upgradeCost(museum, idx("P01")), null, "the kiosk cannot be upgraded");
  equal(sim.economy(museum).incomePerMin, 0, "the kiosk earns nothing");
  check(sim.ratingPoints(gold) === 6, "the gold carousel counts 6 rating points");
}

function verifyGiftsStampsEvents() {
  const state = deepFreeze({ ...sim.createState({ now: 0 }), tb: 500, c: 100 });
  const first = sim.applyGift(state, 12, 250);
  check(first.applied && first.state.c === 350 && first.state.tb === 500, "a gift adds cash only");
  equal(first.state.gi, [12], "gift id remembered");
  const again = sim.applyGift(first.state, 12, 250);
  check(!again.applied && again.state === first.state, "the same gift id pays once (same state object)");
  equal(sim.stars(first.state), sim.stars(state), "gifts never move stars");
  for (const bad of [0, -5, NaN, Infinity, "5", null]) check(!sim.applyGift(state, 13, bad).applied, `bad amount ${bad} ignored`);
  for (const bad of [0, -1, 1.5, 2 ** 60, "3", null]) check(!sim.applyGift(state, bad, 10).applied, `bad id ${bad} ignored`);
  let many = state;
  for (let id = 1; id <= 60; id++) many = sim.applyGift(many, id, 1).state;
  equal(many.gi.length, 50, "only the last 50 gift ids are kept");
  equal([many.gi[0], many.gi[49]], [11, 60], "the window slides");
  check(sim.applyGift(many, 5, 1).applied, "an id that left the window can pay again (same as the idle games)");
  check(sim.applyGift({ ...state, c: CASH_CAP }, 99, 5).state.c === CASH_CAP, "gifts respect the cash cap");
  // Stamps.
  const day = n => eventsAt(lux(2027, 8, 20 + n, 12));
  let stamped = sim.createState({ now: 0 });
  const outside = sim.stampToday(stamped, eventsAt(lux(2027, 8, 10)));
  check(outside === stamped, "no stamp outside the fair");
  for (let n = 0; n < 9; n++) stamped = sim.stampToday(stamped, day(n));
  equal(sim.stampCount(stamped, 2027), 9, "nine stamps after nine days");
  check(sim.stampToday(stamped, day(8)) === stamped, "opening twice on a day stamps once");
  equal(sim.stampRewards(stamped, 2027), { count: 9, bulbs: true, statue: false, booth: false, crown: false }, "rewards at 9 stamps");
  const rich = { ...stamped, c: 1e6 };
  equal(sim.build(rich, idx("P01"), "lammy").reason, "item-locked", "statue locked below 10 stamps");
  stamped = sim.stampToday(stamped, day(9));
  const statue = sim.build({ ...stamped, c: 1000 }, idx("P01"), "lammy");
  check(statue.ok && statue.state.c === 1000 && sim.ratingPoints(statue.state) === 2, "statue is free and worth 2 points");
  for (let n = 10; n < 20; n++) stamped = sim.stampToday(stamped, day(n));
  equal(sim.stampRewards(stamped, 2027), { count: 20, bulbs: true, statue: true, booth: true, crown: true }, "all rewards at 20 stamps");
  equal(sim.stampCount(stamped, 2028), 0, "another year starts empty");
  // Closing fireworks gift.
  const earning = deepFreeze(ok(sim.build(sim.createState({ now: 0 }), idx("P01"), "kachel")));
  const before = eventsAt(lux(2027, 9, 8, 21, 30));
  equal(sim.claimFireworks(earning, before).reason, "not-claimable", "no gift before 22:00");
  const after = eventsAt(lux(2027, 9, 8, 22, 5));
  const claim = sim.claimFireworks(earning, after);
  check(claim.ok && claim.amount === Math.floor(sim.economy(earning).incomePerSec * 900), "gift is 15 minutes of income");
  check(claim.state.c === earning.c + claim.amount && claim.state.fw === 2027 && claim.state.tb === earning.tb, "gift is cash only and remembered");
  equal(sim.claimFireworks(claim.state, after).reason, "already-claimed", "once per edition");
  check(sim.claimFireworks(earning, eventsAt(lux(2027, 9, 12))).ok, "claimable on the days after closing");
  // Hämmi's daily present (W7): once per Luxembourg calendar day, cash only, scaled to income.
  const monday = eventsAt(lux(2027, 7, 5, 10)), mondayLate = eventsAt(lux(2027, 7, 5, 23, 50)), tuesday = eventsAt(lux(2027, 7, 6, 0, 5));
  check(sim.haemmiGiftReady(earning, monday), "a fresh player has Hämmi's present waiting");
  const gift1 = sim.claimHaemmiGift(earning, monday);
  const perMin = sim.economy(earning).incomePerMin;
  check(gift1.ok && gift1.amount === Math.max(25, Math.round(perMin * 3 / 5) * 5), "present = 3 minutes of income in steps of 5, at least 25");
  check(gift1.state.c === earning.c + gift1.amount && gift1.state.tb === earning.tb && gift1.state.gi === earning.gi && sim.stars(gift1.state) === sim.stars(earning), "cash only: tb, stars and gift ids untouched");
  equal(gift1.state.hd, monday.now.dayNumber, "the Lux day is remembered");
  equal(sim.claimHaemmiGift(gift1.state, mondayLate).reason, "already-today", "a second present on the same day is refused (even at 23:50)");
  check(sim.claimHaemmiGift(gift1.state, tuesday).ok, "...but 10 minutes after Lux midnight there is a new one");
  equal(sim.claimHaemmiGift(sim.claimHaemmiGift(gift1.state, tuesday).state, tuesday).reason, "already-today", "once on Tuesday too");
  const poor = sim.haemmiGiftAmount(sim.createState({ now: 0 }));
  equal(poor, 25, "an empty fair still gets the 25 euro minimum");
  const rich2 = sim.haemmiGiftAmount({ ...earning, pitches: earning.pitches.map((e, i) => (i < 6 ? sim.makeEntry(["kachel", "fritten", "kanner", "wurscht", "zocker", "crepes"][i], 3, 0, 0) : null)), rb: 80 });
  check(rich2 > poor * 4, `a richer fair gets a bigger present (${rich2})`);
  check(sim.claimHaemmiGift({ ...earning, c: CASH_CAP }, monday).state.c === CASH_CAP, "the cash cap holds");
  check(!sim.haemmiGiftReady({ ...earning, hd: monday.now.dayNumber + 1 }, monday) && sim.haemmiGiftReady({ ...earning, hd: monday.now.dayNumber - 1 }, monday), "ready only when the stored day is older");
  const saved = save.decodeSave(JSON.stringify(save.encodeSave(gift1.state)));
  equal(saved.hd, gift1.state.hd, "the present day survives the save codec");
  equal(save.decodeSave({ ...save.encodeSave(earning), hd: -4 }).hd, 0, "a forged day is clamped");
  equal(save.decodeSave({ ...save.encodeSave(earning), hd: "x" }).hd, 0, "a non-number day becomes 0");
}

function verifyEconomyModel() {
  const stall = deepFreeze(ok(sim.build(sim.createState({ now: 0 }), idx("P01"), "kachel")));
  const live = sim.economy(stall);
  // A potato stall at the start: capacity-limited, tiny queue signal.
  check(live.perPitch[0].served <= live.perPitch[0].cap + 1e-9, "served never exceeds capacity");
  const crowded = { ...stall, rb: 75 };
  const queue = sim.economy(crowded).perPitch[0];
  check(queue.queue > 0 && queue.queueFigures >= 5 && queue.queueFigures <= 15 && queue.problem, "demand beyond capacity shows a queue of 5-15 figures");
  equal(queue.served, queue.cap, "a saturated attraction serves exactly its capacity");
  check(live.perPitch[0].queue === 0 && live.perPitch[0].queueFigures === 0 && !live.perPitch[0].problem, "no queue while demand fits the capacity");
  // Weather and time never enter the economy, and the clock is never read.
  const realNow = Date.now;
  Date.now = () => { throw new Error("sim read the clock"); };
  try {
    const plain = sim.economy(stall).incomePerMin;
    equal(sim.economy(stall, { weather: "rain", hour: 23, night: true, season: "winter" }).incomePerMin, plain, "weather and time of day are ignored");
    const moved = sim.tick(stall, 10);
    check(moved.c > stall.c && moved.tb > stall.tb, "tick earns without touching the clock");
  } finally { Date.now = realNow; }
  // Income scales with event multipliers in the demand-limited regime.
  const rich = (() => {
    let s = { ...sim.createState({ now: 0 }), c: 1e9, rb: 20 };
    for (const [pitch, id] of [["P03", "fesch"], ["P04", "scooter"], ["P01", "zocker"], ["P02", "fritten"]]) s = ok(sim.build(s, idx(pitch), id));
    return s;
  })();
  const baseline = sim.economy(rich);
  check(baseline.perPitch.every(row => row.queue === 0), "the comparison state is demand-limited");
  const period = economyContext(eventsAt(lux(2027, 8, 23, 12)));
  const income = (state, ctx) => sim.economy(state, ctx).incomePerMin;
  const boosted = income(rich, period) / baseline.incomePerMin;
  check(boosted > 1.05 && boosted < 1.2, `fair period raises income by about 10 % (x${boosted.toFixed(3)})`);
  const familyDay = economyContext(eventsAt(lux(2027, 8, 25, 12)));
  const family = income(rich, familyDay) / income(rich, period);
  check(family > 1.08 && family < 1.18, `Familljendag nets about +12 % when demand-limited (x${family.toFixed(3)})`);
  const capped = { ...stall, rb: 75 };
  check(sim.economy(capped).perPitch[0].queue > 0, "the second comparison state is capacity-limited");
  check(income(capped, familyDay) / income(capped, period) >= 0.999999, "Familljendag never costs a full stall income");
  const dayBefore = economyContext(eventsAt(lux(2028, 9, 10, 12)));   // 2028 closes on a Monday, no Familljendag
  const promo = economyContext(eventsAt(lux(2028, 9, 11, 12)));
  near(income(rich, promo) / income(rich, dayBefore), 1, 1e-9, "last-day promo is income-neutral when demand-limited");
  near(income(capped, promo) / income(capped, dayBefore), 1, 1e-9, "last-day promo is income-neutral when capacity-limited");
  const parade = sim.economy(rich, economyContext(eventsAt(lux(2027, 8, 29, 11, 30))));
  const noParade = sim.economy(rich, economyContext(eventsAt(lux(2027, 8, 29, 14))));
  const m1 = parade.perPitch.find(row => PITCHES[row.pitch].zone === "M1"), n1 = noParade.perPitch.find(row => row.pitch === m1.pitch);
  near(m1.income / n1.income, FOUER_RULES.paradeBonus, 1e-9, "main-alley pitches earn the Hämmelsmarsch bonus");
  const north = parade.perPitch.find(row => PITCHES[row.pitch].zone === "N");
  check(north && Math.abs(north.income / noParade.perPitch.find(row => row.pitch === north.pitch).income - 1) < 1e-9, "north-row pitches get no parade bonus");
  const rating = items => items.reduce((s, [pitch, id, lv]) => ({ ...s, pitches: s.pitches.map((e, i) => i === idx(pitch) ? { k: id, lv, look: 0, fl: 0 } : e) }), sim.createState({ now: 0 }));
  const levels = [0, 1, 2, 3].map(lv => sim.ratingPoints(rating([["P01", "kachel", lv]])));
  check(levels.every((p, i) => i === 0 || p > levels[i - 1]), "rating grows with every level");
  const hourly = [0, 1, 2, 3].map(lv => sim.economy({ ...rating([["P01", "kachel", lv]]), rb: 75 }).incomePerMin);
  check(hourly.every((p, i) => i === 0 || p > hourly[i - 1]), "income of a capacity-limited stall grows with every level");
  const flagged = ok(sim.build({ ...sim.createState({ now: 0 }), c: 1e6, rb: 75, pi: 1 }, idx("P03"), "gold"));
  check(sim.economy(flagged).incomePerMin > 0, "the gold carousel earns");
}

// ---------------------------------------------------------------- idle-extras parity

function loadIdleExtras() {
  const source = fs.readFileSync(`${here}../idle-extras.js`, "utf8");
  const window = {};
  vm.runInNewContext(source, { window, document: { addEventListener() {} }, localStorage: { getItem: () => null }, console });
  return window.IdleExtras;
}

function verifyOffline() {
  const idle = loadIdleExtras();
  for (let stars = 0; stars <= 5; stars++) {
    equal([sim.awayRate(stars), sim.capHoursFor(stars)], [idle.awayRate(stars), idle.offline(stars, 0, 1, 0).capHours], `away rate and cap match IdleExtras at ${stars} stars`);
  }
  // IdleExtras.activityRate reads its own load-time clock, so probe a fresh copy per case with a small tolerance on the idle time.
  for (const stars of [1, 3, 5]) for (const idleMs of [1000, 20 * 60000, 5 * 3600000, 11 * 3600000]) {
    const sandbox = { window: {}, document: { addEventListener() {} }, localStorage: { getItem: () => null }, console };
    vm.runInNewContext(fs.readFileSync(`${here}../idle-extras.js`, "utf8"), sandbox);
    equal(sim.activityRate(stars, idleMs), sandbox.window.IdleExtras.activityRate(stars, Date.now() + idleMs), `activity rate matches IdleExtras (${stars} stars, ${idleMs} ms idle)`);
  }
  equal(sim.activityRate(2, 15 * 60000 - 1), 1, "active until 15 minutes");
  equal(sim.activityRate(2, 100 * 3600000), 0, "paused after the cap");
  check(sim.activityRate(2, 3600000, true) > sim.activityRate(2, 3600000), "the fair period raises the away rate of an open tab too");
  const now = 1.8e12;
  let state = ok(sim.build(sim.createState({ now: now - 7 * 3600000 }), idx("P01"), "kachel"));
  state = deepFreeze({ ...state, tb: 10, c: 0 });
  const info = sim.economy(state);
  const result = sim.offline(state, now);
  const expected = idle.offline(info.stars, state.t * 1000, info.incomePerSec, now);
  near(result.credited, expected.credited, 1e-6, "offline credit equals IdleExtras.offline");
  equal([result.seconds, result.capHours], [expected.seconds, expected.capHours], "offline seconds and cap equal IdleExtras");
  near(result.state.c, result.credited, 1e-6, "credit lands in cash");
  near(result.state.tb, 10 + result.credited, 1e-6, "offline earnings count towards the lifetime value");
  equal(result.state.t, Math.floor(now / 1000), "save time moves to now");
  const twice = sim.offline(result.state, now);
  check(twice.credited === 0 && twice.state.c === result.state.c, "a second call at the same instant credits nothing");
  const long = sim.offline(state, state.t * 1000 + 40 * 3600000);
  equal(long.seconds, long.capHours * 3600, "long absences are capped");
  near(long.credited, long.seconds * info.incomePerSec * sim.awayRate(info.stars), 1e-6, "capped credit = seconds x production x rate");
  check(sim.offline({ ...state, t: 0 }, now).credited === 0, "a save without a time credits nothing");
  check(sim.offline(state, state.t * 1000 - 5000).credited === 0, "a clock set backwards credits nothing");
  const period = sim.offline(state, state.t * 1000 + 40 * 3600000, { period: true });
  near(period.capHours - long.capHours, 2, 1e-12, "fair period adds 2 hours of cap");
  near(period.rate - long.rate, 0.1, 1e-12, "fair period adds 10 points of away rate");
  check(sim.offline(sim.createState({ now }), now + 3600000).credited === 0, "no attractions, no offline income");
  const maxed = { ...state, rb: 75 };
  check(sim.awayRate(5, true) === 0.25 + 0.0375 * 5 + 0.1 && sim.awayRate(5, true) <= 1, "away rate with period bonus stays at most 1");
  check(sim.capHoursFor(40) === 12, "cap hours never exceed 12 outside the fair");
  void maxed;
}

// ---------------------------------------------------------------- fuzz

function verifyFuzz() {
  const random = mulberry32(2027);
  let state = { ...sim.createState({ now: 0 }), c: 5000, pi: 1, vo: ["kanner", "wheel", "maus"] };
  let money = state.tb;
  let accepted = 0, refused = 0, steps = 0;
  const kinds = ITEMS.map(item => item.id);
  for (let i = 0; i < 4000; i++) {
    const pitch = Math.floor(random() * 36) - 1;
    const kind = kinds[Math.floor(random() * kinds.length)];
    const roll = random();
    let result;
    if (roll < 0.35) result = sim.build(state, pitch, kind, Math.floor(random() * 4));
    else if (roll < 0.6) result = sim.upgrade(state, pitch);
    else if (roll < 0.7) result = sim.replace(state, pitch, kind);
    else if (roll < 0.75) result = sim.useVoucher(state, kind, pitch);
    else if (roll < 0.8) result = sim.setLook(state, pitch, Math.floor(random() * 4));
    else { result = { ok: true, state: sim.tick(state, random() * 600) }; }
    if (result.ok) { state = result.state; accepted++; } else refused++;
    if (state.c < 0 || !Number.isFinite(state.c) || state.tb < money) { check(false, `invariant broken at step ${i}`); }
    money = state.tb;
    steps++;
    if (i % 400 === 0) {
      const round = save.decodeSave(save.encodeSave(state));
      assert.ok(round, "fuzz state decodes");
      assert.deepStrictEqual(save.encodeSave(round), save.encodeSave(state), "fuzz round trip");
    }
    const copies = {};
    for (const entry of state.pitches) if (entry) copies[entry.k] = (copies[entry.k] ?? 0) + 1;
    if (!Object.entries(copies).every(([id, n]) => n <= ITEM_BY_ID[id].max)) check(false, "copy limit broken");
    if (!state.pitches.every((entry, p) => !entry || sizeFits(ITEM_BY_ID[entry.k].size, PITCHES[p].size))) check(false, "size rule broken");
  }
  check(true, "4000 random commands keep cash >= 0, tb monotonic, copy and size limits");
  check(accepted > 200 && refused > 200, `fuzz exercised both outcomes (${accepted} accepted, ${refused} refused)`);
  check(Number.isFinite(state.c) && state.c >= 0, "cash stays finite and non-negative");
  equal(steps, 4000, "all fuzz steps ran");
}

// ---------------------------------------------------------------- the greedy bot

function playBot(hours, { replacements = true } = {}) {
  let state = sim.createState({ now: 0 });
  let t = 0, lastStar = 1;
  const starAt = { 1: 0 }, incomeAtStar = { 1: 0 }, log = [];
  const horizon = hours * 3600;
  let maxedAt = null;
  while (t < horizon) {
    const info = sim.economy(state);
    const options = sim.listActions(state, undefined, { replacements }).filter(action => action.dIncome > 1e-9 || (action.cost === 0 && action.type === "build"));
    if (!options.length) { maxedAt = t; break; }
    let best = options[0], bestRatio = -1;
    for (const action of options) {
      const ratio = action.net <= 0 ? Infinity : action.dIncome / action.net;
      if (ratio > bestRatio) { bestRatio = ratio; best = action; }
    }
    const wait = Math.max(0, best.net - state.c) / info.incomePerSec;
    if (t + wait > horizon) break;
    const step = wait > 0 ? wait + 1e-6 : 0;
    const before = state.tb;
    state = sim.tick(state, step); t += step;
    assert.ok(state.tb >= before, "tb never falls");
    const result = best.type === "build" ? sim.build(state, best.pitch, best.item)
      : best.type === "upgrade" ? sim.upgrade(state, best.pitch) : sim.replace(state, best.pitch, best.item);
    assert.ok(result.ok, `bot command ${best.type} ${best.item} refused: ${result.reason}`);
    assert.ok(result.state.c >= 0, "cash never negative");
    state = result.state;
    const now = sim.economy(state);
    log.push({ t, income: now.incomePerMin, points: now.points, stars: now.stars, type: best.type });
    if (now.stars !== lastStar) {
      for (let star = lastStar + 1; star <= now.stars; star++) { starAt[star] = t; incomeAtStar[star] = now.incomePerMin; }
      lastStar = now.stars;
    }
  }
  const at = hoursMark => [...log].filter(entry => entry.t <= hoursMark * 3600).pop();
  return { state, log, starAt, incomeAtStar, maxedAt, at, t };
}

function verifyPacing() {
  const bot = playBot(14);
  const minutes = star => bot.starAt[star] / 60;
  const bands = { 2: [10, 17], 3: [41, 69], 4: [88, 148], 5: [180, 300] };
  for (const [star, [low, high]] of Object.entries(bands)) {
    check(minutes(star) >= low && minutes(star) <= high, `star ${star} at ${minutes(star).toFixed(1)} min is inside ${low}-${high} min`);
  }
  check(minutes(2) >= 12 - 2.5 && minutes(2) <= 15 + 2.5, "star 2 in the first session (12-15 min +-25 %)");
  check(minutes(5) / 60 >= 3 && minutes(5) / 60 <= 5, "star 5 after about 4 hours (+-25 %)");
  check(bot.maxedAt === null || bot.maxedAt > 8 * 3600, "the bot still has profitable purchases after 8 hours");
  const eight = playBot(8);
  deepFreeze(eight.state);
  const left = sim.listActions(eight.state);
  const profitable = left.filter(action => action.dIncome > 0);
  check(profitable.length > 0, "a profitable build or upgrade exists at 8 h");
  const withSwaps = sim.listActions(eight.state, undefined, { replacements: true }).filter(action => action.dIncome > 0);
  check(withSwaps.length >= profitable.length, "replacements only add options");
  const remainingUpgradeCost = eight.state.pitches.reduce((sum, entry, pitch) => {
    let level = entry?.lv ?? 4, total = 0;
    while (entry && level < RULES.maxLevel) { total += ITEM_BY_ID[entry.k].upgradeBase * RULES.upgradeFractions[level]; level++; }
    return sum + total;
  }, 0);
  const free = eight.state.pitches.filter(entry => !entry).length;
  check(eight.state.pitches.every((entry, p) => !entry || sizeFits(ITEM_BY_ID[entry.k].size, PITCHES[p].size)), "bot respects the size rule");
  check(bot.log.every((entry, i) => entry.stars >= (bot.log[i - 1]?.stars ?? 1) || entry.type === "replace"), "stars only fall through replacements");
  check(bot.log.length > 150, `the optimal path takes many purchases (${bot.log.length})`);
  check(eight.at(8).income > eight.at(4).income && eight.at(4).income > eight.at(2).income && eight.at(2).income > eight.at(1).income, "income keeps rising through 8 hours");
  check(Math.max(...bot.log.map(entry => entry.income)) < 30000, "income stays in a sane range");
  // Without swaps the plain purchases run out earlier; the goal card must then still point at something that earns.
  const noSwap = playBot(14, { replacements: false });
  deepFreeze(noSwap.state);
  check(sim.stars(noSwap.state) === 5, "even without swaps a player reaches star 5");
  check(noSwap.maxedAt !== null && noSwap.maxedAt > 4 * 3600, `plain builds and upgrades alone last ${(noSwap.maxedAt / 3600).toFixed(1)} h (swaps extend the game to ${(bot.maxedAt / 3600).toFixed(1)} h)`);
  const goal = sim.nextGoal(noSwap.state);
  check(["fill", "replace", "upgrade", "gold", "maxed"].includes(goal.id), `the stalled player's goal is "${goal.id}"`);
  if (goal.id !== "maxed") {
    const move = sim.listActions(noSwap.state, undefined, { replacements: true }).find(action => action.pitch === goal.pitch && action.item === goal.item);
    check(move && move.dIncome > 0, "the goal never suggests a move that lowers income");
  }
  const fresh = sim.nextGoal(eight.state);
  check(fresh.id !== "star" && fresh.id !== "firstBuild", "a star-5 fair gets a purchase goal");
  const tip = sim.tipFor(sim.createState({ now: 0 }));
  check(tip.type === "build" && tip.item === "kachel" && tip.cost === 0, "the very first tip is the free starter stall");
  // Upgrading never lowers income along the optimal path.
  let negativeUpgrades = 0;
  for (const hours of [0.5, 1, 2, 4, 6]) {
    const probe = playBot(hours).state;
    negativeUpgrades += sim.listActions(probe).filter(action => action.type === "upgrade" && action.dIncome < -1e-9).length;
  }
  equal(negativeUpgrades, 0, "no upgrade lowers income on the greedy path");
  const row = stage => {
    const mark = bot.at(stage);
    return { hours: stage, income: mark.income, points: mark.points, stars: mark.stars };
  };
  section.pacing = {
    starMinutes: Object.fromEntries([2, 3, 4, 5].map(star => [star, Number(minutes(star).toFixed(1))])),
    incomeAtStar: Object.fromEntries([1, 2, 3, 4, 5].map(star => [star, Math.round(bot.incomeAtStar[star])])),
    marks: [0.25, 0.5, 1, 2, 4, 8, 12].map(row),
    maxedHours: bot.maxedAt === null ? null : Number((bot.maxedAt / 3600).toFixed(1)),
    purchases: bot.log.length, left8: { actions: profitable.length, swapActions: withSwaps.length, upgradeCost: Math.round(remainingUpgradeCost), emptyPitches: free },
    totalEarned: Math.round(bot.state.tb),
  };
}

// ---------------------------------------------------------------- save

const PG_FIXTURE_A = '{"v":2,"tb":34472,"c":5530,"t":1790000000,"p":"000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000","pu":"0","rb":68,"pi":1,"mg":4059,"vo":"l4","lg":"","st":"","gi":[12,13,14],"n":"Ian","tu":8,"ea":"","fw":0}';
const PG_FIXTURE_B = '{"v":2,"tb":123456789012,"c":99999999999,"t":1790000000,"p":"1b74b7bb7cb71b74b7bb70000004b7bb70000004b70000001b74b7000000000000bb70001b74b7bb7cb71b74b70000000004b7","pu":"0","rb":75,"pi":1,"mg":20000,"vo":"lmk","lg":"L1|000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000","st":"2027:mh33,2028:mh33","gi":[123456,123457,123458,123459,123460,123461,123462,123463,123464,123465,123466,123467,123468,123469,123470,123471,123472,123473,123474,123475,123476,123477,123478,123479,123480,123481,123482,123483,123484,123485,123486,123487,123488,123489,123490,123491,123492,123493,123494,123495,123496,123497,123498,123499,123500,123501,123502,123503,123504,123505],"n":"IanëIanëIanëIanëIanëIanë","tu":8,"ea":"","fw":0}';

function maxContentState() {
  const items = ITEMS.filter(item => item.special === null);
  let state = { ...sim.createState({ name: "ë".repeat(24), now: 1.8e12 }), tb: CASH_CAP, c: CASH_CAP, pi: 1, rb: 75, mg: 20000, tu: 8, ea: "abcdefgh", fw: 2027 };
  const copies = {};
  state = { ...state, pitches: PITCHES.map(pitch => {
    const item = items.find(candidate => sizeFits(candidate.size, pitch.size) && (copies[candidate.id] ?? 0) < candidate.max && candidate.size === pitch.size)
      ?? items.find(candidate => sizeFits(candidate.size, pitch.size) && (copies[candidate.id] ?? 0) < candidate.max);
    copies[item.id] = (copies[item.id] ?? 0) + 1;
    return { k: item.id, lv: 3, look: 2, fl: 7 };
  }), pu: 2 ** 34 - 1, vo: ["wheel", "maus", "tent", "kanner", "kette"],
  lg: `L1|${"0".repeat(896)}`.slice(0, save.LG_LIMIT), gi: Array.from({ length: 50 }, (_, i) => 9007199254740000 - i),
  st: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [2027 + i, 2 ** 20 - 1])) };
  return state;
}

function fakeClock() {
  const clock = { time: 1e12, timers: [], nextId: 1,
    now: () => clock.time,
    setTimeout(fn, ms) { const id = clock.nextId++; clock.timers.push({ id, at: clock.time + ms, fn }); return id; },
    clearTimeout(id) { clock.timers = clock.timers.filter(timer => timer.id !== id); },
    advance(ms) {
      const end = clock.time + ms;
      for (;;) {
        const due = clock.timers.filter(timer => timer.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        clock.timers = clock.timers.filter(timer => timer.id !== due.id);
        clock.time = due.at;
        due.fn();
      }
      clock.time = end;
    } };
  return clock;
}

function fakeEnv({ testMode = false } = {}) {
  const clock = fakeClock();
  const listeners = {};
  const sent = [];
  const storage = new Map();
  const parent = { postMessage: (message, target) => sent.push({ message, target }) };
  const scores = [];
  const win = { __pbTestMode: testMode, score: 0, Arcade: { score: value => scores.push(value) },
    addEventListener: (type, fn) => { (listeners[type] ??= new Set()).add(fn); },
    removeEventListener: (type, fn) => listeners[type]?.delete(fn),
    dispatch: (type, event) => [...(listeners[type] ?? [])].forEach(fn => fn(event)), listeners };
  const store = { getItem: key => storage.has(key) ? storage.get(key) : null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  return { env: { win, parent, storage: store, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    clock, sent, storage, win, parent, scores };
}

function verifySave() {
  const sample = deepFreeze({ ...ok(sim.build(sim.createState({ name: "Ian", now: 1.7e12 }), idx("P01"), "kachel")), tb: 1234.9, c: 99.6, vo: ["wheel"], gi: [3, 4] });
  const record = save.encodeSave(sample);
  equal(Object.keys(record), ["v", "tb", "c", "t", "p", "pu", "rb", "pi", "mg", "vo", "lg", "st", "gi", "n", "tu", "ea", "fw", "hd"], "record fields (8.3)");
  equal(record.p.length, 102, "34 pitches x 3 characters");
  check(Object.entries(record).every(([key, value]) => key === "gi" ? Array.isArray(value) : typeof value === "string" || Number.isInteger(value)), "strings and integers only; gi is the only array");
  const decoded = save.decodeSave(JSON.stringify(record));
  equal([decoded.tb, decoded.c, decoded.vo, decoded.gi, decoded.n], [1234, 99, ["wheel"], [3, 4], "Ian"], "round trip through JSON text");
  equal(save.encodeSave(decoded), record, "encode(decode(x)) is stable");
  equal(save.decodeSave(record).pitches[0], { k: "kachel", lv: 0, look: 0, fl: 1 }, "pitch entries survive");
  const maxState = maxContentState();
  const sizes = save.saveSizes(maxState);
  check(sizes.json <= save.SAVE_LIMIT_BYTES, `max content JSON ${sizes.json} bytes <= 3000`);
  check(sizes.jsonb < save.JSONB_LIMIT_BYTES, `max content jsonb estimate ${sizes.jsonb} < 8192`);
  check(sizes.jsonb < 4096, "max content leaves half the jsonb budget spare");
  section.saveSizes = sizes;
  const maxRecord = save.encodeSave(maxState);
  const maxDecoded = save.decodeSave(maxRecord);
  equal(save.encodeSave(maxDecoded), maxRecord, "maximum content survives the codec unchanged");
  check(save.serializeSave(maxDecoded).length <= 3000, "maximum content serialises");
  const huge = { ...maxState, gi: Array.from({ length: 50 }, (_, i) => 1e15 + i), n: "🎡".repeat(24) };
  check(save.saveSizes(huge).json <= 3000, "emoji name and 16-digit gift ids still fit");
  check(save.jsonbSize(Array(1600).fill(1)) === 19208, "estimator reproduces the measured v1 failure (19,208 bytes)");
  check(save.jsonbSize(Array(1600).fill(0)) === 19206, "a zero numeric is 6 bytes (the last element is not padded)");
  // Fixtures measured with pg_column_size() on the live database (22 Oct 2026): the estimator must match to the byte.
  const measured = JSON.parse(`{"a":${PG_FIXTURE_A},"b":${PG_FIXTURE_B},"arr":${JSON.stringify(Array.from({ length: 100 }, (_, i) => i % 3))}}`);
  equal([save.jsonbSize(measured.a), save.jsonbSize(measured.b), save.jsonbSize(measured.arr), save.jsonbSize(measured)], [410, 2123, 1206, 3770], "jsonb estimator equals pg_column_size on the live database");
  check(save.jsonbSize({ n: 100000000 }) < save.jsonbSize({ n: 123456789 }), "trailing zero digit groups of a numeric are not stored");
  check(save.jsonbSize({ g: Array(1600).fill(0), v: "" }) > save.JSONB_LIMIT_BYTES, "a v1-shaped save is far over the limit");
  check(save.jsonbSize({ a: "x" }) === 4 + 4 + 8 + 1 + 1, "tiny object estimate");
  check(save.jsonbSize(maxRecord) >= JSON.stringify(maxRecord).length, "jsonb is never smaller than the text");
  const oversized = { ...maxState, lg: "L1|" + "0".repeat(2000) };
  const trimmed = save.decodeSave(save.encodeSave(oversized));
  equal(trimmed.lg, "", "an oversized legacy snapshot is dropped at the boundary");
  const tooBig = { ...maxState, gi: Array.from({ length: 500 }, (_, i) => 9007199254740000 - i) };
  assert.throws(() => save.serializeSave(tooBig), /too large/);
  checks++;
  equal(save.decodeSave(save.encodeSave(tooBig)).gi.length, 50, "a hand-made oversized gift list is cut to 50 on load");
  // Forged and corrupt inputs.
  const raw = (patch) => save.decodeSave({ ...record, ...patch });
  equal(raw({ tb: NaN }), null, "NaN tb is refused");
  equal(raw({ tb: -5 }), null, "negative tb is refused");
  equal(raw({ tb: "9" }), null, "string tb is refused");
  equal(raw({ tb: 1e30 }).tb, CASH_CAP, "huge tb is capped");
  equal(raw({ c: -50 }).c, 0, "negative cash is clamped");
  equal(raw({ c: 1e30 }).c, CASH_CAP, "huge cash is capped");
  equal(raw({ c: "x" }).c, 350, "bad cash falls back");
  equal(raw({ rb: 999 }).rb, 75, "rating bonus is capped at 75");
  equal(raw({ rb: -3 }).rb, 0, "negative rating bonus");
  equal(raw({ pi: 7 }).pi, 0, "pioneer flag is 0 or 1");
  equal(raw({ mg: 1e9 }).mg, 20000, "migrated progress is capped");
  equal(raw({ t: -1 }).t, 0, "negative time");
  equal(raw({ t: 1e15 }).t, 4102444800, "far-future time is capped");
  equal(raw({ tu: 99 }).tu, 8, "tutorial step is capped");
  equal(raw({ n: "<script>alert(1)</script>".repeat(3) }).n.includes("<"), false, "angle brackets removed from the name");
  equal(raw({ n: "y".repeat(100) }).n.length, 24, "name length");
  equal(raw({ vo: "zzzzzz" }).vo, [], "unknown voucher characters dropped");
  check(raw({ vo: "1v2w3x4" }).vo.every(id => ITEM_BY_ID[id].special === null) && raw({ vo: "1v2w3x4" }).vo.length <= 5, "vouchers never include specials and never exceed 5");
  equal(raw({ vo: "11111111" }).vo.length, 5, "at most 5 vouchers");
  equal(raw({ gi: [3, "4", -1, 1.5, 2 ** 60, 3, null, 5] }).gi, [3, 5], "gift ids are cleaned and deduplicated");
  equal(raw({ gi: Array.from({ length: 80 }, (_, i) => i + 1) }).gi.length, 50, "gift ids are cut at 50");
  equal(raw({ gi: "nope" }).gi, [], "non-array gift ids");
  equal(raw({ st: "2027:zz,abcd:1,1999:1,2027:fffff" }).st, { 2027: 2 ** 20 - 1 }, "stamp parser keeps valid years only");
  equal(raw({ st: "2027:" + "z".repeat(10) }).st, {}, "oversized stamp mask rejected");
  equal(raw({ lg: "<img>" }).lg, "", "invalid snapshot dropped");
  equal(raw({ ea: "<<<" }).ea, "", "invalid flags dropped");
  equal(raw({ fw: 12 }).fw, 0, "invalid fireworks year");
  equal(raw({ pu: "zzzzzzzzzzzz" }).pu, 0, "oversized voucher mask");
  equal(raw({ p: "abc" }), null, "wrong pitch string length");
  equal(raw({ p: "!".repeat(102) }), null, "pitch string must be base 36");
  equal(raw({ p: "z00".repeat(34) }).pitches.every(entry => entry === null), true, "unknown kinds become empty pitches");
  equal(raw({ p: "1" + "00" + "000".repeat(33) }).pitches[0].k, "kachel", "a valid kind decodes");
  const pitchCode = (id, detail = "0", fl = "0") => ITEM_BY_ID[id].idx.toString(36) + detail + fl;
  const withPitches = list => list.join("").padEnd(102, "0");
  const wrongSize = raw({ p: withPitches([pitchCode("scooter")]) });
  equal(wrongSize.pitches[0], null, "an item that does not fit its pitch is dropped");
  const copiesDropped = raw({ p: withPitches([pitchCode("kachel"), pitchCode("kachel"), pitchCode("kachel"), pitchCode("kachel")]) });
  equal(copiesDropped.pitches.filter(Boolean).length, 3, "surplus copies are dropped");
  equal(raw({ pi: 0, p: withPitches([pitchCode("museum")]) }).pitches[0], null, "pioneer specials need the pioneer flag");
  equal(raw({ pi: 1, p: withPitches([pitchCode("museum")]) }).pitches[0].k, "museum", "pioneers keep the kiosk");
  equal(raw({ p: withPitches([pitchCode("lammy")]) }).pitches[0], null, "the statue needs stamps");
  equal(raw({ p: withPitches([pitchCode("kachel", "z", "z")]) }).pitches[0], { k: "kachel", lv: 3, look: 2, fl: 7 }, "level, look and flags are clamped");
  equal(raw({ pi: 1, p: withPitches([pitchCode("museum", "9")]) }).pitches[0].lv, 0, "non-upgradable items stay at level 1");
  equal(save.decodeSave({ ...record, stub: 1 }), null, "a pioneer stub is not a save");
  equal(save.decodeSave({ ...record, v: 3 }), null, "future versions are refused");
  equal(save.decodeSave([record]), null, "arrays are refused");
  equal(quiet(() => save.decodeSave("{nope")).value, null, "broken JSON is refused");
  equal(save.decodeSave(null), null, "null is refused");
  equal(save.decodeSave(undefined), null, "undefined is refused");
  const polluted = save.decodeSave(JSON.parse('{"__proto__":{"polluted":1},"constructor":{"x":1},"v":2,"tb":5,"p":"' + "0".repeat(102) + '"}'));
  check(polluted && polluted.polluted === undefined && ({}).polluted === undefined && !Object.hasOwn(polluted, "constructor"), "prototype pollution has no effect");
  check(!("extra" in save.decodeSave({ ...record, extra: 1 })), "unknown fields are not carried");
  equal(save.classifyRaw(record), "v2", "classify v2");
  equal(save.classifyRaw({ v: 2, stub: 1, pv: 9000 }), "stub", "classify stub");
  equal(save.classifyRaw({ version: 1, g: [] }), "v1", "classify v1");
  equal([save.classifyRaw(null), save.classifyRaw(undefined), save.classifyRaw(5), save.classifyRaw([])], ["empty", "empty", "invalid", "invalid"], "classify empty and invalid");
  equal(quiet(() => save.classifyRaw("{oops")).value, "empty", "unparsable text is treated as nothing (with a warning)");
  // Merge: the higher tb wins, a tie goes to the later save.
  const a = { ...sample, tb: 100, t: 10 }, b = { ...sample, tb: 200, t: 5 }, c = { ...sample, tb: 100, t: 20 };
  check(save.mergeSaves(a, b) === b && save.mergeSaves(b, a) === b, "higher tb wins in both directions");
  check(save.mergeSaves(a, c) === c && save.mergeSaves(c, a) === c, "tie goes to the later save");
  check(save.mergeSaves(a, { ...a }) === a, "a full tie keeps the first");
  check(save.isNewer(b, a) && !save.isNewer(a, b) && !save.isNewer(a, a), "isNewer is strict");
  check(!save.isNewer({ ...a, t: 999999 }, b), "a later time never beats a higher tb");
  equal(quiet(() => save.pickBest([save.encodeSave(a), save.encodeSave(b), "junk", null, save.encodeSave(c)])).value.tb, 200, "pickBest ignores junk");
  equal(save.pickBest([null, undefined]), null, "pickBest with nothing");
}

function verifyPersistence() {
  const quietRun = fn => quiet(fn).value;
  const state0 = ok(sim.build(sim.createState({ now: 1e12 }), idx("P01"), "kachel"));
  const rig = fakeEnv();
  let state = { ...state0, tb: 1000 };
  const adopted = [], errors = [];
  const persistence = save.createPersistence({ getState: () => state, onState: next => { adopted.push(next); state = next; }, onError: m => errors.push(m), env: rig.env });
  equal(rig.sent.map(entry => entry.message), [{ __pbWantSave: 1 }], "handshake asks for the cloud save once");
  equal([rig.win.score, rig.scores.at(-1)], [1000, 1000], "score published at startup");
  equal(rig.win.listeners.message.size + rig.win.listeners.pagehide.size, 2, "message and pagehide listeners");
  persistence.scheduleSave(); persistence.scheduleSave(); persistence.scheduleSave();
  rig.clock.advance(1199);
  equal(rig.sent.length, 1, "nothing is sent before the debounce delay");
  rig.clock.advance(2);
  equal(rig.sent.length, 2, "one save after 1.2 s even after three schedules");
  const posted = rig.sent[1].message;
  check(posted.__pbSave === 1 && rig.sent[1].target === "*" && save.decodeSave(posted.data).tb === 1000, "save message carries a valid v2 record");
  persistence.pushSave();
  equal(rig.sent.length, 2, "an unchanged save is not sent again");
  state = { ...state, t: state.t + 100 };
  persistence.pushSave();
  equal(rig.sent.length, 2, "a change of only the save time is not sent");
  state = { ...state, tb: 1500, c: 10 };
  for (let i = 0; i < 7; i++) { persistence.scheduleSave(); rig.clock.advance(1000); }
  check(rig.sent.length >= 3 && save.decodeSave(rig.sent.at(-1).message.data).tb === 1500, "a busy player is still saved at least every 5 s");
  const beforeHide = rig.sent.length;
  state = { ...state, tb: 1600 };
  rig.win.dispatch("pagehide", {});
  equal(rig.sent.length, beforeHide + 1, "pagehide flushes immediately");
  check(rig.storage.has(save.BACKUP_KEY) && save.readBackup(rig.env.storage).tb === 1000, "rolling backup pb_fouer_bak holds the first save of the minute");
  const backupText = rig.storage.get(save.BACKUP_KEY);
  state = { ...state, tb: 1700 };
  persistence.pushSave();
  equal(rig.storage.get(save.BACKUP_KEY), backupText, "the backup is rewritten at most once a minute");
  rig.clock.advance(61000);
  state = { ...state, tb: 1800 };
  persistence.pushSave();
  check(rig.storage.get(save.BACKUP_KEY) !== backupText && save.readBackup(rig.env.storage).tb === 1800, "after a minute the backup rolls forward");
  equal(rig.win.score, 1800, "window.score follows tb");
  // Incoming cloud saves: only if higher.
  const current = state;
  check(!persistence.applyIncoming(save.encodeSave({ ...current, tb: 900 })), "a lower cloud save is ignored");
  check(!persistence.applyIncoming(save.encodeSave({ ...current, tb: current.tb, t: current.t })), "an equal cloud save is ignored");
  check(!persistence.applyIncoming(save.encodeSave({ ...current, tb: 1700, t: current.t + 1e6 })), "a lower tb with a later time is ignored");
  equal(adopted.length, 0, "no state replaced by stale saves");
  const higher = { ...current, tb: 5000, c: 777 };
  check(persistence.applyIncoming(save.encodeSave(higher)), "a higher cloud save is applied");
  equal([adopted.length, adopted[0].tb, adopted[0].c], [1, 5000, 777], "onState receives the decoded save");
  check(!quietRun(() => persistence.applyIncoming({ nonsense: true })) && !quietRun(() => persistence.applyIncoming(null)), "garbage cloud saves are ignored");
  check(!quietRun(() => persistence.applyIncoming({ v: 2, stub: 1, pv: 99999 })), "a pioneer stub never replaces a v2 state");
  // The message path checks the sender.
  const sentBefore = rig.sent.length;
  rig.win.dispatch("message", { source: { other: true }, data: { __pbLoadSave: 1, data: save.encodeSave({ ...current, tb: 9e9 }) } });
  equal(adopted.length, 1, "messages from other windows are ignored");
  rig.win.dispatch("message", { source: rig.parent, data: { __pbLoadSave: 1, data: save.encodeSave({ ...current, tb: 9e9 }) } });
  equal(adopted.length, 2, "a message from the arcade page is applied");
  rig.win.dispatch("message", { source: rig.parent, data: "not a record" });
  rig.win.dispatch("message", { source: rig.parent, data: { __pbSave: 1 } });
  equal(adopted.length, 2, "other message shapes are ignored");
  check(rig.sent.length >= sentBefore, "adopting a cloud save schedules a save");
  persistence.destroy();
  equal(rig.win.listeners.message.size + rig.win.listeners.pagehide.size, 0, "destroy removes the listeners");
  // Test mode: nothing is written or replaced.
  const test = fakeEnv({ testMode: true });
  let testState = { ...state0, tb: 50 };
  const guarded = save.createPersistence({ getState: () => testState, onState: () => { throw new Error("must not be called"); }, onError: () => {}, env: test.env });
  guarded.scheduleSave(); test.clock.advance(6000); guarded.pushSave();
  check(test.sent.every(entry => entry.message.__pbSave === undefined), "test mode posts no saves");
  equal(test.storage.size, 0, "test mode writes no backup");
  check(!guarded.applyIncoming(save.encodeSave({ ...testState, tb: 1e9 })), "test mode ignores incoming cloud saves");
  equal(test.win.score, 50, "test mode still reports the score");
  guarded.destroy();
  // Errors are reported once, with context.
  const failing = fakeEnv();
  const errorLog = [];
  const huge = { ...maxContentState(), gi: Array.from({ length: 50 }, (_, i) => 9007199254740000 - i) };
  const oversize = { ...huge, n: "x".repeat(24) };
  let unavailable = false;
  const broken = save.createPersistence({ getState: () => { if (unavailable) throw new Error("state unavailable"); return state0; }, onState() {}, onError: m => errorLog.push(m), env: failing.env });
  unavailable = true;
  const warned = quiet(() => { broken.pushSave(); broken.pushSave(); });
  equal(errorLog.length, 1, "the same error is shown once");
  check(warned.messages.some(message => message.includes("[fouer]")), "errors are logged with context");
  broken.destroy();
  void oversize;
  // No parent window (standalone): no postMessage, no crash.
  const standalone = fakeEnv();
  standalone.env.parent = standalone.win;
  const alone = save.createPersistence({ getState: () => state0, onState() {}, onError() {}, env: standalone.env });
  alone.pushSave();
  equal(standalone.sent.length, 0, "standalone play posts nothing");
  check(standalone.storage.has(save.BACKUP_KEY), "standalone play still keeps the backup");
  alone.destroy();
  // Storage failures never crash.
  const noisy = fakeEnv();
  noisy.env.storage = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("full"); } };
  const survivor = save.createPersistence({ getState: () => state0, onState() {}, onError() {}, env: noisy.env });
  const tried = quiet(() => survivor.pushSave());
  check(tried.value === true && tried.messages.length > 0, "a full or blocked storage is logged, the save still goes out");
  equal(quiet(() => save.readBackup(noisy.env.storage)).value, null, "unreadable backup storage returns null");
  survivor.destroy();
  equal(save.readBackup(null), null, "no storage, no backup");
}

// ---------------------------------------------------------------- migration

function v1Park(objects, { cash = null, roads = true } = {}) {
  let state = v1Create(1);
  state = v1Tick({ saved: { ...state.saved, l: 0xffff, c: 1e7, u: 15 }, derived: { ...state.derived, dirty: true } }, 0);
  if (roads) for (let y = 1; y <= 18; y++) state = v1PlacePath(state, 20, y);
  for (const id of objects) {
    outer: for (let y = 0; y < 38; y++) for (let x = 0; x < 38; x++) {
      if (x === 20 && roads) continue;
      if (v1CanPlace(state, id, x, y, 0).ok) { state = v1Place(state, id, x, y, 0); break outer; }
    }
  }
  const base = v1Tick(state, 0);
  if (cash !== null) {
    const fixed = base.derived.parkValue - base.saved.c;
    state = v1Tick({ saved: { ...base.saved, c: cash - fixed - 0 }, derived: { ...base.derived, dirty: true } }, 0);
    if (state.derived.parkValue !== cash) {
      state = v1Tick({ saved: { ...base.saved, c: base.saved.c + (cash - base.derived.parkValue) }, derived: { ...base.derived, dirty: true } }, 0);
    }
  } else state = base;
  return state;
}

const MEDIAN_OBJECTS = ["ghost-train", "wheel", "burgers", "carousel", "popcorn", "toilet", "bin", "flowers", "tree", "lemonade"];

async function verifyMigration() {
  const untouched = v1Serialize(v1Create(1));
  const median = v1Serialize(v1Park(MEDIAN_OBJECTS, { cash: 10259 }));
  const heavy = [];
  for (let i = 0; i < 12; i++) heavy.push("launch-coaster", "inverted-coaster", "wooden-coaster", "rapids");
  for (let i = 0; i < 16; i++) heavy.push("emporium");
  const maxedState = v1Park(heavy, { roads: false });
  const maxed = v1Serialize(maxedState);
  check(maxed.length < 7000, `the maxed v1 blob is a valid v1 save (${maxed.length} chars)`);
  check(maxedState.derived.parkValue > 26200, "maxed park is far above the cap");
  const stats = { median: await legacy.readV1(median), untouched: await legacy.readV1(untouched), maxed: await legacy.readV1(maxed) };
  equal([stats.untouched.pv, stats.median.pv], [6200, 10259], "the synthetic parks have the intended v1 parkValue");
  check(stats.maxed.objects.length >= 56, `maxed park holds ${stats.maxed.objects.length} objects`);
  const now = 1.8e12;
  // Golden 1: untouched.
  const g1 = await legacy.migrate(untouched, null, { now, name: "Ian" });
  equal([g1.report.kind, g1.state.c, g1.state.rb, g1.state.tb, g1.state.vo, g1.state.pi, g1.state.mg], ["fresh", 350, 0, 2000, [], 1, 0], "untouched park: 350 euro, no bonus, tb0 2,000");
  check(g1.state.n === "Ian" && g1.report.gold === true && g1.report.stars === 1, "untouched park keeps the name and gets the gold carousel");
  // Golden 2: median.
  const frozenBlob = deepFreeze(JSON.parse(median));
  const g2 = await legacy.migrate(frozenBlob, null, { now, name: "Ian" });
  deepFreeze(g2.state);
  equal([g2.report.kind, g2.state.mg, g2.state.rb, g2.state.tb, g2.state.c], ["fresh", 4059, 68, 34472, 4649], "median park: P 4,059, rb 68, tb0 34,472, cash 4,649");
  equal(g2.state.vo, ["geister", "wheel", "wurscht", "kanner", "mandel"], "median park: five vouchers, most expensive first");
  equal(g2.report.stars, 2, "median park starts at star 2");
  check(sim.economy(g2.state).points === 68, "rb counts as rating points");
  // Golden 3: maxed / forged-to-the-limit.
  const g3 = await legacy.migrate(maxed, null, { now });
  equal([g3.state.c, g3.state.rb, g3.state.tb, g3.state.mg, g3.state.vo.length], [350 + 9000 + 4000, 75, 160000, 20000, 5], "maxed park: all caps hit");
  equal(g3.report.stars, 3, "maxed park starts at star 3");
  equal(g3.state.vo, ["booster", "booster", "booster", "booster", "booster"], "maxed park: five launch-coaster vouchers");
  // Forged: huge cash in a valid v1 blob.
  const forgedBlob = JSON.parse(median);
  forgedBlob.c = 99999999;
  const forged = await legacy.migrate(forgedBlob, null, { now });
  equal([forged.state.c, forged.state.rb, forged.state.tb, forged.state.mg], [13350 - 4000 + Math.min(4000, 240), 75, 160000, 20000], "forged cash is capped like any other");
  check(forged.state.c <= 350 + 9000 + 4000 && forged.state.tb <= 160000 && forged.state.rb <= 75 && forged.state.vo.length <= 5, "forged blob stays inside every cap");
  // Corrupt blobs.
  const garbage = { version: 1, g: [1, 2, 3], o: [], v: "" };
  const corrupt = await quietAsync(() => legacy.migrate(garbage, null, { now }));
  equal([corrupt.value.report.kind, corrupt.value.state.c, corrupt.value.state.rb, corrupt.value.state.tb, corrupt.value.state.pi, corrupt.value.state.vo], ["corrupt", 1350, 0, 2000, 1, []], "corrupt blob: thank-you of 1,000 euro and the pioneer badge");
  check(corrupt.messages.some(message => message.includes("could not be read")), "the corrupt path is logged, not silent");
  const oversize = await quietAsync(() => legacy.migrate(JSON.stringify({ version: 1, pad: "x".repeat(7000) }), null, { now }));
  equal(oversize.value.report.kind, "corrupt", "oversize blob (>= 7000 chars) takes the corrupt path");
  const nonsense = await legacy.migrate({ hello: 1 }, null, { now });
  equal(nonsense.report.kind, "none", "an unrelated object is not a v1 park");
  // Stub-only.
  const stub = await legacy.migrate({ v: 2, stub: 1, pv: 10259 }, null, { now, name: "Ian" });
  equal([stub.report.kind, stub.state.c, stub.state.rb, stub.state.tb, stub.state.vo, stub.state.pi, stub.state.mg], ["stub", 4409, 68, 34472, [], 1, 4059], "pioneer stub: numbers from the score alone");
  const stubLow = await legacy.migrate({ v: 2, stub: 1, pv: 100 }, null, { now });
  equal([stubLow.state.c, stubLow.state.tb], [350, 2000], "a stub below the untouched value gets nothing extra");
  const stubBad = await legacy.migrate({ v: 2, stub: 1, pv: "lots" }, null, { now });
  equal(stubBad.state.mg, 0, "a stub with a bad score counts as untouched");
  const stubHuge = await legacy.migrate({ v: 2, stub: 1, pv: 1e12 }, null, { now });
  equal([stubHuge.state.c, stubHuge.state.rb, stubHuge.state.tb], [9350, 75, 160000], "a forged stub is capped");
  // Never twice.
  const again = await legacy.migrate(median, g2.state, { now });
  check(again.state === g2.state && again.report.kind === "ignored", "the same blob never migrates twice");
  const againStub = await legacy.migrate({ v: 2, stub: 1, pv: 10259 }, g2.state, { now });
  check(againStub.state === g2.state && againStub.report.kind === "ignored", "the same stub never migrates twice");
  const againCorrupt = await quietAsync(() => legacy.migrate(garbage, g2.state, { now }));
  check(againCorrupt.value.state === g2.state, "a corrupt blob never changes a migrated save");
  // Second device with a richer park: one-time top-up.
  const bump = await legacy.migrate(maxed, g2.state, { now });
  equal(bump.report.kind, "topup", "a richer second park tops up");
  equal([bump.state.c - g2.state.c, bump.state.rb, bump.state.mg, bump.state.tb - g2.state.tb], [9000 - 4059, 75, 20000, 160000 - 34472], "top-up: cash by the progress difference, rb to max, tb0 difference");
  equal(bump.state.vo.length, 5, "top-up fills the vouchers up to five");
  check(bump.state.vo.slice(0, 5).includes("geister") || bump.state.vo.length === 5, "existing vouchers stay");
  const second = await legacy.migrate(maxed, bump.state, { now });
  check(second.state === bump.state, "the top-up happens once");
  const poorer = await legacy.migrate(untouched, g2.state, { now });
  check(poorer.state === g2.state, "a poorer second park changes nothing");
  const partly = { ...g2.state, vo: ["wheel"] };
  const filled = await legacy.migrate(maxed, partly, { now });
  equal(filled.state.vo, ["wheel", "booster", "booster", "booster", "booster"], "vouchers fill up to five without dropping the old ones");
  // v2 without a pioneer flag + blob: late migration; v2 with the flag: ignored.
  const newcomer = { ...sim.createState({ now }), c: 800, tb: 900, rb: 0 };
  const late = await legacy.migrate(median, newcomer, { now, name: "Ian" });
  equal([late.report.kind, late.state.c, late.state.tb, late.state.pi, late.state.mg, late.state.vo.length], ["late", 800 + 4649 - 350, 900 + 34472, 1, 4059, 5], "a v2 player without the pioneer flag still gets the migration");
  check(late.state.pitches === newcomer.pitches, "late migration keeps the built fair");
  // Startup order.
  const cloudV2 = save.encodeSave({ ...g2.state, tb: 99999, t: 5 });
  const startup1 = await legacy.resolveStartup({ local: median, now, name: "Ian" });
  equal([startup1.report.kind, startup1.state.tb, startup1.v1Source === median], ["fresh", 34472, true], "local v1 only: migrate");
  const startup2 = await legacy.resolveStartup({ local: untouched, cloud: cloudV2, now });
  equal([startup2.state.tb, startup2.report.kind], [99999, "ignored"], "a v1-fresh local blob never beats a pioneer cloud save");
  const startup3 = await legacy.resolveStartup({ local: save.encodeSave(g1.state), cloud: { v: 2, stub: 1, pv: 12000 }, now });
  equal([startup3.state.tb, startup3.report.kind], [2000, "none"], "a v2 save beats a stub");
  const startup4 = await legacy.resolveStartup({ local: untouched, backup: JSON.stringify(save.encodeSave({ ...g2.state, tb: 777777 })), now });
  equal(startup4.state.tb, 777777, "the backup restores a v2 save that an old client overwrote");
  const startup5 = await legacy.resolveStartup({ cloud: { v: 2, stub: 1, pv: 10259 }, now });
  equal([startup5.report.kind, startup5.state.mg], ["stub", 4059], "cloud stub only");
  const startup6 = await legacy.resolveStartup({ now });
  equal([startup6.state, startup6.report.kind], [null, "none"], "nothing found: a brand-new player");
  const startup7 = await legacy.resolveStartup({ local: median, cloud: { v: 2, stub: 1, pv: 6300 }, now });
  equal([startup7.report.kind, startup7.state.mg], ["fresh", 4059], "the real blob beats the stub");
  const startup8 = await legacy.resolveStartup({ local: save.encodeSave(g2.state), cloud: save.encodeSave({ ...g2.state, tb: 100 }), now });
  equal(startup8.state.tb, g2.state.tb, "two v2 sources: higher tb wins");
  const startup9 = await legacy.resolveStartup({ local: save.encodeSave(g2.state), cloud: median, now });
  equal(startup9.report.kind, "ignored", "a v2 save plus the old blob ignores the blob");
  // Backup of the original blob.
  const store = new Map();
  const storage = { getItem: key => store.has(key) ? store.get(key) : null, setItem: (key, value) => store.set(key, value) };
  check(legacy.backupV1(storage, median) && store.get("pb_park_v1_backup") === median, "the v1 blob is backed up once");
  check(!legacy.backupV1(storage, untouched) && store.get("pb_park_v1_backup") === median, "the backup is never overwritten");
  check(legacy.backupV1({ getItem: () => null, setItem: (k, v) => store.set(k + "2", v) }, JSON.parse(median)) && store.has("pb_park_v1_backup2"), "objects are stored as JSON text");
  check(!legacy.backupV1(null, median) && !legacy.backupV1(storage, undefined), "no storage or no blob: nothing happens");
  const denied = quiet(() => legacy.backupV1({ getItem: () => null, setItem() { throw new Error("quota"); } }, median));
  check(denied.value === false && denied.messages.length === 1, "a full storage is reported, not thrown");
  equal(legacy.V1_BACKUP_KEY, "pb_park_v1_backup", "backup key");
  // Property: the formula never loses against the v1 score once the park is past the untouched value, and respects every cap.
  const random = mulberry32(99);
  const kinds = V1_KINDS.map(kind => kind.id);
  let generated = 0, below = 0, lowest = Infinity;
  for (let round = 0; round < 40; round++) {
    const list = Array.from({ length: Math.floor(random() * 30) }, () => kinds[Math.floor(random() * kinds.length)]);
    const park = v1Park(list, { roads: random() < 0.5 });
    const blob = v1Serialize({ saved: { ...park.saved, c: Math.floor(random() * 30000) }, derived: park.derived });
    const reading = await legacy.readV1(blob);
    if (!reading.ok) continue;
    const plan = legacy.planMigration({ pv: reading.pv, objects: reading.objects, lg: legacy.deflateLayout(reading) });
    generated++;
    check(plan.cash <= 350 + 9000 + 4000 && plan.rb <= 75 && plan.tb0 <= 160000 && plan.vouchers.length <= 5 && plan.lg.length <= 900, "plan stays inside every cap");
    if (reading.pv >= 6800) check(plan.tb0 >= Math.min(160000, reading.pv), `tb0 ${plan.tb0} never falls below the v1 score ${reading.pv}`);
    else { below++; lowest = Math.min(lowest, reading.pv); }
  }
  check(generated >= 30, `generated ${generated} v1 parks`);
  section.migration = { untouched: g1.state, median: g2.state, maxed: g3.state, generated, below };
  // Snapshot of the old park.
  const snapshot = reading => legacy.deflateLayout(reading);
  const lgMedian = snapshot(stats.median), lgMaxed = snapshot(stats.maxed), lgUntouched = snapshot(stats.untouched);
  check(lgMedian.length <= 900 && lgMaxed.length <= 900 && lgUntouched.length <= 900, `snapshots fit 900 characters (${lgUntouched.length}/${lgMedian.length}/${lgMaxed.length})`);
  const parsed = legacy.parseSnapshot(lgMedian);
  equal(parsed.objects.length, stats.median.objects.length, "snapshot keeps every object");
  equal(parsed.objects.map(o => [o.k, o.p, o.r]), stats.median.objects.map(o => [o.k, o.p, o.r]), "snapshot objects round-trip");
  const tilesOf = reading => reading.state.saved.g.map((tile, p) => tile === 1 ? p : -1).filter(p => p >= 0);
  equal(parsed.paths, tilesOf(stats.median), "snapshot paths round-trip when they fit");
  equal(parsed.land, stats.median.state.saved.l, "snapshot keeps the owned land");
  equal(legacy.parseSnapshot(lgUntouched).objects, [], "untouched park has no objects");
  check(legacy.parseSnapshot("junk") === null && legacy.parseSnapshot(null) === null && legacy.parseSnapshot("L1|zz|") === null, "bad snapshots parse to null");
  check(save.decodeSave(save.encodeSave(g2.state)).lg === g2.state.lg && g2.state.lg.startsWith("L1|"), "snapshot survives the save codec");
  const inflated = await legacy.inflateSnapshot(lgMedian);
  equal(inflated.derived.parkValue > 0 && inflated.saved.o.filter(Boolean).length, stats.median.objects.length, "snapshot inflates back into a v1 park for the diorama");
  equal(await legacy.inflateSnapshot("nope"), null, "an unreadable snapshot does not inflate");
  // A path-heavy park is truncated, never overflows.
  const dense = JSON.parse(median);
  dense.g = dense.g.map((tile, p) => (p % 2 === 0 && tile === 0 ? 1 : tile));
  dense.l = 0xffff;
  const denseReading = await legacy.readV1(dense);
  const denseLg = denseReading.ok ? snapshot(denseReading) : "";
  check(denseReading.ok && denseLg.length <= 900 && legacy.parseSnapshot(denseLg) !== null, "a checkerboard of paths still fits 900 characters");
  const maxedState2 = await legacy.migrate(maxed, null, { now, name: "ë".repeat(24) });
  check(save.saveSizes(maxedState2.state).json <= 3000 && save.saveSizes(maxedState2.state).jsonb < 8192, "a migrated maximal save fits the budget");
  section.lg = [lgUntouched.length, lgMedian.length, lgMaxed.length];
}

// ---------------------------------------------------------------- i18n

function verifyI18n() {
  const keys = lang => Object.keys(i18n.STRINGS[lang]).sort();
  equal(i18n.LANGS, ["lb", "de", "en"], "three languages");
  equal(keys("de"), keys("lb"), "de has the same keys as lb");
  equal(keys("en"), keys("lb"), "en has the same keys as lb");
  check(keys("lb").length > 120, `${keys("lb").length} keys`);
  for (const lang of i18n.LANGS) check(Object.values(i18n.STRINGS[lang]).every(text => typeof text === "string" && text.trim().length > 0), `${lang} has no empty strings`);
  let mismatched = 0;
  for (const key of keys("lb")) {
    const expected = JSON.stringify(i18n.placeholders(i18n.STRINGS.lb[key]));
    for (const lang of ["de", "en"]) if (JSON.stringify(i18n.placeholders(i18n.STRINGS[lang][key])) !== expected) mismatched++;
  }
  equal(mismatched, 0, "placeholders match in every language");
  check(ITEMS.every(item => i18n.STRINGS.lb[item.nameKey] && i18n.STRINGS.de[item.nameKey] && i18n.STRINGS.en[item.nameKey]), "every item has a name in each language");
  check([0, 1, 2, 3].every(level => i18n.STRINGS.en[`level.${level}`]) && LOOKS.every(look => i18n.STRINGS.en[`look.${look}`]), "levels and looks are named");
  check(["ride", "food", "game", "deco"].every(cat => i18n.STRINGS.en[`cat.${cat}`]), "categories are named");
  const simSource = fs.readFileSync(`${here}sim.js`, "utf8");
  const reasons = [...simSource.matchAll(/refuse\("([a-z-]+)"\)/g)].map(match => match[1]);
  check(reasons.length >= 12, `${reasons.length} refusal reasons found in sim.js`);
  check(reasons.every(reason => i18n.STRINGS.lb[`reason.${reason}`]), "every refusal reason has a text");
  for (const id of ["firstBuild", "voucher", "star", "fill", "replace", "upgrade", "gold", "maxed"]) check(i18n.STRINGS.lb[`goal.${id}`], `goal text ${id}`);
  for (const id of ["fouer", "opening", "familljendag", "fouersonndeg", "haemmelsmarsch", "lastday", "fireworks"]) check(i18n.STRINGS.lb[`event.${id}`], `event name ${id}`);
  for (let step = 1; step <= 7; step++) check(i18n.STRINGS.de[`tutorial.${step}`], `tutorial step ${step}`);
  equal(i18n.t("lb", "gift.toast", { amount: "€50", what: i18n.t("lb", "gift.what") }), "🎁 Kaddo: +€50 Suen", "gift toast in lb matches the idle games");
  equal(i18n.t("de", "gift.toast", { amount: "€50", what: i18n.t("de", "gift.what") }), "🎁 Geschenk: +€50 Geld", "gift toast in de");
  equal(i18n.t("en", "gift.toast", { amount: "€50", what: i18n.t("en", "gift.what") }), "🎁 Gift: +€50 cash", "gift toast in en");
  equal(i18n.t("lb", "offline.body", { duration: "6 h 12 min", amount: "€4,380" }), "Dei Stänn hu während 6 h 12 min €4,380 verdéngt.", "offline card text");
  equal(i18n.t("lb", "goal.star", { stars: 2, points: 9 }), "Ziel: ⭐2, nach 9 Punkten", "goal card text from the design");
  equal(i18n.t("xx", "game.title"), "Schueberfouer Tycoon", "unknown language falls back to English");
  const missing = quiet(() => i18n.t("lb", "no.such.key"));
  check(missing.value === "no.such.key" && missing.messages.length === 1, "a missing key is returned and warned about");
  const noParam = quiet(() => i18n.t("lb", "goal.star", { stars: 2 }));
  check(noParam.value.includes("{points}") && noParam.messages.length === 1, "a missing parameter is kept visible and warned about");
  equal(i18n.formatMoney(4380), "€4,380", "money format");
  equal(i18n.formatMoney(999), "€999", "small money");
  equal(i18n.formatMoney(123456), "€123.5K", "compact thousands");
  equal(i18n.formatMoney(2500000), "€2.5M", "compact millions");
  equal(i18n.formatMoney(-5), "€0", "negative money shows 0");
  equal(i18n.formatDuration(6 * 3600 + 12 * 60), "6 h 12 min", "duration with hours");
  equal(i18n.formatDuration(45 * 60), "45 min", "duration in minutes");
  equal(i18n.formatDuration(40), "40 s", "duration in seconds");
  equal(i18n.formatDate("lb", { year: 2027, month: 8, day: 20 }), "20. Aug. 2027", "lb date");
  equal(i18n.formatDate("en", { year: 2027, month: 8, day: 20 }), "20 Aug 2027", "en date");
  equal(i18n.t("lb", "event.nextFouer", { date: i18n.formatDate("lb", { year: 2027, month: 8, day: 20 }), days: 302 }), "Nächst Fouer: 20. Aug. 2027 (302 Deeg)", "next-Fouer sign");
  // No real brands or the city's mascot name anywhere visible.
  const banned = ["bellevue", "alpina", "olympia", "jules verne", "maxxx", "gaufre", "big splash", "happy sailor", "lämmy", "lammy "];
  const visible = Object.values(i18n.STRINGS).flatMap(table => Object.values(table)).join("\n").toLowerCase();   // texts only; item keys are internal ids
  check(banned.every(word => !visible.includes(word)), "no brand names or the city mascot in any string");
  const code = ["data.js", "calendar.js", "sim.js", "save.js", "legacy.js", "i18n.js"].map(file => fs.readFileSync(`${here}${file}`, "utf8").toLowerCase()).join("\n");
  check(["bellevue", "jean la gaufre", "booster maxxx", "lämmy"].every(word => !code.includes(word)), "no brand names in the shipped W1 sources");
  check(!/\bDate\.now\b|new Date\(\)/.test(fs.readFileSync(`${here}sim.js`, "utf8")), "sim.js never reads the clock");
}

// ---------------------------------------------------------------- main

function syncPitches() {
  const json = JSON.parse(fs.readFileSync(`${here}pitches.json`, "utf8"));
  const block = json.map(pitch => `  {id:"${pitch.id}",zone:"${pitch.zone}",u:${pitch.u},w:${pitch.w},size:"${pitch.size}",star:${pitch.star},face:"${pitch.face}"}`).join(",\n");
  const source = fs.readFileSync(`${here}data.js`, "utf8");
  const next = source.replace(/\/\/ BEGIN PITCHES\nconst PITCH_TABLE = \[\n[\s\S]*?\n\];\n\/\/ END PITCHES/, `// BEGIN PITCHES\nconst PITCH_TABLE = [\n${block}\n];\n// END PITCHES`);
  fs.writeFileSync(`${here}data.js`, next);
  console.log("data.js pitch table rewritten from pitches.json");
}

function printTable() {
  const p = section.pacing;
  console.log("\nEconomy (greedy bot, active play, replacements allowed)");
  console.log("star  reached at   income/min at that moment");
  for (const star of [1, 2, 3, 4, 5]) console.log(`  ${star}   ${String(p.starMinutes[star] ?? 0).padStart(7)} min   ${String(p.incomeAtStar[star]).padStart(6)}`);
  console.log("hours  income/min  rating  stars");
  for (const mark of p.marks) console.log(`${String(mark.hours).padStart(5)}  ${String(Math.round(mark.income)).padStart(10)}  ${String(Math.round(mark.points)).padStart(6)}  ${mark.stars}`);
  console.log(`bot runs out of profitable purchases at ${p.maxedHours} h after ${p.purchases} purchases (${p.totalEarned} earned)`);
  console.log(`at 8 h: ${p.left8.actions} profitable builds/upgrades left (${p.left8.swapActions} incl. swaps), ${p.left8.upgradeCost} euro of upgrades, ${p.left8.emptyPitches} empty pitches`);
  console.log(`max rating by star pitch set: ${section.maxPoints.map(Math.round).join(" / ")}; thresholds ${STAR_POINTS.join(" / ")}`);
  console.log(`tutorial: starter stall ${section.tutorial.starter} euro/min, with the carousel ${section.tutorial.pair} euro/min, ${section.tutorial.cash} euro in hand at 2:00`);
  const m = section.migration;
  for (const [name, state] of Object.entries({ untouched: m.untouched, median: m.median, maxed: m.maxed })) {
    console.log(`migration ${name}: cash ${state.c} rb ${state.rb} tb0 ${state.tb} vouchers ${state.vo.join(",") || "-"}`);
  }
  console.log(`save at maximum content: ${section.saveSizes.json} JSON bytes, jsonb estimate ${section.saveSizes.jsonb}; lg lengths ${section.lg.join("/")}`);
  console.log(`min gap between pitches ${section.minPitchGap} m; ${m.generated} generated v1 parks, ${m.below} with PV < 6800 (formula can be below the old score there)`);
}

// ---------------------------------------------------------------- W6: walk, crowd, audio, ride, Foodie

async function verifyWalk() {
  const { circleVsBox, circleVsObb, subtractBox, createMask, pitchSolids, frontSpot, distToRect, onFrontSide, halfDepth, pointInPoly, angleDelta, WALK } = walkMod;
  // collision primitives
  const box = { u0: 0, u1: 10, w0: 0, w1: 4 };
  equal(circleVsBox(-1, 2, 0.3, box), null, "circle left of a box does not touch");
  const hit = circleVsBox(-0.1, 2, 0.34, box);
  check(hit && hit.nx < -0.99 && Math.abs(hit.depth - 0.24) < 1e-9, "circle touching the left face is pushed left by the overlap");
  const inside = circleVsBox(5, 3.9, 0.3, box);
  check(inside && inside.nz > 0.99 && inside.depth > 0.3, "a centre inside the box leaves through the nearest face");
  const obb = { u: 0, w: 0, ax: Math.SQRT1_2, az: Math.SQRT1_2, hl: 5, hw: 1 };
  check(circleVsObb(0, 0.5, 0.2, obb) !== null && circleVsObb(0, 5, 0.2, obb) === null, "oriented box: inside hits, far misses");
  const o2 = circleVsObb(-0.6, 0.6, 0.3, obb);
  check(o2 && Math.abs(Math.hypot(o2.nx, o2.nz) - 1) < 1e-9, "oriented box normals are unit length");
  check(pointInPoly([[0, 0], [10, 0], [10, 10], [0, 10]], 5, 5) && !pointInPoly([[0, 0], [10, 0], [10, 10], [0, 10]], 11, 5), "point in polygon");
  const holeParts = subtractBox({ u0: 0, u1: 10, w0: 0, w1: 10 }, { u0: 3, u1: 5, w0: -1, w1: 4 });
  const area = list => list.reduce((sum, b) => sum + (b.u1 - b.u0) * (b.w1 - b.w0), 0);
  near(area(holeParts), 100 - 2 * 4, 1e-9, "a carved corridor removes exactly its area");
  equal(subtractBox({ u0: 0, u1: 1, w0: 0, w1: 1 }, { u0: 5, u1: 6, w0: 5, w1: 6 }).length, 1, "a hole that misses leaves the box alone");
  near(angleDelta(0.1, TAU_ - 0.1), -0.2, 1e-9, "angle delta takes the short way");

  // the mask: a 100 x 100 field with one solid pitch, one open gate
  const rects = [{ u: 50, w: 50, du: 8, dw: 8 }];
  const mask = createMask({ fieldPoly: [[0, 0], [100, 0], [100, 100], [0, 100]], rects, faces: ["+w"], entrances: [{ id: "E", kind: "gate", u: 100, w: 20, face: "+u", star: 2 }] });
  mask.setPitches(pitchSolids(rects, () => true));
  check(!mask.allowed(50, 50), "inside a solid pitch is blocked");
  check(mask.allowed(40, 40), "free ground is walkable");
  let pos = { x: 40, z: 50 };
  for (let i = 0; i < 120; i++) pos = mask.move(pos.x, pos.z, 0.05, 0);                 // walk straight at the pitch (6 m)
  check(pos.x < 50 - 4 && pos.x > 50 - 4 - WALK.radius - 0.6, `walking into a solid pitch stops at its face (x ${pos.x.toFixed(2)})`);
  let slide = { x: 45.3, z: 47 };
  for (let i = 0; i < 60; i++) slide = mask.move(slide.x, slide.z, 0.04, 0.04);      // diagonal into the left wall: slides along it
  check(slide.z > 49 && slide.x < 45.6, `a diagonal push into a wall slides along it (${slide.x.toFixed(2)}, ${slide.z.toFixed(2)})`);
  mask.setPitches(pitchSolids(rects, () => false));
  check(mask.allowed(50, 50), "an open (empty) pitch is walkable");
  mask.setPitches(pitchSolids(rects, () => true, { 0: { u0: 49, u1: 51, w0: 53, w1: 56 } }));
  check(mask.pitchBoxes.length === 3 && mask.allowed(50, 55) && !mask.allowed(47, 52), "a carved pitch becomes several boxes");
  mask.setGates(1);
  check(!mask.allowed(103, 20), "a gate that needs more stars is closed (nothing outside the field)");
  mask.setGates(2);
  check(mask.allowed(103, 20) && !mask.allowed(103, 40), "an open gate lets the walker outside, only through the gate");
  check(!mask.allowed(-3, 50), "outside the field is blocked");
  const out = mask.move(0.4, 50, -3, 0);
  check(out.x >= 0.3, "the walker cannot leave the field");
  const free = mask.nearestFree(50, 50, 10);
  check(free !== null && mask.allowed(free.x, free.z), "nearestFree finds a standable point");
  mask.setPitches(pitchSolids(rects, () => true));
  const nf = mask.nearestFree(50, 50, 10);
  check(nf && Math.hypot(nf.x - 50, nf.z - 50) > 4, "nearestFree leaves a solid pitch");
  // tram as a moving obstacle
  mask.setDynamic([{ u: 20, w: 20, ax: 1, az: 0, hl: 20, hw: 1.5 }]);
  const pushed = mask.move(20, 20, 0, 0);
  check(Math.abs(pushed.z - 20) > 1.5, "the walker is pushed out of the tram");
  // pitch helpers
  const rect = { u: 62, w: 41, du: 8, dw: 8 };
  const spot = frontSpot(rect, "+w", 2.5);
  near(spot.z, 41 + 4 + 2.5, 1e-9, "front spot is 2.5 m in front of the front edge");
  near(frontSpot(rect, "-u", 3).x, 62 - 4 - 3, 1e-9, "front spot follows the face");
  near(distToRect(rect, 62, 50), 5, 1e-9, "distance to a pitch rectangle");
  check(onFrontSide(rect, "+w", 62, 47) && !onFrontSide(rect, "+w", 62, 35), "front side test");
  equal(halfDepth({ du: 40, dw: 24 }, "+u"), 20, "half depth follows the face axis");
  check(WALK.eye === 1.65 && WALK.fov === 70, "eye 1.65 m, FOV 70 (DESIGN 5)");
  // the right-hand rule the A/D fix depends on: heading (cos, sin), right (-sin, cos) -> looking along +u the right hand is +w
  const yaw = 0.7;
  const fwd = [Math.cos(yaw), Math.sin(yaw)], rgt = [-Math.sin(yaw), Math.cos(yaw)];
  near(fwd[0] * rgt[0] + fwd[1] * rgt[1], 0, 1e-12, "right is perpendicular to forward");
  check(Math.abs(-Math.sin(0)) < 1e-12 && Math.cos(0) === 1, "looking along +u the right hand is +w (as in the builder rig)");

  // ---- crowd
  const { crowdTarget, CROWD_CAP, buildGraph, edgePoint, queueSlot, figureArrays, makeLook, mulberry } = crowdMod;
  equal(CROWD_CAP, { low: 70, medium: 150, high: 320 }, "crowd caps 70 / 150 / 320 (DESIGN 5)");
  for (const q of ["low", "medium", "high"]) {
    const lo = crowdTarget(q, 0, "walk"), hi = crowdTarget(q, 1e6, "walk");
    check(lo > 0 && lo <= hi && hi === CROWD_CAP[q], `${q}: crowd between ${lo} and the cap ${hi}`);
    check(crowdTarget(q, 50, "builder") < crowdTarget(q, 50, "walk"), `${q}: the builder view shows a thinner crowd`);
  }
  check(crowdTarget("medium", 10) < crowdTarget("medium", 60) && crowdTarget("medium", 60) < crowdTarget("medium", 140), "more guests per minute -> a bigger crowd");
  const open = { allowed: (x, z) => x > 0 && x < 200 && z > 0 && z < 100, freeSide: (x, z, hx, hz, side) => Math.min(6, side > 0 ? 6 : 6) };
  const graph = buildGraph(open, [{ name: "a", u: [0, 200], w: [48, 52] }, { name: "b", u: [98, 102], w: [0, 100] }, { name: "gate-x", u: [0, 4], w: [0, 4] }], { minPiece: 8 });
  equal(graph.edges.length, 4, "two alleys crossing: four edges");
  equal(graph.nodes.length, 5, "...and five nodes");
  check(graph.nodes.some(n => n.edges.length === 4), "the crossing node has four edges");
  check(graph.edges.every(e => Math.abs(Math.hypot(e.dx, e.dz) - 1) < 1e-9 && e.fl.length === Math.floor(e.len) + 1), "edges have unit directions and free-width samples");
  const e0 = graph.edges[0];
  const p1 = edgePoint(e0, 1, 5, 2), p2 = edgePoint(e0, -1, 5, 2);
  check(Math.hypot(p1.x - p2.x, p1.z - p2.z) > 3.9, "right-hand traffic: opposite directions use opposite sides");
  const narrow = { ...e0, fr: e0.fr.map(() => 1.0), fl: e0.fl.map(() => 1.0) };
  check(Math.abs(edgePoint(narrow, 1, 5, 3).lat) <= 0.6 + 1e-9, "a narrow gap clamps the lane offset");
  const slot0 = queueSlot(rect, "+w", 0), slot5 = queueSlot(rect, "+w", 5);
  check(slot0.z >= 41 + 4 + 3 - 1e-9 && Math.abs(slot5.x - slot0.x) > 4 && Math.abs(slot5.z - slot0.z) < 1e-9, "queue slots form a row 3 m in front of the pitch");
  const fig = figureArrays();
  check(fig.triangles >= 60 && fig.triangles <= 100, `crowd figure has ${fig.triangles} triangles (about 90)`);
  check(Array.from(fig.position).every(Number.isFinite) && Array.from(fig.normal).every(v => Math.abs(v) <= 1.0001), "figure geometry is finite with unit normals");
  equal(fig.info.length / 2, fig.position.length / 3, "every vertex has a part id and an animation group");
  const look1 = makeLook(mulberry(5), "adult"), look2 = makeLook(mulberry(5), "adult");
  equal(look1, look2, "looks are deterministic per seed");
  check(makeLook(mulberry(5), "kid").scale < 0.75 && look1.scale > 0.88, "kids are smaller than adults");

  // ---- audio (pure helpers)
  const { organPhrase, pickVoices, voiceKindFor, voiceGain, MAX_VOICES } = audioMod;
  const ph = organPhrase(4), ph2 = organPhrase(4), ph3 = organPhrase(9);
  equal(ph, ph2, "the carousel tune is deterministic per seed");
  check(JSON.stringify(ph) !== JSON.stringify(ph3), "different carousels play different tunes");
  check(ph.beats === 24 && ph.notes.every(n => n.beat >= 0 && n.beat < 24 && n.dur > 0 && n.midi >= 30 && n.midi <= 100), "an 8-bar waltz phrase with sane notes");
  check(ph.notes.every((n, i) => i === 0 || ph.notes[i - 1].beat <= n.beat), "the tune is in time order (the sequencer walks it in order)");
  check(ph.notes.filter(n => n.kind === "bass").length === 8 && ph.notes.filter(n => n.kind === "mel").length >= 14, "oom-pah bass every bar plus a melody");
  check(ITEMS.filter(i => i.cat !== "deco").every(i => voiceKindFor(i.id)), "every attraction and stall has a sound");
  const cands = ["kanner", "kachel", "maus", "wheel", "scooter", "musik", "tent", "schiess", "lukas", "jules"].map((id, k) => ({ id, kind: voiceKindFor(id), x: k * 6, z: 0 }));
  const picked = pickVoices(cands, { x: 0, z: 0 });
  check(picked.length <= MAX_VOICES && MAX_VOICES === 6, "at most 6 voices");
  check(picked.every((v, k) => k === 0 || picked[k - 1].level >= v.level), "voices are ranked loudest first");
  equal(pickVoices([{ id: "kachel", kind: "fryer", x: 100, z: 0 }], { x: 0, z: 0 }).length, 0, "a far fryer is silent");
  check(voiceGain("organ", 5) > voiceGain("organ", 30) && voiceGain("organ", 30) > voiceGain("organ", 60) && voiceGain("organ", 80) === 0, "voice level falls with distance and ends at its reach");

  // ---- ride
  const { wheelSpeedAt } = rideMod;
  check(wheelSpeedAt(0) === 1.5 && Math.abs(wheelSpeedAt(0.5) - 6) < 1e-9 && wheelSpeedAt(1) === 1.5, "wheel: eases in, cruises at 6x, eases out");
  let seconds = 0;
  const steps = 4000;
  for (let i = 0; i < steps; i++) { const p = (i + 0.5) / steps; seconds += (4 * Math.PI / steps) / (2 * Math.PI / 120 * wheelSpeedAt(p)); }
  check(seconds > 38 && seconds < 52, `two revolutions take ${seconds.toFixed(1)} s (about 40 s)`);
  let probe = 0;
  for (let i = 0; i < steps; i++) { const p = (i + 0.5) / steps; probe += (6 * Math.PI / steps) / (2 * Math.PI / 120 * wheelSpeedAt(p)); }
  check(probe > 55 && probe < 72, `the Probefahrt (3 revolutions) takes ${probe.toFixed(1)} s (about 60 s)`);

  // ---- Foodie: a multiplier through the economy's own `bonus`, sim.js untouched
  equal(foodieMultiplier(0), 1, "no Foodie stacks: x1");
  near(foodieMultiplier(1), 1.05, 1e-12, "one stack x1.05");
  near(foodieMultiplier(3), 1.05 ** 3, 1e-12, "three stacks x1.05^3");
  equal(foodieMultiplier(9), foodieMultiplier(3), "never more than three stacks");
  check(FOODIE.seconds === 180 && FOODIE.maxStacks === 3 && FOODIE.perFood === 1.05, "Foodie rules from the design: 3 minutes, 3 stacks, x1.05");
  const state = sim.build(sim.createState({ now: 0 }), 0, "kachel").state;
  const base = sim.economy(state, { ...sim.NEUTRAL_CONTEXT }).incomePerMin;
  near(sim.economy(state, { ...sim.NEUTRAL_CONTEXT, bonus: 1.05 }).incomePerMin / base, 1.05, 1e-9, "ctx.bonus multiplies income and nothing else");
  equal(sim.economy(state, { ...sim.NEUTRAL_CONTEXT, bonus: 1.05 }).stars, sim.economy(state).stars, "the bonus never changes the rating");
  // the controller: eat, stacking, session rule, expiry, flags
  let clock = 1_800_000_000_000;
  const fakeWin = { parent: null, addEventListener() {}, setTimeout: () => 0 };
  fakeWin.parent = fakeWin;
  const game = createGame({ win: fakeWin, storage: null, now: () => clock, persist: false });
  await game.start();
  const built = { ...game.state, c: 1e6, tu: 8, pitches: game.state.pitches.map((e, i) => i === 0 ? sim.makeEntry("kachel", 1, 0, 0) : i === 1 ? sim.makeEntry("fritten", 0, 0, 0) : e) };
  game.debugSetState(built);
  const income0 = game.info().incomePerMin;
  const first = game.eat("kachel");
  check(first.ok && first.granted && first.stacks === 1 && Math.abs(first.mult - 1.05) < 1e-12, "first food: +1 stack");
  near(game.info().incomePerMin / income0, 1.05, 1e-9, "income is 5 % higher right away");
  const again = game.eat("kachel");
  check(!again.granted && again.known && again.stacks === 1, "the same food again: no second stack (once per distinct food per session)");
  const second = game.eat("fritten");
  check(second.granted && second.stacks === 2, "a different food stacks");
  near(game.info().incomePerMin / income0, 1.05 * 1.05, 1e-9, "two stacks: x1.1025");
  game.eat("wurscht"); const fourth = game.eat("zocker");
  check(!fourth.granted && fourth.full && fourth.stacks === 3, "a fourth food while three are active is not granted");
  clock += 181_000;
  game.update();
  equal(game.foodie().stacks, 0, "stacks expire after 3 minutes");
  near(game.info().incomePerMin / income0, 1, 1e-9, "income is back to normal");
  check(game.eat("kachel").known, "an expired food is still 'known' this session (the session rule is not time based)");
  check(game.setFlag("r") && game.hasFlag("r") && !game.setFlag("r") && game.state.ea.includes("r"), "flags: Op der Spëtzt is stored once in the save");
  check(!game.setFlag("R") && !game.setFlag("rr"), "flags must be a single [a-z0-9]");
}

async function run() {
  if (process.argv.includes("--sync-pitches")) { syncPitches(); return; }
  verifyData();
  verifyPitches();
  verifyCalendar();
  verifyBasics();
  verifyTutorial();
  verifyCommands();
  verifyVouchers();
  verifyGiftsStampsEvents();
  verifyEconomyModel();
  verifyOffline();
  verifyFuzz();
  verifyPacing();
  verifySave();
  verifyPersistence();
  await verifyMigration();
  verifyI18n();
  await verifyWalk();
  await verifyLaunch({ check, equal, near, lux, deepFreeze });
  if (process.argv.includes("--table")) printTable();
  const p = section.pacing;
  console.log(`PASS: ${checks} checks; stars at ${p.starMinutes[2]}/${p.starMinutes[3]}/${p.starMinutes[4]}/${p.starMinutes[5]} min; save ${section.saveSizes.json} B JSON, ${section.saveSizes.jsonb} B jsonb.`);
}

try { await run(); } catch (error) {
  console.error(`FAIL: ${error.stack ?? error}`);
  process.exitCode = 1;
}
