# "Looks" wave: notes (23 Oct 2026)

Reviewer verdict before this wave: the hall tents are plain gabled boxes, the crowd figures are blocky boxes, the stalls are simple boxes, the XL plots look toy-like.
Montages (before / after / reference photo): `website-overnight/reports/fouer/looks/*.jpg`. No photos, no secrets, no network assets in the repo.

## What changed
| # | item | change |
|---|---|---|
| 1 | **Hall tents** | NEW `models/tents.js` `hallTent` (replaces the old box + gable in `npc.js`; used by every NPC hall, the locked L pitches (`hallL`), the XL tent rows (`bigTent`) and the small `tentS`): aluminium posts at every 4.6 m bay, PVC roof panels that sag a little between the frames (4 triangles round a lowered centre), sewn seams over each frame, ridge cap, eave gutters, scalloped fringe along the eaves (3 triangles per scallop), gable end with an aluminium truss (chords, tie beam, king post, struts), a raised lettered panel on a coloured frame with bulb rows, door with a lit inside, coloured skirt and battens on the white wall, optional porch, pennants. Sides are closed (white panels + glowing clear window strip) or open (knee wall, long tables and benches, a bar, a bulb garland under the ridge). 16 % of the tents have coloured stripe panels on the roof. Names: Restaurant, Brasserie, Bierhaus, Crêperie, Café, Fëschstuff, Weinstuff, Grill, Bierstuff, Friture, Fouerfësch, Eisekuch, Zelt, Kachelstuff (no company names). Whites stay HDR on the `fabric` channel (warm glow at night). `far` form: no interior, no fringe, no lattice. 250 / 500 / 800 triangles for a 6 / 12 / 29 m tent. The player's Bierzelt (`hall-tent.js`): sagging roof panels, seams, ridge cap and gutters on nave and aisles, the gable end shows the striped fabric ceiling above a thick aluminium truss (tie beam, king post, struts), battens on the white panels. |
| 2 | **Crowd figures** | `crowd.js` `figureArrays('hi' / 'base')` rewritten: LOD0 294 triangles, LOD1 119 (was 142 / 94): head (8 sides) with a flat face, nose, eyes, hair painted by face + volume, neck, tapered torso with shoulders, pelvis, thigh + shin with a knee, shoes, upper arm + forearm + hand, skirt / dress, hat crown + brim (cap or sun hat), ponytail, long hair panels, hood. Vertex-shader walk cycle: hip and shoulder swing, the knee bends while the leg swings through, the elbow follows; the elderly stoop. Variants per instance (`iVar`, `iVar2`): hair style (short, long, bald, ponytail, puffy), hat, build, skirt / dress, sleeves, shoe colour, jacket / hoodie (hood), stoop. New `makeLook` kind `elder` (grey hair, slower, hats), 18 shirt colours, more hair colours. Carried things in their own instanced mesh (`fouer-crowd-props`, drawn within 24 m): food tray, candy floss, balloons, beer, pushchair (a parent with a pushchair + toddler is a group recipe). Draw calls: hi, lo, props, dots + Hämmi = 5 (was 4). **Fix of an old bug**: the figure shader mirrored the figure (local x / z swapped), so single-sided faces (nose, eyes) were culled and the back of the head showed; the transform is now a proper rotation. Hämmi: smooth shaded, 16 curly tufts, bigger head. |
| 2b | **Parade / ceremony** (`events.js` `createCast`) | Rewritten in rigid parts: tapered limbs with knee and elbow, hands, head with nose and eyes, hair, shoes, 6 instanced meshes (box, low ball, head ball, cylinder, tapered limb, flare). Shepherds: blue smock (flare), straw hat with a red band, red neckerchief with a hanging tie, crook with a hook; brass band: dark blue uniform, peaked cap, epaulettes, trumpets with bells at the mouth, white drums on the chest with sticks; drum major with a tall white shako; mayor with scissors. Sheep: 9 smooth wool tufts + curly body, face with eyes / nose / ears, ribbon. Public API (`addHuman` / `addSheep` / `addProp`, `pose`, `entries`, `flush`) unchanged. |
| 3 | **Stalls** | NEW `models/stallkit.js` `buildStall` (one composer: counter with depth and a steel shelf overhang, lift-up striped awning with scalloped valance on two props, bulb-framed fascia with a lit sign, optional pylon sign, goods on the counter and hanging from the awning, lit display case, menu board, side mural, interior with a lit back wall, trailer chassis with wheels, drawbar and steps; barrel / gable / hip / flat roofs). Used by the NPC skins `trailer`, `kiosk`, `chalet` (flower boxes), `sweets`, `game`, `pizza` (oven), `icecream` (giant cone), `souvenir`, `temple` (columns + pediment), `fisher` (nets, wheels). The cheap `far` form got a front awning. Player stalls: `deck()` now has wheels under the front edge and jack legs (inside the footprint). |
| 4 | **Free plots / XL plots** | `plots.js`: gravel in a NEW `ground` channel / material (`M.ground`, vertex colours + fine procedural grit by world position: no texture, lit by the night light map, own draw call per batch); smooth tonal patches from value noise (no quilt of flat cells), a packed track with two tyre ruts and damp patches. Site equipment at real size: 6 m container, track segments on bearers (3 - 4 high, 9 - 11 m), bundles of steel columns, truck crane with a 14 m telescopic boom, cable drums, a 9 m light tower, portaloos, pallets; M gets a stack + drum, L a container + stack + bundle + tower, XL two containers, three stacks, two bundles, crane, towers. |
| 5 | **Budget** | see below. World: ground decor tier 7 -> 14 m, far terrain stride 2 -> 3, far-ring houses < 180 m2 dropped on medium / low (`world/glacis.js`); walk tiles of the base / pitch batches 4x2 -> 6x2 (`fair.js`). A terrain stride 3 was tried and reverted: it tears the grass at tile edges in the walk. |

