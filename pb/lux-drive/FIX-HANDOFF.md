# lux-drive-fix handoff (branch lux-drive-fix-local, based on origin/lux-drive) - DONE

The work of the cloud session (smooth road beds, the camera-following city) was finished on the Mac mini.  Everything that was on the TODO list is done; the numbers, the gates,
what was narrowed and what is still wrong are in `PROGRESS.md`, section "Road fix".

## Where things are
* `road-bed.js`: Whittaker in arc space, ring design (`closed`), curvature limit, `holdToLand` (bedHardClamp 1 m).  `config.js` ROAD: bedStiffness / bedDeviation (3 cm) / bedHardClamp / bedClamp.
* `road-network.js`: beds designed after crossing detection, junction pins, `PIN_FADE` 3 m, `closed` chains.
* `harness.js`: sections I (smooth roads, bob, crossfall, kerb) and J (render lattice per quality); `--only=I,J` (10 s), `--verbose` lists the offenders.
* `scripts/luxdrive/road_smoothness.mjs <pb/lux-drive/ folder>`: before / after numbers of any checkout.
* `scripts/flows/luxdrive_world.mjs`: the held-camera building gates.
* Pictures: `~/Library/Caches/luxdrive-work/fix/{before,after}-*`.
