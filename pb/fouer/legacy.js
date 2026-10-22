// Migration of Theme Park Tycoon (v1) players (DESIGN.md section 7). The frozen v1 kernel in pb/park/ is imported
// lazily and only to read an old blob and to inflate the old-park diorama; nothing in it is modified.
import { RULES, VOUCHER_MAP } from "./data.js";
import { createState, cleanName, starsFor, ratingPoints } from "./sim.js";
import { classifyRaw, parseRaw, pickBest, LG_LIMIT } from "./save.js";

export const V1_BACKUP_KEY = "pb_park_v1_backup";
export const V1_SAVE_LIMIT = 7000;                     // the v1 kernel refuses longer layouts
export const MIGRATION = Object.freeze({
  untouchedValue: 6200,                                // park value of an untouched v1 park (5000 cash + rating 40 x 30)
  maxProgress: 20000,
  cashProgressCap: 9000, cashObjectsCap: 4000, objectsFraction: 0.5,
  ratingDivisor: 60, ratingCap: 75,
  valueBase: 2000, valuePerProgress: 8, valueCap: 160000,
  corruptGift: 1000,
});
const SNAPSHOT_VERSION = "L1";
const SNAPSHOT_LAND_CHARS = 4, SNAPSHOT_OBJECT_CHARS = 5, SNAPSHOT_RUN_CHARS = 4, TILE_CHARS = 3, MAX_RUN = 35;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// ---- the frozen v1 kernel, loaded on demand ----

let kernelPromise = null;
const kernelUrl = file => new URL(`../park/${file}`, import.meta.url).href;

export function loadKernel() {
  kernelPromise ??= Promise.all(["save.js", "build.js", "sim.js", "data.js"].map(file => import(kernelUrl(file))))
    .then(([save, build, sim, data]) => ({ readLayout: save.readLayout, restoreSave: save.restoreSave, snapshot: save.snapshot,
      KINDS: build.KINDS, GRID: build.GRID, readObjects: build.readObjects, packObject: build.packObject,
      createState: sim.createState, TILE: data.TILE }))
    .catch(error => { kernelPromise = null; throw error; });
  return kernelPromise;
}

/** Decode an old blob (object or JSON text) with the kernel's own validation. */
export async function readV1(blob) {
  const kernel = await loadKernel();
  let layout = blob;
  if (typeof blob !== "string") {
    try { layout = JSON.stringify(blob); } catch (error) { return { ok: false, reason: "unserialisable", error }; }
  }
  if (typeof layout !== "string" || layout.length >= V1_SAVE_LIMIT) return { ok: false, reason: "oversize" };
  const state = kernel.readLayout(layout);
  if (!state) return { ok: false, reason: "invalid" };
  const objects = kernel.readObjects(state.saved).filter(Boolean).map(object => {
    const kind = kernel.KINDS[object.k];
    return { id: object.id, k: object.k, kindId: kind.id, type: kind.type, cost: kind.cost, p: object.p, r: object.r };
  });
  return { ok: true, pv: state.derived.parkValue, objects, state, kernel };
}

// ---- compact snapshot of the old park (`lg`) ----

/** "L1|<land>|<objects: kind(1) tile(3) rotation(1)>|<path runs: tile(3) length(1)>", at most 900 characters. */
export function deflateLayout(reading) {
  const { state, kernel, objects } = reading;
  const { TILE, GRID } = kernel;
  const head = `${SNAPSHOT_VERSION}|${state.saved.l.toString(36).padStart(SNAPSHOT_LAND_CHARS, "0")}|`;
  const objectText = objects.map(object => object.k.toString(36) + object.p.toString(36).padStart(TILE_CHARS, "0") + object.r.toString(36)).join("");
  const runs = [];
  for (let y = 0; y < GRID.height; y++) {
    let x = 0;
    while (x < GRID.width) {
      if (state.saved.g[y * GRID.width + x] !== TILE.PATH) { x++; continue; }
      let length = 0;
      while (x + length < GRID.width && length < MAX_RUN && state.saved.g[y * GRID.width + x + length] === TILE.PATH) length++;
      runs.push({ tile: y * GRID.width + x, length });
      x += length;
    }
  }
  // Keep the longest runs when the budget is tight, then restore reading order.
  const room = Math.max(0, Math.floor((LG_LIMIT - head.length - objectText.length - 1) / SNAPSHOT_RUN_CHARS));
  const kept = [...runs].sort((a, b) => b.length - a.length || a.tile - b.tile).slice(0, room).sort((a, b) => a.tile - b.tile);
  return head + objectText + "|" + kept.map(run => run.tile.toString(36).padStart(TILE_CHARS, "0") + run.length.toString(36)).join("");
}

