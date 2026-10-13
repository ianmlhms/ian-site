/* Zuchsimulator Lëtzebuerg: registry of photo-modelled real stations.
 * Each stations-*.js file calls TS.realStations.register(name, spec) for the stations it owns.
 * spec = { kind: 'rail' | 'tram' (default 'rail'), canopy: false (skip the generic canopy), furniture: false (skip generic benches,
 * lamps, clocks), build(api) } — infra.js buildStation() calls build(api) instead of the generic station building.
 * api: see buildStation in infra.js (sets/M/mat/col/helpers, sx/pf/spot/place for the station's local frame, extra = Object3D list). */
(function () {
  'use strict';
  window.TS = window.TS || {};
  const specs = new Map();
  const keyOf = (name, kind) => (kind || 'rail') + ':' + name;

  function register(name, spec) {
    if (!name || !spec || typeof spec.build !== 'function') {
      console.warn('[Lokféierer] realStations: bad spec for', name);
      return;
    }
    specs.set(keyOf(name, spec.kind), Object.freeze(Object.assign({ kind: 'rail' }, spec)));
  }

  function get(name, kind) {
    return specs.get(keyOf(name, kind)) || null;
  }

  const list = () => Array.from(specs.keys());

  window.TS.realStations = Object.freeze({ register, get, list });
})();
