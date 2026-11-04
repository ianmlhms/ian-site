/* The full-screen Kaart of Lux Drive: north up, pan with a finger or the mouse, zoom with two fingers, the wheel or the buttons,
 * street names, the car, and a tap on a road puts the car on that road (the caller teleports; this module only reports the tap).
 *
 * The base (woods, fields, town, water) is the shared basemap canvas; the roads come from the shared road index, drawn in
 * three batched strokes per style so that a pan stays smooth on an iPad.  Minor roads and street names appear when zoomed in. */
import { isMajorRoad } from './road-index.js';

const MIN_ZOOM_FIT = 0.9;           // the world fitted to the screen, times this: the farthest view
const MAX_ZOOM = 2.4;               // px per metre: the closest view
const MINOR_FROM = 0.12;            // px per metre: minor roads are drawn from this zoom
const NAMES_FROM = 0.28;            // px per metre: street names from this zoom
const MAJOR_NAMES_FROM = 0.1;       // the main roads get their names earlier
const TOWN_NAMES_UNTIL = 0.35;      // town names fade out when zoomed in
const TAP_MAX_PX = 9;               // a press that moves less than this is a tap
const TAP_MAX_MS = 450;
const PICK_PX = 34;                 // px: how far from a road a tap still picks it
const PICK_MIN_M = 18;              // m: ... and at least this
const WHEEL_STEP = 1.0016;          // per wheel delta unit
const BUTTON_STEP = 1.6;
const REFRESH_MS = 400;             // the car moves on the map while it is open
const FONT = '600 13px ui-rounded, "SF Pro Rounded", "Avenir Next", system-ui, sans-serif';
const COLOUR = Object.freeze({ fill: '#fffaf0', casing: '#6d6657', major: '#ffd27a', motorway: '#f2a14a', text: '#2a2620', halo: 'rgba(255,250,240,0.92)', car: '#e8452c' });

/**
 * @param {{ container: HTMLElement, index, basemap, world: {width:number, depth:number}, places?: Array, onPick: Function, labels: () => object }} options
 */