const SNAPSHOT_PATTERN = new RegExp(`^${SNAPSHOT_VERSION}\\|([0-9a-z]{${SNAPSHOT_LAND_CHARS}})\\|((?:[0-9a-z]{${SNAPSHOT_OBJECT_CHARS}})*)\\|((?:[0-9a-z]{${SNAPSHOT_RUN_CHARS}})*)$`);

/** Pure decoder of `lg`: { land, objects: [{ k, p, r }], paths: [tile, ...] } or null. */
export function parseSnapshot(lg) {
  const match = typeof lg === "string" ? SNAPSHOT_PATTERN.exec(lg) : null;
  if (!match) return null;
  const chunks = (text, size) => text.match(new RegExp(`.{${size}}`, "g")) ?? [];
  const objects = chunks(match[2], SNAPSHOT_OBJECT_CHARS).map(chunk => ({
    k: parseInt(chunk[0], 36), p: parseInt(chunk.slice(1, 1 + TILE_CHARS), 36), r: parseInt(chunk[4], 36) }));
  const paths = chunks(match[3], SNAPSHOT_RUN_CHARS).flatMap(chunk => {
    const start = parseInt(chunk.slice(0, TILE_CHARS), 36), length = parseInt(chunk[3], 36);
    return Array.from({ length }, (_, offset) => start + offset);
  });
  return { land: parseInt(match[1], 36), objects, paths };
}

/** Rebuild a v1 state from `lg` for the (lazily loaded) diorama renderer. Returns null for an unreadable snapshot. */
export async function inflateSnapshot(lg) {
  const parsed = parseSnapshot(lg);
  if (!parsed) return null;
  const kernel = await loadKernel();
  const base = kernel.snapshot(kernel.createState(1));
  const g = Array(base.g.length).fill(kernel.TILE.EMPTY);
  for (const tile of parsed.paths) if (tile >= 0 && tile < g.length) g[tile] = kernel.TILE.PATH;
  const o = parsed.objects.map(object => kernel.packObject({ k: object.k, p: object.p, r: object.r, h: 100, b: 0, t: 0 }));
  return kernel.restoreSave({ ...base, g, o, l: parsed.land });
}

// ---- conversion formula (7.3) ----

/** Pure: the migration numbers for a decoded v1 park, a pioneer stub or an unreadable blob. */
export function planMigration({ pv = null, objects = [], lg = "", corrupt = false, from = "v1" } = {}) {
  const M = MIGRATION;
  if (corrupt) {
    return { kind: "corrupt", P: 0, cash: RULES.startCash + M.corruptGift, rb: 0, tb0: M.valueBase, vouchers: [], lg: "" };
  }
  const P = clamp(Math.round(Number.isFinite(pv) ? pv : M.untouchedValue) - M.untouchedValue, 0, M.maxProgress);
  const ranked = objects.filter(object => object.type === "ride" || object.type === "stall")
    .sort((a, b) => b.cost - a.cost || a.k - b.k || a.id - b.id).slice(0, RULES.voucherSlots);
  const picked = new Set(ranked.map(object => object.id));
  const spare = objects.filter(object => !picked.has(object.id)).reduce((sum, object) => sum + object.cost, 0);
  return { kind: from, P,
    cash: RULES.startCash + Math.min(M.cashProgressCap, Math.round(P)) + Math.min(M.cashObjectsCap, Math.round(M.objectsFraction * spare)),
    rb: Math.min(M.ratingCap, Math.round(P / M.ratingDivisor)),
    tb0: Math.min(M.valueCap, M.valueBase + M.valuePerProgress * P),
    vouchers: ranked.map(object => VOUCHER_MAP[object.kindId]).filter(Boolean), lg };
}

const progressValue = P => Math.min(MIGRATION.valueCap, MIGRATION.valueBase + MIGRATION.valuePerProgress * P);
const fillVouchers = (current, extra) => [...current, ...extra].slice(0, RULES.voucherSlots);

function reportFor(kind, plan, state, extra = {}) {
  return { kind, P: plan.P, cash: plan.cash, rb: plan.rb, tb0: plan.tb0, vouchers: [...plan.vouchers],
    gold: true, stars: starsFor(ratingPoints(state)), ...extra };
}

