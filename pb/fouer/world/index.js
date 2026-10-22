/* Schueberfouer Tycoon, W2: assembles the empty Glacis world.
 *   createWorld({ T, TS, r, quality, onProgress }) -> world
 * world.groundY(u, w)     terrain height in the game frame (y of the drawn terrain mesh, LiDAR - oy)
 * world.toGame / toLocal  frame conversions;  world.fieldPoly  Glacis polygon in game metres
 * world.update(dt)        advances ground water, tram, sky
 * world.setNight(k)       0..1 night factor (lit windows, landmark glow, tram lights); the sky module calls it
 * world.glacis / landmarks / tram / stops / pitches / sky  the parts (see their files) */
import { loadBundle } from './bundle.js';
import { makeFrame } from './frame.js';
import { createGlacis } from './glacis.js';
import { createLandmarks } from './landmarks.js';

export async function createWorld({ T, TS, r, quality, onProgress = () => {}, parts = {} }) {
  onProgress(0.01, 'bundle');
  const bundle = await loadBundle(undefined, (p) => onProgress(0.01 + p * 0.05, 'bundle'));
  const H = bundle.header;
  const frame = makeFrame(H.frame);
  const glacis = await createGlacis({ T, TS, bundle, quality, frame, onProgress: (p, s) => onProgress(0.06 + p * 0.8, s) });
  const landmarks = await createLandmarks({ T, bundle, oy: H.oy });
  glacis.root.add(landmarks.group);
  r.scene.add(glacis.root);
  const world = {
    T, bundle, header: H, frame, glacis, landmarks, root: glacis.root, quality,
    toGame: frame.toGame, toLocal: frame.toLocal,
    fieldPoly: H.polysGame.glacis, busPoly: H.polysGame.bus,
    groundY(u, w) { const [x, z] = frame.toLocal(u, w); return glacis.meshY(x, z); },
    parts: {}, nightK: 0,
    setNight(k) { world.nightK = k; glacis.setNight(k); landmarks.setNight(k); Object.values(world.parts).forEach((p) => p && p.setNight && p.setNight(k)); },
    update(dt) { glacis.update(dt); Object.values(world.parts).forEach((p) => p && p.update && p.update(dt)); },
    dispose() { Object.values(world.parts).forEach((p) => p && p.dispose && p.dispose()); landmarks.dispose(); glacis.dispose(); r.scene.remove(glacis.root); },
  };
  r.state.groundY = (u, w) => world.groundY(u, w);
  r.state.world = world;
  r.fieldPoly = world.fieldPoly;
  // site clamp for the camera: the field + the bus park annex + a margin
  const us = world.fieldPoly.concat(world.busPoly).map((p) => p[0]); const ws = world.fieldPoly.concat(world.busPoly).map((p) => p[1]);
  r.setSite({ u: [Math.min(...us) - 40, Math.max(...us) + 60], w: [Math.min(...ws) - 25, Math.max(...ws) + 30] });
  for (const [name, make] of Object.entries(parts)) {
    try { world.parts[name] = await make(world); } catch (e) { console.error('[fouer] part ' + name + ' failed', e); }
  }
  onProgress(1, 'ready');
  return world;
}