export function createFullMap({ container, index, basemap, world, places = [], onPick, labels }) {
  const canvas = container.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const view = { cx: world.width / 2, cz: world.depth / 2, zoom: 0.05 };
  let open = false, dirty = false, car = { x: 0, z: 0, heading: 0 }, ping = null, timer = 0;
  const pointers = new Map();
  let gesture = null;

  const minZoom = () => Math.min(canvas.clientWidth / world.width, canvas.clientHeight / world.depth) * MIN_ZOOM_FIT;
  const clampView = () => {
    view.zoom = Math.max(minZoom(), Math.min(MAX_ZOOM, view.zoom));
    view.cx = Math.max(0, Math.min(world.width, view.cx));
    view.cz = Math.max(0, Math.min(world.depth, view.cz));
  };
  const toWorld = (px, py) => ({ x: view.cx + (px - canvas.clientWidth / 2) / view.zoom, z: view.cz + (py - canvas.clientHeight / 2) / view.zoom });
  const request = () => { if (open && !dirty) { dirty = true; requestAnimationFrame(draw); } };

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    clampView();
    request();
  }

  function draw() {
    dirty = false;
    if (!open) return;
    const dpr = canvas.width / Math.max(1, canvas.clientWidth);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#8fa3b0';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(view.zoom, view.zoom);
    ctx.translate(-view.cx, -view.cz);
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = '#9fb184';
    ctx.fillRect(0, 0, world.width, world.depth);
    ctx.drawImage(basemap.canvas, 0, 0, basemap.canvas.width * basemap.cell, basemap.canvas.height * basemap.cell);

    const tl = toWorld(0, 0), br = toWorld(w, h);
    const groups = { minor: [], major: [], motorway: [] };
    const named = new Map();
    const showMinor = view.zoom >= MINOR_FROM;
    index.forEach(tl.x, tl.z, br.x, br.z, (s) => {
      const motorway = s.road.kind === 'motorway' || s.road.kind === 'trunk';
      if (!s.major && !showMinor) return;
      groups[motorway ? 'motorway' : s.major ? 'major' : 'minor'].push(s);
      if (s.name && view.zoom >= (s.major ? MAJOR_NAMES_FROM : NAMES_FROM)) {
        // the label goes on the visible segment nearest to the middle of the screen
        const d = Math.hypot((s.ax + s.bx) / 2 - view.cx, (s.az + s.bz) / 2 - view.cz);
        const prev = named.get(s.road);
        if (!prev || d < prev.d) named.set(s.road, { s, d });
      }
    });
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const px = 1 / view.zoom;
    const stroke = (list, colour, width) => {
      if (!list.length) return;
      ctx.strokeStyle = colour; ctx.lineWidth = width;
      ctx.beginPath();
      for (const s of list) { ctx.moveTo(s.ax, s.az); ctx.lineTo(s.bx, s.bz); }
      ctx.stroke();
    };
    for (const [list, fill, metres, minPx] of [[groups.minor, COLOUR.fill, 6, 2.2], [groups.major, COLOUR.major, 11, 3.4], [groups.motorway, COLOUR.motorway, 16, 4.2]]) {
      const width = Math.max(metres, minPx * px);
      stroke(list, COLOUR.casing, width + 2.2 * px);
      stroke(list, fill, width);
    }

    // the target ping of the last tap
    if (ping) {
      const age = (performance.now() - ping.t) / 700;
      if (age < 1) {
        ctx.strokeStyle = `rgba(232,69,44,${1 - age})`; ctx.lineWidth = 3 * px;
        ctx.beginPath(); ctx.arc(ping.x, ping.z, (10 + 40 * age) * px, 0, Math.PI * 2); ctx.stroke();
        request();
      } else ping = null;
    }
    ctx.restore();

    // the text is drawn in screen space (upright, with a halo)
    ctx.font = FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const taken = [];
    const free = (x, y, tw, th) => {
      for (const r of taken) if (Math.abs(r.x - x) < (r.w + tw) / 2 && Math.abs(r.y - y) < (r.h + th) / 2) return false;
      taken.push({ x, y, w: tw, h: th });
      return true;
    };
    const items = [...named.values()].sort((a, b) => (b.s.major - a.s.major) || (b.s.road.length - a.s.road.length));
    for (const { s } of items) {
      const sx = ((s.ax + s.bx) / 2 - view.cx) * view.zoom + w / 2, sy = ((s.az + s.bz) / 2 - view.cz) * view.zoom + h / 2;
      if (sx < -40 || sy < -20 || sx > w + 40 || sy > h + 20) continue;
      const tw = ctx.measureText(s.name).width;
      const segPx = Math.hypot(s.bx - s.ax, s.bz - s.az) * view.zoom;
      if (segPx < Math.min(tw * 0.7, 90)) continue;                          // the street is shorter than its name
      let angle = Math.atan2(s.bz - s.az, s.bx - s.ax);
      if (angle > Math.PI / 2) angle -= Math.PI; else if (angle < -Math.PI / 2) angle += Math.PI;      // never upside down
      const box = Math.abs(Math.cos(angle)) * tw + Math.abs(Math.sin(angle)) * 14;
      if (!free(sx, sy, box + 6, Math.abs(Math.sin(angle)) * tw + 16)) continue;
      ctx.save();
      ctx.translate(sx, sy); ctx.rotate(angle);
      ctx.lineWidth = 4; ctx.strokeStyle = COLOUR.halo; ctx.strokeText(s.name, 0, 0);
      ctx.fillStyle = COLOUR.text; ctx.fillText(s.name, 0, 0);
      ctx.restore();
    }
    // the towns and the landmarks
    if (view.zoom < TOWN_NAMES_UNTIL) {
      ctx.font = '700 15px ui-rounded, "SF Pro Rounded", "Avenir Next", system-ui, sans-serif';
      for (const p of places) {
        const sx = (p.x - view.cx) * view.zoom + w / 2, sy = (p.z - view.cz) * view.zoom + h / 2;
        if (sx < 0 || sy < 0 || sx > w || sy > h) continue;
        if (!free(sx, sy, ctx.measureText(p.name).width + 8, 20)) continue;
        ctx.lineWidth = 5; ctx.strokeStyle = COLOUR.halo; ctx.strokeText(p.name, sx, sy);
        ctx.fillStyle = '#4a3b2a'; ctx.fillText(p.name, sx, sy);
      }
    }

    // the car: an arrow, drawn last so that nothing covers it
    const cx = (car.x - view.cx) * view.zoom + w / 2, cy = (car.z - view.cz) * view.zoom + h / 2;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(car.heading);
    ctx.fillStyle = COLOUR.car; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-9, 9); ctx.lineTo(-4, 0); ctx.lineTo(-9, -9); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.font = '700 12px ui-rounded, system-ui, sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = COLOUR.halo; ctx.strokeText(labels().here, cx, cy - 22);
    ctx.fillStyle = COLOUR.car; ctx.fillText(labels().here, cx, cy - 22);
  }

  /** Zooms by `factor` keeping the world point under (px, py) where it is. */
  function zoomAt(factor, px, py) {
    const before = toWorld(px, py);
    view.zoom *= factor;
    clampView();
    const after = toWorld(px, py);
    view.cx += before.x - after.x; view.cz += before.z - after.z;
    clampView();
    request();
  }

  function pick(px, py) {
    const at = toWorld(px, py);
    const reach = Math.max(PICK_MIN_M, PICK_PX / view.zoom);
    const hit = index.nearest(at.x, at.z, reach);
    ping = { x: hit ? hit.x : at.x, z: hit ? hit.z : at.z, t: performance.now() };
    request();
    onPick(hit, at);
  }

  // ---- the pointers: one finger pans (or taps), two fingers pinch
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    gesture = pointers.size === 1 ? { x0: e.offsetX, y0: e.offsetY, t0: performance.now(), moved: 0 } : { ...(gesture || {}), pinch: true, moved: 99 };
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const nx = e.offsetX, ny = e.offsetY;
    if (pointers.size === 1) {
      view.cx -= (nx - p.x) / view.zoom; view.cz -= (ny - p.y) / view.zoom;
      clampView();
      if (gesture) gesture.moved = Math.max(gesture.moved, Math.hypot(nx - gesture.x0, ny - gesture.y0));
      request();
    } else if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)[1];
      const d0 = Math.hypot(p.x - other.x, p.y - other.y), d1 = Math.hypot(nx - other.x, ny - other.y);
      if (d0 > 8) zoomAt(d1 / d0, (nx + other.x) / 2, (ny + other.y) / 2);
    }
    p.x = nx; p.y = ny;
  });
  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (wasSingle && gesture && !gesture.pinch && e.type === 'pointerup' && gesture.moved < TAP_MAX_PX && performance.now() - gesture.t0 < TAP_MAX_MS) pick(e.offsetX, e.offsetY);
    if (!pointers.size) gesture = null;
  };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(WHEEL_STEP ** -e.deltaY, e.offsetX, e.offsetY); }, { passive: false });
  container.querySelector('[data-zoom="in"]').addEventListener('click', () => zoomAt(BUTTON_STEP, canvas.clientWidth / 2, canvas.clientHeight / 2));
  container.querySelector('[data-zoom="out"]').addEventListener('click', () => zoomAt(1 / BUTTON_STEP, canvas.clientWidth / 2, canvas.clientHeight / 2));
  window.addEventListener('resize', () => { if (open) resize(); });

  return {
    /** Opens the map on the car (a street-level zoom) and keeps the car's arrow moving. */
    open(state) {
      open = true;
      container.hidden = false;
      car = { x: state.x, z: state.z, heading: state.heading };
      view.cx = state.x; view.cz = state.z; view.zoom = 0.4;
      resize();
      clearInterval(timer);
      timer = setInterval(request, REFRESH_MS);
    },
    close() { open = false; container.hidden = true; clearInterval(timer); pointers.clear(); gesture = null; },
    isOpen: () => open,
    /** The car moves while the map is open (a teleport, or the physics running under a transparent map). */
    setCar(state) { car = { x: state.x, z: state.z, heading: state.heading }; },
    refresh: request,
    view,
  };
}
