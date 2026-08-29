import {
  ENEMIES, MAX_LEVEL, META, RULES, SKILLS, TOWERS, clamp, distance,
  enemySequence, metaCost, padsForLevel, pathForLevel, pathLength, pointOnPath, waveCount,
} from "./content.js";

const PROJECTILE_SPEED = 24;
const FREEZE_SECONDS = 5;
const RALLY_SECONDS = 8;
const METEOR_DAMAGE = 155;
const METEOR_RADIUS = 4.5;
const HEAL_AMOUNT = 5;

const levelOf = (upgrades, key) => clamp(Math.floor(Number(upgrades?.[key]) || 0), 0, META[key].cap);
const allTargets = (targetMode, flying) => targetMode === "all" || targetMode === "air" && flying || targetMode === "ground" && !flying;

export function cleanMeta(meta) {
  const safe = meta || {};                 // a default only covers undefined, not null
  const upgrades = Object.fromEntries(Object.keys(META).map((key) => [key, levelOf(safe.upgrades, key)]));
  return { shards: Math.max(0, Math.floor(Number(safe.shards) || 0)), upgrades };
}

export function startingGold(meta) {
  return 285 + levelOf(meta.upgrades, "startingGold") * 25;
}

export function towerPrice(type, meta) {
  const tower = TOWERS[type];
  if (!tower) return Infinity;
  const discount = 1 - levelOf(meta.upgrades, "towerDiscount") * 0.03;
  return Math.max(1, Math.round(tower.cost * discount));
}

export function createGame(level, meta = {}) {
  const safeLevel = clamp(Math.floor(level), 1, MAX_LEVEL);
  const safeMeta = cleanMeta(meta);
  const path = pathForLevel(safeLevel);
  const maxLives = RULES.baseLives + levelOf(safeMeta.upgrades, "extraLife");
  const heroPoint = pointOnPath(path, pathLength(path) * 0.22);
  return {
    status: "build", level: safeLevel, wave: 0, maxWaves: waveCount(safeLevel),
    time: 0, buildRemaining: RULES.buildSeconds, gold: startingGold(safeMeta),
    lives: maxLives, maxLives, path, pathLength: pathLength(path), pads: padsForLevel(safeLevel),
    towers: [], enemies: [], queue: [], projectiles: [], events: [], nextId: 1,
    spawnClock: 0, rallyUntil: 0, meta: safeMeta,
    hero: { x: heroPoint.x, z: heroPoint.z, targetX: heroPoint.x, targetZ: heroPoint.z, cooldown: 0 },
    skills: Object.fromEntries(Object.keys(SKILLS).map((key) => [key, 0])),
    stats: { kills: 0, escaped: 0, goldEarned: 0 },
  };
}

function scaledEnemy(type, level, wave, id) {
  const definition = ENEMIES[type];
  const healthScale = 1 + (level - 1) * 0.065 + (wave - 1) * 0.07;
  const health = Math.round(definition.hp * healthScale);
  return { id, type, along: 0, hp: health, maxHp: health, slowUntil: 0, brittleUntil: 0 };
}

export function startWave(state, early = false) {
  if (state.status !== "build" || state.wave >= state.maxWaves) return state;
  const bonus = early ? Math.ceil(state.buildRemaining) * RULES.earlyGoldPerSecond : 0;
  const nextWave = state.wave + 1;
  const types = enemySequence(state.level, nextWave);
  const queue = types.map((type, index) => scaledEnemy(type, state.level, nextWave, state.nextId + index));
  const event = bonus ? [{ type: "notice", text: `Early deployment +${bonus} gold` }] : [];
  return {
    ...state, status: "wave", wave: nextWave, buildRemaining: 0,
    gold: state.gold + bonus, queue, spawnClock: 0, events: event,
    nextId: state.nextId + queue.length,
  };
}

export function setHeroTarget(state, point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return state;
  return {
    ...state,
    hero: {
      ...state.hero,
      targetX: clamp(point.x, 0.8, 35.2),
      targetZ: clamp(point.z, 0.8, 53.2),
    },
  };
}

