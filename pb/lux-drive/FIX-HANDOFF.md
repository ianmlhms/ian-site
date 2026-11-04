# lux-drive-fix handoff (branch claude/lux-drive-fix-fm3psx, based on origin/lux-drive)

## Done (committed)
- **Bumpy roads**: `road-bed.js` (new) = Whittaker-smoothed profile + 20 m curvature limiter + junction pins.
  `road-network.js`: beds designed after crossing detection; junction ends share a mean level; side ways pinned to bigger ways;
  `carve` uses the nearest segment per way (+ other arm) and pins the carriageway to the bed, composited by class rank
  (old code summed far segments of the same road, leaking noisy ground onto the road). Config: bedStiffness/bedRelax/bedDeviation.
  Along-road gate passes (worst 2.07 cm / 200 ways).
- **Bugs 2+3 root cause**: `main.js` ran `city.update` at the car, while the shot tool/hole detector hold the camera elsewhere
  -> cheap material near camera (medium) / no houses (low). Now follows the frozen camera like terrain. Not yet verified with shots.
- `harness.js` sections I (smoothness, crossfall, kerb) and J (render lattice per quality) added.

## Still failing / TODO
1. Gate I: crossfall (3 pts, worst 4.9 % on a track at 7460,4580) and kerb height (13 of 6022 off, worst 32 cm) - investigate.
2. Gate J: mesh vs field.height on carriageway off by up to 35 cm at step 1 (probably junction/priority transitions; probe with
   surface.height - field.height around 4274,10220 and 3476,13189).
3. Low quality lattice: config.js QUALITY.low lodScale 0.2/protectedSize 64 gives 4 m lattice from ~26 m. Plan: lodScale 0.4, protectedSize 128; re-check tri budgets in luxdrive_world flow.
4. Flow gates: cell within 100 m of camera uses full material; building triangles within 60 m of camera > 0 at every quality (use __lux.city.group.children, city.material).
5. Before/after shots with grazing light (time=evening), poses in the task; before = git worktree of origin/lux-drive.
6. Re-run ALL gates (harness ~3+ min, luxdrive_world, luxdrive_holes, luxdrive_ui) and record in pb/lux-drive/PROGRESS.md. Full harness not yet run on the new code.
7. Check harness house probes (floating/buried) still pass with the smoother beds (bed may now differ from ground up to bedClamp).
