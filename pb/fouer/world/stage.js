/* Schueberfouer Tycoon, W2: standalone stage for the empty Glacis (pb/fouer.html).  W5's main.js replaces this boot; it keeps using
 * createRenderer() + createWorld() + createEnv() + mountEnvUi() the same way. */
import { createRenderer } from '/pb/fouer/renderer.js';
import { createWorld } from '/pb/fouer/world/index.js';
import { createEnv } from '/pb/fouer/world/sky.js';
import { createTram } from '/pb/fouer/world/tram.js';
import { createPitches } from '/pb/fouer/world/pitches.js';
import { mountEnvUi } from '/pb/fouer/world/envmenu.js';

const T = window.THREE; const TS = window.TS;
const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const debug = qs.get('fouerDebug') === '1';

async function boot() {
  const canvas = $('fouerCanvas');
  const r = createRenderer({ THREE: T, canvas });
  const setLoad = (p, msg) => { $('bar').firstElementChild.style.width = Math.round(p * 100) + '%'; if (msg) $('loadMsg').textContent = msg; };
  let world;
  try {
    world = await createWorld({
      T, TS, r, quality: r.state.quality, onProgress: setLoad,
      parts: {
        tram: (w) => createTram({ T, world: w, bundle: w.bundle }),
        pitches: async (w) => { const p = await createPitches({ T, world: w }); r.gameRoot.add(p.group); return p; },
      },
    });
  } catch (e) {
    console.error('[fouer] world failed', e);
    $('loadMsg').textContent = 'Could not load the Glacis: ' + e.message;
    document.documentElement.dataset.bootError = 'world';
    throw e;
  }
  if (world.parts.tram) world.root.add(world.parts.tram.group);
  const env = createEnv({ T, scene: r.scene, renderer: r.renderer, world, quality: r.state.quality });
  world.env = env;
  r.on('frame', (dt) => { env.update(dt, r.camera); world.update(dt); });
  r.poses.overview = Object.assign({}, r.framePose());
  mountEnvUi({ env, r, pitches: world.parts.pitches });
  if (qs.get('fouerMarkers')) world.parts.pitches.setMode(qs.get('fouerMarkers'));
  r.flyIn(qs.get('fouerNoFly') === '1' ? 0.01 : 3.6);
  r.start();
  $('loading').classList.add('done');
  document.documentElement.dataset.fouerReady = '1';
  if (debug) {
    const presets = {
      overview: () => r.flyTo(r.framePose(), 0),
      close: () => r.flyTo(r.poses.close, 0), top: () => r.flyTo(r.poses.top, 0), reverse: () => r.flyTo(r.poses.reverse, 0), north: () => r.flyTo(r.poses.north, 0),
    };
    window.__fouer = {
      renderer: r.renderer, r, world, env, THREE: T, tram: world.parts.tram, pitches: world.parts.pitches,
      performanceSnapshot: () => r.performanceSnapshot(),
      setTime: (h) => (typeof h === 'string' ? env.setTime(h, false) : env.setHour(h)),
      setWeather: (w) => env.setWeatherNow(w),
      cameraPreset: (name) => { if (presets[name]) presets[name](); else throw new Error('unknown preset ' + name); },
      presets: Object.keys(presets),
      showPitches: (m) => world.parts.pitches.setMode(m === true ? 'glow' : m === false ? 'off' : m),
      setFreeCamera: (o) => r.setFreeCamera(o),
    };
  }
}
boot();
