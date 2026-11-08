/* Zuch + Tram simulator are not for phones (Ian, Nov 2026): at 390x844 with touch the game does not start (calm block screen, back button,
 * no game boot); at iPad size (820x1180) the game loads as before. Supabase is mocked. */
import { runFlow, runIfMain } from './lib.mjs';
import { openBothCareers } from './train_sim.mjs';

const frameOf = async (h) => { await h.page.waitForFunction(() => document.getElementById('gf')?.contentWindow, null, { timeout: 30000 }); return h.page.frames().find((f) => f.parentFrame()); };

const phoneFlow = {
  name: 'train-sim-phone', fullChromium: true, touch: true, viewport: { width: 390, height: 844 },
  backend: { tables: { scores: () => [], game_saves: () => [] } },
  async run(h) {
    await h.signIn();
    await openBothCareers(h);
    for (const id of ['train-sim', 'tram-sim']) {
      h.step(`phone: ${id} shows the block screen, no game`);
      await h.goto(`/pixelbreak.html?g=${id}`);
      const f = await frameOf(h);
      await f.waitForSelector('#phoneBlock:not([hidden])', { timeout: 20000 });
      h.expect(/nëmmen um iPad an um Computer/.test(await f.locator('#phoneText').innerText()), 'lb text on the block screen');
      h.expect((await f.locator('#phoneTitle').innerText()) === (id === 'tram-sim' ? 'Tramsimulator' : 'Zuchsimulator'), 'title per mode');
      h.expect(await f.evaluate(() => !window.__tsTest || window.__tsTest.state().phase === 'boot'), 'the game did not boot (phase boot, no world)');
      h.expect(await f.locator('#phoneBack').isVisible(), 'back button');
      await h.pause(1500);
      await h.shot(`phone-${id}`);
    }
  },
};
const padFlow = {
  name: 'train-sim-pad', fullChromium: true, touch: true, viewport: { width: 820, height: 1180 },
  backend: { tables: { scores: () => [], game_saves: () => [] } },
  async run(h) {
    await h.signIn();
    await openBothCareers(h);
    h.step('iPad: the game still loads');
    await h.goto('/pixelbreak.html?g=train-sim');
    const f = await frameOf(h);
    await f.waitForSelector('#menu:not([hidden])', { timeout: 60000 });
    h.expect(await f.locator('#phoneBlock').isHidden(), 'no block screen on an iPad');
  },
};
export const flow = phoneFlow;
export { phoneFlow, padFlow };
import { pathToFileURL } from 'node:url';
import path from 'node:path';
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  (async () => { let ok = true; for (const f of [phoneFlow, padFlow]) { const r = await runFlow(f); ok = ok && r.ok; } process.exit(ok ? 0 : 1); })().catch((e) => { console.error(e); process.exit(2); });
}
