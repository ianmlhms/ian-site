import { MAX_LEVEL, RULES, SKILLS, TOWERS, metaCost } from "./content.js";
import {
  buyMetaUpgrade, createGame, placeTower, sellTower, setHeroTarget,
  starsForLives, startWave, tick, towerPrice, towerStats, upgradeCost, upgradeTower, useSkill,
} from "./simulation.js";
import { cleanProgress, completeLevel, isStrictlyMoreProgress, metaSummary, totalStars } from "./progress.js";
import { BattlefieldView } from "./renderer.js";

const SAVE_INTERVAL_MS = 5000;
const NOTICE_MS = 1700;
const $ = (id) => document.getElementById(id);
const safeText = (value) => String(value ?? "");

let progress = cleanProgress(window.__pbSave);
let game = null;
let selectedBuild = "rapid";
let selectedTowerId = null;
let targetSkill = null;
let speed = 1;
let paused = false;
let lastFrame = performance.now();
let countedRunKills = 0;
let noticeTimer = 0;
let resultShown = false;

window.score = progress.kills;

const view = new BattlefieldView($("battlefield"), {
  onTower: selectTower,
  onPad: tapPad,
  onGround: tapGround,
});

function snapshot() {
  return cleanProgress(progress);
}

function pushSave() {
  try {
    parent.postMessage({ __pbSave: 1, data: snapshot() }, "*");
  } catch (error) {
    console.warn("Tower Defense save failed", error);
  }
}

function applyIncomingSave(save) {
  if (!isStrictlyMoreProgress(save, progress)) return;
  progress = cleanProgress(save);
  window.score = progress.kills;
  renderLevels();
  renderMeta();
  updateUi();
}

function showNotice(message) {
  const notice = $("notice");
  notice.textContent = safeText(message);
  notice.classList.add("show");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => notice.classList.remove("show"), NOTICE_MS);
}

function startLevel(level) {
  if (level < 1 || level > progress.level) return;
  game = createGame(level, progress.meta);
  selectedBuild = "rapid";
  selectedTowerId = null;
  targetSkill = null;
  paused = false;
  speed = 1;
  countedRunKills = 0;
  resultShown = false;
  $("overlay").classList.add("hidden");
  $("branchSheet").classList.add("hidden");
  view.sync(game, selectedTowerId);
  renderTowerButtons();
  updateUi();
  showNotice("Tap a glowing pad to build. Tap the field to move your commander.");
}

function consumeKills(nextGame) {
  const difference = Math.max(0, nextGame.stats.kills - countedRunKills);
  if (!difference) return;
  countedRunKills += difference;
  progress = { ...progress, kills: progress.kills + difference };
  window.score = progress.kills;
}

function updateGame(dt) {
  if (!game || paused || game.status === "won" || game.status === "lost") return;
  const next = tick(game, dt * speed);
  consumeKills(next);
  game = next;
  game.events.filter((event) => event.type === "notice").forEach((event) => showNotice(event.text));
  if (game.status === "won" && !resultShown) finishLevel();
  if (game.status === "lost" && !resultShown) showResult(false, 0);
}

function finishLevel() {
  const stars = starsForLives(game.lives, game.maxLives);
  progress = completeLevel(progress, game.level, stars, 0);
  window.score = progress.kills;
  pushSave();
  renderLevels();
  renderMeta();
  showResult(true, stars);
}

function showResult(won, stars) {
  resultShown = true;
  $("overlayTitle").textContent = won ? "Realm secured" : "Defenses breached";
  $("overlayText").textContent = won
    ? `${"★".repeat(stars)}${"☆".repeat(3 - stars)} · ${game.lives} lives remain · ${progress.kills} lifetime defeats`
    : `Level ${game.level} fell. Reposition your commander and try a different upgrade path.`;
  $("menuSections").classList.add("hidden");
  $("resultActions").classList.remove("hidden");
  $("continueBtn").textContent = won && game.level < MAX_LEVEL ? "Next level" : "Retry level";
  $("overlay").classList.remove("hidden");
  updateUi();
}