/** Merge a plan into a v2 state: a fresh pioneer, a late pioneer, or the one-time top-up for a richer second device. */
function applyPlan(plan, existing, { now, name }) {
  if (!existing) {
    const state = { ...createState({ name, now }), c: plan.cash, tb: plan.tb0, rb: plan.rb, pi: 1, mg: plan.P,
      vo: [...plan.vouchers], lg: plan.lg };
    return { state, report: reportFor(plan.kind === "v1" ? "fresh" : plan.kind, plan, state) };
  }
  if (existing.pi !== 1) {
    const state = { ...existing, c: existing.c + plan.cash - RULES.startCash, tb: existing.tb + plan.tb0,
      rb: Math.max(existing.rb, plan.rb), pi: 1, mg: plan.P, vo: fillVouchers(existing.vo, plan.vouchers),
      lg: plan.lg || existing.lg, n: existing.n || cleanName(name) };
    return { state, report: reportFor("late", plan, state) };
  }
  if (plan.kind === "corrupt" || plan.P <= existing.mg) {
    return { state: existing, report: reportFor("ignored", { ...plan, cash: 0, rb: 0, tb0: 0, vouchers: [] }, existing, { gold: false }) };
  }
  const cash = Math.min(MIGRATION.cashProgressCap, plan.P) - Math.min(MIGRATION.cashProgressCap, existing.mg);
  const tb0 = progressValue(plan.P) - progressValue(existing.mg);
  const state = { ...existing, c: existing.c + cash, tb: existing.tb + tb0, rb: Math.max(existing.rb, plan.rb), mg: plan.P,
    vo: fillVouchers(existing.vo, plan.vouchers), lg: plan.lg || existing.lg };
  return { state, report: reportFor("topup", { ...plan, cash, tb0 }, state, { gold: false }) };
}

/**
 * Migrate a v1 blob, a pioneer stub or nothing into v2.
 * `source`: raw v1 blob (object or JSON text), stub { v: 2, stub: 1, pv }, or null. `existing`: the v2 state already present.
 * Returns { state, report }; report.kind: fresh | stub | corrupt | late | topup | ignored | none. Never migrates twice:
 * once `pi` and `mg` are set, only a strictly richer v1 park (P > mg) adds anything.
 */
export async function migrate(source, existing = null, { now = 0, name = "" } = {}) {
  const kind = classifyRaw(source);
  const options = { now, name: cleanName(name) };
  if (kind === "empty" || kind === "invalid" || kind === "v2") {
    return { state: existing, report: { kind: "none" } };
  }
  if (kind === "stub") {
    const stub = parseRaw(source);
    return applyPlan(planMigration({ pv: stub.pv, from: "stub" }), existing, options);
  }
  let reading;
  try { reading = await readV1(source); }
  catch (error) { console.warn("[fouer] the v1 kernel could not be loaded", error); reading = { ok: false, reason: "kernel" }; }
  if (!reading.ok) {
    console.warn(`[fouer] the old park could not be read (${reading.reason}); granting the thank-you instead`);
    return applyPlan(planMigration({ corrupt: true }), existing, options);
  }
  const plan = planMigration({ pv: reading.pv, objects: reading.objects, lg: deflateLayout(reading) });
  return applyPlan(plan, existing, options);
}

/** Copy the original v1 blob once into localStorage; it is never overwritten or removed. */
export function backupV1(storage, raw) {
  if (!storage || raw === undefined || raw === null) return false;
  try {
    if (storage.getItem(V1_BACKUP_KEY) !== null) return false;
    storage.setItem(V1_BACKUP_KEY, typeof raw === "string" ? raw : JSON.stringify(raw));
    return true;
  } catch (error) { console.warn("[fouer] could not back up the v1 save", error.message); return false; }
}

/**
 * Startup order (7.7): v2 sources first, a v1 blob only migrates when no v2 exists or it is richer than `mg`.
 * `local` = window.__pbSave, `cloud` = the {__pbLoadSave} payload, `backup` = pb_fouer_bak text.
 * Returns { state, report, v1Source }; state is null for a brand-new player.
 */
export async function resolveStartup({ local, cloud, backup, now = 0, name = "" } = {}) {
  const raws = [local, cloud, backup];
  const best = pickBest(raws);
  const v1Source = raws.slice(0, 2).find(raw => classifyRaw(raw) === "v1");
  const stub = raws.slice(0, 2).find(raw => classifyRaw(raw) === "stub");
  const options = { now, name };
  if (v1Source !== undefined) return { ...(await migrate(v1Source, best, options)), v1Source };
  if (best) return { state: best, report: { kind: "none" }, v1Source: null };
  if (stub !== undefined) return { ...(await migrate(stub, null, options)), v1Source: null };
  return { state: null, report: { kind: "none" }, v1Source: null };
}
