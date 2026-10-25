/* Flow: MTB Mëllerdall "zero holes", browser side. Renders the world from many camera poses (along the trails at rider height, random positions at 1.5-120 m above
 * the ground, the edges and corners of the world, looking outwards) with the sky switched off and the clear colour magenta (?holes=1): any magenta pixel that
 * lies more than 1 degree BELOW the horizon is a hole in the ground (the pure checks of pb/mtb/harness.js prove the geometry; this proves the picture). */
import { runIfMain } from "./lib.mjs";

const PAGE = "/pb/mtb.html?holes=1&q=medium&time=noon&weather=clear";
const POSES = 72;

export const flow = {
  name: "mtb-holes",
  fullChromium: true,
  async run(h) {
    const { page } = h;
    await page.setViewportSize({ width: 640, height: 400 });
    h.step("boot in hole-detector mode");
    await h.goto(PAGE);
    await page.waitForFunction(() => document.documentElement.dataset.mtbReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 120000 });
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "no boot error");

    h.step(`render ${POSES} poses and count magenta pixels below the horizon`);
    await page.evaluate(() => {
      window.__probe = async (poses) => {
      const m = window.__mtb;
      const THREE = window.THREE;
      const gl = m.renderer.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const buf = new Uint8Array(W * H * 4);
      const inv = new THREE.Matrix4();
      const out = { poses: poses.length, holes: 0, worst: [], rendered: 0, minTiles: 1e9 };
      for (const p of poses) {
        const y = m.surface.height(p.x, p.z) + p.up;
        const yr = p.yaw * Math.PI / 180, pr = p.pitch * Math.PI / 180;
        m.setCamera({ x: p.x, y, z: p.z, tx: p.x + Math.cos(yr) * Math.cos(pr) * 50, ty: y + Math.sin(pr) * 50, tz: p.z + Math.sin(yr) * Math.cos(pr) * 50, fov: 70 });
        // wait until the terrain has caught up with the new pose (pending builds) and two frames were drawn
        for (let k = 0; k < 60; k++) { await new Promise((r) => requestAnimationFrame(r)); if (m.terrain.stats.pending === 0 && k >= 2) break; }
        await new Promise((r) => requestAnimationFrame(r));
        m.renderer.render(m.scene, m.camera);
        gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        m.camera.updateMatrixWorld(); inv.copy(m.camera.projectionMatrixInverse);
        let flagged = 0;
        const dir = new THREE.Vector3();
        for (let py = 0; py < H; py += 1) {
          for (let px = 0; px < W; px += 1) {
            const o = (py * W + px) * 4;
            if (buf[o] < 235 || buf[o + 1] > 30 || buf[o + 2] < 235) continue;
            // gl rows start at the bottom
            dir.set((px + 0.5) / W * 2 - 1, (py + 0.5) / H * 2 - 1, 0.5).applyMatrix4(inv).applyMatrix4(m.camera.matrixWorld).sub(m.camera.position).normalize();
            if (dir.y >= -0.0175) continue;
            // a magenta pixel is only a HOLE when its ray meets the ground within 6 km (farther out the land is fogged into the horizon, drawn or not)
            if (((px * 7 + py * 13) % 5) !== 0 && flagged > 40) continue;       // after 40 hits, sample every 5th pixel (keeps the flow quick)
            let t = 4, hit = false;
            while (t < 6000) {
              const x = m.camera.position.x + dir.x * t, z = m.camera.position.z + dir.z * t, yy = m.camera.position.y + dir.y * t;
              if (yy < m.field.baseHeight(x, z) - (1 + 0.004 * t)) { hit = true; break; }     // tolerance: a far, coarse tile may sit below a ridge by its LOD error
              t += Math.max(3, t * 0.04);
            }
            if (hit) flagged++;
          }
        }
        out.rendered++;
        out.minTiles = Math.min(out.minTiles, m.terrain.stats.leaves);
        if (flagged) { out.holes += flagged; out.worst.push({ ...p, flagged }); }
      }
      m.setCamera(null);
      return out;
      };
    });
    const result = await page.evaluate(async (N) => {
      const m = window.__mtb;
      const rng = (() => { let s = 12345; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
      const poses = [];
      const box = { x0: 192, x1: 5632 - 192, z0: 192, z1: 5632 - 192 };
      for (let i = 0; i < 12; i++) { const c = m.centre[Math.floor((i + 0.5) / 12 * m.centre.length)]; poses.push({ x: c[0], z: c[1], up: 1.7, yaw: rng() * 360, pitch: -8 + rng() * 14, kind: "trail" }); }
      for (let i = 0; i < 12; i++) { const c = m.centre[Math.floor((i + 0.5) / 12 * m.centre.length)]; poses.push({ x: c[0], z: c[1], up: 1.7, yaw: 90 + 40 * rng(), pitch: -20 - 20 * rng(), kind: "trail-down" }); }
      while (poses.length < N - 16) poses.push({ x: box.x0 + rng() * (box.x1 - box.x0), z: box.z0 + rng() * (box.z1 - box.z0), up: 1.6 + Math.pow(rng(), 2) * 120, yaw: rng() * 360, pitch: -45 + rng() * 50, kind: "random" });
      for (let i = 0; i < 16; i++) {     // the world edge: stand just inside and look outwards / along the edge
        const side = i % 4, t = rng();
        const p = [{ x: 200, z: 200 + t * 5200, yaw: 180 }, { x: 5432, z: 200 + t * 5200, yaw: 0 }, { x: 200 + t * 5200, z: 200, yaw: 270 }, { x: 200 + t * 5200, z: 5432, yaw: 90 }][side];
        poses.push({ ...p, up: 1.7 + (i % 3) * 25, pitch: -6 + rng() * 6, kind: "edge" });
      }
      return window.__probe(poses);
    }, POSES);
    h.eq(result.rendered, POSES, `${POSES} poses rendered`);
    h.eq(result.holes, 0, `0 hole pixels below the horizon over ${result.rendered} poses${result.holes ? " " + JSON.stringify(result.worst.slice(0, 4)) : ""}`);
    h.expect(result.minTiles > 60, `at least ${result.minTiles} terrain tiles at every pose`);

    h.step("self-test: with one tile removed the detector DOES report holes");
    const hidden = await page.evaluate(async () => {
      const m = window.__mtb;
      const c = m.centre[Math.floor(m.centre.length / 2)];
      const tile = [...m.terrain.tiles.values()].find((t) => t.leaf.size === 32 && c[0] >= t.leaf.x0 && c[0] < t.leaf.x0 + 32 && c[1] >= t.leaf.z0 && c[1] < t.leaf.z0 + 32) || [...m.terrain.tiles.values()].find((t) => t.leaf.size === 32);
      const g = m.surface.height(tile.leaf.x0 + 16, tile.leaf.z0 + 16);
      const keep = tile.mesh;
      keep.visible = false;
      m.forest.group.visible = false;                      // trees must not hide the gap
      const probe = await window.__probe([{ x: tile.leaf.x0 + 16, z: tile.leaf.z0 + 16 - 14, up: 12, yaw: 90, pitch: -50, kind: "selftest" }]);
      keep.visible = true; m.forest.group.visible = true;
      return { holes: probe.holes, g };
    });
    h.expect(hidden.holes > 100, `a missing 32 m tile is seen as ${hidden.holes} hole pixels (the detector works)`);
  },
};

runIfMain(import.meta.url, flow);
