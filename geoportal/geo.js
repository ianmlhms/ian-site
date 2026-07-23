/* Geoportal Luxembourg — a rebuild of the geoportail.lu viewer on ian.lu.

   Basemaps and raster overlays come from geoportail.lu's open-data WMTS
   (see layers.js). Trail geometry and bus stops are reused from the existing
   ian.lu data: ../kaart/data/*.json and ../moien-stops.json. */
(function () {
  'use strict';

  var LUX_BOUNDS = [[49.44, 5.72], [50.19, 6.53]];
  var COLORS = { hiking: '#2e7d4f', mtb: '#d2691e' };
  var BUS_MIN_ZOOM = 13;   // 2803 stops — only worth drawing once zoomed in
  var MAX_RESULTS = 12;

  var map, t, lang;
  var baseLayers = {}, overlayLayers = {};
  var trailGroups = {}, busLayer = null;
  var routes = [], stops = [], geo = {};
  var measure = { on: false, points: [], line: null, markers: [] };
  var activeBase = 'topo';

  function $(sel) { return document.querySelector(sel); }

  /* ---------------- language ---------------- */

  function detectLang() {
    try {
      var stored = localStorage.getItem('trails_lang');
      if (stored && window.GEO_I18N[stored]) return stored;
    } catch (e) { /* private mode */ }
    var nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
    if (nav === 'lb' || nav === 'de') return 'de';
    if (nav === 'fr') return 'fr';
    return window.GEO_I18N[nav] ? nav : 'en';
  }

  function setLang(next) {
    lang = next;
    t = window.GEO_I18N[next];
    try { localStorage.setItem('trails_lang', next); } catch (e) { /* ignore */ }
    document.documentElement.lang = next;
    renderChrome();
  }

  function renderChrome() {
    $('#title').textContent = t.title;
    $('#subtitle').textContent = t.subtitle;
    document.title = t.title + ' · ian.lu';
    $('#search').placeholder = t.search;
    $('#h-basemap').textContent = t.basemap;
    $('#h-overlays').textContent = t.overlays;
    $('#h-trails').textContent = t.trails;
    $('#h-tools').textContent = t.tools;
    $('#h-coords').textContent = t.coords;
    $('#opacity-label').textContent = t.opacity;
    $('#btn-measure').textContent = '📏 ' + t.measure;
    $('#btn-clear').textContent = '✕ ' + t.clear;
    $('#measure-hint').textContent = t.measureHint;

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.dataset.i18n;
      if (t[key]) el.textContent = t[key];
    });
    document.querySelectorAll('.langs button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.lang === lang);
    });
    var note = $('#busnote');
    if (note) note.textContent = t.busZoom;
  }

  /* ---------------- map + layers ---------------- */

  function initMap() {
    map = L.map('map', { zoomControl: true, minZoom: 8, maxZoom: 19 });

    window.GEO_BASEMAPS.forEach(function (bm) {
      baseLayers[bm.id] = L.tileLayer(bm.src.url, {
        attribution: bm.src.attribution,
        maxZoom: bm.src.maxZoom,
        maxNativeZoom: bm.src.maxZoom
      });
    });
    window.GEO_OVERLAYS.forEach(function (ov) {
      overlayLayers[ov.id] = L.tileLayer(ov.src.url, {
        attribution: ov.src.attribution,
        maxZoom: ov.src.maxZoom,
        maxNativeZoom: ov.src.maxZoom,
        opacity: 0.75
      });
    });

    var start = readHash();
    if (start) {
      map.setView([start.lat, start.lon], start.z);
      if (start.base && baseLayers[start.base]) activeBase = start.base;
    } else {
      map.fitBounds(LUX_BOUNDS);
    }
    baseLayers[activeBase].addTo(map);

    map.on('mousemove', function (e) { showCoords(e.latlng); });
    map.on('click', function (e) {
      showCoords(e.latlng);
      if (measure.on) addMeasurePoint(e.latlng);
    });
    map.on('dblclick', function () { if (measure.on) toggleMeasure(false); });
    map.on('moveend zoomend', function () { writeHash(); syncBusVisibility(); });

    addMapButton('◎', function () { map.locate({ setView: true, maxZoom: 15 }); });
  }

  function addMapButton(label, onClick) {
    var Btn = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function () {
        var b = L.DomUtil.create('button', 'map-btn');
        b.type = 'button';
        b.textContent = label;
        L.DomEvent.on(b, 'click', function (e) { L.DomEvent.stop(e); onClick(); });
        return b;
      }
    });
    map.addControl(new Btn());
  }

  function selectBasemap(id) {
    if (!baseLayers[id] || id === activeBase) return;
    map.removeLayer(baseLayers[activeBase]);
    activeBase = id;
    baseLayers[id].addTo(map);
    baseLayers[id].bringToBack();
    writeHash();
  }

  /* ---------------- coordinates ---------------- */

  function showCoords(latlng) {
    var luref = window.wgs84ToLuref(latlng.lat, latlng.lng);
    $('#c-lat').textContent = latlng.lat.toFixed(5);
    $('#c-lon').textContent = latlng.lng.toFixed(5);
    $('#c-e').textContent = Math.round(luref.e).toLocaleString('fr-FR');
    $('#c-n').textContent = Math.round(luref.n).toLocaleString('fr-FR');
    $('#c-zoom').textContent = map.getZoom();
  }

  /* ---------------- trails + bus ---------------- */

  function decodePolyline(str, precision) {
    var factor = Math.pow(10, precision || 5);
    var index = 0, lat = 0, lon = 0, points = [];
    while (index < str.length) {
      var shift = 0, result = 0, byte;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);

      shift = 0; result = 0;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      lon += (result & 1) ? ~(result >> 1) : (result >> 1);

      points.push([lat / factor, lon / factor]);
    }
    return points;
  }

  function buildTrailLayers() {
    ['hiking', 'mtb'].forEach(function (cat) {
      trailGroups[cat] = L.layerGroup();
    });

    routes.forEach(function (route) {
      var encoded = geo[route.cat] && geo[route.cat][route.slug];
      if (!encoded) return;
      var rings = encoded.map(function (r) { return decodePolyline(r); });
      var line = L.polyline(rings, { color: COLORS[route.cat], weight: 3, opacity: 0.9 });
      line.bindPopup(trailPopup(route));
      line.bindTooltip(route.name, { sticky: true, direction: 'top' });
      trailGroups[route.cat].addLayer(line);
    });
  }

  function trailPopup(route) {
    var url = route.url.replace('/de/', '/' + lang + '/');
    var km = route.km.toFixed(1).replace(/\.0$/, '');
    return '<b>' + escapeHtml(route.name) + '</b>'
      + km + ' km · ' + route.gain + ' hm<br>'
      + '<a href="' + url + '">' + escapeHtml(t.openPage) + '</a>';
  }

  function buildBusLayer() {
    busLayer = L.layerGroup();
    var renderer = L.canvas({ padding: 0.3 });
    stops.forEach(function (stop) {
      var marker = L.circleMarker([stop[2], stop[3]], {
        renderer: renderer, radius: 4, weight: 1,
        color: '#1d6fce', fillColor: '#1d6fce', fillOpacity: 0.75
      });
      marker.bindPopup('<b>' + escapeHtml(stop[1]) + '</b>');
      busLayer.addLayer(marker);
    });
  }

  /* Bus stops only render past a zoom threshold — 2803 markers otherwise. */
  function syncBusVisibility() {
    var wanted = $('#ov-bus') && $('#ov-bus').checked;
    var note = $('#busnote');
    if (!busLayer) return;

    if (wanted && map.getZoom() >= BUS_MIN_ZOOM) {
      if (!map.hasLayer(busLayer)) busLayer.addTo(map);
      if (note) note.hidden = true;
    } else {
      if (map.hasLayer(busLayer)) map.removeLayer(busLayer);
      if (note) note.hidden = !wanted;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- measuring ---------------- */

  function toggleMeasure(on) {
    measure.on = on === undefined ? !measure.on : on;
    $('#btn-measure').setAttribute('aria-pressed', String(measure.on));
    $('#measure-hint').hidden = !measure.on;
    map.getContainer().style.cursor = measure.on ? 'crosshair' : '';
    if (measure.on) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }

  function addMeasurePoint(latlng) {
    measure.points.push(latlng);
    var dot = L.circleMarker(latlng, {
      radius: 4, color: '#c62828', fillColor: '#c62828', fillOpacity: 1, weight: 2
    }).addTo(map);
    measure.markers.push(dot);

    if (measure.line) map.removeLayer(measure.line);
    if (measure.points.length > 1) {
      measure.line = L.polyline(measure.points, {
        color: '#c62828', weight: 3, dashArray: '6,5'
      }).addTo(map);
    }
    renderMeasureTotal();
  }

  function renderMeasureTotal() {
    var metres = 0;
    for (var i = 1; i < measure.points.length; i++) {
      metres += measure.points[i - 1].distanceTo(measure.points[i]);
    }
    var box = $('#measure-total');
    if (!measure.points.length) { box.textContent = ''; return; }
    box.textContent = t.total + ': ' + (metres >= 1000
      ? (metres / 1000).toFixed(2) + ' km'
      : Math.round(metres) + ' m');
  }

  function clearMeasure() {
    measure.markers.forEach(function (m) { map.removeLayer(m); });
    if (measure.line) map.removeLayer(measure.line);
    measure.markers = []; measure.points = []; measure.line = null;
    renderMeasureTotal();
    toggleMeasure(false);
  }

  /* ---------------- search ---------------- */

  function runSearch(query) {
    var box = $('#results');
    box.innerHTML = '';
    var q = query.trim().toLowerCase();
    if (q.length < 2) return;

    var hits = [];
    routes.forEach(function (r) {
      if ((r.name + ' ' + r.place).toLowerCase().indexOf(q) !== -1) {
        hits.push({ label: r.name, kind: t[r.cat === 'mtb' ? 'ovMtb' : 'ovHiking'], route: r });
      }
    });
    stops.forEach(function (s) {
      if (s[1].toLowerCase().indexOf(q) !== -1) {
        hits.push({ label: s[1], kind: t.ovBus, latlng: [s[2], s[3]] });
      }
    });

    if (!hits.length) {
      box.innerHTML = '<p class="hint">' + escapeHtml(t.noResults) + '</p>';
      return;
    }

    hits.slice(0, MAX_RESULTS).forEach(function (hit) {
      var btn = document.createElement('button');
      btn.type = 'button';
      var name = document.createElement('span');
      name.textContent = hit.label;
      var kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = ' · ' + hit.kind;
      btn.appendChild(name);
      btn.appendChild(kind);
      btn.addEventListener('click', function () {
        if (hit.latlng) {
          map.setView(hit.latlng, 16);
        } else {
          var enc = geo[hit.route.cat][hit.route.slug];
          var pts = [];
          enc.forEach(function (r) { pts = pts.concat(decodePolyline(r)); });
          map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
          if (!map.hasLayer(trailGroups[hit.route.cat])) {
            var cb = $('#ov-' + hit.route.cat);
            if (cb) { cb.checked = true; trailGroups[hit.route.cat].addTo(map); }
          }
        }
        closePanelOnMobile();
      });
      box.appendChild(btn);
    });
  }

  /* ---------------- permalink ---------------- */

  function writeHash() {
    var c = map.getCenter();
    var hash = '#' + map.getZoom() + '/' + c.lat.toFixed(5) + '/' + c.lng.toFixed(5) + '/' + activeBase;
    history.replaceState(null, '', hash);
  }

  function readHash() {
    var parts = (location.hash || '').replace('#', '').split('/');
    if (parts.length < 3) return null;
    var z = parseInt(parts[0], 10), lat = parseFloat(parts[1]), lon = parseFloat(parts[2]);
    if (isNaN(z) || isNaN(lat) || isNaN(lon)) return null;
    return { z: z, lat: lat, lon: lon, base: parts[3] };
  }

  /* ---------------- panel building ---------------- */

  function buildBasemapList() {
    var box = $('#basemaps');
    window.GEO_BASEMAPS.forEach(function (bm) {
      var label = document.createElement('label');
      label.className = 'opt';
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'basemap';
      input.value = bm.id;
      input.checked = bm.id === activeBase;
      input.addEventListener('change', function () { selectBasemap(bm.id); });
      var span = document.createElement('span');
      span.dataset.i18n = bm.key;
      span.textContent = window.GEO_I18N[lang][bm.key];
      label.appendChild(input);
      label.appendChild(span);
      box.appendChild(label);
    });
  }

  function buildOverlayList() {
    var box = $('#overlays');
    window.GEO_OVERLAYS.forEach(function (ov) {
      var label = document.createElement('label');
      label.className = 'opt';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.addEventListener('change', function () {
        if (input.checked) overlayLayers[ov.id].addTo(map);
        else map.removeLayer(overlayLayers[ov.id]);
      });
      var span = document.createElement('span');
      span.dataset.i18n = ov.key;
      span.textContent = window.GEO_I18N[lang][ov.key];
      label.appendChild(input);
      label.appendChild(span);
      box.appendChild(label);
    });

    $('#opacity').addEventListener('input', function (e) {
      var value = Number(e.target.value) / 100;
      window.GEO_OVERLAYS.forEach(function (ov) { overlayLayers[ov.id].setOpacity(value); });
    });
  }

  function wireTrailToggles() {
    [['hiking', '#ov-hiking'], ['mtb', '#ov-mtb']].forEach(function (pair) {
      var cb = $(pair[1]);
      cb.addEventListener('change', function () {
        if (cb.checked) trailGroups[pair[0]].addTo(map);
        else map.removeLayer(trailGroups[pair[0]]);
      });
    });
    $('#ov-bus').addEventListener('change', syncBusVisibility);
  }

  function closePanelOnMobile() {
    if (window.innerWidth <= 800) $('.panel').classList.remove('open');
  }

  function wireChrome() {
    document.querySelectorAll('.langs button').forEach(function (b) {
      b.addEventListener('click', function () { setLang(b.dataset.lang); });
    });
    $('.menu-toggle').addEventListener('click', function () {
      $('.panel').classList.toggle('open');
    });
    $('#search').addEventListener('input', function (e) { runSearch(e.target.value); });
    $('#btn-measure').addEventListener('click', function () { toggleMeasure(); });
    $('#btn-clear').addEventListener('click', clearMeasure);
  }

  /* ---------------- boot ---------------- */

  function fetchJson(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error(url + ' -> ' + res.status);
      return res.json();
    });
  }

  function boot() {
    lang = detectLang();
    t = window.GEO_I18N[lang];

    initMap();
    buildBasemapList();
    buildOverlayList();
    wireTrailToggles();
    wireChrome();
    renderChrome();
    showCoords(map.getCenter());

    Promise.all([
      fetchJson('../kaart/data/routes.json'),
      fetchJson('../kaart/data/geo-hiking.json'),
      fetchJson('../kaart/data/geo-mtb.json'),
      fetchJson('../moien-stops.json')
    ]).then(function (res) {
      routes = res[0].routes;
      geo.hiking = res[1];
      geo.mtb = res[2];
      stops = res[3];

      buildTrailLayers();
      buildBusLayer();
      trailGroups.hiking.addTo(map);
      $('#ov-hiking').checked = true;

      var el = $('#loading');
      if (el) el.remove();
    }).catch(function (err) {
      var el = $('#loading');
      if (el) el.textContent = t.error;
      if (window.console) console.error('[geoportal]', err);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
