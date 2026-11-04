/* Lux Drive: turns the views of the landmark QA (scripts/luxdrive/look_views.json) into poses for shot.mjs.
 *   node scripts/luxdrive/look_poses.mjs [views.json] [out.json] [name ...]
 * A view: { name, tx, tz, ty (target, m above the ground), dist, bearing (deg: where the camera stands as seen from the target, 0 = east, 90 = south),
 *           height (eye, m above the road), fov, clearance, buildingClearance, sightStop, hide: [mesh name prefixes], free: true }.
 * Unless `free` is set the camera stands ON A ROAD with nothing of the world within `clearance` m and a clear line of sight (pick_pose.mjs: never inside a
 * house or a tree).  `free` puts it dist m from the target at the bearing (turned to the nearest bearing that is not inside a house and has a clear line of sight), `height` above the ground
 * (a drone: for cliffs and valleys without roads).
 * A view nobody can see is an error (listed at the end, exit code 1), never a silent gap. */
import fs from 'node:fs';
import { createPicker } from './pick_pose.mjs';

const [viewsFile = 'scripts/luxdrive/look_views.json', outFile = '-', ...only] = process.argv.slice(2);
const views = JSON.parse(fs.readFileSync(viewsFile, 'utf8')).filter((v) => !only.length || only.includes(v.name));
const picker = await createPicker();
const poses = [], failed = [];
for (const v of views) {
  const common = { name: v.name, at: [v.tx, v.tz, v.ty], fov: v.fov || 55, hide: v.hide || [] };
  if (v.free) {
    // the camera stands dist m from the target at the bearing; when that spot is inside (or within 3 m of) a house, or a house blocks the line of sight, the
    // bearing is turned in steps of 10 degrees until it is free (the first free bearing nearest to the asked one wins)
    const spot = (deg) => { const a = (deg * Math.PI) / 180; return { x: v.tx + Math.cos(a) * v.dist, z: v.tz + Math.sin(a) * v.dist }; };
    let chosen = null;
    for (let turn = 0; turn <= 180 && !chosen; turn += 10) {
      for (const deg of turn === 0 ? [v.bearing] : [v.bearing + turn, v.bearing - turn]) {
        const p = spot(deg), eye = picker.ground(p.x, p.z) + v.height;
        if (picker.index.collide(p.x, p.z, 3)) continue;
        if (!picker.sightClear(p.x, p.z, eye, v.tx, v.tz, picker.ground(v.tx, v.tz) + v.ty, v.sightStop ?? 14)) continue;
        chosen = { deg, ...p };
        break;
      }
    }
    if (!chosen) { failed.push(`${v.name}: no free bearing at ${v.dist} m`); continue; }
    if (chosen.deg !== v.bearing) console.error(`${v.name}: bearing ${v.bearing} -> ${chosen.deg} (a house was in the way)`);
    poses.push({ ...common, x: chosen.x, z: chosen.z, h: v.height });
    continue;
  }
  try {
    const p = picker.pick({ name: v.name, tx: v.tx, tz: v.tz, ty: v.ty, dist: v.dist, bearing: v.bearing ?? null, height: v.height, fov: v.fov, clearance: v.clearance, buildingClearance: v.buildingClearance, sightStop: v.sightStop });
    poses.push({ ...common, x: p.x, z: p.z, h: p.h });
  } catch (error) { failed.push(`${v.name}: ${error.message}`); }
}
const json = JSON.stringify(poses, null, 1);
if (outFile === '-') console.log(json); else fs.writeFileSync(outFile, json);
if (failed.length) { console.error('NO POSE FOR:\n' + failed.join('\n')); process.exit(1); }