function showMenu() {
  game = null;
  selectedTowerId = null;
  targetSkill = null;
  paused = false;
  $("overlayTitle").textContent = "Tower Defense 3D";
  $("overlayText").textContent = "Command the battlefield, trigger skills, and forge permanent realm upgrades.";
  $("menuSections").classList.remove("hidden");
  $("resultActions").classList.add("hidden");
  $("overlay").classList.remove("hidden");
  $("branchSheet").classList.add("hidden");
  renderLevels();
  renderMeta();
  updateUi();
}

function tapPad(padIndex, point) {
  if (!game || paused) return;
  if (targetSkill === "meteor") return castTargetedSkill(point);
  if (!selectedBuild) return tapGround(point);
  const next = placeTower(game, selectedBuild, padIndex);
  if (next === game) {
    showNotice(game.towers.some((tower) => tower.padIndex === padIndex) ? "That pad is occupied" : "Not enough gold");
    return;
  }
  game = next;
  showNotice(`${TOWERS[selectedBuild].name} deployed`);
  updateUi();
}

function tapGround(point) {
  if (!game || paused) return;
  if (targetSkill === "meteor") return castTargetedSkill(point);
  selectedTowerId = null;
  selectedBuild = null;
  game = setHeroTarget(game, point);
  renderTowerButtons();
  updateInspect();
  showNotice("Commander moving");
}

function selectTower(towerId) {
  if (!game || paused) return;
  selectedTowerId = towerId;
  selectedBuild = null;
  targetSkill = null;
  renderTowerButtons();
  updateInspect();
}

function chooseBuild(type) {
  if (!game || !TOWERS[type]) return;
  selectedBuild = type;
  selectedTowerId = null;
  targetSkill = null;
  renderTowerButtons();
  updateInspect();
  showNotice(TOWERS[type].role);
}

function upgradeSelected() {
  const tower = game?.towers.find((item) => item.id === selectedTowerId);
  if (!tower) return;
  if (tower.level === 2) {
    showBranchChoices(tower);
    return;
  }
  const next = upgradeTower(game, tower.id);
  if (next === game) return showNotice(game.gold < upgradeCost(game, tower) ? "Not enough gold" : "Maximum level reached");
  game = next;
  showNotice(`${TOWERS[tower.type].name} upgraded`);
  updateUi();
}

function showBranchChoices(tower) {
  const definition = TOWERS[tower.type];
  $("branchTitle").textContent = `Choose ${definition.name} path`;
  ["A", "B"].forEach((branch) => {
    const button = $(`branch${branch}`);
    button.replaceChildren();
    const name = document.createElement("strong");
    const note = document.createElement("span");
    name.textContent = definition.branches[branch].name;
    note.textContent = definition.branches[branch].note;
    button.append(name, note);
  });
  $("branchCost").textContent = `${upgradeCost(game, tower)} gold`;
  $("branchSheet").classList.remove("hidden");
}

function chooseBranch(branch) {
  const tower = game?.towers.find((item) => item.id === selectedTowerId);
  if (!tower) return;
  const next = upgradeTower(game, tower.id, branch);
  if (next === game) return showNotice("Not enough gold");
  game = next;
  $("branchSheet").classList.add("hidden");
  showNotice(`${TOWERS[tower.type].branches[branch].name} unlocked`);
  updateUi();
}

function sellSelected() {
  if (!game || !selectedTowerId) return;
  const tower = game.towers.find((item) => item.id === selectedTowerId);
  if (!tower) return;
  const refund = Math.floor(tower.spent * RULES.sellRate);
  game = sellTower(game, tower.id);
  selectedTowerId = null;
  showNotice(`Tower sold +${refund} gold`);
  updateUi();
}

