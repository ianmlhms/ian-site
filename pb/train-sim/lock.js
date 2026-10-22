/* Lokféierer: career lock. The game holds two careers in one save, 'rail' (Zuch) and 'tram' (the Luxtram). The arcade shows them as two tiles
   that open the same page: the tile injects window.__tsCareerLock ('rail' | 'tram') before any game script runs, a standalone page takes it from
   ?career=rail|tram. TS.careerLock is that value, or null (nothing locked: both careers, as before). Anything else is ignored. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const CAREER_IDS = Object.freeze(['rail', 'tram']);
  const TRAM_TAB_TITLE = 'Tramsimulator Lëtzebuerg 🚊 – Arcade';

  function readRaw() {
    if (window.__tsCareerLock !== undefined) return window.__tsCareerLock;
    try {
      return new URLSearchParams(location.search).get('career');
    } catch (error) {
      console.warn('[Lokféierer] could not read the career lock', error);
      return null;
    }
  }
  const raw = readRaw();
  TS.careerLock = CAREER_IDS.includes(raw) ? raw : null;
  if (TS.careerLock === 'tram') document.title = TRAM_TAB_TITLE;   // read by arcade-kit.js as the standalone bar title
})();
