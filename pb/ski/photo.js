/* Photo mode (28 Nov 2026): the game pauses, the HUD is gone, a free orbit camera circles the skier (mouse / touch drag turns, wheel /
 * pinch zooms, two fingers up / down lift the view point), three looks (none / warm / black and white) and "Foto späicheren".
 * Nothing is uploaded: the picture is made in the page (the picture of the game canvas + the look as a pixel pass, PNG via toBlob) and
 * handed to the share sheet on a touch device (iPad Safari), else downloaded; a card shows the picture so it can also be saved with a
 * long press, where neither works. The look on the screen is a CSS filter on the canvas (cheap, compositor), the saved file gets the same
 * look from a pixel pass (Safari has no 2D ctx.filter). Pure orbit maths + DOM, no THREE. */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const LOOKS = Object.freeze([
  { id: 'none', label: 'Keen', css: '' },
  { id: 'warm', label: 'Waarm', css: 'sepia(0.22) saturate(1.3) contrast(1.05) brightness(1.03)' },
  { id: 'bw', label: 'Schwaarz-wäiss', css: 'grayscale(1) contrast(1.12)' },
]);
export const ORBIT = Object.freeze({ distMin: 1.6, distMax: 70, pitchMin: -0.08, pitchMax: 1.45, lookUp: 1.0, liftMin: -0.6, liftMax: 3.2, fov: 50 });

/** The saved picture's look, in place on RGBA bytes (the same idea as the CSS filter above). */
export function applyLookPixels(data, look) {
  if (look === 'bw') {
    for (let i = 0; i < data.length; i += 4) {
      const y = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      const v = clamp((y - 128) * 1.12 + 128, 0, 255);
      data[i] = v; data[i + 1] = v; data[i + 2] = v;
    }
  } else if (look === 'warm') {
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      const sr = y + (r - y) * 1.3, sg = y + (g - y) * 1.3, sb = y + (b - y) * 1.3;
      data[i] = clamp(sr * 1.07 + 3, 0, 255); data[i + 1] = clamp(sg * 1.01, 0, 255); data[i + 2] = clamp(sb * 0.9, 0, 255);
    }
  }
  return data;
}

const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

