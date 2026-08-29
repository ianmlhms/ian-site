import assert from "node:assert/strict";
import { distanceToPath, pointOnPath } from "./content.js";
import {
  buyMetaUpgrade, createGame, placeTower, setHeroTarget, starsForLives,
  startWave, tick, upgradeTower, useSkill,
} from "./simulation.js";
import { completeLevel } from "./progress.js";

const STEP_SECONDS = 0.1;
const MAX_TICKS = 18_000;
const MAX_TOWERS = 14;

const BUILD_ORDERS = [
  ["rapid","air","frost","cannon","sniper","support","rapid","cannon","air","sniper","frost","rapid","cannon","support"],
  ["rapid","frost","air","sniper","cannon","support","rapid","air","cannon","sniper","frost","rapid","support","cannon"],
  ["frost","rapid","air","cannon","sniper","support","rapid","cannon","air","sniper","frost","rapid","cannon","support"],
  ["rapid","cannon","air","frost","sniper","support","rapid","air","cannon","sniper","rapid","frost","support","cannon"],
  ["cannon","rapid","air","frost","sniper","support","rapid","cannon","air","sniper","frost","rapid","support","cannon"],
  ["rapid","air","sniper","frost","cannon","support","rapid","cannon","air","frost","sniper","rapid","cannon","support"],
  ["frost","rapid","cannon","air","sniper","support","rapid","air","cannon","sniper","frost","rapid","support","cannon"],
  ["rapid","cannon","frost","air","sniper","support","rapid","cannon","air","sniper","frost","rapid","cannon","support"],
  ["rapid","air","frost","sniper","cannon","support","rapid","cannon","air","sniper","frost","rapid","support","cannon"],
  ["cannon","rapid","frost","air","sniper","support","rapid","air","cannon","sniper","rapid","frost","cannon","support"],
  ["rapid","frost","cannon","air","sniper","support","rapid","cannon","air","frost","sniper","rapid","support","cannon"],
  ["rapid","air","cannon","frost","sniper","support","rapid","cannon","air","sniper","frost","rapid","cannon","support"],
  ["frost","cannon","rapid","air","sniper","support","rapid","air","cannon","sniper","frost","rapid","support","cannon"],
  ["rapid","sniper","air","frost","cannon","support","rapid","cannon","air","frost","sniper","rapid","cannon","support"],
  ["cannon","frost","rapid","air","sniper","support","rapid","cannon","air","sniper","frost","rapid","support","cannon"],
];

function assertFiniteNumbers(value, trail = "state") {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${trail} is not finite`);
    return;
  }
  if (!value || typeof value !== "object") return;
  Object.entries(value).forEach(([key, child]) => assertFiniteNumbers(child, `${trail}.${key}`));
}

function assertEnemiesOnPath(state) {
  state.enemies.forEach((enemy) => {
    const point = pointOnPath(state.path, enemy.along);
    assert.ok(distanceToPath(point, state.path) < 0.0001, `enemy ${enemy.id} left the path`);
    assert.ok(enemy.along >= 0 && enemy.along <= state.pathLength + 0.8, `enemy ${enemy.id} has invalid progress`);
  });
}

function buildAndUpgrade(state, order) {
  let next = state;
  while (next.towers.length < Math.min(MAX_TOWERS, next.pads.length)) {
    const type = order[next.towers.length];
    const built = placeTower(next, type, next.towers.length);
    if (built === next) break;
    next = built;
  }
  const upgradable = next.towers.find((tower) => tower.level < 3);
  if (!upgradable) return next;
  const branch = upgradable.level === 2 ? (upgradable.id + state.level) % 2 ? "A" : "B" : null;
  return upgradeTower(next, upgradable.id, branch);
}

function leadEnemyPoint(state) {
  const enemy = state.enemies.reduce((best, item) => !best || item.along > best.along ? item : best, null);
  return enemy ? pointOnPath(state.path, enemy.along) : pointOnPath(state.path, state.pathLength * 0.5);
}

function applyBattleScript(state) {
  if (state.status !== "wave") return state;
  const target = leadEnemyPoint(state);
  let next = setHeroTarget(state, target);
  if (next.enemies.length >= 4 && next.skills.meteor <= 0) next = useSkill(next, "meteor", target);
  if (next.enemies.length >= 5 && next.skills.freeze <= 0) next = useSkill(next, "freeze");
  if (next.enemies.length >= 2 && next.skills.rally <= 0) next = useSkill(next, "rally");
  if (next.lives < next.maxLives && next.skills.heal <= 0) next = useSkill(next, "heal");
  return next;
}

function spendMeta(meta, level) {
  const order = ["startingGold", "heroDamage", "towerDiscount", "extraLife"];
  return order.reduce((next, key, index) => (level + index) % 2 === 0 ? buyMetaUpgrade(next, key) : next, meta);
}

function runLevel(level, meta) {
  let state = createGame(level, meta);
  assert.ok(state.pads.length >= 12, `level ${level} has too few build pads`);
  let ticks = 0;
  let wavesStarted = 0;
  while (state.status !== "won" && state.status !== "lost" && ticks < MAX_TICKS) {
    if (state.status === "build") {
      state = buildAndUpgrade(state, BUILD_ORDERS[level - 1]);
      wavesStarted += 1;
      state = startWave(state, true);
    }
    state = applyBattleScript(state);
    state = tick(state, STEP_SECONDS);
    assertFiniteNumbers(state);
    assertEnemiesOnPath(state);
    ticks += 1;
  }
  assert.notEqual(state.status, "lost", `level ${level} was not winnable with its scripted build`);
  assert.equal(state.status, "won", `level ${level} exceeded ${MAX_TICKS} ticks`);
  assert.equal(wavesStarted, state.maxWaves, `level ${level} did not run every wave`);
  return { state, ticks, wavesStarted, stars: starsForLives(state.lives, state.maxLives) };
}

function main() {
  let progress = { v: 1, level: 1, stars: {}, kills: 0, meta: { shards: 0, upgrades: {} } };
  const rows = [];
  for (let level = 1; level <= 15; level += 1) {
    const result = runLevel(level, progress.meta);
    progress = completeLevel(progress, level, result.stars, result.state.stats.kills);
    progress = { ...progress, meta: spendMeta(progress.meta, level) };
    rows.push({
      Level: level,
      Result: "PASS",
      Waves: result.wavesStarted,
      Ticks: result.ticks,
      Lives: `${result.state.lives}/${result.state.maxLives}`,
      Kills: result.state.stats.kills,
    });
  }
  console.table(rows);
  console.log(`PASS: ${rows.length}/15 levels; total scripted kills ${progress.kills}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}
