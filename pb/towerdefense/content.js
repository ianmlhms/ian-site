export const MAX_LEVEL = 15;
export const WORLD = Object.freeze({ width: 36, depth: 54 });

export const RULES = Object.freeze({
  baseLives: 20,
  buildSeconds: 12,
  earlyGoldPerSecond: 3,
  waveClearGold: 28,
  waveClearGrowth: 3,
  spawnGap: 0.62,
  sellRate: 0.7,
  heroSpeed: 7.2,
  heroRange: 3.2,
  heroRate: 1.05,
  heroAuraRange: 6,
  heroAuraBuff: 0.18,
});

export const TOWERS = Object.freeze({
  rapid: Object.freeze({
    name: "Repeater", short: "RPD", role: "Rapid ground fire", cost: 52,
    color: 0x58d7ff, range: 8.2, rate: 4.1, damage: 10, targets: "ground",
    branches: Object.freeze({
      A: Object.freeze({ name: "Gatling", note: "Extreme fire rate", rate: 1.65 }),
      B: Object.freeze({ name: "Penetrator", note: "Armour-piercing rounds", damage: 1.55, pierce: 0.65 }),
    }),
  }),
  frost: Object.freeze({
    name: "Frost Spire", short: "FRZ", role: "Slows ground units", cost: 68,
    color: 0x83edff, range: 7.8, rate: 1.15, damage: 8, targets: "ground", slow: 0.58,
    branches: Object.freeze({
      A: Object.freeze({ name: "Deep Winter", note: "Stronger, longer freeze", slow: 0.55, slowTime: 1.8 }),
      B: Object.freeze({ name: "Crystal Lance", note: "Brittle targets take more damage", damage: 1.8, brittle: 0.2 }),
    }),
  }),
  cannon: Object.freeze({
    name: "Bombard", short: "AOE", role: "Heavy ground splash", cost: 94,
    color: 0xffa44f, range: 9.2, rate: 0.7, damage: 40, targets: "ground", splash: 3.4,
    branches: Object.freeze({
      A: Object.freeze({ name: "Earthshaker", note: "Huge blast radius", damage: 1.25, splash: 1.55 }),
      B: Object.freeze({ name: "Skyburst", note: "Shrapnel can strike flyers", rate: 1.25, targets: "all" }),
    }),
  }),
  sniper: Object.freeze({
    name: "Longshot", short: "SNP", role: "Long range, hits all", cost: 112,
    color: 0xffdd68, range: 15.5, rate: 0.42, damage: 92, targets: "all", pierce: 0.2,
    branches: Object.freeze({
      A: Object.freeze({ name: "Deadeye", note: "Devastating single shots", damage: 1.65 }),
      B: Object.freeze({ name: "Boss Hunter", note: "Faster, stronger vs bosses", rate: 1.4, boss: 1.75 }),
    }),
  }),
  air: Object.freeze({
    name: "Skyguard", short: "AIR", role: "Dedicated anti-air", cost: 76,
    color: 0xd09aff, range: 10.5, rate: 2.35, damage: 19, targets: "air",
    branches: Object.freeze({
      A: Object.freeze({ name: "Flak Array", note: "Splash damage to air groups", splash: 2.8 }),
      B: Object.freeze({ name: "Seekers", note: "Long-range heavy missiles", damage: 1.55, range: 1.3 }),
    }),
  }),
  support: Object.freeze({
    name: "War Beacon", short: "BUF", role: "Buffs nearby towers", cost: 86,
    color: 0x6ee59b, range: 7.4, rate: 0, damage: 0, targets: "none", buff: 0.22,
    branches: Object.freeze({
      A: Object.freeze({ name: "Overcharge", note: "Stronger damage aura", buff: 1.75 }),
      B: Object.freeze({ name: "Quartermaster", note: "Discounts nearby upgrades", discount: 0.18, range: 1.2 }),
    }),
  }),
});

export const ENEMIES = Object.freeze({
  normal: Object.freeze({ name: "Raider", hp: 50, speed: 3.65, reward: 9, colour: 0xe9dfc7 }),
  fast: Object.freeze({ name: "Runner", hp: 34, speed: 6.1, reward: 10, colour: 0xffd34f }),
  armoured: Object.freeze({ name: "Bulwark", hp: 125, speed: 2.65, reward: 16, armour: 0.32, colour: 0x8d9cac }),
  flying: Object.freeze({ name: "Skimmer", hp: 64, speed: 4.8, reward: 14, flying: true, colour: 0xd98dff }),
  boss: Object.freeze({ name: "Warlord", hp: 470, speed: 2.05, reward: 82, armour: 0.2, colour: 0xff5f68 }),
});

export const SKILLS = Object.freeze({
  meteor: Object.freeze({ name: "Meteor", cooldown: 24, description: "Blast a targeted area" }),
  freeze: Object.freeze({ name: "Freeze", cooldown: 30, description: "Slow every enemy" }),
  rally: Object.freeze({ name: "Rally", cooldown: 34, description: "Boost tower and hero damage" }),
  heal: Object.freeze({ name: "Repair", cooldown: 46, description: "Restore 5 base lives" }),
});

export const META = Object.freeze({
  startingGold: Object.freeze({ name: "War Chest", description: "+25 starting gold", cap: 5 }),
  heroDamage: Object.freeze({ name: "Hero Training", description: "+15% hero damage", cap: 5 }),
  towerDiscount: Object.freeze({ name: "Engineering", description: "3% tower discount", cap: 5 }),
  extraLife: Object.freeze({ name: "Fortification", description: "+1 starting life", cap: 5 }),
});

