/* Loads the shipped Lux Drive world in Node with the very code the browser runs (a tool for the landmark work:
 * profiles of the ground under a bridge, the footprints under a church).  No raw data needed. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorldData } from '../../pb/lux-drive/world-data.js';
import { createHeightField } from '../../pb/lux-drive/heightfield.js';
import { createSurface } from '../../pb/lux-drive/surface.js';
import { createDeckNetwork, widenToWays, createGround } from '../../pb/lux-drive/decks.js';
import { fixLandmarkDecks } from '../../pb/lux-drive/landmarks.js';
import { createTubes } from '../../pb/lux-drive/tunnel-tubes.js';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../pb/lux-drive/data');
export async function loadWorld() {
  const data = await loadWorldData(async (name) => new Uint8Array(fs.readFileSync(path.join(DATA, name))));
  const field = createHeightField({ near: data.near, far: data.far, roads: data.roads, decks: data.decks });
  const surface = createSurface(field);
  const deckNetwork = createDeckNetwork(widenToWays(fixLandmarkDecks(data.decks, (x, z) => surface.height(x, z)), data.roads), surface);
  const tubes = createTubes(data.roads, surface, field.network, data.buildings);       // (the tunnels the car drives through, as main.js)
  const ground = createGround(surface, deckNetwork, tubes.network);
  return { data, field, surface, ground, deckNetwork, tubes };
}
