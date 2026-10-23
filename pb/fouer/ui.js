// Schueberfouer Tycoon W5: the game UI. Three verbs only: tap a glowing pitch (build), tap an attraction (upgrade / look /
// replace), the 👣 button (walk, a hook for W6). Everything else is HUD: cash, stars, ONE goal, a settings menu.
// DOM only; all rules live in game.js, all drawing in scene.js.
import { t, formatMoney, formatDuration, formatDate, LANGS } from "./i18n.js";
import { ITEM_BY_ID, LOOKS, LEVELS, PITCHES, STAR_POINTS, RULES } from "./data.js";
import { stampRewards, stampCount } from "./sim.js";
import { mountEnvUi } from "./world/envmenu.js";
import { parseSnapshot, loadKernel } from "./legacy.js";

export const ICON = { kachel: "🥔", fritten: "🍟", lous: "🎟️", kanner: "🎠", wurscht: "🌭", zocker: "🍭", lukas: "🔨", mandel: "🌰", waffel: "🧇", fesch: "🐟",
  kette: "🎪", scooter: "🚗", crepes: "🥞", schiess: "🎯", bayern: "🚙", happy: "⛵", break: "🌀", musik: "🎵", takeoff: "🛩️", tent: "🍺", wheel: "🎡", maus: "🐭",
  geister: "👻", jules: "🗼", hangover: "⬇️", splash: "🌊", booster: "🚀", alpina: "🏔️", looping: "🎢", infinity: "♾️", gold: "🎠", museum: "🏛️", lammy: "🐑" };
const LANG_NAMES = { lb: "Lëtzebuergesch", de: "Deutsch", en: "English" };
const POP_LIMIT = 12;
const POP_MIN_GAP = 0.7;
const SHEET_REFRESH = 0.25;
const TOAST_MS = 2600;
const STAMP_DAY_KEY = "pb_fouer_stampday";
const GOAL_KEY = "pb_fouer_goal";

