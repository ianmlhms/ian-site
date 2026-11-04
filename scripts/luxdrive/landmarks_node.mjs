/* Builds the landmarks in Node and prints what each one is (triangles, size, what it hides): a quick check while modelling.
 *   node scripts/luxdrive/landmarks_node.mjs [id ...] */
import { loadWorld } from './world_node.mjs';
import { createLandmarks } from '../../pb/lux-drive/landmarks.js';

const only = process.argv.slice(2);
const w = await loadWorld();
const t0 = Date.now();
const lm = createLandmarks({ buildings: w.data.buildings, decks: w.deckNetwork.decks, ground: (x, z) => w.surface.height(x, z), roads: w.data.roads, only: only.length ? only : null });
for (const m of lm.list) console.log(m.id.padEnd(22), 'tris', String(m.soup.triangleCount).padStart(6), 'bounds', m.bounds.map((v) => v.toFixed(0)).join(','), 'y', m.bottom.toFixed(1), '..', m.top.toFixed(1), JSON.stringify(m.info));
console.log('hidden buildings', lm.hiddenBuildings.size, 'hidden decks', [...lm.hiddenDecks].join(','), 'walls', lm.walls.length, `${Date.now() - t0} ms`);
