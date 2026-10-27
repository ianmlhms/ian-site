/* Zuchsimulator W3: hole detector of the Luxtram world (scripts/zuch/tram_hole_lib.mjs): magenta-clear-colour render poses along the line and vertical rays over the tiles.
 * The detector first has to find a hole it is given (one terrain tile hidden), then the whole line (all three services share the data) must be clean. */
import { runIfMain } from './lib.mjs';
import { simOnPage } from '../zuch/zlib.mjs';
import { scanTram } from '../zuch/tram_hole_lib.mjs';

export const flow = {
  name: 'train-sim-tram-holes', fullChromium: true,
  async run(h) {
    const sim = await simOnPage(await h.context.newPage(), h.origin, { quality: 'high' });
    h.step('the detector finds a missing terrain tile');
    const self = await scanTram(sim, 'luxtram', { selftest: true });
    h.expect(self.detected, `a hidden tile is detected (${JSON.stringify(self.poses)})`);
    h.step('the whole Luxtram line: no hole beside trenches, portals, pits or tile seams');
    const rep = await scanTram(sim, 'luxtram', { step: 200, rayStep: 60 });
    h.eq(rep.flagged.slice(0, 3), [], `${rep.poses} render poses: no hole`);
    h.eq(rep.rayFailures.slice(0, 3), [], `${rep.rays} vertical rays: every one hits a tile mesh within tolerance`);
    h.eq(sim.errors.filter((e) => !/404/.test(e)).slice(0, 5), [], 'no console errors or warnings from the game');
  },
};
runIfMain(import.meta.url, flow);