## Numbers (headless Chromium 1280 x 800, medium, `renderer.info` of the frame, before = HEAD 35e8a47e)
| scene | before draws / tris | after draws / tris |
|---|---|---|
| builder fresh, day | 58 / 233k | 58 / 226k |
| builder mid (`fillFair(2,3)`), night | 89 / 276k | 90 / 284k |
| builder full (`fillFair(3,5)`), night | 108 / 290k | 108 / 286k |
| walk mid, night (alley start) | 147 / 276k | 172 / 286k |
| walk full, night (alley start) | 172 / 289k | 189 / 290k |
| low, builder full / walk full | 104 / 201k, 164 / 188k | 106 / 206k, 163 / 192k |
| high, builder full / walk full | - | 109 / 314k, 239 / 374k (limits 200 / 700k, 300 / 700k) |
Limits (DESIGN 5, iPad medium): builder 140 / 300k, walk 220 / 300k. Walk draws grew because the base / pitch tiles are 6 x 2 (was 4 x 2), +1 draw for the `ground` material. Figures: +15k triangles in the walk with a full crowd, paid back by the world cuts above. Real-iPad speed is still unverified.

## New API / contracts
- `Builder` channel `'ground'` (`b.quad(..., { ch: 'ground' })`), `M.ground`; `M.all()` includes it.
- `models/tents.js` `hallTent(b, r, w, d, { names, stripes, open: [l, r], porch, accent })`; `models/stallkit.js` `buildStall(b, r, w, d, spec)`, `awning`, `barrel`.
- `crowd.js`: `figureArrays('hi' | 'base')` (info is now `[part, group, tag]` per vertex), `propArrays()`, `FIGURE_SHADERS()` (for previews), `makeLook` kinds `kid | teen | adult | elder`, look fields `sleeves, shoe, cloth, stoop, carry, carryColor`.
- Harness: the figure check now asserts LOD0 200 - 300 and LOD1 90 - 120 triangles (was 60 - 100) and 3 floats of info per vertex.

## Verdict (honest, see the montages)
- Hall tents: from the wheel view and from the alley they now read as real festival hall tents (sewn roof panels, ridge, frames, fringe, lettered gable, lit inside), clearly better than gabled boxes; still stylised low-poly (no billowing PVC, no sponsor banners, the sign atlas text is small).
- Crowd: people, not boxes: proportions, faces, hair, clothing variety, a real stride; kids, elderly, pushchairs, balloons, candy floss, beer. Still flat shaded low-poly (a "good mobile game" level, not photo-real) and the face is two dots and a nose.
- Stalls: the NPC rows have awnings, counters, goods, signs, wheels and murals instead of boxes. The far interior stalls (cheap form) are still simple boxes with an awning; claw machines, popcorn carts and the funhouse / bouncy skins were only lightly touched.
- Plots: the gravel is a believable work yard and the XL plots carry real-size site equipment; the crane and track stacks are chunky.
- Night: tents, stalls and plots take the existing warm light / bloom well; the new fringes and awnings are lit by the bulb rows only (no extra lights).