const RAW_PATHS = [
 [[-.08,.10],[.76,.10],[.76,.31],[.22,.31],[.22,.55],[.82,.55],[.82,.80],[.08,.80]],
 [[.10,-.06],[.10,.25],[.78,.25],[.78,.47],[.30,.47],[.30,.72],[.90,.72],[.90,1.06]],
 [[-.08,.16],[.28,.16],[.28,.42],[.72,.42],[.72,.18],[.92,.18],[.92,.68],[.48,.68],[.48,.88],[1.08,.88]],
 [[.18,-.06],[.18,.18],[.82,.18],[.82,.38],[.15,.38],[.15,.62],[.77,.62],[.77,.84],[.35,.84],[.35,1.06]],
 [[-.08,.08],[.88,.08],[.88,.29],[.12,.29],[.12,.50],[.88,.50],[.88,.71],[.12,.71],[.12,.92],[1.08,.92]],
 [[.08,-.06],[.08,.20],[.55,.20],[.55,.38],[.88,.38],[.88,.61],[.38,.61],[.38,.82],[.78,.82],[.78,1.06]],
 [[-.08,.13],[.20,.13],[.20,.34],[.80,.34],[.80,.13],[.94,.13],[.94,.58],[.48,.58],[.48,.78],[.12,.78],[.12,1.06]],
 [[.50,-.06],[.50,.14],[.12,.14],[.12,.38],[.82,.38],[.82,.61],[.24,.61],[.24,.84],[.66,.84],[.66,1.06]],
 [[-.08,.22],[.35,.22],[.35,.08],[.78,.08],[.78,.43],[.18,.43],[.18,.68],[.68,.68],[.68,.90],[1.08,.90]],
 [[.12,-.06],[.12,.17],[.88,.17],[.88,.36],[.42,.36],[.42,.55],[.10,.55],[.10,.76],[.72,.76],[.72,1.06]],
 [[-.08,.09],[.68,.09],[.68,.27],[.22,.27],[.22,.45],[.88,.45],[.88,.65],[.42,.65],[.42,.84],[.08,.84],[.08,1.06]],
 [[.88,-.06],[.88,.16],[.18,.16],[.18,.35],[.70,.35],[.70,.54],[.08,.54],[.08,.73],[.56,.73],[.56,.92],[1.08,.92]],
 [[-.08,.14],[.42,.14],[.42,.32],[.86,.32],[.86,.51],[.16,.51],[.16,.70],[.62,.70],[.62,.88],[1.08,.88]],
 [[.28,-.06],[.28,.16],[.82,.16],[.82,.34],[.08,.34],[.08,.53],[.68,.53],[.68,.72],[.20,.72],[.20,.91],[1.08,.91]],
 [[-.08,.07],[.92,.07],[.92,.23],[.12,.23],[.12,.40],[.82,.40],[.82,.57],[.18,.57],[.18,.74],[.72,.74],[.72,.91],[1.08,.91]],
];

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function pathForLevel(level) {
  const safe = clamp(Math.floor(level), 1, MAX_LEVEL);
  return RAW_PATHS[safe - 1].map(([x, z]) => ({ x: x * WORLD.width, z: z * WORLD.depth }));
}

export function pathLength(path) {
  return path.slice(1).reduce((sum, point, index) => sum + distance(path[index], point), 0);
}

export function pointOnPath(path, along) {
  let remaining = Math.max(0, along);
  for (let index = 1; index < path.length; index += 1) {
    const segment = distance(path[index - 1], path[index]);
    if (remaining > segment) {
      remaining -= segment;
      continue;
    }
    const amount = segment ? remaining / segment : 0;
    return {
      x: path[index - 1].x + (path[index].x - path[index - 1].x) * amount,
      z: path[index - 1].z + (path[index].z - path[index - 1].z) * amount,
    };
  }
  return { ...path[path.length - 1] };
}

function distanceToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const square = dx * dx + dz * dz;
  if (!square) return distance(point, start);
  const amount = clamp(((point.x - start.x) * dx + (point.z - start.z) * dz) / square, 0, 1);
  return distance(point, { x: start.x + amount * dx, z: start.z + amount * dz });
}

export function distanceToPath(point, path) {
  return Math.min(...path.slice(1).map((end, index) => distanceToSegment(point, path[index], end)));
}

export function padsForLevel(level) {
  const path = pathForLevel(level);
  const candidates = [];
  for (let z = 3; z <= WORLD.depth - 3; z += 3) {
    for (let x = 3; x <= WORLD.width - 3; x += 3) {
      const point = { x, z };
      const roadGap = distanceToPath(point, path);
      if (roadGap >= 3.2 && roadGap <= 8.5) candidates.push({ ...point, roadGap });
    }
  }
  const ordered = [...candidates].sort((a, b) => a.roadGap - b.roadGap || a.z - b.z || a.x - b.x);
  return ordered.reduce((pads, candidate) => {
    if (pads.length >= 16) return pads;
    if (pads.some((pad) => distance(pad, candidate) < 4.6)) return pads;
    return [...pads, { x: candidate.x, z: candidate.z }];
  }, []);
}

export function waveCount(level) {
  return 10 + Math.floor((clamp(level, 1, MAX_LEVEL) - 1) * 5 / (MAX_LEVEL - 1));
}

export function enemySequence(level, wave) {
  const count = 6 + wave + Math.floor(level * 0.65);
  const regular = Array.from({ length: count }, (_, index) => {
    if (wave >= 3 && index % 5 === 2) return "fast";
    if (wave >= 4 && index % 6 === 3) return "armoured";
    if (wave >= 2 && index % 7 === 4) return "flying";
    return "normal";
  });
  return wave % 5 === 0 ? [...regular, "boss"] : regular;
}

export function metaCost(key, currentLevel) {
  if (!META[key]) return Infinity;
  return 2 + Math.max(0, currentLevel) * 2;
}
