/* Lux Drive sweep: builds the game's physics world in Node exactly as pb/lux-drive/harness.js does (same decoders, same colliders), once per process.
 * Windows-safe: every path comes from fileURLToPath.  Pure Node, no browser. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const LD = path.join(REPO, 'pb', 'lux-drive');
const DATA = path.join(LD, 'data');
const imp = (f) => import(new URL(`file:///${path.join(LD, f).replace(/\\/g, '/').replace(/^\//, '')}`).href);

/** Loads the world.  Returns everything the sweeps need: { data, field, surface, ground, tubes, net, collider (car-collide.js), roads (drivable car ways) }. */
export async function loadWorld() {
  const [wd, hf, sf, dk, ps, tt, lm, bd, tr, pt, pa, wm, wc, pr, sl, pb, cc, ri, lc] = await Promise.all([
    'world-data.js', 'heightfield.js', 'surface.js', 'decks.js', 'portals.js', 'tunnel-tubes.js', 'landmarks.js', 'buildings.js', 'trees.js', 'portals.js',
    'play-area.js', 'world-map.js', 'wall-collider.js', 'props.js', 'street-lights.js', 'park-benches.js', 'car-collide.js', 'road-index.js', 'lane-clearance.js',
  ].map(imp));
  const read = async (name) => new Uint8Array(fs.readFileSync(path.join(DATA, name)));
  const data = await wd.loadWorldData(read);
  const area = JSON.parse(fs.readFileSync(path.join(DATA, 'area.json'), 'utf8'));
  const field = hf.createHeightField({ near: data.near, far: data.far, roads: data.roads, decks: data.decks });
  const surface = sf.createSurface(field);
  const deckNetwork = dk.createDeckNetwork(dk.widenToWays(lm.fixLandmarkDecks(data.decks, (x, z) => surface.height(x, z)), data.roads), surface);
  const tubes = tt.createTubes(data.roads, surface, field.network, data.buildings, deckNetwork);      // (the deck network: the approach of a tube may run on onto a bridge, tunnels19 - as main.js)
  const ground = dk.createGround(surface, deckNetwork, tubes.network);
  const landmarks = lm.createLandmarks({ buildings: data.buildings, decks: deckNetwork.decks, ground: (x, z) => surface.height(x, z), roads: data.roads });
  const buildings = bd.createBuildingIndex(data.buildings, { hidden: landmarks.hiddenBuildings, groundAt: (x, z) => field.height(x, z), landAt: (x, z) => field.baseHeight(x, z) });
  const playArea = pa.createPlayArea(area);
  const net = field.network;
  const portals = ps.createPortals(data.roads, (x, z) => surface.height(x, z), (r) => net.isDrawn(r.id), (x, z) => playArea.inside(x, z), ps.portalRoadAt(net), ps.portalBlocked(buildings, deckNetwork), tubes.ids);
  const maps = wm.buildWorldMap({ classes: data.classes, classInfo: data.classInfo, canopy: data.canopy, buildings: data.buildings });
  const treeDecks = dk.createDeckNetwork([...ground.decks, ...landmarks.footprints]);
  const shells = tt.tubeShells(tubes.tubes, (x, z) => surface.height(x, z));
  const bakedTrees = tr.keepWaysClear(data.trees, { network: net, field, treeDecks, treeFree: landmarks.treeFree }).filter((t) => !shells.inShell(t.x, t.z, 1.5));
  const forest = tr.createTreeIndex({ map: maps, field, network: net, buildings, trees: bakedTrees, clearings: [...landmarks.clearings, ...shells.clearings], treeDecks });
  const props = pr.createPropCollider();
  const lamps = tt.lampsOutsideShells(sl.placeStreetLights({ roads: data.roads, network: net, buildings, map: maps, walls: data.walls }), shells.inShell);
  for (let i = 0; i < lamps.count; i++) props.add(lamps.x[i], lamps.z[i], cc.LAMP_POST_RADIUS, surface.height(lamps.x[i], lamps.z[i]), cc.LAMP_POST_HEIGHT);
  const benches = pb.placeParkBenches({ roads: data.roads, network: net, buildings, map: maps });
  for (let i = 0; i < benches.count; i++) props.add(benches.x[i], benches.z[i], cc.BENCH_RADIUS, surface.height(benches.x[i], benches.z[i]), cc.BENCH_HEIGHT);
  const walls = wc.createWallCollider(data.walls, (x, z) => ground.height(x, z), (x, z) => surface.height(x, z));
  const collider = cc.createCarCollider({ buildings, landmarks, walls, portals, ground, forest, props, trams: null, playArea, surface, deckNetwork, tubes: tubes.network });
  const isOpen = (r) => tubes.ids.has(r.id);
  const roads = lc.laneRoads(data.roads, isOpen);
  return { playArea, data, field, surface, ground, tubes, net, collider, roads, deckNetwork, isOpen, laneOffsets: lc.laneOffsets };
}
