# W3 "Small stuff": notes (23 Oct 2026)

Preview: `pb/fouer.html?models=1` (grid) / `&view=single&item=kachel&look=1&level=3&time=night` / `&view=fair&level=4` (all 34 pitches on the real Glacis).
Extra params: `fouerQ=low|medium|high`, `far=1`, `big=0` (skip W4a's wheel/towers), `spin=0`, `fouerDebug=1`. `window.__fouerModels` is always exposed.
Flow: `scripts/flows/fouer_models.mjs` (`fouer-models`, registered in run_all.mjs). Montages: `website-overnight/reports/fouer/w3/`.

## Files (pb/fouer/models/)
| file | size | what |
|---|---|---|
| kit.js | 40 KB | `Builder`: triangles into 4 channels (solid / lamp / sign / signLit) + swing channel, bulb + fx points, transform stack, primitives (box, cyl, lathe, sphere, blob, beam, gable, hip, valance, scallopRing, pennants, bulbRow/Ring, led/ledRect, sign/mural/lockSign, figure, table, railing, flag), animated `part()`s, level helpers `dressEdge/dressForecourt` |
| materials.js | 8 KB | shared materials (see contract), bulb/fx Points shaders, LED chase shader, chair-swing vertex shader, `setNight(k)` |
| atlas.js | 13 KB | one 2048x1536 CanvasTexture holding every sign / mural (painted procedurally, 3 sign Looks, murals, padlock plate) |
| stalls.js | 49 KB | kachel fritten lous wurscht zocker lukas mandel waffel fesch crepes schiess + museum + lammy (Hämmi statue) + shared stall helpers and the Hämmi sheep |
| rides-small.js | 36 KB | kanner, gold (pioneer carousel), kette (chair swings), bayern, happy, break, musik, takeoff, infinity (fallback, W4a's taller version wins when loaded) |
| npc.js | 28 KB | 17 skins, `buildNpcFair` (212 background stalls), `buildPitchNpc` (NPC stall + padlock for a locked pitch, stand-in for items without a model) |
| props.js | 16 KB | lamps, bulb strings over the Haaptallee + Fressgaass, bins, benches, SE-rim barriers, painted NE portal, SW barrier booms, 5 gate frames (`ENTRANCES` table) |
| fair.js | 16 KB | the fair layer: batching, LOD, live rides, pitch API, `fillShowcase` |
| index.js | 3 KB | registry, `buildModel`, `loadBigModels` (dynamic import of W4a's wheel.js/towers.js; 404s are swallowed) |
| preview.js | 12 KB, selftest.js 4 KB | the `?models=1` page, in-page checks used by the flow |

## Model contract as implemented
`MODELS = { [itemId]: { build(opts) } }`, `opts = { look 0|1|2, level 1..4, quality 'low'|'medium'|'high', seed, far?, lang? }` (`far` = simplified static LOD; `quality:'low'` builds like far).
`build` returns a `THREE.Group` (name = itemId), origin = pitch centre on the ground, +z = front (alley), inside the pitch size of data.js (the test measures real vertices over several animation poses, tolerance 0.15 m).
Geometry is merged per shared material: children `solid`, `lamp`, `sign`, `signLit`, `swing` (meshes) and `bulbs`, `fx` (Points); animated pieces are child groups `part:<name>` (also `userData.parts[name]`, pivot = group origin, nested parts allowed). `userData`: `animate(t, dt, nightK)` (also applied once at t=0 = rest pose), `setNight(k)`, `tris`, `bulbs`, `size`, `height`, `id`, `look`, `level`, `kit:'w3'`, `animated`.
Night convention (W2): `lamp.color` scalar = 0.45 + 0.55 k; lit signs `emissiveIntensity` 0.2 + 0.95 k; bulbs get a halo; `world.setNight(k)` -> `fair.setNight(k)` (the fair registers itself as `world.parts.fair`; `setNight` / `update(dt)` are called by W2's world).
Levels: L1 plain bulbs; L2 lit sign + string lights + flags + second booth; L3 chasing LED outline (shader pulse), figures, railings + queue, steam/fog/sparks; L4 gold trim. Looks change palette + sign painter only.
Names on signs: `STRINGS[lang]['item.<id>']` (lb default). No real brand / showman name anywhere; the mascot is our own sheep Hämmi (statue id stays `lammy` as in data.js).

## For W5 (how the game uses it)
```js
const fair = await createFairLayer({ T, root: renderer.gameRoot, pitches: world.parts.pitches.items, groundY: world.groundY, quality, fieldPoly: world.fieldPoly, world });
world.parts.fair = fair;                       // setNight + dispose are forwarded; call fair.update(dt, camera) from the frame loop
fair.setPitch('P01', { state: 'locked' });     // NPC stall + padlock plate "ab * N" (star from pitches.json)
fair.setPitch('P01', { state: 'open' });       // empty: W2's glowing marker shows
fair.setPitch('P01', { state: 'built', item: 'kachel', look: 1, level: 3 });   // upgrade = same call with a higher level
fair.toNpc('P01');                             // back to the NPC stall (returns the star)
fair.setAll({ P01: {...}, ... });  fair.getPitch(id);  fair.stats();  fair.flush(camera)
```
Items without a registered model (scooter, tent, maus, ... until W4b) get a white hall tent / worksite stand-in of the right pitch size. W4a's models (own materials) are added as opaque groups; the layer drives their `setLOD/setAnimated/animate`. Tap handling stays with W2 (`pitches.pick`). Rebuilds are lazy (next `update`) and cost ~10-30 ms; LOD is re-evaluated every 0.3 s with hysteresis.
Per-pitch model orientation: `face` '+w' yaw 0, '-w' yaw PI, '+u' yaw PI/2 (the layer does it). Entrances are data in `props.js ENTRANCES`; alley corridors in `npc.js CORRIDORS`.

## Numbers (headless Chromium, `fouer-models` flow, iPad-medium profile, field framed)
- W3 share, all 34 pitches at L4 + 212 NPC stalls (125 camelots on the tram lane) + props: **17 draw calls, 55.8k triangles**, same at night (budget 35 / 60k). 3 batches (base 5 draws, pitches 6, frozen rides 6) + 1 bulb Points + 1 fx Points per batch. Whole scene (W2 world + W3 + W4a wheel/towers) 69 draws, 222k tris (builder budget 140 / 300k).
- Close view (dist 60): 3 live rides (limit 10 on medium, 6 low, 40 high), +8 draws, scene 39 draws / 171k tris. Far LOD beyond 80 m (medium; 55 low, 140 high).
- Per model at L4 (near / far LOD): kachel 1.8k/1.0k, fritten 1.4k/0.9k, lous 3.3k/2.0k, wurscht 1.2k/0.7k, zocker 1.9k/1.3k, lukas 1.6k/1.0k, mandel 1.6k/1.0k, waffel 1.8k/1.1k, fesch 2.2k/1.3k, crepes 1.4k/0.9k, schiess 3.2k/2.0k, museum 0.8k/0.5k, lammy 1.2k/0.9k, kanner 2.8k/1.8k, gold 4.1k/1.9k, kette 3.2k/1.7k, bayern 2.6k/1.2k, happy 2.9k/1.7k, break 2.1k/1.5k, musik 2.6k/1.4k, takeoff 2.3k/1.3k, infinity 1.5k/1.0k.
- Sign atlas (2048 x 1536): ~250 slots, ~62 % full when every item at every Look has been built (a normal game page uses about a third). Overflow reuses a blank slot (test asserts none).
- fouer-world flow: its rain check ("denser fog") is flaky when the random start weather is already rain/fog (passes alone, failed once inside run_all); not W3 related.

## Photo comparison verdicts (montages in `website-overnight/reports/fouer/w3/`, file = item name)
| item | reference | verdict |
|---|---|---|
| kachel | food-gromperekichelcher-stall-2017-27 | GOOD: timber canopy packed with small bulbs, orange-red lettering on white fascia, hanging carved plates, sunflowers, fryers + steam, staff vests; night glow lower than the photo (bulb rows only partly visible from this angle) |
| waffel | jean-la-gaufre-waffel-circus-2018-103 | GOOD: white trailer on plate platform, star/heart print, two sign tiers in circus lettering, own crowned Hämmi with a waffle instead of the strawberry; print panel is low-res |
| mandel | roasted-almonds-stall-2017-32 | GOOD: arched green fascia, red lettering, double bulb rows, copper kettles, hanging lamps, banner |
| wurscht | generic-bratwurst-stand-frankfurt | GOOD: hip tile roof, bulb ridge, white sign, red standing tables |
| fritten | generic-fries-baraque-a-frites-dieppe | GOOD: white kiosk, blue pyramid roof with edge, big window, white awning, feather flags |
| zocker | generic-cotton-candy-stall-haagse-kermis-2010 | GOOD: pink/orange booth, striped columns, lettered counter, chaser bulbs, hanging bags, angled wings |
| crepes | generic-bratwurst-stand-frankfurt-waeldchestag-foodbooths | GOOD: timber chalet, shingle roof, griddles, flower boxes |
| lous | generic-losbude-lottery-booth-kaerlich | GOOD: plush wall + hanging plush, bulb header, trailer on plate deck (plush are simple blobs) |
| schiess | generic-schiessbude-shooting-gallery-welser-volksfest | GOOD: double bulb header on red fascia, plush wall, can pyramids, targets |
| lukas | generic-hau-den-lukas-high-striker | needs work: knight cut-out and ladder read right but are crude and short (7 m) |
| fesch | plate photo only | GOOD (no stall photo exists): hut + terrace + fish sign |
| kanner | kids-manege-2018-112 | GOOD: striped tent roof, gilt cornice with painted panels, animals on brass poles, curtains; animals are blocky |
| gold | same, gold palette | GOOD (same model, gold + "Pionéier" plaque) |
| kette | chair-o-planes-2017-08 | GOOD: umbrella canopy with scalloped valance, panels, crown, 24 chairs flying out with speed; lit underside only visible from below |
| break | break-dance-2021-109 | GOOD: stepped plinth, chequer floor, hub + 5 arms with gondola rings, skyline backdrop; no truss gantry |
| takeoff | take-off-2018-106 | GOOD: raised plate platform, blue stairs, tilted spinning arm with 2 x 5 seat pairs, mural wall, ellipse bulb signs |
| happy | happy-sailor-2021-122 | GOOD: step plinth, boats in two bobbing groups on a blue floor, wave canopy with foam, gilded Neptune |
| musik | musik-express-moers-2010 | GOOD: undulating ring (two anti-phase halves), cone hub with medallion fascia + radial bulb ribs |
| bayern | bayern-kurve-2021-103 | GOOD: lozenge pavilion, flag-coloured cars on a blue-white deck |
| infinity | infinity-2018-116 | W4a's tall version is used when loaded; W3's fallback (two A towers, swinging arm + spinning disc, zig-zag LED) is GOOD for an M pitch |
| portal (NE) | entrance-portal-2018-100b | GOOD: own painted artwork (jester, butterflies), wavy top, green lettering, bulbs, pylons |
| camelots | food-camelots-allee-scheffer-2018-120 | needs work: continuous canvas stalls hug the rails on both sides (correct structure, free lane ~7 m) but the tarps are flat colours |
| museum, lammy | no photo | n/a (kiosk with diorama + Hämmi statue on plinth) |
| full fair vs `site-fair-from-ferris-wheel-2025-1` | | needs work: layout, white tent rows, bulb strings and the Grand Théâtre vista match, density is about 60 % of the photo (alleys 12/7 m, stalls simpler); `fair-vs-photo-wheel_day/night.jpg`, `fair-top_night.png` |
Also `looks-neon-retro-night.jpg` (3 Looks), `levels-L1-L4-*.jpg` (4 levels).

## Known gaps
Figures are boxy; plush/bags are low-poly blobs; hall-tent roofs read grey from above in some lighting; the sign atlas is tight if all three Looks of all items are alive at once; no real shadows; NPC stalls are not individually animated; real-iPad speed unverified; the fair view has no crowd (W6). Pitch-less NPC density is limited by the 34 pitches taking most of the field; more skins or a 2nd row behind the S row would add density. Big items (scooter, tent, maus, geister, splash, booster, alpina, looping) are stand-ins until W4b. W4a's models bring their own materials (they cannot be merged into the fair batches, ~4-8 draws each).