export function placeTower(state, type, padIndex) {
  const definition = TOWERS[type];
  const pad = state.pads[padIndex];
  const cost = towerPrice(type, state.meta);
  if (!definition || !pad || state.gold < cost) return state;
  if (state.towers.some((tower) => tower.padIndex === padIndex)) return state;
  const tower = {
    id: state.nextId, type, padIndex, x: pad.x, z: pad.z,
    level: 1, branch: null, cooldown: 0, spent: cost,
  };
  return { ...state, gold: state.gold - cost, towers: [...state.towers, tower], nextId: state.nextId + 1 };
}

function nearbyQuartermaster(state, tower) {
  return state.towers.some((other) => {
    if (other.type !== "support" || other.level < 3 || other.branch !== "B") return false;
    return distance(tower, other) <= towerStats(other).range;
  });
}

export function upgradeCost(state, tower) {
  if (!tower || tower.level >= 3) return Infinity;
  const base = towerPrice(tower.type, state.meta) * (tower.level === 1 ? 0.72 : 1.08);
  return Math.round(base * (nearbyQuartermaster(state, tower) ? 0.82 : 1));
}

export function upgradeTower(state, towerId, branch = null) {
  const tower = state.towers.find((item) => item.id === towerId);
  if (!tower || tower.level >= 3) return state;
  const chosenBranch = tower.level === 2 && (branch === "A" || branch === "B") ? branch : null;
  if (tower.level === 2 && !chosenBranch) return state;
  const cost = upgradeCost(state, tower);
  if (state.gold < cost) return state;
  const next = { ...tower, level: tower.level + 1, branch: chosenBranch, spent: tower.spent + cost };
  return { ...state, gold: state.gold - cost, towers: state.towers.map((item) => item.id === towerId ? next : item) };
}

export function sellTower(state, towerId) {
  const tower = state.towers.find((item) => item.id === towerId);
  if (!tower) return state;
  const refund = Math.floor(tower.spent * RULES.sellRate);
  return { ...state, gold: state.gold + refund, towers: state.towers.filter((item) => item.id !== towerId) };
}

export function towerStats(tower) {
  const base = TOWERS[tower.type];
  const levelDamage = tower.level === 1 ? 1 : tower.level === 2 ? 1.38 : 1.72;
  const levelRange = tower.level === 1 ? 1 : tower.level === 2 ? 1.08 : 1.16;
  const levelRate = tower.level === 1 ? 1 : tower.level === 2 ? 1.16 : 1.32;
  const branch = tower.level === 3 ? base.branches[tower.branch] : null;
  return {
    ...base,
    damage: base.damage * levelDamage * (branch?.damage || 1),
    range: base.range * levelRange * (branch?.range || 1),
    rate: base.rate * levelRate * (branch?.rate || 1),
    splash: (base.splash || 0) * (branch?.splash || 1),
    slow: (base.slow || 0) * (branch?.slow || 1),
    slowTime: 1.8 * (branch?.slowTime || 1),
    pierce: Math.max(base.pierce || 0, branch?.pierce || 0),
    brittle: branch?.brittle || 0,
    boss: branch?.boss || 1,
    buff: (base.buff || 0) * (branch?.buff || 1),
    targets: branch?.targets || base.targets,
  };
}

function towerBuff(state, tower) {
  const supportBuff = state.towers.reduce((best, other) => {
    if (other.type !== "support" || other.id === tower.id) return best;
    const stats = towerStats(other);
    return distance(tower, other) <= stats.range ? Math.max(best, stats.buff) : best;
  }, 0);
  const heroBuff = distance(tower, state.hero) <= RULES.heroAuraRange ? RULES.heroAuraBuff : 0;
  const rallyBuff = state.rallyUntil > state.time ? 0.45 : 0;
  return 1 + supportBuff + heroBuff + rallyBuff;
}

function chooseTarget(state, tower, stats) {
  const options = state.enemies.filter((enemy) => {
    const flying = Boolean(ENEMIES[enemy.type].flying);
    return allTargets(stats.targets, flying) && distance(tower, pointOnPath(state.path, enemy.along)) <= stats.range;
  });
  return options.reduce((best, enemy) => !best || enemy.along > best.along ? enemy : best, null);
}

