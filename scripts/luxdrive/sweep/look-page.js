/* Lux Drive sweep 2, the code that runs inside the game's page (window.__lux).  Loaded as text by sweep-look.mjs and evaluated once; defines window.__sweep.
 * Every view is rendered twice in hole mode (sky off, magenta clear colour; near plane 0.1 and 0.13: a depth tie flips between the two = z-fighting) and the
 * pixels are read back; the detectors work on those two frames.  Only a flagged frame is rendered a third time (normal sky) and returned as a labelled JPEG. */
window.__sweep = (() => {
  const T = window.THREE;
  const T_ = { holeMin: 30, flickerMin: 120, flickerDiff: 28, grassShare: 0.6, grassMin: 6, paintValid: 12, objectPen: 0.02 };
  const W = 1280, H = 720;
  let m, gl, buf, buf2, inv, dir, shown = 0;
  const hex = (v) => v.toString(16).padStart(2, '0');

  function init() {
    m = window.__lux; gl = m.renderer.getContext();
    m.env.sky.visible = false; m.renderer.setClearColor(0xff00ff, 1);
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    buf = new Uint8Array(w * h * 4); buf2 = new Uint8Array(w * h * 4);
    inv = new T.Matrix4(); dir = new T.Vector3();
    return { w, h };
  }

  /** Lands the car at the point (the game's landCar: hint, reset, hint = car) and builds everything around it at once. */
  function land(p, heading) {
    m.ground.hint(p.hint);
    m.car.reset(p.x, p.z, heading);
    m.ground.hint(m.car.state.y);
    m.terrain.buildAll(p.x, p.z);
    m.city.update(p.x, p.z);
    m.trees.update(p.x, p.z, m.clock(), true);
  }

  async function settle(p) {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const s = m.stats();
      if (i >= 2 && s.pending === 0 && s.cityPending === 0) break;
      m.terrain.update(p.x, p.z);
    }
  }

  const gy = (x, z) => m.ground.height(x, z);

  /** The four views of a point: { name, cam: {x,y,z,tx,ty,tz,fov}, heading } */
  function views(p) {
    const f = [Math.cos(p.yaw), Math.sin(p.yaw)];
    const out = [];
    const chase = (name, head) => {
      const c = [Math.cos(head), Math.sin(head)];
      const cx = p.x - c[0] * 7.2, cz = p.z - c[1] * 7.2;
      const gh = gy(p.x, p.z);
      out.push({ name, head, cam: { x: cx, y: Math.max(gy(cx, cz) + 0.6, gh + 3.1), z: cz, tx: p.x + c[0] * 8, ty: gh + 1.2, tz: p.z + c[1] * 8, fov: 62 } });
    };
    chase('chase-fwd', p.yaw); chase('chase-back', p.yaw + Math.PI);
    const gh = gy(p.x, p.z);
    // side: 1.5 m above the ground, beside the carriageway, looking across and 25 degrees along it (the side that is not inside a solid)
    for (const side of [1, -1]) {
      const nx = -f[1] * side, nz = f[0] * side, d = p.width / 2 + 2.5;
      const cx = p.x + nx * d, cz = p.z + nz * d, cy = gy(cx, cz) + 1.5;
      if (m.collide(cx, cz, 0.6, cy - 0.6)) continue;
      out.push({ name: 'side', head: p.yaw, cam: { x: cx, y: cy, z: cz, tx: p.x + f[0] * 12, ty: gh + 1, tz: p.z + f[1] * 12, fov: 62 } }); break;
    }
    if (p.level !== 'tunnel') out.push({ name: 'top', head: p.yaw, cam: { x: p.x, y: gh + 40, z: p.z, tx: p.x + f[0] * 0.6, ty: gh, tz: p.z + f[1] * 0.6, fov: 62 } });
    return out;
  }

  const lum = (b, o) => (b[o] + b[o + 1] + b[o + 2]) / 3;
  const grassy = (b, o) => b[o + 1] > b[o] * 1.12 + 4 && b[o + 1] > b[o + 2] * 1.25 && b[o + 1] > 50;
  const paint = (b, o) => b[o] > 175 && b[o + 1] > 165 && b[o + 2] > 120 && Math.abs(b[o] - b[o + 1]) < 40;
  const magenta = (b, o) => b[o] > 235 && b[o + 1] < 30 && b[o + 2] > 235;

  /** Projects (x, y, z) to pixel coordinates (gl rows from the bottom); null when behind the camera or off screen. */
  function project(x, y, z) {
    const v = new T.Vector3(x, y, z).project(m.camera);
    if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 0.98 || Math.abs(v.y) > 0.98) return null;
    return [Math.round((v.x * 0.5 + 0.5) * (gl.drawingBufferWidth - 1)), Math.round((v.y * 0.5 + 0.5) * (gl.drawingBufferHeight - 1))];
  }

  function renderRead(near, out) {
    m.camera.near = near; m.camera.updateProjectionMatrix();
    m.renderer.render(m.scene, m.camera);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, out);
  }

  /** Runs the detectors on one view.  Returns the flags: [{ type, score, at: [px, py (gl row)], detail }]. */
  function detect(p, v) {
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, flags = [];
    renderRead(0.1, buf);
    renderRead(0.13, buf2);
    m.camera.near = 0.1; m.camera.updateProjectionMatrix(); m.camera.updateMatrixWorld();
    // --- holes: clear-colour pixels below the horizon whose ray meets the ground within the far plane
    let mag = 0, sx = 0, sy = 0, flicker = 0, fx = 0, fy = 0;
    const holes = [];
    for (let py = 0; py < h; py++) {
      const row = py * w * 4;
      for (let px = 0; px < w; px++) {
        const o = row + px * 4;
        if (magenta(buf, o)) { mag++; if (holes.length < 24 && (px * 7 + py * 13) % 11 === 0) holes.push([px, py]); sx += px; sy += py; }
        const d = Math.abs(buf[o] - buf2[o]) + Math.abs(buf[o + 1] - buf2[o + 1]) + Math.abs(buf[o + 2] - buf2[o + 2]);
        if (d > T_.flickerDiff && !magenta(buf, o) && !magenta(buf2, o)) { flicker++; fx += px; fy += py; }
      }
    }
    if (mag >= T_.holeMin) {
      inv.copy(m.camera.projectionMatrixInverse);
      let real = 0, ex = null;
      for (const [px, py] of holes) {
        dir.set((px + 0.5) / w * 2 - 1, (py + 0.5) / h * 2 - 1, 0.5).applyMatrix4(inv).applyMatrix4(m.camera.matrixWorld).sub(m.camera.position).normalize();
        if (dir.y >= -0.0175) continue;
        let t = 4;
        while (t < m.camera.far) {
          const x = m.camera.position.x + dir.x * t, z = m.camera.position.z + dir.z * t, yy = m.camera.position.y + dir.y * t;
          if (yy < m.field.baseHeight(x, z) - (1 + 0.004 * t)) { real++; if (!ex) ex = [px, py, +dir.y.toFixed(4), Math.round(t), +yy.toFixed(1), +m.field.baseHeight(x, z).toFixed(1)]; break; }
          t += Math.max(3, t * 0.04);
        }
      }
      if (real >= 2) flags.push({ type: 'hole', score: mag / 40, at: [Math.round(sx / mag), Math.round(sy / mag)], detail: `${mag} px, e.g. ${JSON.stringify(ex)}` });
    }
    if (flicker >= T_.flickerMin) flags.push({ type: 'flicker', score: flicker / 250, at: [Math.round(fx / flicker), Math.round(fy / flicker)], detail: `${flicker} px` });
    // --- the lane in the picture: samples along the road's own centre line ahead / around, read from the pixels
    const mid = p.slice.length >> 1, step = v.name === 'top' ? 1 : 1;
    const lo = v.name === 'chase-back' ? mid - 26 : v.name === 'top' ? mid - 8 : mid + (v.name === 'side' ? -6 : 5);
    const hi = v.name === 'chase-back' ? mid - 6 : v.name === 'top' ? mid + 8 : mid + (v.name === 'side' ? 6 : 24);
    let valid = 0, grass = 0, firstGrass = null;
    for (let k = Math.max(0, Math.min(lo, hi)); k <= Math.min(p.slice.length - 1, Math.max(lo, hi)); k += step) {
      const [x, z] = p.slice[k];
      const pix = project(x, m.ground.levelAt(x, z, p.hint > 1e8 ? m.car.state.y : p.hint) + 0.02, z);
      if (!pix) continue;
      const o = (pix[1] * w + pix[0]) * 4;
      if (magenta(buf, o)) continue;
      valid++;
      if (grassy(buf, o)) { grass++; if (!firstGrass) firstGrass = pix; }
    }
    if (valid >= T_.grassMin && grass / valid >= T_.grassShare) flags.push({ type: 'grass', score: 1 + 3 * grass / valid, at: firstGrass, detail: `${grass}/${valid} lane samples green` });
    // --- the lane lines (top view of a marked way, 5.5 m or wider): across the carriageway at 14 places along 28 m, inside its outer 0.6 m, some pixel must be clearly lighter
    // than the asphalt (a dashed centre / lane line).  Samples over a tree, in shade or on a non-road colour are not counted.
    if (v.name === 'top' && p.marked && p.width >= 5.5) {
      const hw = p.width / 2 - 0.6, cross = [];
      let valid = 0;
      for (let k = mid - 14; k <= mid + 14; k += 2) {
        const a = p.slice[Math.max(0, k - 1)], b = p.slice[Math.min(p.slice.length - 1, k + 1)], c = p.slice[k];
        const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / tl, nz = (b[0] - a[0]) / tl;
        const row = [];
        for (let d = -hw; d <= hw; d += 0.2) {
          const x = c[0] + nx * d, z = c[1] + nz * d;
          const pix = project(x, m.ground.levelAt(x, z, p.hint > 1e8 ? m.car.state.y : p.hint) + 0.02, z);
          if (!pix) continue;
          const o = (pix[1] * w + pix[0]) * 4;
          if (magenta(buf, o) || grassy(buf, o)) continue;
          row.push(lum(buf, o));
        }
        if (row.length >= hw * 4) { valid++; cross.push(row); }
      }
      if (valid >= T_.paintValid / 2) {
        const all = cross.flat().sort((q, r) => q - r), med = all[all.length >> 1];
        const bright = all.filter((q) => q > med + 45).length;
        if (bright < 3) flags.push({ type: 'nolines', score: 1.5, at: project(p.x, m.ground.levelAt(p.x, p.z, p.hint > 1e8 ? m.car.state.y : p.hint), p.z), detail: `${bright} light pixels in ${valid} cross-sections (asphalt ${Math.round(med)})` });
      }
    }
    return flags;
  }

  /** Is a body at a lane centre stopped by something?  (the colliders of the game, all lanes of the point) */
  function objectInLane(p) {
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    let best = null;
    for (const off of p.lanes) {
      const x = p.x - sy * off, z = p.z + cy * off;
      m.ground.hint(p.hint > 1e8 ? 1e9 : p.hint);
      const lvl = m.ground.levelAt(x, z, p.hint);
      for (const o of [1.25, -1.25, 0]) {
        const hit = m.collide(x + cy * o, z + sy * o, 0.98, lvl);
        if (hit && (!best || hit.pen > best.pen)) best = { pen: hit.pen, id: hit.id, off, x: x + cy * o, z: z + sy * o, y: lvl };
      }
    }
    return best && best.pen >= T_.objectPen && best.pen <= 2 ? best : null;     // (a penetration over a body diameter is the edge of the play area, not a thing in the lane)
  }

  /** A labelled JPEG of the current view (normal sky), the flag circled.  Returns a data URL. */
  function picture(flag, label) {
    m.env.sky.visible = true; m.renderer.setClearColor(0x9ab6c8, 1);
    m.renderer.render(m.scene, m.camera);
    const c = document.createElement('canvas'); c.width = gl.drawingBufferWidth; c.height = gl.drawingBufferHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(m.renderer.domElement, 0, 0);
    if (flag.at) {
      const x = flag.at[0], y = c.height - flag.at[1];
      ctx.lineWidth = 4; ctx.strokeStyle = '#ff2d2d'; ctx.beginPath(); ctx.arc(x, y, 46, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 50, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(0, 0, c.width, 34);
    ctx.fillStyle = '#fff'; ctx.fillText(label, 10, 25);
    m.env.sky.visible = false; m.renderer.setClearColor(0xff00ff, 1);
    return c.toDataURL('image/jpeg', 0.82);
  }

  /** One point: the object probe and the views.  Returns { flags: [{ type, view, score, detail, image? }], frames }. */
  async function probe(p, wantImages) {
    const out = [];
    let frames = 0;
    land(p, p.yaw);
    await settle(p);
    const obj = objectInLane(p);
    m.ground.hint(m.car.state.y);
    for (const v of views(p)) {
      land(p, v.head);
      m.setCamera(v.cam);
      await new Promise((r) => requestAnimationFrame(r));
      // the terrain follows the camera (its LOD tiles are picked around it): build what the new pose asks for before the picture is judged (as luxdrive_holes.mjs)
      for (let k = 0; k < 800; k++) { m.terrain.update(v.cam.x, v.cam.z); if (m.terrain.stats.pending === 0 && k >= 3) break; }
      for (let k = 0; k < 20 && m.stats().cityPending > 0; k++) await new Promise((r) => requestAnimationFrame(r));
      await new Promise((r) => requestAnimationFrame(r));
      const flags = detect(p, v);
      frames++;
      if (obj && v.name === 'chase-fwd') {
        const pix = project(obj.x, obj.y + 0.5, obj.z);
        flags.push({ type: 'object', score: 2 + obj.pen / 0.2, at: pix, detail: `something solid in lane ${obj.off} (pen ${obj.pen.toFixed(2)} m at ${Math.round(obj.x)}, ${Math.round(obj.z)})` });
      }
      for (const f of flags) {
        const rec = { type: f.type, view: v.name, score: +f.score.toFixed(2), detail: f.detail, at: f.at };
        if (wantImages) rec.image = picture(f, `${f.type.toUpperCase()}  ${p.name || p.kind}  (${Math.round(p.x)}, ${Math.round(p.z)})  ${v.name}  ${f.detail}`);
        out.push(rec);
      }
    }
    m.setCamera(null);
    return { flags: out, frames };
  }

  /** Self-test: with the terrain tile under the point hidden the detector must report a hole (the same check as scripts/flows/luxdrive_holes.mjs). */
  async function selfTest(p) {
    land(p, p.yaw);
    await settle(p);
    const tile = [...m.terrain.tiles.values()].find((t) => p.x >= t.leaf.x0 && p.x < t.leaf.x0 + t.leaf.size && p.z >= t.leaf.z0 && p.z < t.leaf.z0 + t.leaf.size);
    if (!tile) return { ok: false, why: 'no terrain tile under the point' };
    const trees = m.trees.group.visible, city = m.city.group.visible;
    tile.mesh.visible = false; m.trees.group.visible = false; m.city.group.visible = false;
    const f = views(p).find((v) => v.name === 'top');
    m.setCamera(f.cam);
    await new Promise((r) => requestAnimationFrame(r));
    tile.mesh.visible = false;
    const flags = detect(p, f);
    tile.mesh.visible = true; m.trees.group.visible = trees; m.city.group.visible = city; m.setCamera(null);
    return { ok: flags.some((q) => q.type === 'hole'), flags: flags.map((q) => `${q.type} ${q.detail}`) };
  }

  return { init, probe, selfTest, limits: T_ };
})();