/** root = #ui; canvas = the game canvas; height(x, z) = the snow; renderNow() draws one frame (so the canvas can be read at once). */
export function createPhoto({ root, canvas, height, blocked = () => false, renderNow, onClose = () => {}, onToast = () => {} }) {
  let on = false, yaw = 0, pitch = 0.5, dist = 6, lift = 0, look = 'none', target = { x: 0, y: 0, z: 0 }, surf = null, bar = null, card = null, cardUrl = null;
  const cam = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: ORBIT.fov };
  const pointers = new Map();
  let pinch0 = 0, dist0 = 0, mid0 = 0, lift0 = 0;

  function applyCss() { const l = LOOKS.find((x) => x.id === look); canvas.style.filter = l && l.css ? l.css : ''; }
  function sync() {
    if (!bar) return;
    for (const b of bar.querySelectorAll('.phlooks button')) b.classList.toggle('on', b.dataset.v === look);
    document.documentElement.dataset.skiPhotoLook = look;
  }
  function setLook(id) { if (!LOOKS.some((l) => l.id === id)) return; look = id; applyCss(); sync(); }

  function closeCard() { if (card) { card.remove(); card = null; } if (cardUrl) { URL.revokeObjectURL(cardUrl); cardUrl = null; } }
  function showCard(blob, name) {
    closeCard();
    cardUrl = URL.createObjectURL(blob);
    card = el(`<div class="card phcard" role="dialog" aria-label="Foto"><h2>Foto</h2><img alt="Dat Foto" src="${cardUrl}"><p class="phhint">Laang op d'Bild drécken, fir et ze späicheren.</p>
      <div class="acts"><button type="button" class="btn primary" data-a="dl">Eroflueden</button><button type="button" class="btn" data-a="x">Zou</button></div></div>`);
    card.querySelector('[data-a="x"]').addEventListener('click', closeCard);
    card.querySelector('[data-a="dl"]').addEventListener('click', () => download(blob, name));
    root.appendChild(card);
    document.documentElement.dataset.skiPhotoSaved = '1';
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  const isTouchDevice = () => (navigator.maxTouchPoints || 0) > 1 && matchMedia('(pointer: coarse)').matches;

  /** The picture of the canvas with the look, as a Blob (null when the canvas cannot be read). */
  function capture() {
    renderNow();                                                     // right now, in this task: the drawing buffer is still readable
    const w = canvas.width, h = canvas.height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: false });
    ctx.drawImage(canvas, 0, 0, w, h);
    if (look !== 'none') { const img = ctx.getImageData(0, 0, w, h); applyLookPixels(img.data, look); ctx.putImageData(img, 0, 0); }
    return new Promise((resolve) => c.toBlob((b) => { c.width = 0; resolve(b); }, 'image/png'));
  }
  async function save() {
    let blob = null;
    try { blob = await capture(); } catch (error) { console.warn('[ski] photo could not be made', error); }
    if (!blob) { onToast('Foto huet net geklappt'); return null; }
    const name = `ski-alpen-${stamp()}.png`;
    let shared = false;
    if (isTouchDevice() && typeof navigator.canShare === 'function' && typeof File === 'function') {
      try {
        const file = new File([blob], name, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'Ski Alpen' }); shared = true; }
      } catch (error) { if (error && error.name === 'AbortError') shared = true; else console.warn('[ski] share failed, using the download', error); }
    }
    if (!shared) download(blob, name);
    showCard(blob, name);
    onToast(shared ? 'Foto gedeelt' : 'Foto gespäichert');
    return { size: blob.size, name, shared };
  }

  function build() {
    const surface = el('<div class="phsurf" aria-label="Foto: zéien fir ze dréinen, zwee Fanger fir ze zoomen"></div>');
    const b = el(`<div class="phbar" role="group" aria-label="Foto"><div class="phrow"><b class="phtitle">📷 Foto</b>
      <div class="seg phlooks" aria-label="Look">${LOOKS.map((l) => `<button type="button" data-v="${l.id}">${l.label}</button>`).join('')}</div></div>
      <div class="phrow"><button type="button" class="btn primary" data-a="save">Foto späicheren</button><button type="button" class="btn" data-a="x">Zou</button></div></div>`);
    b.querySelector('.phlooks').addEventListener('click', (e) => { const x = e.target.closest('button'); if (x) setLook(x.dataset.v); });
    b.querySelector('[data-a="save"]').addEventListener('click', () => { save(); });
    b.querySelector('[data-a="x"]').addEventListener('click', () => api.close());
    // orbit: one pointer turns, two pinch (zoom) and lift
    surface.addEventListener('pointerdown', (e) => {
      try { surface.setPointerCapture(e.pointerId); } catch (error) { /* synthetic pointer */ }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) { const [p, q] = [...pointers.values()]; pinch0 = Math.hypot(p.x - q.x, p.y - q.y) || 1; dist0 = dist; mid0 = (p.y + q.y) / 2; lift0 = lift; }
    });
    surface.addEventListener('pointermove', (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size === 1) { yaw -= dx * 0.0075; pitch = clamp(pitch + dy * 0.006, ORBIT.pitchMin, ORBIT.pitchMax); }
      else if (pointers.size === 2) {
        const [a, c] = [...pointers.values()];
        dist = clamp(dist0 * (pinch0 / (Math.hypot(a.x - c.x, a.y - c.y) || 1)), ORBIT.distMin, ORBIT.distMax);
        lift = clamp(lift0 + (mid0 - (a.y + c.y) / 2) * 0.012, ORBIT.liftMin, ORBIT.liftMax);
      }
    });
    const up = (e) => { pointers.delete(e.pointerId); if (pointers.size === 1) { /* the remaining finger keeps turning */ } };
    surface.addEventListener('pointerup', up); surface.addEventListener('pointercancel', up); surface.addEventListener('lostpointercapture', up);
    surface.addEventListener('wheel', (e) => { e.preventDefault(); dist = clamp(dist * Math.exp(e.deltaY * 0.0012), ORBIT.distMin, ORBIT.distMax); }, { passive: false });
    return { surface, bar: b };
  }
  const onKey = (e) => {
    if (!on) return;
    const c = e.code;
    if (c === 'ArrowLeft') yaw += 0.12; else if (c === 'ArrowRight') yaw -= 0.12;
    else if (c === 'ArrowUp') pitch = clamp(pitch + 0.08, ORBIT.pitchMin, ORBIT.pitchMax); else if (c === 'ArrowDown') pitch = clamp(pitch - 0.08, ORBIT.pitchMin, ORBIT.pitchMax);
    else if (c === 'Equal' || c === 'NumpadAdd') dist = clamp(dist / 1.15, ORBIT.distMin, ORBIT.distMax);
    else if (c === 'Minus' || c === 'NumpadSubtract') dist = clamp(dist * 1.15, ORBIT.distMin, ORBIT.distMax);
    else if (c === 'Enter') save();
    else return;
    e.preventDefault();
  };

  const api = {
    get active() { return on; },
    get look() { return look; },
    get params() { return { yaw, pitch, dist, lift }; },
    setLook,
    orbit(dyaw, dpitch) { yaw += dyaw; pitch = clamp(pitch + dpitch, ORBIT.pitchMin, ORBIT.pitchMax); },
    zoom(factor) { dist = clamp(dist * factor, ORBIT.distMin, ORBIT.distMax); },
    save,
    /** fromCam = the camera that is on the screen now (the orbit starts there); skier = { x, y, z }. */
    open(skier, fromCam) {
      if (on) return false;
      on = true;
      target = { x: skier.x, y: skier.y, z: skier.z };
      const dx = fromCam.x - target.x, dz = fromCam.z - target.z, dy = fromCam.y - (target.y + ORBIT.lookUp);
      const flat = Math.hypot(dx, dz);
      yaw = flat > 0.01 ? Math.atan2(dz, dx) : 0;
      pitch = clamp(Math.atan2(dy, flat || 1), 0.15, 1.0);
      dist = clamp(Math.hypot(dx, dy, dz) || 6, 3.5, 14);
      lift = 0; look = 'none'; pointers.clear();
      const parts = build();
      surf = parts.surface; bar = parts.bar;
      root.appendChild(surf); root.appendChild(bar);
      window.addEventListener('keydown', onKey, true);
      document.documentElement.dataset.skiPhoto = '1';
      applyCss(); sync();
      return true;
    },
    /** The orbit camera for this frame (assign to game.camPose). */
    camera() {
      const ty = target.y + ORBIT.lookUp + lift;
      const cp = Math.cos(pitch), ux = Math.cos(yaw) * cp, uz = Math.sin(yaw) * cp, uy = Math.sin(pitch);
      // never through a wall, a roof or the snow: the boom is shortened to the first thing in the way
      let d = dist;
      for (let t = 0.4; t <= dist; t += 0.4) {
        const px = target.x + ux * t, pz = target.z + uz * t, py = ty + uy * t;
        if (py < height(px, pz) + 0.45 || blocked(px, py, pz)) { d = Math.max(ORBIT.distMin * 0.75, t - 0.8); break; }
      }
      const x = target.x + ux * d, z = target.z + uz * d;
      const y = Math.max(ty + uy * d, height(x, z) + 0.45);
      cam.x = x; cam.y = y; cam.z = z; cam.tx = target.x; cam.ty = ty; cam.tz = target.z; cam.fov = ORBIT.fov;
      return cam;
    },
    close() {
      if (!on) return;
      on = false; pointers.clear();
      closeCard();
      window.removeEventListener('keydown', onKey, true);
      if (surf) { surf.remove(); surf = null; }
      if (bar) { bar.remove(); bar = null; }
      canvas.style.filter = '';
      delete document.documentElement.dataset.skiPhoto; delete document.documentElement.dataset.skiPhotoLook; delete document.documentElement.dataset.skiPhotoSaved;
      onClose();
    },
  };
  return api;
}