function fireTower(state, tower) {
  const stats = towerStats(tower);
  if (!stats.rate) return { tower, projectile: null, nextId: state.nextId };
  const target = chooseTarget(state, tower, stats);
  if (!target) return { tower: { ...tower, cooldown: 0 }, projectile: null, nextId: state.nextId };
  const targetPoint = pointOnPath(state.path, target.along);
  const projectile = {
    id: state.nextId, sourceId: tower.id, targetId: target.id,
    x: tower.x, z: tower.z, targetX: targetPoint.x, targetZ: targetPoint.z,
    damage: stats.damage * towerBuff(state, tower), speed: PROJECTILE_SPEED,
    splash: stats.splash, slow: stats.slow, slowTime: stats.slowTime,
    pierce: stats.pierce, brittle: stats.brittle, boss: stats.boss,
    colour: stats.color,
  };
  return { tower: { ...tower, cooldown: 1 / (stats.rate * towerBuff(state, tower)) }, projectile, nextId: state.nextId + 1 };
}

function updateTowers(state, dt) {
  return state.towers.reduce((result, tower) => {
    const cooled = { ...tower, cooldown: Math.max(0, tower.cooldown - dt) };
    if (cooled.cooldown > 0) return { ...result, towers: [...result.towers, cooled] };
    const fired = fireTower({ ...state, nextId: result.nextId }, cooled);
    return {
      towers: [...result.towers, fired.tower],
      projectiles: fired.projectile ? [...result.projectiles, fired.projectile] : result.projectiles,
      nextId: fired.nextId,
    };
  }, { towers: [], projectiles: state.projectiles, nextId: state.nextId });
}

function spawnEnemy(state, dt) {
  if (!state.queue.length) return { ...state, spawnClock: 0 };
  const clock = state.spawnClock - dt;
  if (clock > 0) return { ...state, spawnClock: clock };
  return {
    ...state,
    enemies: [...state.enemies, state.queue[0]],
    queue: state.queue.slice(1),
    spawnClock: RULES.spawnGap,
  };
}

function moveEnemies(state, dt) {
  const enemies = state.enemies.map((enemy) => {
    const definition = ENEMIES[enemy.type];
    const slow = enemy.slowUntil > state.time ? 0.42 : 1;
    const levelSpeed = 1 + state.level * 0.009;
    return { ...enemy, along: enemy.along + definition.speed * slow * levelSpeed * dt };
  });
  return { ...state, enemies };
}

function moveHero(state, dt) {
  const destination = { x: state.hero.targetX, z: state.hero.targetZ };
  const gap = distance(state.hero, destination);
  if (gap <= 0.02) return { ...state, hero: { ...state.hero, cooldown: Math.max(0, state.hero.cooldown - dt) } };
  const amount = Math.min(gap, RULES.heroSpeed * dt) / gap;
  return {
    ...state,
    hero: {
      ...state.hero,
      x: state.hero.x + (destination.x - state.hero.x) * amount,
      z: state.hero.z + (destination.z - state.hero.z) * amount,
      cooldown: Math.max(0, state.hero.cooldown - dt),
    },
  };
}

function applyDamage(enemy, rawDamage, pierce = 0, boss = 1, time = 0) {
  const definition = ENEMIES[enemy.type];
  const armour = Math.max(0, (definition.armour || 0) * (1 - pierce));
  const brittle = enemy.brittleUntil > time ? 1.2 : 1;
  const bossFactor = enemy.type === "boss" ? boss : 1;
  return { ...enemy, hp: enemy.hp - rawDamage * (1 - armour) * brittle * bossFactor };
}

