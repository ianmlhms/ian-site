# HANDOFF drive12 (branch `lux-drive-drive12`, merged with lux-drive e94df7fd, main.js ?v=58)

State: DONE (finish 6 Nov 2026, merged with city13, main.js ?v=60) - harness 161 / 161, world / holes (medium, low) / ui / webkit PASS; see PROGRESS "Drive 12" section 5.
Item 1 below is fixed (road-network `stepPlace` / `LANE_KEEP`; T4's route table was wrong and is now the QA's own routes); items 2 - 4 stay open (item 4 is a QA-route artefact).

## What is done
* Every collider of the car answers for the car's level (`car-collide.js`, `level-span.js`): the Pont Rouge drives across; no house / tree / lamp / rail under a deck touches a car on it (T2 = 0, T5).
* No retaining wall's collision block reaches a lane at its level (`lane-clearance.js`, `bake_walls.mjs`): static lane scan 89 road / wall pairs -> 0 (T1), QA wall-pair stops 25 -> 5.
* Pont Adolphe east end: the landmark deck runs over the pit at its end (`decks.js landmarkPit / landmarkPinOut`): axis step 10 cm -> passes Q1, lanes 69 -> 22 cm.
* Harness T (`harness-drive12.js`).

## What is open (do this next)
1. **R3 / T4: the two-level faces in the lanes.**  Where two carriageways overlap in plan (Merl link beside the A4 3116,9975; A6 deck 241 at Croix de Gasperich 1971,11619;
   way 301 at 4877,12243) the wall the bake put on the step stood in a lane - an invisible wall that stopped the car (QA3 N3-W01).  drive12 takes the wall out of the lane, and now
   the car's outer wheels meet the steep face itself (R3 roll 0.749 rad; T4 p09 / p12 stopped by the ground).  The structural fix is in `road-network.js`: the step face between two
   levels (surface11 `stepShape` / the face pass) must not lie inside a lane of either carriageway - put it at the outer lane's edge + the car's clearance (the narrower of the two
   overlapping OSM widths gives way; surface11 noted the real cutting slope lies on the A4 side), then re-bake walls (`node scripts/luxdrive/bake_walls.mjs`) so the wall stands
   on the moved face and clears the lane.  Do NOT put the walls back into the lanes and do NOT relax R3 / T4.
   Measure with `harness.js --only=R,T,K` (~20 min) and `~/Library/Caches/luxdrive-work/drive12/tools/lanes.mjs` (the full lane scan, ~16 min).
2. Houses in lanes on narrow streets (1097 pairs, lane scan `drive12/out/lanes_v55.json`): a road width / footprint question; no gate yet.
3. T3 ratchet 13 (decks 59, 169, 197); decks 204 / 169 / 167 / 64 steps 12 - 16 cm in the every-lane carry.
4. Rue de Neudorf 3 -> 2 lanes at one node without a taper (r07_1: the car runs onto the pavement and a lamp).

## Tools
`~/Library/Caches/luxdrive-work/drive12/tools/`: `drive.mjs <job.json> <out.json> [names]` (the QA's drive in Node, names the collider that stopped the car; REPO=<tree>),
`gameworld.mjs`, `lanes.mjs`, `deckend.mjs <deck> <end> [offsets]`, `q3.mjs` (DECKS=, AXIS=1), `wallat.mjs x z r`, `waysat.mjs x z r`, `table.py`.
