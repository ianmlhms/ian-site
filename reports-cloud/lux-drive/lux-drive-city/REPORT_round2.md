# Lux Drive city, round 2 (branch claude/lux-drive-city-ettsr2)

Done: building style by quarter (`quarters.js`, `building-style.js`, town façade in `building-material.js`), villages as houses in render, the stick root cause (OSM tree girth divided by 100 twice in `tree-view.js`), neutral darker night (`env.js`) with brighter lamp pools, grass verges in Kirchberg (`world-map.js` near-building mask).
Gates: world PASS, holes PASS (0 px), harness --quick PASS (61/0). Draw calls medium: 102-146.
Pictures: r2_quarters_day.jpg, r2_sticks_verges_night.jpg.

Still wrong / not done (honest):
- Place de l'Europe paving blob: unchanged (it is the pedestrian ways of the data, drivable, width-checked).
- A1 median sawtooth: not touched.
- No mansard geometry: roofs are the LOD2 hip roofs, only coloured dark slate.
- Tall (<=38 m) stone-style blocks on the Boulevard Royal are stone facades with flat roofs; Hamilius is really glass, so this is a judgement call.
- Shop share (34 % of city buildings) is a guess; shopfronts are dark and large.
- Grund street (Rue Munster) not shot; village palette only checked at Niederanven / Senningen / Ernster.
- Lamp-pool final strength not looked at after the last tweak; no GPU / iPad timing.