function heroAttack(state) {
  if (state.hero.cooldown > 0) return state;
  const target = state.enemies.reduce((best, enemy) => {
    const point = pointOnPath(state.path, enemy.along);
    if (distance(state.hero, point) > RULES.heroRange) return best;
    return !best || enemy.along > best.along ? enemy : best;
  }, null);
  if (!target) return state;
  const training = levelOf(state.meta.upgrades, "heroDamage");
  const rally = state.rallyUntil > state.time ? 1.45 : 1;
  const damage = 28 * (1 + training * 0.15) * rally;
  return {
    ...state,
    hero: { ...state.hero, cooldown: 1 / RULES.heroRate },
    enemies: state.enemies.map((enemy) => enemy.id === target.id ? applyDamage(enemy, damage, 0.3, 1, state.time) : enemy),
    events: [...state.events, { type: "heroStrike", targetId: target.id }],
  };
}

function damageAtImpact(state, projectile, impact) {
  const targetIds = state.enemies.filter((enemy) => {
    if (projectile.splash <= 0) return enemy.id === projectile.targetId;
    return distance(pointOnPath(state.path, enemy.along), impact) <= projectile.splash;
  }).map((enemy) => enemy.id);
  const enemies = state.enemies.map((enemy) => {
    if (!targetIds.includes(enemy.id)) return enemy;
    const damaged = applyDamage(enemy, projectile.damage, projectile.pierce, projectile.boss, state.time);
    return {
      ...damaged,
      slowUntil: projectile.slow ? Math.max(enemy.slowUntil, state.time + projectile.slowTime) : enemy.slowUntil,
      brittleUntil: projectile.brittle ? Math.max(enemy.brittleUntil, state.time + 3) : enemy.brittleUntil,
    };
  });
  return { ...state, enemies, events: [...state.events, { type: "impact", x: impact.x, z: impact.z, splash: projectile.splash, colour: projectile.colour }] };
}

function updateProjectiles(state, dt) {
  return state.projectiles.reduce((result, projectile) => {
    const target = result.enemies.find((enemy) => enemy.id === projectile.targetId);
    if (!target) return result;
    const targetPoint = pointOnPath(result.path, target.along);
    const gap = distance(projectile, targetPoint);
    const travel = projectile.speed * dt;
    if (gap <= travel) return damageAtImpact(result, projectile, targetPoint);
    const amount = travel / gap;
    const moved = {
      ...projectile,
      x: projectile.x + (targetPoint.x - projectile.x) * amount,
      z: projectile.z + (targetPoint.z - projectile.z) * amount,
      targetX: targetPoint.x,
      targetZ: targetPoint.z,
    };
    return { ...result, projectiles: [...result.projectiles, moved] };
  }, { ...state, projectiles: [] });
}

function resolveEnemies(state) {
  const killed = state.enemies.filter((enemy) => enemy.hp <= 0);
  const escaped = state.enemies.filter((enemy) => enemy.hp > 0 && enemy.along >= state.pathLength);
  const reward = killed.reduce((sum, enemy) => sum + ENEMIES[enemy.type].reward, 0);
  const removed = new Set([...killed, ...escaped].map((enemy) => enemy.id));
  return {
    ...state,
    gold: state.gold + reward,
    lives: Math.max(0, state.lives - escaped.length),
    enemies: state.enemies.filter((enemy) => !removed.has(enemy.id)),
    projectiles: state.projectiles.filter((projectile) => !removed.has(projectile.targetId)),
    events: [
      ...state.events,
      ...killed.map((enemy) => ({ type: "defeat", enemyId: enemy.id })),
      ...escaped.map((enemy) => ({ type: "escape", enemyId: enemy.id })),
    ],
    stats: {
      ...state.stats,
      kills: state.stats.kills + killed.length,
      escaped: state.stats.escaped + escaped.length,
      goldEarned: state.stats.goldEarned + reward,
    },
  };
}

function finishWave(state) {
  if (state.queue.length || state.enemies.length || state.projectiles.length) return state;
  if (state.wave >= state.maxWaves) return { ...state, status: "won", events: [...state.events, { type: "victory" }] };
  const bonus = RULES.waveClearGold + state.wave * RULES.waveClearGrowth;
  return {
    ...state, status: "build", buildRemaining: RULES.buildSeconds,
    gold: state.gold + bonus,
    events: [...state.events, { type: "notice", text: `Wave cleared +${bonus} gold` }],
  };
}