function activateSkill(key) {
  if (!game || paused || game.status !== "wave") return showNotice("Skills activate during a wave");
  if (game.skills[key] > 0) return showNotice(`${SKILLS[key].name} is recharging`);
  if (key === "meteor") {
    targetSkill = "meteor";
    selectedBuild = null;
    selectedTowerId = null;
    renderTowerButtons();
    updateInspect();
    return showNotice("Tap the battlefield to call the meteor");
  }
  const next = useSkill(game, key);
  if (next === game) return showNotice(key === "heal" ? "Base is already at full life" : "Skill unavailable");
  game = next;
  showNotice(`${SKILLS[key].name} activated`);
  updateUi();
}

function castTargetedSkill(point) {
  const next = useSkill(game, "meteor", point);
  targetSkill = null;
  if (next === game) return showNotice("Meteor unavailable");
  game = next;
  showNotice("Meteor inbound");
  updateUi();
}

function renderTowerButtons() {
  const container = $("towerTray");
  container.replaceChildren();
  Object.entries(TOWERS).forEach(([type, definition]) => {
    const button = document.createElement("button");
    const name = document.createElement("strong");
    const price = document.createElement("span");
    button.className = `towerCard${selectedBuild === type ? " selected" : ""}`;
    button.dataset.type = type;
    button.setAttribute("aria-label", `${definition.name}, ${definition.role}, ${towerPrice(type, progress.meta)} gold`);
    name.textContent = definition.short;
    price.textContent = `${towerPrice(type, progress.meta)}g`;
    button.append(name, price);
    container.appendChild(button);
  });
}

function updateInspect() {
  const panel = $("inspectPanel");
  const tower = game?.towers.find((item) => item.id === selectedTowerId);
  if (!tower) {
    panel.classList.add("hidden");
    return;
  }
  const stats = towerStats(tower);
  const branchName = tower.branch ? ` · ${TOWERS[tower.type].branches[tower.branch].name}` : "";
  $("inspectText").textContent = `${stats.name} L${tower.level}${branchName} · ${stats.role}`;
  $("upgradeBtn").textContent = tower.level >= 3 ? "Max level" : tower.level === 2 ? `Choose path · ${upgradeCost(game, tower)}g` : `Upgrade · ${upgradeCost(game, tower)}g`;
  $("upgradeBtn").disabled = tower.level >= 3;
  $("sellBtn").textContent = `Sell · ${Math.floor(tower.spent * RULES.sellRate)}g`;
  panel.classList.remove("hidden");
}

function updateSkills() {
  Object.entries(SKILLS).forEach(([key, skill]) => {
    const button = $(`skill-${key}`);
    const remaining = game?.skills[key] || 0;
    const ratio = remaining / skill.cooldown;
    button.style.setProperty("--cool", `${Math.round(ratio * 360)}deg`);
    button.disabled = !game || game.status !== "wave" || remaining > 0 || paused;
    button.querySelector("small").textContent = remaining > 0 ? `${Math.ceil(remaining)}s` : skill.name;
  });
}

function updateUi() {
  $("gold").textContent = game ? Math.floor(game.gold) : "—";
  $("lives").textContent = game ? game.lives : "—";
  $("wave").textContent = game ? `${game.wave}/${game.maxWaves}` : "—";
  $("foes").textContent = game ? game.enemies.length + game.queue.length : "—";
  $("kills").textContent = progress.kills;
  $("shards").textContent = progress.meta.shards;
  $("speedBtn").textContent = `${speed}×`;
  $("pauseBtn").textContent = paused ? "▶" : "Ⅱ";
  const canWave = game?.status === "build";
  $("waveBtn").disabled = !canWave || paused;
  $("waveBtn").textContent = canWave ? `Start early +${Math.ceil(game.buildRemaining) * RULES.earlyGoldPerSecond}g` : "Wave active";
  $("targetMode").classList.toggle("hidden", !targetSkill);
  updateSkills();
  updateInspect();
}

