/* Flow: Lux Drive "zero holes", browser side.
 *
 * Renders the world from many camera poses (along the roads at car height, random positions 1.6-120 m above the
 * ground, the edges of the world looking outwards) with the sky switched off and the clear colour magenta
 * (?holes=1): a magenta pixel that lies more than 1 degree BELOW the horizon and whose ray meets the ground within
 * the far plane is a hole in the ground.  The pure checks of pb/lux-drive/harness.js prove the geometry; this proves
 * the picture the player sees. */
import { runIfMain } from "./lib.mjs";

const PAGE = "/pb/lux-drive.html?holes=1&q=medium&time=noon&weather=clear";
const POSES = 72;
const WORLD_W = 16896;                    // m: the width of the world box (the x axis runs east)
const WORLD_D = 14848;                    // m: the depth of the world box (the z axis runs south)

export const flow = {
  name: "luxdrive-holes",
  fullChromium: true,
  async run(h) {
    const { page } = h;
    await page.setViewportSize({ width: 640, height: 400 });
    h.step("boot in hole-detector mode");
    await h.goto(PAGE);
    await page.waitForFunction(() => document.documentElement.dataset.luxReady === "1" || document.documentElement.dataset.bootError, null, { timeout: 180000 });
    h.eq(await page.evaluate(() => document.documentElement.dataset.bootError || ""), "", "no boot error");

    h.step(`render ${POSES} poses and count magenta pixels below the horizon`);
    await page.evaluate(() => {
      window.__probe = async (poses) => {
        const m = window.__lux;
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
          // wait until the terrain has caught up with the new pose (the pending builds are done) and two frames were drawn
          for (let k = 0; k < 180; k++) { await new Promise((r) => requestAnimationFrame(r)); if (m.terrain.stats.pending === 0 && k >= 3) break; }
          await new Promise((r) => requestAnimationFrame(r));
          m.renderer.render(m.scene, m.camera);
          gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          m.camera.updateMatrixWorld(); inv.copy(m.camera.projectionMatrixInverse);
          let flagged = 0;
          const dir = new THREE.Vector3();
          for (let py = 0; py < H; py += 1) {
            for (let px = 0; px < W; px += 1) {
              const o = (py * W + px) * 4;
              if (buf[o] < 235 || buf[o + 1] > 30 || buf[o + 2] < 235) continue;      // not the clear colour
              // gl rows start at the bottom
              dir.set((px + 0.5) / W * 2 - 1, (py + 0.5) / H * 2 - 1, 0.5).applyMatrix4(inv).applyMatrix4(m.camera.matrixWorld).sub(m.camera.position).normalize();
              if (dir.y >= -0.0175) continue;                                          // at or above the horizon: that is the sky
              // a magenta pixel is only a HOLE when its ray meets the ground within the far plane (farther out the land is fogged)
              if (((px * 7 + py * 13) % 5) !== 0 && flagged > 40) continue;           // after 40 hits, sample every 5th pixel (keeps the flow quick)
              let t = 4, hit = false;
              while (t < m.camera.far) {
                const x = m.camera.position.x + dir.x * t, z = m.camera.position.z + dir.z * t, yy = m.camera.position.y + dir.y * t;
                if (yy < m.field.baseHeight(x, z) - (1 + 0.004 * t)) { hit = true; break; }   // tolerance: a far, coarse tile may sit below a ridge by its LOD error
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
    const result = await page.evaluate(async ({ N, w, d }) => {
      const m = window.__lux;
      const rng = (() => { let s = 12345; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
      const poses = [];
      // the roads: one pose per way, thinned out so the poses are spread over the whole map
      const net = m.field.network, s = net.samples;
      const kept = [];
      for (let ri = 0; ri < net.roads.length && kept.length < 24; ri++) {
        const first = s.first[ri], count = s.segs[ri];
        if (count < 2) continue;
        const k = first + Math.floor(count / 2);
        const x = s.x[k], z = s.z[k];
        if (kept.some((p) => Math.hypot(p.x - x, p.z - z) < 700)) continue;
        kept.push({ x, z });
        poses.push({ x, z, up: 1.7, yaw: rng() * 360, pitch: -8 + rng() * 14, kind: "road" });
      }
      // random places in the map, 1.6 m to 120 m above the ground
      while (poses.length < N - 24) {
        poses.push({ x: 200 + rng() * (w - 400), z: 200 + rng() * (d - 400), up: 1.6 + Math.pow(rng(), 2) * 120, yaw: rng() * 360, pitch: -45 + rng() * 50, kind: "random" });
      }
      // the edge of the world: stand just inside and look outwards / along the edge
      for (let i = 0; i < 24; i++) {
        const side = i % 4, t = (Math.floor(i / 4) + 0.5) / 6;
        const p = [{ x: 60, z: 60 + t * (d - 120), yaw: 180 }, { x: w - 60, z: 60 + t * (d - 120), yaw: 0 }, { x: 60 + t * (w - 120), z: 60, yaw: 270 }, { x: 60 + t * (w - 120), z: d - 60, yaw: 90 }][side];
        poses.push({ ...p, up: 1.7 + (i % 3) * 25, pitch: -6 + rng() * 6, kind: "edge" });
      }
      return window.__probe(poses);
    }, { N: POSES, w: WORLD_W, d: WORLD_D });
    h.eq(result.rendered, POSES, `${POSES} poses rendered`);
    h.eq(result.holes, 0, `0 hole pixels below the horizon over ${result.rendered} poses${result.holes ? " " + JSON.stringify(result.worst.slice(0, 4)) : ""}`);
    h.expect(result.minTiles > 60, `at least ${result.minTiles} terrain tiles at every pose`);

    h.step("self-test: with one tile removed the detector DOES report holes");
    const hidden = await page.evaluate(async () => {
      const m = window.__lux;
      const tiles = [...m.terrain.tiles.values()];
      const tile = tiles.find((t) => t.leaf.size === 32) || tiles[0];
      const keep = tile.mesh;
      keep.visible = false;
      m.trees.group.visible = false;                       // trees must not hide the gap
      m.city.group.visible = false;
      const probe = await window.__probe([{ x: tile.leaf.x0 + 16, z: tile.leaf.z0 + 16 - 14, up: 12, yaw: 90, pitch: -50, kind: "selftest" }]);
      keep.visible = true; m.trees.group.visible = true; m.city.group.visible = true;
      return { holes: probe.holes, size: tile.leaf.size };
    });
    h.expect(hidden.holes > 100, `a missing ${hidden.size} m tile is seen as ${hidden.holes} hole pixels (the detector works)`);
  },
};

runIfMain(import.meta.url, flow);
