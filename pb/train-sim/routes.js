/* Lokféierer: route definitions (authored layouts).
 *
 * A route is a list of layout items that TS.track.build() turns into a smooth 3D curve:
 *   { t:'s', len }                       straight
 *   { t:'c', len, r, dir:'L'|'R' }       curve (radius in m, left or right turn)
 *   { t:'station', name, size, side }    level straight with a platform
 * Optional per-item fields: g (grade in %), limit (km/h), biome, tunnel, crossing,
 * bridge:{kind:'viaduct'|'steel'|'river', h (height above valley), water}.
 *
 * Layouts are authored with a tiny token language, see parseLeg():
 *   s200            straight, 200 m          s*          straight, fills what is left of the leg
 *   r450/230        right curve R450, 230 m  l600/200    left curve
 *   flags (after ':'): g0.8 grade % | v90 limit | T tunnel | X level crossing | bfarmland biome
 *                      Bs,36,w bridge (v|s|r = viaduct|steel|river, height m, w = water below)
 */
(function () {
  'use strict';
  window.TS = window.TS || {};

  const BRIDGE_KINDS = { v: 'viaduct', s: 'steel', r: 'river' };

  const STATION_DEFAULTS = {
    rail: { platformLen: 210, approachBefore: 40, approachAfter: 40, stationLimit: 80 },
    hst: { platformLen: 260, approachBefore: 40, approachAfter: 40, stationLimit: 160 },
    tram: { platformLen: 40, approachBefore: 20, approachAfter: 20, stationLimit: 25 },
  };

  function parseFlags(flags) {
    const out = {};
    flags.forEach((flag) => {
      const key = flag[0];
      const val = flag.slice(1);
      if (key === 'g') out.g = parseFloat(val);
      else if (key === 'v') out.limit = parseInt(val, 10);
      else if (key === 'T') out.tunnel = true;
      else if (key === 'X') out.crossing = true;
      else if (key === 'b') out.biome = val;
      else if (key === 'B') {
        const [k, h, w] = val.split(',');
        out.bridge = { kind: BRIDGE_KINDS[k] || 'viaduct', h: parseFloat(h) || 10, water: w === 'w' };
      } else console.warn('[Lokféierer] routes: unknown flag', flag);
    });
    return out;
  }

  function parseToken(token) {
    const [head, ...flags] = token.split(':');
    const extra = parseFlags(flags);
    if (head === 's*') return Object.assign({ t: 's', len: 0, fill: true }, extra);
    if (head[0] === 's') return Object.assign({ t: 's', len: parseFloat(head.slice(1)) }, extra);
    const m = head.match(/^([rl])(\d+)\/(\d+)$/);
    if (!m) throw new Error('[Lokféierer] routes: bad token ' + token);
    return Object.assign({ t: 'c', dir: m[1] === 'r' ? 'R' : 'L', r: parseInt(m[2], 10), len: parseInt(m[3], 10) }, extra);
  }

  // Expand one leg (between two stations) to exactly `length` metres.
  function leg(length, spec) {
    const items = spec.trim().split(/\s+/).map(parseToken);
    const fixed = items.reduce((sum, it) => sum + it.len, 0);
    const fills = items.filter((it) => it.fill);
    const rest = Math.max(30, length - fixed) / Math.max(1, fills.length);
    if (length - fixed < 30) console.warn('[Lokféierer] routes: leg overfull', length, fixed);
    return items.map((it) => (it.fill ? Object.assign({}, it, { len: rest, fill: undefined }) : it));
  }

  const station = (name, size, side, biome, terminus) => ({ t: 'station', name, size, side, biome, terminus: !!terminus });

  function makeRoute(def, body) {
    const stations = body.filter((it) => it.t === 'station').map((it) => it.name);
    const layout = body.reduce((acc, it) => acc.concat(it), []);
    const defaults = STATION_DEFAULTS[def.kind];
    const stationLen = defaults.approachBefore + defaults.platformLen + defaults.approachAfter;
    const lengthM = layout.reduce((sum, it) => sum + (it.t === 'station' ? stationLen : it.len), 0);
    const passNames = Object.freeze((def.passNames || []).filter((n, i, all) => stations.indexOf(n) > 0 && stations.indexOf(n) < stations.length - 1 && all.indexOf(n) === i));
    return Object.freeze(Object.assign({ stationDefaults: defaults, stations, layout, lengthM, stopCount: stations.length - passNames.length, sceneryId: def.id }, def, { passNames }));
  }

  /* ---------------------------------------------------------------- 1 west */
  const west = makeRoute(
    {
      id: 'west', kind: 'rail', region: 'West', cruise: 120, biomes: ['city', 'suburb', 'farmland'],
      name: { lb: 'Lëtzebuerg – Kleinbettingen', de: 'Luxemburg – Kleinbettingen', en: 'Luxembourg – Kleinbettingen' },
    },
    [
      station('Lëtzebuerg', 3, 'right', 'city'),
      ...leg(1000, 's150:v60:bcity r420/230:g0.4 s220:v90:bsuburb l650/200:g0.6 s*:v110'),
      station('Bartreng', 1, 'left', 'suburb'),
      ...leg(1400, 's200:v110:bsuburb r800/260:g0.3 s*:X l900/240:g-0.3 s220'),
      station('Mamer', 2, 'right', 'suburb'),
      ...leg(1700, 's250:bfarmland l700/300:g0.5 s*:X r1000/280 s300:g-0.4'),
      station('Capellen', 1, 'left', 'farmland'),
      ...leg(1900, 's300 r800/330:g0.5 s*:g0 l1000/340:g-0.5 s400:X r900/260 s*:v90'),
      station('Kleinbettingen', 2, 'right', 'farmland', true),
    ]
  );

  /* --------------------------------------------------------------- 2 south */
  const south = makeRoute(
    {
      id: 'south', kind: 'rail', region: 'Minett', cruise: 120, biomes: ['city', 'suburb', 'farmland', 'industrial'],
      name: { lb: 'Lëtzebuerg – Esch-Uelzecht – Rodange', de: 'Luxemburg – Esch – Rodange', en: 'Luxembourg – Esch – Rodange' },
    },
    [
      station('Lëtzebuerg', 3, 'right', 'city'),
      ...leg(900, 's200:v60:bcity r350/200 s* l500/180:g0.6 s150'),
      station('Hollerich', 1, 'left', 'city'),
      ...leg(1100, 's250:v80:bcity r600/220:g0.8 s*:bsuburb l700/200:g0.4 s200'),
      station('Berchem', 1, 'right', 'suburb'),
      ...leg(1200, 's250:v100:bsuburb l900/260:g-0.6 s*:X r800/260 s250:g-0.5'),
      station('Bettembuerg', 2, 'left', 'suburb'),
      ...leg(1300, 's250:v120:bfarmland r1000/300:g0.7 s*:bindustrial l800/260 s300:X:v90'),
      station('Esch-Uelzecht', 3, 'right', 'industrial'),
      ...leg(1000, 's200:v70:bindustrial r500/250:g0.5 s* l400/220 s150:v80'),
      station('Belval-Université', 2, 'left', 'industrial'),
      ...leg(1100, 's200:v80 l450/260:g0.6 s* r600/240:g-0.4 s200:X'),
      station('Déifferdang', 2, 'right', 'industrial'),
      ...leg(900, 's200:v90 r500/220 s*:g0.5 l500/200 s150'),
      station('Péiteng', 1, 'left', 'industrial'),
      ...leg(1000, 's200:v90 l600/250:g-0.6 s*:X r700/240 s200'),
      station('Rodange', 2, 'right', 'industrial', true),
    ]
  );

  /* --------------------------------------------------------------- 4 north */
  const north = makeRoute(
    {
      id: 'north', kind: 'rail', region: 'Norden', cruise: 100, biomes: ['city', 'suburb', 'farmland', 'forest', 'ardennes'],
      name: { lb: 'Lëtzebuerg – Ettelbréck – Clierf', de: 'Luxemburg – Ettelbrück – Clerf', en: 'Luxembourg – Ettelbruck – Clervaux' },
    },
    [
      station('Lëtzebuerg', 3, 'right', 'city'),
      ...leg(780, 's90:v50:bcity r400/140 s280:Bs,36,w:v50 l500/120:bforest s*:v60'),
      station('Pafendall-Kierchbierg', 1, 'left', 'forest'),
      ...leg(1300, 's200:v70:bsuburb l600/260:g1.2 s*:v90 r800/260:g1.0 s220'),
      station('Walfer', 1, 'right', 'suburb'),
      ...leg(1400, 's250:v100:bfarmland r900/300:g0.8 s*:X l1000/300:g-0.3 s200'),
      station('Lëntgen', 1, 'left', 'farmland'),
      ...leg(1300, 's250:v100:bforest l700/280:g-0.8 s*:v90 r700/280 s200:Br,9,w'),
      station('Miersch', 2, 'right', 'forest'),
      ...leg(1400, 's200:v100:bforest r800/300:g0.6 s240:T:v80 l700/260 s*:X:v100'),
      station('Ettelbréck', 3, 'left', 'forest'),
      ...leg(1500, 's200:v90:bardennes r600/260:g1.4 s300:T:v80 l500/240:g1.0 s*:Bv,24,w r600/220:g-0.4 s150'),
      station('Kautebaach', 1, 'right', 'ardennes'),
      ...leg(1550, 's200:v80 l550/240:g1.0 s400:T r500/260:g1.2 s*:v90 l600/200 s120'),
      station('Wëlwerwolz', 1, 'left', 'ardennes'),
      ...leg(1300, 's200:v80 r500/240:g0.8 s220:T:v70 l450/260:g-0.8 s*:Bv,20,w r550/220 s100:v70'),
      station('Clierf', 2, 'right', 'ardennes', true),
    ]
  );

  /* ------------------------------------------------- the Mosel line (east, wittlich, trier)
   * Lëtzebuerg - Sandweiler-Contern - Oetrange - Munsbach - Roodt-Syr - Betzder - Wecker - Manternach - Mertert - Wasserbëlleg - Igel - Kreuz Konz -
   * Tréier Süd - Tréier Hbf - Ehrang - Schweich - Föhren - Hetzerath - Sehlem - Salmtal - Wittlich - Cochem - Koblenz Hbf.
   * The line is authored ONCE (moselBody); three services run on slices of it, so the curves, stations, crossings, bridges and scenery are identical
   * wherever they share track (sceneryId 'mosel' seeds the landscape and the crossing roads).  east = up to Wasserbëlleg (all stops), wittlich = up to
   * Wittlich (all stops, the RB 83 of the real timetable), trier = the whole line as an express: it runs through the stations in passNames at line speed.
   * See pb/train-sim/REAL-LINES.md for the real stop list and its sources. */
  const MOSEL_PASS_LIMIT = 110;
  const moselBody = [
    station('Lëtzebuerg', 3, 'right', 'city'),
    ...leg(1500, 's120:v60:bcity r450/220:g0.3 s230:bsuburb:v90 l900/260:bfarmland s*:v110'),
    station('Sandweiler-Contern', 1, 'left', 'suburb'),
    ...leg(1000, 's180:v110:bfarmland r1300/260:g-0.2 s*:X l1000/200 s120'),
    station('Oetrange', 1, 'right', 'farmland'),
    ...leg(1000, 's150:bfarmland l900/240:g0.5 s*:v100:bsuburb r800/200 s100'),
    station('Munsbach', 1, 'left', 'suburb'),
    ...leg(1300, 's150:bsuburb r700/260:g-0.4 s*:bforest l800/280:g0.6 s*:X r900/220 s120'),
    station('Roodt-Syr', 1, 'right', 'forest'),
    ...leg(1150, 's150:bforest l900/260:g0.3 s*:Br,6,w r1000/240 s120:bfarmland'),
    station('Betzder', 1, 'left', 'farmland'),
    ...leg(900, 's120:bfarmland r1100/240 s*:X l1200/200 s100'),
    station('Wecker', 1, 'left', 'farmland'),
    ...leg(850, 's120 l1000/230:g-0.3 s* r900/200 s100'),
    station('Manternach', 2, 'right', 'forest'),
    ...leg(1100, 's150:bforest r1000/260:g-0.4 s*:Br,7,w l900/240 s120:briver'),
    station('Mertert', 1, 'left', 'river'),
    ...leg(800, 's120:briver l1300/220 s*:v90 r900/180 s80'),
    station('Wasserbëlleg', 2, 'right', 'river'),
    ...leg(1200, 's150:v80:briver s*:Bs,9,w r1000/260:g0.2 s*:v100 l900/220 s120'),
    station('Igel', 1, 'right', 'river'),
    ...leg(1300, 's150:briver r1200/260 s*:X l1100/240:bsuburb s*:v100 r900/200 s100'),
    station('Kreuz Konz', 1, 'left', 'suburb'),
    ...leg(1000, 's150 l800/240:bsuburb s*:Br,12,w r900/220:bcity s100'),
    station('Tréier Süd', 1, 'right', 'city'),
    ...leg(800, 's120:v70:bcity r500/180 s*:v60 l600/150 s60'),
    station('Tréier Hbf', 3, 'right', 'city'),
    ...leg(1300, 's150:v60:bcity l700/220 s*:v90:bsuburb r800/250:briver s*:X l900/200 s100'),
    station('Ehrang', 1, 'left', 'industrial'),
    ...leg(1300, 's150:v100:bindustrial r900/260:briver s*:v120:bvineyard l1000/260 s*:X r900/200 s100'),
    station('Schweich', 1, 'left', 'vineyard'),
    ...leg(1000, 's150:bvineyard l1100/240 s*:X:bfarmland r1000/200 s100'),
    station('Föhren', 1, 'right', 'farmland'),
    ...leg(900, 's120:bfarmland r900/220 s*:X l1000/200 s100'),
    station('Hetzerath', 1, 'left', 'farmland'),
    ...leg(800, 's120 l900/200:g0.4 s*:bforest r800/180 s80'),
    station('Sehlem', 1, 'right', 'forest'),
    ...leg(800, 's120:bforest r800/200:g0.3 s* l900/180 s80:bfarmland'),
    station('Salmtal', 1, 'left', 'farmland'),
    ...leg(1600, 's150:bfarmland l1000/260 s*:X r1100/280:g-0.4 s*:v100 l900/220:bsuburb s150'),
    station('Wittlich', 2, 'right', 'farmland'),
    ...leg(2200, 's300:v120:bvineyard l1000/300:g-0.5 s*:v140 s560:T:v120 r900/320 s*'),
    station('Cochem', 2, 'left', 'vineyard'),
    ...leg(1800, 's300:v120:briver r1000/320 s*:v140 l1100/300:bsuburb s200:v100:bcity'),
    station('Koblenz Hbf', 3, 'right', 'city'),
  ];
  const moselSlice = (lastStation) => {
    const end = moselBody.findIndex((it) => it.t === 'station' && it.name === lastStation);
    return moselBody.slice(0, end + 1).map((it, i, all) => (i === all.length - 1 ? Object.assign({}, it, { terminus: true }) : it));
  };
  const MOSEL_BIOMES = ['city', 'suburb', 'farmland', 'forest', 'river', 'vineyard', 'industrial'];
  const MOSEL_STOPS_TRIER = ['Lëtzebuerg', 'Sandweiler-Contern', 'Wasserbëlleg', 'Igel', 'Kreuz Konz', 'Tréier Süd', 'Tréier Hbf', 'Schweich', 'Föhren', 'Wittlich', 'Cochem', 'Koblenz Hbf'];

  /* ---------------------------------------------------------------- 3 east (all stops, ends at Wasserbëlleg) */
  const east = makeRoute(
    {
      id: 'east', kind: 'rail', region: 'Ost', cruise: 120, biomes: MOSEL_BIOMES, sceneryId: 'mosel',
      name: { lb: 'Lëtzebuerg – Wasserbëlleg', de: 'Luxemburg – Wasserbillig', en: 'Luxembourg – Wasserbillig' },
    },
    moselSlice('Wasserbëlleg')
  );

  /* ------------------------------------------------- 3b wittlich (all stops, the RB 83) */
  const wittlich = makeRoute(
    {
      id: 'wittlich', kind: 'rail', region: 'Ost', cruise: 120, biomes: MOSEL_BIOMES, sceneryId: 'mosel',
      name: { lb: 'Lëtzebuerg – Tréier – Wittlech', de: 'Luxemburg – Trier – Wittlich', en: 'Luxembourg – Trier – Wittlich' },
    },
    moselSlice('Wittlich')
  );

  /* --------------------------------------------------------------- 6 trier (express: RE 11 + RE 1 to Koblenz) */
  const trier = makeRoute(
    {
      id: 'trier', kind: 'rail', region: 'Däitschland', cruise: 140, biomes: MOSEL_BIOMES, sceneryId: 'mosel',
      name: { lb: 'Lëtzebuerg – Tréier – Koblenz', de: 'Luxemburg – Trier – Koblenz', en: 'Luxembourg – Trier – Koblenz' },
      passNames: moselBody.filter((it) => it.t === 'station' && !MOSEL_STOPS_TRIER.includes(it.name)).map((it) => it.name),
    },
    moselSlice('Koblenz Hbf')
  );

  /* ---------------------------------------------------------------- 7 metz */
  const metz = makeRoute(
    {
      id: 'metz', kind: 'rail', region: 'Frankräich', cruise: 140, biomes: ['city', 'suburb', 'farmland', 'industrial'],
      name: { lb: 'Lëtzebuerg – Metz – Nancy', de: 'Luxemburg – Metz – Nancy', en: 'Luxembourg – Metz – Nancy' },
    },
    [
      station('Lëtzebuerg', 3, 'right', 'city'),
      ...leg(2400, 's300:v60:bcity r600/260 s*:v120:bsuburb l1200/320:g-0.8 s500:bfarmland:v140 r1500/300 s*:X'),
      station('Bettembuerg', 2, 'left', 'suburb'),
      ...leg(2400, 's300:v120:bfarmland l1400/320 s*:v160 r1500/320:g-0.4 s*:X:v140'),
      station('Thionville', 2, 'right', 'industrial'),
      ...leg(2400, 's300:v100:bindustrial r1200/320 s*:v140:bfarmland l1500/320:g0.5 s300:v160 s*'),
      station('Metz-Ville', 3, 'left', 'city'),
      ...leg(2200, 's300:v100:bsuburb l1200/300 s*:v160:bfarmland r1600/320 s*:X'),
      station('Pont-à-Mousson', 1, 'right', 'farmland'),
      ...leg(2000, 's300:v120:bfarmland r1300/320:g-0.4 s*:v160 l1500/300 s200:v100'),
      station('Nancy-Ville', 3, 'left', 'city', true),
    ]
  );

  /* ------------------------------------------------------------ 8 brussels */
  const brussels = makeRoute(
    {
      id: 'brussels', kind: 'rail', region: 'Belsch', cruise: 140, biomes: ['city', 'suburb', 'farmland', 'forest', 'ardennes'],
      name: { lb: 'Lëtzebuerg – Arlon – Namur – Bréissel', de: 'Luxemburg – Arlon – Namur – Brüssel', en: 'Luxembourg – Arlon – Namur – Brussels' },
    },
    [
      station('Lëtzebuerg', 3, 'right', 'city'),
      ...leg(2400, 's300:v60:bcity r600/260 s*:v120:bsuburb l1000/300:g0.8 s400:bfarmland:v140 r1500/300 s*:X'),
      station('Kleinbettingen', 1, 'left', 'farmland'),
      ...leg(1600, 's300:v120:bforest l1100/300:g0.6 s*:v140 r1200/300 s200:v100'),
      station('Arlon', 2, 'right', 'forest'),
      ...leg(3200, 's300:v120:bforest r1000/300:g0.8 s*:v140 l1100/300:bardennes:g-0.4 s500:T:v120 r900/300:g0.6 s*:Bv,22,w'),
      station('Libramont', 2, 'left', 'ardennes'),
      ...leg(3400, 's300:v120:bardennes l900/300:g-0.8 s*:Br,10,w r1000/320 s500:T:v120 l1100/300:bforest s*:X:bsuburb s150:bcity'),
      station('Namur', 3, 'right', 'city'),
      ...leg(2800, 's300:v100:bcity r1200/300:briver s*:v140:bfarmland l1500/300:g0.3 s*:X r1400/300 s300:v100:bsuburb'),
      station('Bruxelles-Midi', 3, 'left', 'city', true),
    ]
  );

  /* --------------------------------------------------------------- 9 paris */
  const paris = makeRoute(
    {
      id: 'paris', kind: 'hst', region: 'Frankräich', cruise: 320, biomes: ['city', 'suburb', 'highspeed', 'farmland'],
      name: { lb: 'TGV Lëtzebuerg – Paräis-Est', de: 'TGV Luxemburg – Paris-Est', en: 'TGV Luxembourg – Paris-Est' },
    },
    [
      station('Lëtzebuerg', 3, 'right', 'city'),
      ...leg(7000, 's400:v100:bcity r1200/300 s500:v160:bsuburb l3000/600:v220 s800:bhighspeed:v300 s*:v320 r6500/1200:g0.8 s350:Br,14,w s*:v320'),
      station('Metz-Ville', 3, 'left', 'city'),
      ...leg(8500, 's500:v160:bsuburb r3500/600:v250 s1000:bhighspeed:v320 s*:v320 l7000/1400:g-0.6 s700:T:v320 s*:v320'),
      station('Champagne-Ardenne TGV', 2, 'right', 'highspeed'),
      ...leg(6500, 's500:v200:bhighspeed s*:v320 r8000/1400:g0.5 s400:Bv,30,w:v320 s*:v320 l4000/900:bsuburb:v250 s500:v160'),
      station('Paris-Est', 3, 'left', 'city', true),
    ]
  );

  const list = [west, south, east, wittlich, north, trier, metz, brussels, paris];

  /* Return direction: every route can also be driven the other way. The id of that direction is `<routeId>~r`; it is derived here (same
     ownership / price / career as the forward route, see TS.routeDir). TS.track.build(def) understands def.reverse + def.base. */
  const REV = '~r';
  const baseId = (id) => (typeof id === 'string' && id.endsWith(REV) ? id.slice(0, -REV.length) : id);
  const isReverse = (id) => typeof id === 'string' && id.endsWith(REV);
  function reverseName(def) {
    const names = def.stations || [];
    const first = names[0];
    const last = names[names.length - 1];
    const out = {};
    ['lb', 'de', 'en'].forEach((lang) => {
      const src = (def.name && def.name[lang]) || (def.name && def.name.en) || def.id;
      const prefix = (src.match(/^(.*?:\s*|TGV\s+)/) || ['', ''])[1];
      out[lang] = first && last ? prefix + last + ' → ' + first : src + ' ←';
    });
    return Object.freeze(out);
  }
  const reversed = new Map();
  function reverseDef(def) {
    if (!reversed.has(def.id)) {
      const r = Object.create(def);   // everything else (layout, length getter, luxtram spec, defaults) is inherited from the forward route
      Object.defineProperties(r, {
        id: { value: def.id + REV, enumerable: true }, name: { value: reverseName(def), enumerable: true },
        stations: { value: Object.freeze((def.stations || []).slice().reverse()), enumerable: true },
        reverse: { value: true, enumerable: true }, base: { value: def, enumerable: true },
      });
      reversed.set(def.id, Object.freeze(r));
    }
    return reversed.get(def.id);
  }
  function makeRoutes(routeList) {
    const byId = routeList.reduce((acc, r) => Object.assign(acc, { [r.id]: r }), {});
    return Object.freeze({
      list: routeList,
      get: (id) => byId[id] || (isReverse(id) && byId[baseId(id)] ? reverseDef(byId[baseId(id)]) : null),
    });
  }

  window.TS.routeDir = Object.freeze({ REV, baseId, isReverse, makeRoutes, reverseDef });
  window.TS.routes = makeRoutes(list);
})();