function renderLevels() {
  const grid = $("levelGrid");
  grid.replaceChildren();
  for (let level = 1; level <= MAX_LEVEL; level += 1) {
    const stars = progress.stars[level] || 0;
    const button = document.createElement("button");
    const label = document.createElement("strong");
    const detail = document.createElement("span");
    button.className = stars ? "levelButton complete" : "levelButton";
    button.disabled = level > progress.level;
    button.dataset.level = String(level);
    label.textContent = String(level);
    detail.textContent = stars ? "★".repeat(stars) : level > progress.level ? "Locked" : "Ready";
    button.append(label, detail);
    grid.appendChild(button);
  }
  $("starTotal").textContent = String(totalStars(progress.stars));
}

function renderMeta() {
  const container = $("metaGrid");
  container.replaceChildren();
  metaSummary(progress.meta).forEach((item) => {
    const button = document.createElement("button");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    const atCap = item.level >= item.cap;
    const cost = metaCost(item.key, item.level);
    button.className = "metaButton";
    button.dataset.meta = item.key;
    button.disabled = atCap || progress.meta.shards < cost;
    title.textContent = `${item.name} ${item.level}/${item.cap}`;
    detail.textContent = atCap ? `${item.description} · Max` : `${item.description} · ${cost} shards`;
    button.append(title, detail);
    container.appendChild(button);
  });
}

function buyUpgrade(key) {
  const next = buyMetaUpgrade(progress.meta, key);
  if (next.shards === progress.meta.shards) return;
  progress = { ...progress, meta: next };
  pushSave();
  renderMeta();
  renderTowerButtons();
  updateUi();
}

function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  updateGame(dt);
  if (game) view.sync(game, selectedTowerId);
  view.render(dt);
  updateUi();
  requestAnimationFrame(frame);
}

$("towerTray").addEventListener("click", (event) => {
  const button = event.target.closest(".towerCard");
  if (button) chooseBuild(button.dataset.type);
});
$("levelGrid").addEventListener("click", (event) => {
  const button = event.target.closest(".levelButton");
  if (button && !button.disabled) startLevel(Number(button.dataset.level));
});
$("metaGrid").addEventListener("click", (event) => {
  const button = event.target.closest(".metaButton");
  if (button && !button.disabled) buyUpgrade(button.dataset.meta);
});
Object.keys(SKILLS).forEach((key) => { $(`skill-${key}`).onclick = () => activateSkill(key); });
$("waveBtn").onclick = () => { if (game) game = startWave(game, true); };
$("speedBtn").onclick = () => { speed = speed === 3 ? 1 : speed + 1; updateUi(); };
$("pauseBtn").onclick = () => { if (game) paused = !paused; updateUi(); };
$("menuBtn").onclick = showMenu;
$("upgradeBtn").onclick = upgradeSelected;
$("sellBtn").onclick = sellSelected;
$("branchA").onclick = () => chooseBranch("A");
$("branchB").onclick = () => chooseBranch("B");
$("branchCancel").onclick = () => $("branchSheet").classList.add("hidden");
$("continueBtn").onclick = () => startLevel(game.status === "won" && game.level < MAX_LEVEL ? game.level + 1 : game.level);
$("resultMenuBtn").onclick = showMenu;
$("helpBtn").onclick = () => $("helpPanel").classList.toggle("hidden");
window.addEventListener("resize", () => view.resize());
window.addEventListener("message", (event) => {
  if (event.data?.__pbLoadSave === 1) applyIncomingSave(event.data.data);
});
window.addEventListener("pagehide", pushSave);

applyIncomingSave(window.__pbSave);
setTimeout(() => applyIncomingSave(window.__pbSave), 0);
setInterval(pushSave, SAVE_INTERVAL_MS);
try {
  parent.postMessage({ __pbWantSave: 1 }, "*");
} catch (error) {
  console.warn("Tower Defense save request failed", error);
}

renderTowerButtons();
renderLevels();
renderMeta();
showMenu();
document.documentElement.dataset.gameBooted = "true";
requestAnimationFrame(frame);