function coolSkills(state, dt) {
  const skills = Object.fromEntries(Object.entries(state.skills).map(([key, value]) => [key, Math.max(0, value - dt)]));
  return { ...state, skills };
}

export function tick(state, dt) {
  if (!Number.isFinite(dt) || dt <= 0 || state.status === "won" || state.status === "lost" || state.status === "paused") return state;
  const step = Math.min(dt, 0.12);
  const base = coolSkills({ ...state, events: [], time: state.time + step }, step);
  if (base.status === "build") {
    const remaining = Math.max(0, base.buildRemaining - step);
    return remaining > 0 ? { ...base, buildRemaining: remaining } : startWave({ ...base, buildRemaining: 0 }, false);
  }
  const spawned = spawnEnemy(base, step);
  const moved = moveEnemies(spawned, step);
  const walked = moveHero(moved, step);
  const hero = heroAttack(walked);
  const attacks = updateTowers(hero, step);
  const fired = { ...hero, towers: attacks.towers, projectiles: attacks.projectiles, nextId: attacks.nextId };
  const impacted = updateProjectiles(fired, step);
  const resolved = resolveEnemies(impacted);
  if (resolved.lives <= 0) return { ...resolved, status: "lost", events: [...resolved.events, { type: "defeatBase" }] };
  return finishWave(resolved);
}

export function useSkill(state, key, point = null) {
  if (state.status !== "wave" || !SKILLS[key] || state.skills[key] > 0) return state;
  if (key === "meteor") return useMeteor(state, point);
  if (key === "freeze") return useFreeze(state);
  if (key === "rally") return useRally(state);
  if (key === "heal") return useHeal(state);
  return state;
}

function setSkillCooldown(state, key) {
  return { ...state, skills: { ...state.skills, [key]: SKILLS[key].cooldown } };
}

function useMeteor(state, point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return state;
  const enemies = state.enemies.map((enemy) => {
    const enemyPoint = pointOnPath(state.path, enemy.along);
    return distance(point, enemyPoint) <= METEOR_RADIUS ? applyDamage(enemy, METEOR_DAMAGE, 0.5, 1, state.time) : enemy;
  });
  const cooled = setSkillCooldown({ ...state, enemies }, "meteor");
  return { ...cooled, events: [...state.events, { type: "meteor", x: point.x, z: point.z, radius: METEOR_RADIUS }] };
}

function useFreeze(state) {
  const enemies = state.enemies.map((enemy) => ({ ...enemy, slowUntil: Math.max(enemy.slowUntil, state.time + FREEZE_SECONDS) }));
  const cooled = setSkillCooldown({ ...state, enemies }, "freeze");
  return { ...cooled, events: [...state.events, { type: "freeze", duration: FREEZE_SECONDS }] };
}

function useRally(state) {
  const cooled = setSkillCooldown({ ...state, rallyUntil: state.time + RALLY_SECONDS }, "rally");
  return { ...cooled, events: [...state.events, { type: "rally", x: state.hero.x, z: state.hero.z }] };
}

function useHeal(state) {
  if (state.lives >= state.maxLives) return state;
  const cooled = setSkillCooldown({ ...state, lives: Math.min(state.maxLives, state.lives + HEAL_AMOUNT) }, "heal");
  return { ...cooled, events: [...state.events, { type: "heal", amount: HEAL_AMOUNT }] };
}

export function starsForLives(lives, maxLives) {
  if (lives >= Math.ceil(maxLives * 0.75)) return 3;
  if (lives >= Math.ceil(maxLives * 0.4)) return 2;
  return 1;
}

export function metaReward(level, stars) {
  return 1 + stars + (level % 5 === 0 ? 2 : 0);
}

export function buyMetaUpgrade(meta, key) {
  const clean = cleanMeta(meta);
  if (!META[key]) return clean;
  const current = clean.upgrades[key];
  const cost = metaCost(key, current);
  if (current >= META[key].cap || clean.shards < cost) return clean;
  return {
    shards: clean.shards - cost,
    upgrades: { ...clean.upgrades, [key]: current + 1 },
  };
}