const el = (tag, className, html) => { const node = document.createElement(tag); if (className) node.className = className; if (html !== undefined) node.innerHTML = html; return node; };
const esc = text => String(text).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const number = n => String(Math.floor(Math.max(0, n))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export function createUi({ root, game, scene, r, env, hooks, sfx, lang: initialLang, setLang: persistLang, debug = false }) {
  let lang = initialLang;
  const T = (key, params) => t(lang, key, params);
  const name = id => T(`item.${id}`);
  const money = amount => formatMoney(amount);
  let selected = -1;
  let sheetMode = null;               // "build" | "manage"
  let replaceOpen = false;
  let replaceConfirm = null;          // { item, until }
  let sheetEl = null;
  let sheetTimer = 0;
  let modalOpen = false;
  const modalQueue = [];
  let bubbleKey = null;                // null = render again, "" = nothing shown
  let fingerEl = null;
  let lastGoalKey = "";
  let shownCash = game.state.c;
  let lastStars = 0;
  let goalCollapsed = false;
  let walking = false;
  let welcomeOver = false;
  const popClock = new Map();
  const popAcc = new Map();
  const badges = new Map();
  let popCount = 0;
  let lastSnapshotKey = "";

  try { goalCollapsed = localStorage.getItem(GOAL_KEY) === "0"; } catch (error) { /* storage blocked */ }

  // ---------------------------------------------------------------- skeleton
  root.innerHTML = "";
  const hud = el("div", "hud");
  hud.innerHTML = `<div class="cashcard"><div class="coin">€</div><div class="nums"><b id="cash">€0</b><small id="rate"></small></div></div>
    <div class="starcard"><div class="stars" id="stars"></div><div class="starbar"><i id="starfill"></i></div><small id="starnote"></small></div>`;
  const banners = el("div", "banners");
  const goal = el("div", ""); goal.id = "goal";
  const goalChip = el("button", ""); goalChip.id = "goalChip"; goalChip.type = "button"; goalChip.textContent = "🎯"; goalChip.hidden = true;
  const layer = el("div", "layer");
  const topstack = el("div", "topstack");            // Hämmi's bubble and the toasts stack here, so they never overlap
  const bubble = el("div", "bubble"); bubble.hidden = true;
  const toasts = el("div", "toasts");
  topstack.append(bubble, toasts);
  const anchors = el("div", "anchors");
  const modalHost = el("div", "layer");
  root.append(hud, banners, goal, goalChip, layer, topstack, anchors, modalHost);
  document.body.classList.add("game");
  const $ = id => root.querySelector("#" + id);
  const starsEl = $("stars");
  for (let i = 0; i < 5; i++) starsEl.append(el("span", "star", "⭐"));
  const walkBtn = document.getElementById("walkBtn");

  // ---------------------------------------------------------------- toasts
  function toast(text, ms = TOAST_MS) {
    const node = el("div", "toast"); node.textContent = text; toasts.append(node);
    while (toasts.children.length > 3) toasts.firstChild.remove();
    setTimeout(() => { node.classList.add("out"); setTimeout(() => node.remove(), 400); }, ms);
  }

  // ---------------------------------------------------------------- HUD
  function refreshStars() {
    const info = game.info();
    const count = info.stars;
    [...starsEl.children].forEach((node, i) => {
      node.classList.toggle("on", i < count);
      if (i === count - 1 && lastStars && count > lastStars) { node.classList.remove("pulse"); void node.offsetWidth; node.classList.add("pulse"); }
    });
    lastStars = count;
    const prev = STAR_POINTS[count - 1], next = STAR_POINTS[count];
    $("starfill").style.width = next === undefined ? "100%" : `${clamp((info.points - prev) / (next - prev), 0, 1) * 100}%`;
    $("starnote").textContent = next === undefined ? T("hud.maxStars") : T("hud.toNext", { points: Math.max(1, Math.ceil(next - info.points)), stars: count + 1 });
  }

  function refreshRate() {
    const per = Math.round(game.info().incomePerMin);
    $("rate").textContent = per > 0 ? `+${money(per)}/min` : "";
  }

  function refreshBanners() {
    banners.innerHTML = "";
    for (const id of game.banners().slice(0, 2)) banners.append(el("div", "pill", esc(T(`event.${id}`))));
    const foodie = game.foodie();
    if (foodie.stacks) banners.append(el("div", "pill foodie", `🍴 ${esc(T("foodie.title"))} ×${(Math.round(foodie.mult * 100) / 100).toFixed(2).replace(/0$/, "")}`));
  }

  function applyChrome() {
    const tut = game.tutorial();
    const minimal = tut.active && tut.mode === "fresh" && (tut.step <= 3 || tut.step === 4);
    document.body.classList.toggle("tut-minimal", minimal);
    const showWalk = !tut.active || (tut.mode === "fresh" ? tut.step >= 7 : tut.step >= 3);
    walkBtn.hidden = !showWalk || walking;
    walkBtn.classList.toggle("tut-glow", tut.active && tut.stage === "walk");
    walkBtn.setAttribute("aria-label", T("hud.walk"));
    document.body.classList.toggle("has-sheet", Boolean(sheetEl));
    refreshBanners();
  }

  // ---------------------------------------------------------------- goal ticket
  function goalView() {
    const g = game.goal();
    const s = game.state;
    const nameOf = id => name(id);
    const tipLine = tip => {
      if (!tip) return "";
      const key = tip.type === "build" ? "goal.tip.build" : tip.type === "upgrade" ? "goal.tip.upgrade" : "goal.tip.replace";
      return T(key, { item: nameOf(tip.item), cost: money(tip.net) });
    };
    switch (g.id) {
      case "firstBuild": return { key: "fb", icon: "🎯", text: T("goal.firstBuild"), sub: "", progress: null };
      case "voucher": return { key: `v${g.count}`, icon: "🎟️", text: T("goal.voucher", { item: nameOf(g.item) }), sub: "", progress: null, pitch: -1 };
      case "star": return { key: `s${g.stars}|${g.points}|${g.tip ? g.tip.item + g.tip.type : ""}`, icon: "⭐", text: T("goal.star", { stars: g.stars, points: g.points }), sub: tipLine(g.tip), progress: g.progress, tip: g.tip };
      case "maxed": return { key: "max", icon: "👑", text: T("goal.maxed"), sub: "", progress: null };
      default: return { key: `${g.id}${g.pitch}${g.item}${Math.round(g.cost)}`, icon: g.id === "gold" ? "🥇" : "⬆️", text: T(`goal.${g.id}`, { item: nameOf(g.item), cost: money(g.cost) }), sub: "", progress: null,
        pitch: g.pitch, replace: g.id === "replace" };
    }
  }

  function refreshGoal() {
    const tut = game.tutorial();
    const hideForTutorial = tut.active && (tut.mode === "fresh" ? tut.step < 6 : tut.step < 3);
    const view = goalView();
    const collapsed = goalCollapsed && !(tut.active && tut.stage === "goal");
    goal.classList.toggle("hidden", hideForTutorial || collapsed);
    goalChip.hidden = hideForTutorial || !collapsed;
    const key = `${lang}|${view.key}`;
    if (key === lastGoalKey) {
      const bar = goal.querySelector(".gbar i");
      if (bar && view.progress !== null) bar.style.width = `${clamp(view.progress, 0, 1) * 100}%`;
      return;
    }
    lastGoalKey = key;
    goal.innerHTML = `<div class="ticket" role="button" tabindex="0" data-tut="goal" aria-label="${esc(T("hud.goal"))}"><span class="gicon">${view.icon}</span>
      <span class="gtext"><b>${esc(view.text)}</b>${view.sub ? `<span>${esc(view.sub)}</span>` : ""}${view.progress !== null ? `<div class="gbar"><i style="width:${clamp(view.progress, 0, 1) * 100}%"></i></div>` : ""}</span>
      <button class="gx" type="button" aria-label="${esc(T("sheet.close"))}">✕</button></div>`;
    goal.querySelector(".gx").addEventListener("click", ev => { ev.stopPropagation(); goalCollapsed = true; saveGoalPref(); refreshGoal(); });
    goal.querySelector(".ticket").addEventListener("click", () => onGoalTap(view));
  }
  const saveGoalPref = () => { try { localStorage.setItem(GOAL_KEY, goalCollapsed ? "0" : "1"); } catch (error) { /* storage blocked */ } };
  goalChip.addEventListener("click", () => { goalCollapsed = false; saveGoalPref(); lastGoalKey = ""; refreshGoal(); });

  function onGoalTap(view) {
    const tut = game.tutorial();
    if (tut.active && tut.stage === "goal") { game.acknowledgeTutorial(); sfx.click(); return; }
    if (tut.active) return;
    sfx.click();
    if (view.tip) { openPitch(view.tip.pitch, { replace: view.tip.type === "replace" }); return; }
    if (view.pitch !== undefined && view.pitch >= 0) { openPitch(view.pitch, { replace: view.replace }); return; }
    if (view.pitch === -1) {
      const free = game.glowPitches()[0];
      if (free !== undefined) openPitch(free);
    }
  }

  // ---------------------------------------------------------------- sheets
  function closeSheet() {
    if (sheetEl) { sheetEl.remove(); sheetEl = null; }
    sheetMode = null; replaceOpen = false; replaceConfirm = null; selected = -1;
    scene.select(-1);
    document.body.classList.remove("has-sheet");
    bubbleKey = null;
  }

  function openPitch(index, { replace = false } = {}) {
    const tut = game.tutorial();
    if (tut.active) {
      const ok = (tut.stage === "pitch" || tut.stage === "upgrade") && index === tut.pitchTarget;
      if (!ok) return;
    }
    const status = game.pitchStatus(index);
    if (status === "built") {
      selected = index; sheetMode = "manage"; replaceOpen = replace && !tut.active; replaceConfirm = null;
    } else if (game.pitchUsable(index)) {
      selected = index; sheetMode = "build"; replaceOpen = false;
    } else {
      sfx.error();
      toast(T("toast.locked", { stars: PITCHES[index].star }));
      return;
    }
    welcomeOver = true;
    scene.select(index);
    scene.focus(index);
    renderSheet();
    sfx.click();
  }

  function iconOf(id) { return ICON[id] ?? "🎪"; }

  function buildCard(option, { solo = false } = {}) {
    const item = option.item;
    const card = el("div", `card${solo ? " solo" : ""}`);
    card.dataset.cat = item.cat; card.dataset.item = item.id; card.dataset.cost = String(option.cost);
    const price = option.gift ? T("ui.starterGift") : option.cost === 0 ? T("card.free") : money(option.cost);
    const income = Math.max(0, Math.round(option.dIncome));
    card.innerHTML = `${option.mode === "voucher" ? `<span class="vbadge">${esc(T("card.voucher"))}</span>` : option.tip && !solo && !game.tutorial().active ? `<span class="tipbadge">★ ${esc(T("card.tip"))}</span>` : ""}
      <div class="ico">${iconOf(item.id)}</div><b>${esc(name(item.id))}</b>
      <div class="price${option.cost === 0 ? " free" : ""}">${esc(price)}</div>
      <div class="stats"><span class="inc">${esc(T("card.income", { amount: money(income) }))}</span><span>${esc(T("card.appeal", { points: Math.round(option.appeal) }))}</span></div>
      <button class="btn" type="button" data-tut="build"></button>`;
    const button = card.querySelector("button");
    button.addEventListener("click", () => doBuild(option));
    return card;
  }

  function refreshCardButtons(scopeEl) {
    scopeEl.querySelectorAll(".card").forEach(card => {
      const button = card.querySelector("button");
      if (!button) return;
      const cost = Number(card.dataset.cost);
      const net = card.dataset.net !== undefined ? Number(card.dataset.net) : cost;
      const cash = card.dataset.replace ? game.state.c + Number(card.dataset.refund) : game.state.c;
      const ok = cash >= cost;
      button.disabled = !ok;
      if (card.dataset.replace) {
        const confirm = replaceConfirm && replaceConfirm.item === card.dataset.item && replaceConfirm.until > performance.now();
        button.innerHTML = ok ? (confirm ? esc(T("manage.confirm")) : esc(T("manage.replaceFor", { cost: money(net < 0 ? 0 : net) }))) : esc(T("card.missing", { amount: money(cost - cash) }));
        button.classList.toggle("green", confirm);
      } else {
        button.innerHTML = ok ? esc(T("card.build")) : esc(T("card.missing", { amount: money(cost - cash) }));
      }
    });
  }

  function renderBuildSheet() {
    const tut = game.tutorial();
    let options = game.buildOptions(selected);
    if (tut.active && tut.item) options = options.filter(o => o.item.id === tut.item);
    const size = PITCHES[selected].size;
    const sheet = el("div", "sheet build");
    sheet.innerHTML = `<div class="grab"></div><header><h2>${esc(T("sheet.build"))}<small>${esc(T(`sheet.size.${size}`))}</small></h2><button class="xbtn" type="button" aria-label="${esc(T("sheet.close"))}">✕</button></header>`;
    const rail = el("div", "rail");
    if (!options.length) rail.append(el("p", "replace-hint", esc(T("sheet.nothingFits"))));
    options.forEach(option => rail.append(buildCard(option, { solo: options.length === 1 })));
    sheet.append(rail);
    sheet.querySelector(".xbtn").addEventListener("click", () => { closeSheet(); sfx.click(); });
    return sheet;
  }

  function levelName(level) { return T(`level.${level}`); }

  function renderManageSheet() {
    const info = game.manageInfo(selected);
    const tut = game.tutorial();
    const item = info.item;
    const sheet = el("div", "sheet manage");
    const pips = [0, 1, 2, 3].map(i => `<span class="pip${i === 3 ? " gold" : ""}${i <= info.level ? " on" : ""}"></span>`).join("");
    const flags = [];
    if (info.problem) flags.push(`<span class="flag warn">${esc(T("manage.queue"))}</span>`);
    if (game.state.pi === 1 && (info.entry.fl & 3)) flags.push(`<span class="flag pioneer">🌟 ${esc(T("manage.pioneer"))}</span>`);
    sheet.innerHTML = `<div class="grab"></div><header><div class="top" data-cat="${item.cat}" style="flex:1;margin:0"><div class="ico">${iconOf(item.id)}</div>
      <div style="min-width:0"><h2 style="margin:0;font-size:20px">${esc(name(item.id))}</h2><div class="pips">${pips}</div>
      <div class="earn">${info.income > 0 ? esc(T("manage.income", { amount: money(Math.round(info.income)) })) : ""} · ${esc(levelName(info.level))}</div></div></div>
      <button class="xbtn" type="button" aria-label="${esc(T("sheet.close"))}">✕</button></header>
      ${flags.length ? `<div class="flags">${flags.join("")}</div>` : ""}`;
    const hint = info.problem ? el("div", "replace-hint", esc(T("ui.queue"))) : null;
    if (hint) sheet.append(hint);
    const up = el("button", "btn"); up.type = "button"; up.dataset.tut = "upgrade";
    up.addEventListener("click", () => doUpgrade());
    sheet.append(up);
    if (!(tut.active)) {
      const looks = el("div", "looks"); looks.append(el("span", "", esc(T("manage.look"))));
      LOOKS.forEach((lookName, look) => {
        const sw = el("button", "swatch", `<span>${esc(T(`look.${lookName}`))}</span>`); sw.type = "button"; sw.dataset.look = String(look);
        sw.setAttribute("aria-pressed", String(info.look === look)); sw.setAttribute("aria-label", T(`look.${lookName}`));
        sw.addEventListener("click", () => { if (game.setLook(selected, look).ok) { sfx.click(); toast(T("toast.look", { look: T(`look.${lookName}`) })); } });
        looks.append(sw);
      });
      sheet.append(looks);
      if (!item.special) {
        const split = el("div", "split");
        const rep = el("button", "btn ghost", `⇄ ${esc(T("manage.replace"))}`); rep.type = "button"; rep.dataset.replace = "toggle";
        rep.addEventListener("click", () => { replaceOpen = !replaceOpen; replaceConfirm = null; renderSheet(); });
        split.append(rep); sheet.append(split);
        if (replaceOpen) {
          sheet.append(el("div", "replace-hint", `${esc(T("manage.replaceHint"))} · ${esc(T("ui.refund", { amount: money(info.refund) }))}`));
          const rail = el("div", "rail");
          info.replaceCards.forEach(option => {
            const card = buildCard(option);
            card.dataset.replace = "1"; card.dataset.refund = String(info.refund); card.dataset.net = String(option.net);
            const button = card.querySelector("button");
            const clone = button.cloneNode(true); button.replaceWith(clone);
            clone.addEventListener("click", () => doReplace(option));
            rail.append(card);
          });
          if (!info.replaceCards.length) rail.append(el("p", "replace-hint", esc(T("sheet.nothingFits"))));
          sheet.append(rail);
        }
      }
    }
    sheet.querySelector(".xbtn").addEventListener("click", () => { closeSheet(); sfx.click(); });
    return sheet;
  }

  function renderSheet() {
    if (selected < 0) return;
    const keepRail = sheetEl && sheetEl.querySelector(".rail") ? sheetEl.querySelector(".rail").scrollLeft : 0;
    const next = sheetMode === "build" ? renderBuildSheet() : renderManageSheet();
    if (sheetEl) { next.style.animation = "none"; sheetEl.replaceWith(next); } else layer.append(next);
    sheetEl = next;
    const rail = sheetEl.querySelector(".rail"); if (rail && keepRail) rail.scrollLeft = keepRail;
    document.body.classList.add("has-sheet");
    refreshSheetDynamic();
  }

  function refreshSheetDynamic() {
    if (!sheetEl) return;
    refreshCardButtons(sheetEl);
    if (sheetMode === "manage") {
      const info = game.manageInfo(selected);
      if (!info) { closeSheet(); return; }
      const up = sheetEl.querySelector('[data-tut="upgrade"]');
      if (up) {
        if (info.maxed) { up.disabled = true; up.innerHTML = `✨ ${esc(levelName(info.level))}`; }
        else {
          up.disabled = !info.canAfford;
          up.innerHTML = info.canAfford
            ? `${esc(T("ui.upgradeFor", { cost: money(info.cost) }))}<small>${esc(T("manage.upgradeGain", { amount: money(Math.max(0, Math.round(info.upgradeGain))) }))}</small>`
            : `${esc(T("manage.wait", { amount: money(info.missing) }))}<small>${esc(T("ui.upgradeFor", { cost: money(info.cost) }))}</small>`;
        }
      }
      const rep = sheetEl.querySelector('[data-replace="toggle"]'); void rep;
    }
  }

  // ---------------------------------------------------------------- commands from the sheets
  function fail(result) {
    sfx.error();
    toast(T(`reason.${result.reason}`, {}));
  }

  function doBuild(option) {
    sfx.unlock();
    const index = selected;
    const result = game.build(index, option.item.id, { voucher: option.mode === "voucher" });
    if (!result.ok) { fail(result); return; }
    sfx.build();
    toast(T("toast.built", { item: name(option.item.id) }));
    closeSheet();
    scene.focus(index, { dist: Math.max(70, Math.min(r.rig.dist, 120)), lift: 0.04, seconds: 0.9 });
  }

  function doUpgrade() {
    sfx.unlock();
    const index = selected;
    const result = game.upgrade(index);
    if (!result.ok) { fail(result); return; }
    sfx.upgrade();
    const entry = game.state.pitches[index];
    toast(T("toast.upgraded", { item: name(entry.k), level: levelName(entry.lv) }));
    renderSheet();
  }

  function doReplace(option) {
    const now = performance.now();
    if (!(replaceConfirm && replaceConfirm.item === option.item.id && replaceConfirm.until > now)) {
      replaceConfirm = { item: option.item.id, until: now + 3500 };
      refreshSheetDynamic();
      return;
    }
    const index = selected;
    const result = game.replace(index, option.item.id);
    if (!result.ok) { fail(result); return; }
    sfx.build();
    toast(T("toast.built", { item: name(option.item.id) }));
    closeSheet();
  }

  // ---------------------------------------------------------------- tapping the world
  function onTap(event) {
    if (walking) return;                                        // the walk handles its own taps
    sfx.unlock();
    if (hooks.tapSheep && hooks.tapSheep(event.clientX, event.clientY)) return;     // Hämmi bleats (W6)
    const index = scene.pick(event.clientX, event.clientY, event.ground);
    if (index >= 0) { if (index === selected) return; openPitch(index); return; }
    if (sheetEl) closeSheet();
  }

  // ---------------------------------------------------------------- Hämmi + the pointing finger (onboarding)
  function tutorialMessage(tut) {
    if (!tut.active) return null;
    const sheetOnTarget = sheetEl && selected === tut.pitchTarget;
    if (tut.mode === "pioneer") {
      if (tut.stage === "pitch") return { key: "p1", text: T("tutorial.pioneer.1") };
      if (tut.stage === "crowd") return { key: "p2", text: T("tutorial.pioneer.2"), ok: true };
      return { key: tut.wait > 0 ? "p3w" : "p3", text: tut.wait > 0 ? T("tutorial.wait", { amount: money(tut.wait) }) : T("tutorial.pioneer.3") };
    }
    switch (tut.stage) {
      case "pitch":
        if (tut.step === 1) return sheetOnTarget ? { key: "t2", text: T("tutorial.2") } : { key: welcomeOver ? "t1" : "w", text: welcomeOver ? T("tutorial.1") : T("hammi.welcome") };
        return { key: "t4", text: T("tutorial.4") };
      case "coin": return { key: "t3", text: T("tutorial.3") };
      case "upgrade": return { key: tut.wait > 0 ? "t5w" : "t5", text: tut.wait > 0 ? T("tutorial.wait", { amount: money(tut.wait) }) : T("tutorial.5") };
      case "goal": return { key: "t6", text: T("tutorial.6"), ok: true };
      case "walk": return { key: "t7", text: T("tutorial.7") };
      default: return null;
    }
  }

  function renderBubble() {
    const tut = game.tutorial();
    const msg = tutorialMessage(tut);
    const key = msg ? `${lang}|${msg.key}` : "";
    if (key === bubbleKey) return;
    bubbleKey = key;
    if (!msg) { bubble.hidden = true; bubble.innerHTML = ""; return; }
    bubble.hidden = false;
    bubble.innerHTML = `<div class="sheep" aria-hidden="true">🐑</div><div class="msg"><span class="who">${esc(T("tutorial.hammi"))}</span><span class="txt">${esc(msg.text)}</span>
      <div class="acts"><button class="skip" type="button">${esc(T("tutorial.skip"))}</button>${msg.ok ? `<button class="btn ok" type="button" data-tut="ok">${esc(T("tutorial.ok"))}</button>` : ""}</div></div>`;
    bubble.querySelector(".skip").addEventListener("click", () => { game.skipTutorial(); bubbleKey = null; refreshAll(); });
    const ok = bubble.querySelector(".ok");
    if (ok) ok.addEventListener("click", () => { sfx.click(); game.acknowledgeTutorial(); });
  }

  function fingerTarget(tut) {
    if (!tut.active) return null;
    const sheetOnTarget = sheetEl && selected === tut.pitchTarget;
    const q = selector => (sheetEl ? sheetEl.querySelector(selector) : null);
    if (tut.stage === "pitch") return sheetOnTarget ? { el: q('[data-tut="build"]:not(:disabled)') ?? q('[data-tut="build"]') } : { pitch: tut.pitchTarget };
    if (tut.stage === "upgrade") return sheetOnTarget ? { el: q('[data-tut="upgrade"]') } : { pitch: tut.pitchTarget };
    if (tut.stage === "crowd" || tut.stage === "goal") return { el: bubble.querySelector('[data-tut="ok"]') };
    if (tut.stage === "walk") return { el: walkBtn };
    return null;
  }

  let glowEl = null;
  function updateFinger() {
    const tut = game.tutorial();
    const target = modalOpen ? null : fingerTarget(tut);
    let x = 0, y = 0, has = false, glow = null;
    if (target && target.pitch !== undefined && target.pitch >= 0) {
      const p = scene.anchor(target.pitch, game.state.pitches[target.pitch] ? Math.min(scene.heightOf(target.pitch) * 0.4, 10) : 0.4);
      if (p && p.visible) { x = p.x; y = p.y; has = true; }
    } else if (target && target.el && target.el.isConnected && !target.el.hidden) {
      const rect = target.el.getBoundingClientRect();
      if (rect.width > 0) { x = rect.left + rect.width * 0.62; y = rect.top + rect.height * 0.55; has = true; glow = target.el; }
    }
    if (glowEl && glowEl !== glow) glowEl.classList.remove("tut-glow");
    if (glow) glow.classList.add("tut-glow");
    glowEl = glow;
    if (!has) { if (fingerEl) { fingerEl.remove(); fingerEl = null; } return; }
    if (!fingerEl) { fingerEl = el("div", "finger", "👆"); fingerEl.setAttribute("aria-hidden", "true"); document.body.append(fingerEl); fingerEl.style.position = "fixed"; }
    fingerEl.style.left = `${x}px`; fingerEl.style.top = `${y}px`;
  }

  // ---------------------------------------------------------------- coins and queue clocks over the stalls
  function spawnPop(index, amount) {
    if (popCount >= POP_LIMIT || r.rig.cdist > 330) return;
    const p = scene.anchor(index, Math.min(scene.heightOf(index) * 0.55, 12));
    if (!p || !p.visible || p.y < 0) return;
    const node = el("div", "coinpop", `<i>€</i>${esc(money(Math.max(1, amount)))}`);
    node.style.left = `${p.x}px`; node.style.top = `${p.y}px`;
    anchors.append(node); popCount++;
    setTimeout(() => { node.remove(); popCount--; }, 1300);
    sfx.coin();
  }

  function updateCoins(dt) {
    if (walking) return;                                        // no coin pops / queue clocks in the first-person walk (the queues are real figures there)
    const info = game.info();
    const rows = new Map(info.perPitch.map(row => [row.pitch, row]));
    for (const row of rows.values()) {
      const perSec = row.income / 60;
      const threshold = Math.max(2, perSec * 2.2);
      let acc = popAcc.get(row.pitch);
      if (acc === undefined) acc = Math.random() * threshold;
      acc += perSec * dt;
      const last = popClock.get(row.pitch) ?? 0;
      popClock.set(row.pitch, last + dt);
      if (acc >= threshold && last + dt >= POP_MIN_GAP) { spawnPop(row.pitch, acc); acc = 0; popClock.set(row.pitch, 0); }
      popAcc.set(row.pitch, acc);
      // the red clock on overloaded attractions
      if (row.problem) {
        let badge = badges.get(row.pitch);
        if (!badge) {
          badge = el("button", "qbadge", `⏰<b></b>`); badge.type = "button"; badge.setAttribute("aria-label", T("manage.queue"));
          badge.addEventListener("click", () => openPitch(row.pitch));
          anchors.append(badge); badges.set(row.pitch, badge);
        }
        badge.querySelector("b").textContent = String(row.queueFigures);
        const p = scene.anchor(row.pitch, Math.min(scene.heightOf(row.pitch) + 2, 16));
        badge.style.display = p && p.visible ? "" : "none";
        if (p) { badge.style.left = `${p.x}px`; badge.style.top = `${p.y}px`; }
      } else if (badges.has(row.pitch)) { badges.get(row.pitch).remove(); badges.delete(row.pitch); }
    }
    for (const [pitch, badge] of badges) if (!rows.has(pitch) || !rows.get(pitch).problem) { badge.remove(); badges.delete(pitch); }
  }

  // ---------------------------------------------------------------- modals
  function showModal(build) {
    return new Promise(resolve => {
      const run = () => {
        modalOpen = true;
        const overlay = el("div", "modal"); overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true");
        const close = value => { overlay.remove(); modalOpen = false; resolve(value); next(); };
        build(overlay, close);
        modalHost.append(overlay);
        const focus = overlay.querySelector("button.btn"); if (focus) focus.focus({ preventScroll: true });
      };
      if (modalOpen) modalQueue.push(run); else run();
    });
  }
  function next() { const run = modalQueue.shift(); if (run) run(); }

  async function drawOldPark(canvas, lg) {
    const parsed = parseSnapshot(lg);
    const ctx = canvas.getContext("2d");
    const S = 4, N = 40;
    canvas.width = N * S; canvas.height = N * S + 0;
    ctx.fillStyle = "#6e9f56"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!parsed) { ctx.fillStyle = "#4b3823"; ctx.font = "bold 40px sans-serif"; ctx.textAlign = "center"; ctx.fillText("?", canvas.width / 2, canvas.height / 2 + 14); return; }
    let kernel = null;
    try { kernel = await loadKernel(); } catch (error) { console.warn("[fouer] old park map needs the v1 kernel", error); }
    for (let p = 0; p < 16; p++) {                        // owned parcels are lighter
      const owned = (parsed.land >> p) & 1;
      const px = (p % 4) * 10, py = Math.floor(p / 4) * 10;
      ctx.fillStyle = owned ? "#a8d583" : "#5f8f4a"; ctx.fillRect(px * S, py * S, 10 * S, 10 * S);
      ctx.strokeStyle = "#ffffff30"; ctx.strokeRect(px * S + .5, py * S + .5, 10 * S - 1, 10 * S - 1);
    }
    ctx.fillStyle = "#f1e2b4";
    for (const tile of parsed.paths) ctx.fillRect((tile % N) * S, Math.floor(tile / N) * S, S, S);
    const color = { ride: "#e5483c", stall: "#2f7aa6", facility: "#8a8f98", scenery: "#3f8f46" };
    for (const object of parsed.objects) {
      const kind = kernel?.KINDS?.[object.k];
      const [fw, fh] = kind ? (object.r % 2 ? [kind.footprint[1], kind.footprint[0]] : kind.footprint) : [2, 2];
      ctx.fillStyle = color[kind?.type] ?? "#8a8f98";
      ctx.fillRect((object.p % N) * S, Math.floor(object.p / N) * S, fw * S, fh * S);
      ctx.strokeStyle = "#00000050"; ctx.strokeRect((object.p % N) * S + .5, Math.floor(object.p / N) * S + .5, fw * S - 1, fh * S - 1);
    }
    ctx.fillStyle = "#ffcf5c"; ctx.beginPath(); ctx.arc(20 * S + S / 2, S, S * 1.4, 0, Math.PI * 2); ctx.fill();   // the golden gate
  }

  function showLetter(letter, { museum = false } = {}) {
    const { report, lg } = letter;
    return showModal((overlay, close) => {
      const paper = el("div", "paper");
      const kind = letter.source === "stub" ? "stub" : (report?.kind ?? "fresh");
      const vouchers = (report?.vouchers ?? []).map(id => `<span class="vchip"><span>${iconOf(id)}</span>${esc(name(id))}</span>`).join("");
      const gold = report?.gold !== false && !museum;
      const intro = museum ? "" : kind === "corrupt" ? T("letter.corrupt") : kind === "stub" ? T("letter.stub") : kind === "topup" ? T("letter.topup") : T("letter.body");
      const showNums = !museum;
      paper.innerHTML = `<div class="seal" aria-hidden="true">🐑</div><h1>${esc(museum ? T("letter.museumTitle") : T("letter.title"))}</h1>
        ${intro ? `<p>${esc(intro)}</p>` : ""}
        ${lg ? `<div class="map"><canvas width="160" height="160" aria-label="${esc(T("museum.title"))}"></canvas></div>` : museum ? `<p>${esc(T("museum.empty"))}</p>` : ""}
        ${showNums ? `<ul>
          <li data-row="value"><span class="e">🏆</span><span class="k">${esc(T("letter.label.value"))}</span><span class="v">+${number(report.tb0)}</span></li>
          <li data-row="cash"><span class="e">💶</span><span class="k">${esc(T("letter.label.cash"))}</span><span class="v">${esc(money(report.cash))}</span></li>
          ${report.rb > 0 ? `<li data-row="rating"><span class="e">⭐</span><span class="k">${esc(T("letter.label.rating"))}</span><span class="v">+${report.rb} (⭐${report.stars})</span></li>` : ""}
        </ul>
        <div class="vouchers">${vouchers}${gold ? `<span class="vchip gold"><span>🎠</span>${esc(T("letter.gold"))}</span><span class="vchip"><span>🏛️</span>${esc(T("letter.kiosk"))}</span>` : ""}</div>` : ""}
        <button class="btn" type="button" data-go="1">${esc(museum ? T("sheet.close") : T("letter.go"))}</button>`;
      overlay.append(paper);
      paper.querySelector("[data-go]").addEventListener("click", () => { sfx.click(); close(); });
      if (lg) drawOldPark(paper.querySelector("canvas"), lg);
    });
  }

  function showOffline(report) {
    return showModal((overlay, close) => {
      const card = el("div", "dialog");
      card.innerHTML = `<div class="coin" style="width:72px;height:72px;font-size:38px;margin:0 auto 6px">€</div><h2>${esc(T("offline.title"))}</h2>
        <p>${esc(T("offline.body", { duration: formatDuration(report.seconds), amount: money(report.credited) }))}</p>
        <div class="big" data-offline>${esc(money(report.credited))}</div>
        ${game.events.fair.active ? `<p>${esc(T("offline.fouer"))}</p>` : ""}${report.capped ? `<p>${esc(T("offline.cap", { hours: Math.round(report.capHours) }))}</p>` : ""}
        <button class="btn" type="button" data-claim="1">${esc(T("offline.claim"))}</button>`;
      overlay.append(card);
      card.querySelector("[data-claim]").addEventListener("click", () => { sfx.coin(); sfx.upgrade(); coinRain(); close(); });
    });
  }

  function coinRain() {
    for (const row of game.info().perPitch.slice(0, 8)) spawnPop(row.pitch, Math.max(1, row.income / 6));
  }

  function showStamps(payload) {
    return showModal((overlay, close) => {
      const year = payload.year;
      const count = stampCount(game.state, year);
      const rewards = stampRewards(game.state, year);
      const card = el("div", "dialog");
      const mask = game.state.st[year] ?? 0;
      const cells = Array.from({ length: 20 }, (_, i) => {
        const on = Math.floor(mask / 2 ** i) % 2 === 1;
        const cls = `stamp${on ? " on" : ""}${i === payload.day ? " today" : ""}${[4, 9, 14, 19].includes(i) ? " reward" : ""}`;
        return `<div class="${cls}">${on ? "🐑" : i + 1}</div>`;
      }).join("");
      const list = [[5, rewards.bulbs, "event.stamp.reward.5"], [10, rewards.statue, "event.stamp.reward.10"], [15, rewards.booth, "event.stamp.reward.15"], [20, rewards.crown, "event.stamp.reward.20"]]
        .map(([n, got, key]) => `<li class="${got ? "got" : ""}">${got ? "✓" : "○"} ${esc(T(key, { year }))}</li>`).join("");
      card.innerHTML = `<div class="emoji">🎟️</div><h2>${esc(T("event.stamp.title"))}</h2><p>${esc(T("event.stamp.today"))} · ${esc(T("event.stamp.count", { count }))}</p>
        <div class="stampgrid">${cells}</div><ul class="rewardlist">${list}</ul><button class="btn" type="button">${esc(T("event.stamp.close"))}</button>`;
      overlay.append(card);
      card.querySelector("button").addEventListener("click", () => { sfx.click(); close(); });
    });
  }

  let fireworksShown = false;
  function maybeFireworks() {
    if (fireworksShown || !game.fireworksClaimable()) return;
    fireworksShown = true;
    const amount = Math.floor(game.info().incomePerSec * 900);
    showModal((overlay, close) => {
      const card = el("div", "dialog");
      card.innerHTML = `<div class="emoji">🎆</div><h2>${esc(T("event.fireworksTitle"))}</h2><p>${esc(T("event.fireworksBody"))}</p><div class="big">${esc(money(amount))}</div>
        <button class="btn green" type="button">${esc(T("event.fireworksClaim"))}</button>`;
      overlay.append(card);
      card.querySelector("button").addEventListener("click", () => {
        const result = game.claimFireworks();
        if (result.ok) { sfx.star(); toast(T("event.fireworksGift", { amount: money(result.amount) })); } else fail(result);
        close();
      });
    });
  }

  function maybeStamp(force = false) {
    const ev = game.events;
    if (!ev.stamp.canStamp) return;
    let shown = null;
    try { shown = localStorage.getItem(STAMP_DAY_KEY); } catch (error) { /* storage blocked */ }
    if (!force && shown === ev.today) return;
    try { if (!game.testMode) localStorage.setItem(STAMP_DAY_KEY, ev.today); } catch (error) { /* storage blocked */ }
    showStamps({ year: ev.fair.year, day: ev.stamp.today });
  }

  // ---------------------------------------------------------------- settings (weather / time come from W2's env menu)
  function mountSettings() {
    for (const id of ["envBtn", "menuBtn", "frameBtn"]) { const node = document.getElementById(id); node.replaceWith(node.cloneNode(true)); }   // drop old listeners (language switch)
    const mounted = mountEnvUi({ env, r, pitches: null, lang });
    const menu = document.getElementById("menu");
    const head = el("div", "", "");
    head.innerHTML = `<h3>${esc(T("set.language"))}</h3>`;
    const langRow = el("div", "row"); langRow.setAttribute("role", "group");
    LANGS.forEach(code => {
      const chip = el("button", "chip", esc(LANG_NAMES[code])); chip.type = "button"; chip.dataset.lang = code; chip.setAttribute("aria-pressed", String(code === lang));
      chip.addEventListener("click", () => { if (code !== lang) changeLang(code); });
      langRow.append(chip);
    });
    head.append(langRow);
    head.insertAdjacentHTML("beforeend", `<h3>${esc(T("set.sound"))}</h3>`);
    const soundRow = el("div", "row");
    for (const on of [true, false]) {
      const chip = el("button", "chip", `${on ? "🔊" : "🔇"} ${esc(T(on ? "set.on" : "set.off"))}`); chip.type = "button"; chip.dataset.sound = on ? "1" : "0";
      chip.setAttribute("aria-pressed", String(sfx.enabled === on));
      chip.addEventListener("click", () => { sfx.setEnabled(on); soundRow.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", String((c.dataset.sound === "1") === on))); if (on) { sfx.unlock(); sfx.click(); } });
      soundRow.append(chip);
    }
    head.append(soundRow);
    menu.prepend(...head.childNodes);
    const tail = el("div", "");
    const days = game.nextFouerDays();
    const next = game.events.next;
    tail.innerHTML = `<h3>${esc(T("set.nextFouer"))}</h3><p class="note">${esc(days <= 0 ? T("event.nextFouerToday") : T("event.nextFouer", { date: formatDate(lang, next.open), days }))}</p>`;
    if (game.state.pi === 1 || game.state.lg) {
      const row = el("div", "row"); const old = el("button", "chip wide", `🏛️ ${esc(T("set.oldPark"))}`); old.type = "button";
      old.addEventListener("click", () => { document.getElementById("menu").hidden = true; document.getElementById("menuBtn").setAttribute("aria-expanded", "false"); showLetter({ report: { kind: "museum", vouchers: [], gold: false }, lg: game.state.lg }, { museum: true }); });
      row.append(old); tail.append(row);
    }
    tail.insertAdjacentHTML("beforeend", `<p class="note">${esc(T("set.about"))}</p>`);
    menu.append(...tail.childNodes);
    document.getElementById("menuBtn").setAttribute("aria-label", T("hud.menu"));
    document.getElementById("envBtn").setAttribute("aria-label", T("hud.env"));
    document.getElementById("frameBtn").setAttribute("aria-label", T("hud.frame"));
    document.getElementById("frameBtn").addEventListener("click", () => sfx.click());
    document.getElementById("menuBtn").addEventListener("click", () => { sfx.unlock(); renderSettingsDynamic(); });
    return mounted;
  }
  function renderSettingsDynamic() { /* the next-Fouer line is static per session */ }

  function changeLang(code) {
    lang = code;
    persistLang(code);
    document.documentElement.lang = code;
    lastGoalKey = ""; bubbleKey = null;
    mountSettings();
    refreshAll();
    if (sheetEl) renderSheet();
  }

  // ---------------------------------------------------------------- walk (W6 replaces hooks.startWalk)
  walkBtn.addEventListener("click", () => {
    sfx.unlock(); sfx.click();
    const tut = game.tutorial();
    if (tut.active && tut.stage === "walk") game.acknowledgeTutorial();
    closeSheet();
    hooks.startWalk();
  });
  hooks.onWalkChange = on => {
    walking = on;
    document.body.classList.toggle("walking", on);
    applyChrome();
  };

  // ---------------------------------------------------------------- wiring
  function refreshAll() {
    refreshStars(); refreshRate(); refreshGoal(); applyChrome(); renderBubble();
    $("cash").textContent = money(shownCash);
  }

  game.on("change", event => {
    if (event.kind === "advance" || event.kind === "start") { refreshAll(); return; }
    refreshAll();
    if (sheetEl) {
      const built = Boolean(game.state.pitches[selected]);
      if ((sheetMode === "build" && built) || (sheetMode === "manage" && !built)) closeSheet();
      else if (event.kind !== "look") renderSheet();
    }
  });
  game.on("tutorial", () => { bubbleKey = null; refreshAll(); });
  game.on("star", ({ stars }) => { sfx.star(); toast(T("toast.starUp", { stars })); });
  game.on("events", () => { refreshBanners(); maybeStamp(); maybeFireworks(); });
  game.on("foodie", () => refreshBanners());
  game.on("stamp", payload => { maybeStamp(); void payload; });
  game.on("offline", report => { showOffline(report); });
  game.on("letter", letter => { showLetter(letter); });
  game.on("adopted", () => toast(T("toast.cloud")));
  game.on("error", ({ message }) => { if (debug) console.warn("[fouer] save error", message); });
  r.on("tap", onTap);
  window.addEventListener("keydown", event => { if (event.key === "Escape" && sheetEl) closeSheet(); });
  document.getElementById("fouerCanvas").addEventListener("pointerdown", () => { document.getElementById("envPop").hidden = true; document.getElementById("menu").hidden = true; });

  mountSettings();
  refreshAll();
  // things the game found at startup: the letter first, then the away card, then the day's stamp, then the closing-night gift
  if (game.pendingLetter) showLetter(game.pendingLetter).then(() => game.dismissLetter());
  if (game.pendingOffline) showOffline(game.pendingOffline).then(() => game.dismissOffline());
  maybeStamp();
  maybeFireworks();

  let sheetClock = 0;
  return {
    toast, openPitch, closeSheet, showLetter, showOffline, showStamps, refreshAll, changeLang, money,
    get lang() { return lang; }, get selected() { return selected; }, get sheetMode() { return sheetMode; }, get modalOpen() { return modalOpen; },
    update(dt) {
      // the cash counter rolls towards the real value
      const target = game.state.c;
      const diff = target - shownCash;
      shownCash = Math.abs(diff) < 0.6 ? target : shownCash + diff * Math.min(1, dt * 7);
      const text = money(shownCash);
      const cashEl = $("cash"); if (cashEl.textContent !== text) cashEl.textContent = text;
      sheetClock += dt;
      if (sheetClock >= SHEET_REFRESH) {
        sheetClock = 0;
        refreshRate(); refreshStars(); refreshSheetDynamic(); refreshGoal(); renderBubble();
      }
      updateCoins(dt);
      updateFinger();
    },
    snapKey: () => lastSnapshotKey,
    rollTo(amount) { shownCash = amount; },
    dispose() { if (fingerEl) fingerEl.remove(); anchors.remove(); root.innerHTML = ""; },
  };
}