## Remaining gaps
- `?v=` of `main.js` in `pb/fouer.html` is not bumped here (that file belongs to the other wave): crowd.js / events.js / models changed, so bump it once at release (no module is versioned by itself).
- Prop mesh costs 244 triangles per carrying guest whatever the kind (kinds collapse in the shader); a split per kind would save ~5k in a busy walk for +2 draws.
- The figure `hi` LOD radius is 12 m; the walk camera at 1.65 m sees the faces only to ~8 m.
- Far / interior NPC stalls and the camelot tarps could get one more detail pass; the stripe tents (16 %) are saturated.
- The terrain stride 2 stays; a stride-3 terrain needs the tile-edge seam fixed first (would save ~12k in builder).
- Real-iPad speed unverified.

## Tests
`node pb/fouer/harness.js` 1118 checks pass; `node scripts/flows/run_all.mjs fouer`: 8 / 8 flows pass (world, models, big-models, game, migration, walk, rides, launch; the Lukas / trailer deck wheels stay inside the footprint); `python3 scripts/check_site.py` 0 errors (the old karttracker-privacy orphan warning); `cv_head.py` PROBLEMS: 0.

## Follow-up (night fronts, reviewer round 2)
- **Fronts face the alleys**: checked with the footprint list (`npc.stalls` now carries `k` kind and `f` face): every stall touching the Fressgaass or the Haaptallee faces its alley (21 / 16 / 17 / 16 of them, no exception). The backs the reviewer saw were (a) the back faces of the banner poles (the sign had a dark frame box on its rear), (b) the side walls of stalls seen from the cross alleys / in oblique views, (c) the free plot's crane. New row `F` (front w 32.3, faces -w, depth 8) puts small stalls on the south side of the Fressgaass, where the deep M1 row used to show its backs.
- **Night lighting of every front** (`stallkit.js`): the awning underside is a lit (lamp channel, warm) surface, a bulb row runs along the awning edge (light spill on the counter and the alley through the existing glow map), bulb columns frame the fascia, lit sign, lit menu board, lit interior back wall. The cheap `far` stall now has a lit window, a coloured fascia with a lit name sign and bulb row, a striped awning with a bulb edge. Side walls of every stall got a panel (mural or accent colour with a lit name plate) and two bulbs; carts and cabinets (< 3.6 m) skip the extras. Closed tent windows glow warm. NPC bulbs 2.4k -> 7.1k (glow light map bake 28 ms, once per rebuild).
- **Boxy skins converted to stallkit**: claw machines (cabinets + pylon sign), popcorn carts (trailer with barrel roof), funhouse (ticket stall at the front), bouncy castle (ticket stall), temple, fisher.
- **Stray pole / dark panel**: the pole was the raised crane boom of the open XL plot (now lying low in transport position, red aviation light); the dark panel was the rear of the banner poles' frame box: the back of every banner is now a lit sign too (`clutter.js`).
- **Tents**: roof stripes only on 8 % of the tents and in muted tones.
- **fair.js**: `applySpec` resets `lastLiveKey`, so a rebuilt pit on an unchanged live set is re-evaluated at once (the cause of the frozen rides; the Rides workaround `fair.setQuality(fair.quality())` is harmless).
- **materials.js**: the chair swing shader now raises the chairs (`+= aDepth * (1 - cos)`); the Rides ride camera already computed its rise with the same formula; the kette preview at swing 0.7 shows the chairs out and up with taut chains.
- **plots.js**: the crane edit had swallowed its `const bx` declarations in a comment (`bx is not defined`); fixed. The Lukas deck wheels stay inside the footprint.
- **Budget** (medium, `fillFair(3, 5)`, night): builder 108 draws / 286k, walk 189 / 290k (limit 300k); stalls deeper than 7 m from an alley that the greedy fill places are now drawn in the cheap form (`corridorDist > 7`).
