// W7 checks (gallery codec, event scripts, firework schedule, march, lb sheet), called from harness.js with its helpers.
import * as social from "./social.js";
import * as events from "./events.js";
import * as sim from "./sim.js";
import * as save from "./save.js";
import * as i18n from "./i18n.js";
import { eventsAt } from "./calendar.js";
import { PITCHES, PITCH_COUNT, ITEMS } from "./data.js";

export async function verifyLaunch({ check, equal, near, lux, deepFreeze }) {
  /* ------------------------------------------------ gallery layout codec */
  const base = sim.createState({ name: "Ian", now: 1.8e12 });
  let state = { ...base, c: 1e6, tb: 12345, rb: 70, pi: 1, pu: 5 };
  for (const [index, item] of [[0, "kachel"], [1, "kanner"], [3, "scooter"], [23, "wheel"]]) state = sim.build(state, index, item).state;
  state = sim.upgrade(state, 0).state;
  state = deepFreeze({ ...state, pitches: state.pitches.map((e, i) => (i === 2 ? sim.makeEntry("gold", 0, 2, 1) : e)) });
  const layout = social.encodeLayout(state, 3);
  check(layout.startsWith("F2|") && layout.length < 130, `a layout is short (${layout.length} chars)`);
  check(!social.isV1Layout(layout) && social.isV1Layout('{"version":1,"g":[]}') && !social.isV1Layout(null), "v1 layouts are told apart by the first character");
  const back = social.decodeLayout(layout);
  equal(back.pitches.map(e => e && [e.k, e.lv, e.look]), state.pitches.map(e => e && [e.k, e.lv, e.look]), "the pitches round-trip (incl. the pioneer gold carousel)");
  equal([back.stars, back.pioneer, back.pu], [3, true, 5], "stars, pioneer flag and opened-pitch mask round-trip");
  equal(social.encodeLayout(state, 9).split("|")[4], "5", "stars are clamped to 1..5 on the way out");
  const wrong = [null, undefined, 5, "", "F2|", "F1|" + layout.slice(3), layout.slice(0, -2), layout.replace(/\|\d$/, "|0"), layout.replace(/\|[01]\|/, "|2|"), layout + "x".repeat(8000),
    "F2|" + "!".repeat(102) + "|0|0|1", `F2|${"0".repeat(102)}|ZZZZZZZZZZ|0|1`, "{}", "F2|" + "0".repeat(101) + "|0|0|1"];
  for (const bad of wrong) check(social.decodeLayout(bad) === null, `a bad layout is refused: ${String(bad).slice(0, 24)}`);
  const forged = social.decodeLayout(`F2|${"zz9".repeat(PITCH_COUNT)}|0|1|2`);
  check(forged && forged.pitches.every(e => e === null), "unknown kinds decode to empty pitches (the visitor never throws)");
  const empty = social.decodeLayout(social.encodeLayout(base, 1));
  equal([empty.pitches.filter(Boolean).length, social.visitSpec(empty, 0), social.visitSpec(empty, PITCHES.findIndex(p => p.star > 1))], [0, { state: "open" }, { state: "locked" }], "a bare pitch is open when its star is reached and locked otherwise");
  equal(social.visitSpec(back, 0), { state: "built", item: "kachel", look: 0, level: 2 }, "a built pitch shows its level (lv + 1) for the fair layer");
  check(PITCHES.every((p, i) => social.visitSpec({ pitches: Array(PITCH_COUNT).fill(null), pu: 2 ** i, stars: 1 }, i).state === "open"), "a pitch opened by a voucher mask bit is open for visitors too");

  /* ------------------------------------------------ rows, museum, errors, publish */
  const uid = "11111111-1111-4111-8111-111111111111";
  const row = social.cleanRow({ user_id: uid, username: "x".repeat(80), park_name: "<b>Fouer</b>", value: 123456.7, guests: 5, rating: 312, likes: 2, liked_by_me: true, updated_at: "2026-10-24T10:00:00Z" });
  equal([row.username.length, row.name, row.value, row.stars, row.museum, row.liked, row.likes], [32, "<b>Fouer</b>", 123456, 3, false, true, 2], "a row is clamped; the name stays plain text (the UI uses textContent)");
  check(social.cleanRow({ user_id: "nope" }) === null && social.cleanRow(null) === null && social.cleanRow([]) === null, "rows without a uuid are dropped");
  check(social.cleanRow({ user_id: uid, rating: 52, updated_at: "2026-09-30T18:54:05Z" }).museum && social.cleanRow({ user_id: uid, rating: 250, updated_at: "2026-10-21T12:00:00Z" }).museum && !social.cleanRow({ user_id: uid, rating: 250, updated_at: "2026-10-25T12:00:00Z" }).museum, "old rows (low v1 rating or written before the launch) are Museum cards");
  equal(social.cleanRow({ user_id: uid, rating: 99999, value: -5, guests: "x" }).rating, 1000, "ratings are capped at 1000 like publish_park does");
  equal(["offline", "test-mode", "timeout", "forbidden", "invalid-layout", "too-large", "weird", "new row violates policy: permission denied"].map(m => social.errorId(new Error(m))), ["offline", "test", "timeout", "auth", "invalid", "big", "generic", "auth"], "error ids");
  const args = social.publishArgs(state, "  Meng <Fouer> mat engem ganz laangen Numm dee ze laang ass  ");
  const summary = sim.gallerySummary(state);
  equal([args.p_value, args.p_guests, args.p_rating, args.p_name.length <= 32, args.p_layout.length < 8000], [summary.value, summary.guests, summary.rating, true, true], "publish arguments follow the gallery columns (value = tb, guests = built pitches, rating = stars x 100 + points / 10)");
  check(!args.p_name.includes("<") && args.p_rating < 1000, "the name is cleaned and the rating fits the column");
  equal(summary.guests, 5, "the five built pitches are the 'guests' column");

  /* ------------------------------------------------ the bridge to the arcade page */
  const listeners = new Map(), posted = [];
  const parent = { postMessage: message => posted.push(message) };
  const win = { parent, addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
  const bridge = social.createBridge({ win, timeout: 40 });
  const answer = (id, data, error = null) => listeners.get("message")({ source: parent, data: { __pbRpcRes: { id, data, error } } });
  const first = bridge.rpc("park_gallery", { p_sort: "value", p_limit: 24 });
  equal([posted[0].__pbRpc.fn, posted[0].__pbRpc.args.p_limit], ["park_gallery", 24], "the call goes to the parent");
  listeners.get("message")({ source: {}, data: { __pbRpcRes: { id: posted[0].__pbRpc.id, data: ["spoofed"] } } });
  answer(posted[0].__pbRpc.id, [1, 2]);
  equal(await first, [1, 2], "the answer of the parent resolves the call (answers from other windows are ignored)");
  await bridge.rpc("drop_everything").then(() => check(false, "forbidden"), error => equal(error.message, "forbidden", "only the five gallery functions can be called"));
  const slow = bridge.rpc("park_layout", { p_user: uid });
  await slow.then(() => check(false, "timeout"), error => equal(error.message, "timeout", "a call that gets no answer times out"));
  const failing = bridge.rpc("like_park", { p_target: uid }); answer(posted.at(-1).__pbRpc.id, null, "jwt expired");
  await failing.then(() => check(false, "rejects"), error => equal(social.errorId(error), "auth", "a server error maps to the sign-in message"));
  const testBridge = social.createBridge({ win: { ...win, addEventListener() {}, removeEventListener() {} }, testMode: true });
  await testBridge.rpc("publish_park", {}).then(() => check(false, "test mode"), error => equal(error.message, "test-mode", "test mode never publishes"));
  const standalone = {}; standalone.parent = standalone; standalone.addEventListener = () => {}; standalone.removeEventListener = () => {};
  await social.createBridge({ win: standalone }).rpc("park_gallery").then(() => check(false, "offline"), error => equal(error.message, "offline", "standalone play has no gallery"));
  bridge.destroy();

  /* ------------------------------------------------ the show clock */
  const open = eventsAt(lux(2027, 8, 20, 17, 0, 1));
  equal(events.showAt(open, lux(2027, 8, 20, 17, 0, 1, 2))?.kind, "opening", "opening day 17:00:01: the ceremony is on");
  near(events.showAt(eventsAt(lux(2027, 8, 20, 17, 1, 30)), lux(2027, 8, 20, 17, 1, 30) + 250).t, 90.25, 0.01, "...with the show clock to the quarter second");
  equal(events.showAt(eventsAt(lux(2027, 8, 20, 17, 3, 0)), lux(2027, 8, 20, 17, 3, 0)), null, "17:03:00: over");
  equal(events.showAt(eventsAt(lux(2027, 8, 20, 16, 59, 59)), lux(2027, 8, 20, 16, 59, 59)), null, "16:59:59: not yet");
  equal(events.showAt(eventsAt(lux(2027, 8, 21, 17, 0, 10)), lux(2027, 8, 21, 17, 0, 10)), null, "no ceremony on day two");
  const sunday = d => eventsAt(lux(2027, 8, 29, ...d));
  equal([events.showAt(sunday([11, 0, 5]), lux(2027, 8, 29, 11, 0, 5))?.kind, events.showAt(sunday([15, 2, 0]), lux(2027, 8, 29, 15, 2, 0))?.kind], ["parade", "parade"], "Fouersonndeg 11:00 and 15:00: the Hämmelsmarsch");
  check(events.showAt(sunday([11, 3, 20]), lux(2027, 8, 29, 11, 3, 20)) !== null && sunday([11, 3, 20]).parade.live === false, "the formation is still on the alley after the calendar's 3 minutes (the tail takes longer)");
  equal(events.showAt(sunday([11, 3, 26]), lux(2027, 8, 29, 11, 3, 26)), null, "...and gone after the 205 s of the show");
  equal(events.showAt(sunday([12, 0, 0]), lux(2027, 8, 29, 12, 0, 0)), null, "no parade at noon");
  equal(events.showAt(eventsAt(lux(2027, 8, 22, 11, 0, 5)), lux(2027, 8, 22, 11, 0, 5)), null, "no parade on other days");
  equal(events.showAt(eventsAt(lux(2027, 9, 5, 11, 0, 5)), lux(2027, 9, 5, 11, 0, 5)), null, "no parade on the second Sunday");
  const last = (h, m, s) => eventsAt(lux(2027, 9, 8, h, m, s));
  const fw0 = events.showAt(last(22, 0, 0), lux(2027, 9, 8, 22, 0, 0));
  equal([fw0.kind, fw0.t], ["fireworks", 0], "closing night 22:00:00: fireworks, t = 0");
  near(events.showAt(last(22, 3, 59), lux(2027, 9, 8, 22, 3, 59) + 500).t, 239.5, 0.001, "...until 22:04");
  equal(events.showAt(last(22, 4, 0), lux(2027, 9, 8, 22, 4, 0)), null, "22:04: over");
  equal(events.showAt(last(21, 59, 59), lux(2027, 9, 8, 21, 59, 59)), null, "21:59:59: not yet");
  equal(events.showAt(eventsAt(lux(2027, 9, 7, 22, 0, 30)), lux(2027, 9, 7, 22, 0, 30)), null, "no fireworks the night before");
  check(events.showAt(last(22, 0, 30), lux(2027, 9, 8, 22, 0, 30)).key === events.showAt(last(22, 1, 0), lux(2027, 9, 8, 22, 1, 0)).key, "one key per show (the controller restarts nothing mid-show)");
  equal(events.showAt(eventsAt(lux(2026, 10, 23, 22, 0, 30)), lux(2026, 10, 23, 22, 0, 30)), null, "outside the fair there is no show at all");
  equal(events.luxSeconds(lux(2027, 8, 20, 17, 0, 1) + 750), 61201.75, "seconds of the Luxembourg day with the fraction");
  equal(events.bannerFor(eventsAt(lux(2027, 9, 8, 10))), "lastday", "banner: the last day before 20:00");
  equal(events.bannerFor(eventsAt(lux(2027, 9, 8, 21))), "familljendag", "banner: the last day is a Wednesday: after 20:00 it is the family day again");
  equal(events.bannerFor(eventsAt(lux(2027, 8, 25, 10))), "familljendag", "banner: Wednesday");
  equal(events.bannerFor(eventsAt(lux(2027, 8, 29, 10))), "fouersonndeg", "banner: Fouersonndeg");
  equal([events.bannerFor(eventsAt(lux(2027, 8, 24, 10))), events.bannerFor(eventsAt(lux(2027, 7, 10)))], [null, null], "banner: an ordinary fair day and a day outside the fair have none");

  /* ------------------------------------------------ the scripts */
  const C = events.CEREMONY;
  const at = t => events.ceremonyScript(t);
  check(!at(C.cutT - 0.1).cut && at(C.cutT).cut && at(C.cutT).confetti && !at(C.cutT + 1).confetti, "the ribbon is cut once, at 1:52");
  equal([at(C.cutT - 1).ribbon, at(C.cutT + 5).ribbon], [0, 1], "the ribbon is whole before and gone after the cut");
  near(at(C.walkFrom).u, C.startU, 1e-9, "the shepherd starts at the east end");
  near(at(C.walkTo + 1).u, C.stopU, 1e-9, "...and stops at the ribbon");
  check(at(30).u < at(20).u && at(30).walking && !at(70).walking, "he walks west, then stands");
  near(at(C.outTo + 1).u, C.outU, 1e-9, "after the cut he walks through the open ribbon");
  equal([0, 5, 12, 109, 110, 134, 135, 179].map(t => at(t).caption), [1, 1, 2, 2, 3, 3, 4, 4], "captions in order");
  check(at(0).fadeIn === 0 && at(7).fadeIn === 1 && at(179.9).fadeOut < 0.05 && at(100).fadeOut === 1, "the crowd fades in and the cast fades out at the end");
  check([0, 30, 59, 60, 100, 117, 118, 150, 175, 177].every(t => Object.values(at(t)).every(v => typeof v !== "number" || Number.isFinite(v))), "all script numbers are finite");
  check(at(30).music && !at(70).music && at(130).music && !at(178).music, "the band plays before the speech and after the cut");
  const P = events.PARADE_FORMATION;
  equal([P.filter(m => m.role === "shepherd").length, P.filter(m => m.role === "sheep").length, P.filter(m => m.role === "band").length, P.filter(m => m.role === "major").length], [5, 8, 8, 1], "5 shepherds, 8 sheep, a band of 8 and a drum major");
  check(P.every(m => Math.abs(m.lat) + 0.5 <= (events.ALLEY.w1 - events.ALLEY.w0) / 2), "everybody fits the 12 m alley");
  check(Math.max(...P.map(m => m.back)) <= events.PARADE.tail, "the formation is no longer than PARADE.tail");
  check(P.filter(m => m.role === "sheep").every(m => m.back > 0) && P.slice(0, 2).every(m => m.role === "shepherd" && m.back === 0), "two shepherds lead, the flock follows");
  check(!events.paradeDone(0) && events.paradeDone(events.PARADE.total) && events.paradeDone(205) && !events.paradeDone(190), `the whole parade is off the field after ${events.PARADE.total} s`);
  near(events.paradeLeadU(100) - events.paradeLeadU(99), 1.55, 1e-9, "walking pace 1.55 m/s");
  check(events.PARADE.total >= (events.PARADE.endU + events.PARADE.tail - events.PARADE.startU) / events.PARADE.speed, "the show is long enough for the tail to leave");

  /* ------------------------------------------------ fireworks schedule and the march */
  const s27 = events.fireworksSchedule(2027), again = events.fireworksSchedule(2027), s28 = events.fireworksSchedule(2028);
  equal(s27, again, "the firework schedule is deterministic (every client plays the same show)");
  check(JSON.stringify(s27) !== JSON.stringify(s28), "...and differs from year to year");
  check(s27.length >= 60 && s27.every((sh, i) => i === 0 || s27[i - 1].t <= sh.t), `${s27.length} shells, sorted`);
  check(s27.every(sh => sh.t - sh.rise >= 0 && sh.t <= events.FIREWORKS_TOTAL && events.SHELL_KINDS.includes(sh.kind) && Math.abs(sh.lane) <= 1 && sh.c1 < events.SHELL_COLORS.length && sh.size >= 34 && sh.alt >= 90), "every shell launches after the start, bursts before the end and is well formed");
  check(s27.filter(sh => sh.t >= 206 && sh.t <= 236).length >= 40, "the finale is a wall of shells");
  check(s27.filter(sh => sh.t < 30).length < s27.filter(sh => sh.t >= 206).length, "...denser than the opening");
  check(new Set(s27.map(sh => sh.kind)).size === events.SHELL_KINDS.length, "all shell kinds appear");
  equal(events.MARCH_BEATS, 32, "the march is 16 bars of 2 beats");
  const loop = events.marchNotes(0, events.MARCH_BEATS * 2);
  equal([loop.length, events.marchNotes(events.MARCH_BEATS, events.MARCH_BEATS * 2).length * 2], [loop.length, loop.length], "the tune repeats note for note");
  check(loop.every(n => n.midi >= 58 && n.midi <= 86 && n.dur > 0) && loop.every((n, i) => i === 0 || loop[i - 1].beat < n.beat), "notes are in range and in order");
  equal(events.marchNotes(3, 5).map(n => n.beat), [3, 4, 4.5], "a window of the tune");
  near(events.midiHz(69), 440, 1e-9, "A4 is 440 Hz");

  /* ------------------------------------------------ strings */
  const need = ["gal.", "ev.", "hammi.", "reason.already-today"];
  const keys = Object.keys(i18n.STRINGS.lb).filter(k => need.some(prefix => k.startsWith(prefix)));
  check(keys.length >= 60, `${keys.length} W7 strings`);
  check(["lb", "de", "en"].every(lang => keys.every(k => typeof i18n.STRINGS[lang][k] === "string" && i18n.STRINGS[lang][k].length > 0)), "every W7 string exists in lb, de and en");
  const brands = /bellevue|alpina|olympia|jules verne|booster maxxx|l[aä]mmy|jean la gaufre/i;
  check(keys.every(k => ["lb", "de", "en"].every(lang => !brands.test(i18n.STRINGS[lang][k]))), "no brand or the city mascot in the W7 strings");
  check(ITEMS.length === 33 && save.LG_LIMIT === 900, "(unchanged data)");
}
