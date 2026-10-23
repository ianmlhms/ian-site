# Schueberfouer Tycoon: design document

Status: research + design, 22 Oct 2026. Nothing is built. Branch `fouer` (worktree `/Users/Ian/Library/Caches/website-fouer`).
Reference photos (not in the repo, copyright): `/Users/Ian/Library/Caches/fouer-refs/` (index: `SOURCES.md`).
OSM raw data and plots: `/Users/Ian/Library/Caches/fouer-refs/osm/`. Pitch layout proposal: `pb/fouer/pitches.proposal.json`.

## 0. Findings that shape everything (read first)

1. **Nobody has a cloud save of the old park.** `game_saves` has 0 rows with `game_id='park'`, although 33 players have a park score. Cause: the table has `CHECK (pg_column_size(data) <= 8192)` on the *jsonb* value, and a v1 save contains the 1600-number tile array `g`, which is about 19 KB as jsonb (measured: 1600 small ints = 19,208 bytes), although it is only ~5.7 KB as text. Every v1 cloud upsert has been rejected since 14 Sep. Old parks live only in each device's `localStorage` (`pb_save_park`) and, for 4 players, as a published gallery layout (text column, so it fit). Consequences: (a) migration must be client-side from the local blob; (b) there is no stale-cloud-save problem with v1; (c) **v2 must be stored as strings and a few small numbers, never number arrays**, budget 3 KB (hard limit 8192 bytes as jsonb).
2. **Numbers** (read-only queries, 22 Oct): 33 players with a park score (min 6200 = an untouched park, median 10,259, max 13,362; 17 above 10k; 29 active in the last 30 days, 4 in the last 7), 32 plays in `game-plays.json`, **0 cloud saves**, gallery `park_showcase` = **4 rows** (max layout 3868 chars, max value 8103), `park_likes` = **2 rows**, `game_gifts` = 1 row total.
3. **The Luxtram level already contains the Glacis**: real LiDAR terrain, LOD2 buildings, painted ground, trees, the Grand Théâtre, the Institut/Fondation Pescatore, the Red Bridge, the Theater and Faïencerie tram stops, the tram track, and a first hand-built Schueberfouer landmark (`def('fair', ...)` in `luxtram-landmarks.js`, wheel/drop tower/swing tower/coaster/tents/stalls/gate). Its own side-by-side montage (`website-overnight/reports/train-sim/stations-real/compare/lm2/fair.jpg`) shows what is missing for this game: **real photos are far denser** (packed white tents, rides wall to wall, crowds, LED everywhere); the Luxtram fair is sparse and blocky. Section 4 lists exactly what to reuse.
4. **Real Fouer dates are rule-based and published**: 2025 22 Aug-10 Sep, 2026 21 Aug-9 Sep (684th edition), 2027 **20 Aug-8 Sep** (vdl.lu), 2028 23 Aug-11 Sep. Rule in section 6.

## 1. Pitch and onboarding

**Pitch (one line, lb / de / en)**
- lb: *"Bau deng Plaz op der Schueberfouer op: vum Gromperekichelcher-Stand bis zum Riserad."*
- de: *"Baue deinen Stand auf der echten Schueberfouer auf: vom Kartoffelpuffer-Stand bis zum Riesenrad."*
- en: *"Build your own corner of the real Schueberfouer, from a potato-fritter stall to the big wheel."*

The game is: **the Glacis in Luxembourg, 3 weeks of funfair, you are a showman who rents pitches and builds attractions; the crowd comes and pays; the better your fair, the more stars and the bigger rides you unlock.** Nothing else to learn.

**First 10 seconds** (no menu, no wall of text)
1. 0.0 s: loading bar (Luxtram style, with the Hämmi sheep) while the world bakes in. Skippable art, no text except the game name.
2. 1-3 s: the camera floats in over the Glacis at golden hour (or the player's chosen time, section 4): the Grand Théâtre at the NE end, tram line along the NW edge, a **fully populated fair** (the other 180+ showmen are drawn as static background), ~40 small guests walking the alleys, the Riesenrad pitch under scaffolding with a crane. In front of the camera one pitch is **glowing gold** with a bobbing label.
3. 3 s: Hämmi (the real mascot sheep, a 2-line speech bubble in the chosen language): *"Moien! D'Fouer fänkt un. Dëst ass deng Plaz."* A pulsing finger on the glowing pitch. One button, nothing else on screen except the cash counter and the star bar.

**First 2 minutes: 7 guided steps, each one tap** (coach marks, skippable with one "Ech weess et" link, step stored in the save as `tu`)

| t | Step | What the player does | What the game shows |
|---|---|---|---|
| 0:05 | 1 Build | taps the glowing pitch | menu with **one** card: *Gromperekichelcher, gratis (Kaddo vum Hämmi)* |
| 0:15 | 2 Place | taps "Opbauen" | 3 s build animation (planks pop up, awning unrolls, bulbs switch on one by one, fryer smoke), the first 3 guests turn into the alley and queue |
| 0:30 | 3 First coin | guests pay | coins pop up (+€3), cash counter ticks; Hämmi: *"Gesäis de? D'Leit bezuele."* |
| 0:45 | 4 Second build | taps the next glowing pitch, buys *Kannerkarussell* (€300 of the €350 start cash) | carousel music starts (organ), a second queue |
| 1:15 | 5 Upgrade | taps the stall | a panel with **one big button** "Verbessere (€90)": the stall gets a lit sign, a second fryer and string lights; +income shown as "+€19/min" |
| 1:40 | 6 Goal | reads the goal card | "Ziel: ⭐2, nach 9 Punkten" with a progress bar; first star bonus €200 teased |
| 2:00 | 7 Walk | taps the 👣 button | a 20 s guided walk (first person) to the stall: smell/steam/sound, "Kaaf e Kachelchen" tap; exit with the same button. After this the tutorial ends and only the **goal card** remains (always one visible next goal, dismissable). |

Design rules for "not overwhelmed": at any time the build menu shows only items that are unlocked **and** fit a pitch the player has open; at ⭐1 that is 4 cards. No prices to set, no staff, no paths, no tool modes, no reading. All numbers are in the build/upgrade cards. Language comes from `site_lang` (default lb).

## 2. Core loop and economy

### 2.1 Decision: fixed alleys + rented pitches (NOT free-form building)

| | Free-form (v1 style) | **Fixed pitches (chosen)** |
|---|---|---|
| Fidelity to the real place | player layouts look nothing like the Glacis; "lieblos" risk | the alleys, entrances, restaurant tents in the NW section and the wheel at the SW end are the real plan; every world shot can be photo-compared |
| Onboarding | paths, connections, tools, rotate, "why is nobody coming" (v1's most common confusion: unreachable rides) | one glowing slot, one tap |
| Performance (iPads) | dynamic navmesh, arbitrary draw-call growth | static alley graph, ≤ 34 slots, pre-merged geometry, deterministic crowds |
| Save size | 5.7 KB end game, never fits the DB limit | 2-3 KB |
| Creativity | high | medium: each attraction has 3 free "Look" variants (Traditioun, Neon, Retro), a sign name, and 3 upgrade levels with visible changes; gallery shows the whole fair |
| Real-world feel | the player invents the fair | the player *belongs to* the real Fouer: "one of 214 showmen" |

Risk: v1 fans miss path-building. Mitigation: the migration reward (section 7) and the Looks/names. **Decision: pitches.**

**Verbs (three):** 1. **Opbauen** (tap a glowing pitch, pick a card). 2. **Verbessere** (tap an attraction, one button, 3 levels). 3. **Ëmgesinn** (walk, ride the wheel, photo). Everything else (weather/time, language, sound, gallery, settings) is in one menu and never required.

### 2.2 Pitches ("Plazen")
34 pitches, sizes **S 8x8 m, M 16x16, L 30x18, XL 56x30, W (wheel) 40x24**, in the real-site frame `u,w` (section 4). An attraction fits a pitch of its own size or one larger (the rest is filled with queue barriers/benches). Pitches unlock by fair stars, so the glowing set grows slowly; locked pitches show a generic background stall (so the fair looks full) with a small padlock sign "ab ⭐N". Count by size: 14 S, 11 M, 6 L, 2 XL, 1 W. The 7 real entrances open with the stars (see 4.2): ⭐1 SW, ⭐2 +SE middle, ⭐3 +NE portal, ⭐4 +2, ⭐5 all 7, so each star visibly opens a door and the crowd spreads toward the NE. Unlocked per star: ⭐1 7, ⭐2 +8 (15), ⭐3 +9 (24), ⭐4 +6 (30), ⭐5 +4 (34). Full table in `pb/fouer/pitches.proposal.json` (id, zone, centre, size, star).

### 2.3 Economy (analytic, not an agent simulation)
v1 simulated every guest's needs and queues (229 checks, hard to balance, impossible to extend offline). v2 uses a **fluid model** and uses guests as pure decoration:

- `R` = fair rating points = Σ over built attractions of `appeal x (1 + 0.35 x (level-1))` + pioneer bonus `rb` (section 7). Stars: ⭐1 0, ⭐2 18, ⭐3 70, ⭐4 200, ⭐5 480 points.
- Guests per minute `λ = 6 + 0.55 x R^0.9 + 2 x stars` (hidden; the crowd on screen is `min(1.5 x λ, cap)`).
- Each guest makes 3.6 uses per visit, split 42 % rides, 40 % food, 18 % games.
- Demand of a category is split over its attractions by weight `appeal x (1 + 0.35 x (level-1))`.
- Each attraction serves `min(demand, capacity)`; income per minute = served x price. Unserved demand is shown as a **queue of 5-15 figures and a red clock** on that attraction (the only "problem" signal; the fix is always the same, "Verbessere" or build a second one).
- Upgrade levels: L2 costs 0.6 x base, L3 a further 0.8 x base. Effects L2/L3: capacity x1.5/x2.0, price x1.15/x1.3, appeal x1.35/x1.7, plus visible changes (lights, sign, decorations, paint).
- Max 2 copies of a stall/ride type (keeps variety, rating counts distinct categories).
- Start: €350 cash, a free Gromperekichelcher (gift), 7 pitches. Refund when replacing an attraction: 50 % of its base cost (upgrades lost). Weather/time of day do **not** change income (they are cosmetic and player-chosen).

**Catalogue with numbers** is in section 3. A greedy-optimal bot on this model (`pb/fouer/economy-sim.proposal.py`, to be ported to the JS harness) gives the pacing for **active play**: **⭐2 at ~14 min, ⭐3 at ~36, ⭐4 at ~74, ⭐5 at ~2.4 h**; income €50/min at the start, €660/min at ⭐3, ~€1,900/min at ⭐4, ~€4,300/min at ⭐5. By ~2.5 h the bot owns all 31 items at level 3 and then has **no profitable purchase left** (income saturates at ~€4,700/min because demand `λ` is the limit, not capacity). Real players are 1.5-2x slower and offline time adds on top, so the content lasts a few sessions; the end game needs sinks and goals that are not income (see risks: Looks, gold plaques, a third copy per type, stamps, gallery rank, and a possible later prestige). First-session hook: two buildings in the first 2 minutes, ⭐2 inside the first session.

### 2.4 Offline earnings (idle stickiness, capped)
Reuse `IdleExtras.offline` / `awayRate` / `capHoursFor` from `pb/idle-extras.js` (same maths as the other idle games, so the arcade behaves consistently):
- away rate `min(1, 0.25 + 0.0375 x stars)` = 29-44 % of the live income, cap `min(12, 8 + 0.25 x stars)` h = 8.25-9.25 h;
- also applies to "tab open but untouched for 15 min" (`IdleExtras.activityRate`), so leaving the tab open overnight is no better;
- on return a "Wëllkomm zeréck" card: *"Dei Stänn hu während 6 h 12 min €4,380 verdéngt"* with one **Hol of** button (animated coin rain on the stalls). Never blocks play;
- during the real Fouer period (section 6) the away rate is +10 points and the cap +2 h ("D'Fouer leeft!");
- no real-time paywalls, no notifications.

### 2.5 Score, merge and gifts
- **Score reported to the arcade = `tb` = lifetime Fouer-Wäert** = all € ever earned + `tb0` (pioneer value, section 7). Monotonic, so (a) `window.score = tb`, (b) the existing DB trigger `game_saves_keep_progress` (it protects any save with a numeric `tb`, see `scripts/game-saves-guard-rebirth.sql`) already refuses stale or lower saves, **no SQL change needed**, (c) the client rule "incoming applied only if higher `tb`" is the same as v1's.
- Leaderboard: keep game id `park`; old scores (6k-13k) stay valid; pioneers' `tb0` keeps them above newcomers early (section 7).
- **Gift field**: `gi` = last 50 applied gift ids (same as `IdleExtras.liveGifts`); a gift adds **cash** (never `tb`/stars, as in the idle games: "main balance only"). Wiring in section 8.

## 3. Content list

Names: lb / de / en. **All lb names are drafts for Ian to proofread.** Costs are base (L1) prices in euro; cap = guests per minute at L1; price = euro per use at L1; appeal = rating points at L1; Star = fair stars needed (vouchers ignore it). Pitch size rule: item fits its own size or one larger. Real showmen's company names and trade names seen in the photos (Bellevue, Alpina Bahn, Olympia Looping, Jules Verne Tower, Booster Maxxx, Big Splash, Happy Sailor, Take Off, Infinity, Hangover, Jean la Gaufre...) appear only in the reference columns; in the game the attractions carry **generic names** (open question 2).
Photo filenames are relative to `/Users/Ian/Library/Caches/fouer-refs/`; the full index with licence and author is `SOURCES-rides.md` and `SOURCES-food-site.md`.

### 3.1 Numbers (sim-balanced, see 2.3; 30 items + 3 specials)
| # | id | lb / de / en | Size | Cost | Cap | Price | Appeal | ⭐ | Role |
|---|---|---|---|---|---|---|---|---|---|
| 1 | kachel | Gromperekichelcher / Kartoffelpuffer / Potato fritters | S | 0 (gift) / 150 | 10 | 3 | 3 | 1 | the starter: cheap, fast income, the signature smell |
| 2 | fritten | Fritten / Pommes / Chips | S | 220 | 12 | 3.5 | 3 | 1 | |
| 3 | lous | Lotteriebud / Losbude / Lottery stall | S | 250 | 9 | 3 | 3 | 1 | game |
| 4 | kanner | Kannerkarussell / Kinderkarussell / Kids' carousel | S | 300 | 12 | 2.5 | 4 | 1 | first ride, first music |
| 5 | wurscht | Grillwurscht / Grillwurst / Grilled sausage | S | 480 | 14 | 4 | 4 | 2 | |
| 6 | zocker | Zockerwatt / Zuckerwatte / Candy floss | S | 560 | 12 | 3.5 | 3 | 2 | sweets |
| 7 | lukas | Haut de Lukas / Hau den Lukas / Strength tester | S | 580 | 10 | 3.5 | 4 | 2 | game, bell sound |
| 8 | mandel | Mandelen & Magenbrout / Gebrannte Mandeln & Magenbrot / Roasted almonds & Magenbrot | S | 690 | 12 | 4 | 4 | 2 | sweets |
| 9 | waffel | Eisekuch / Eisenkuchen (Waffeln) / Waffles ("Eisekuch") | S | 750 | 14 | 4.5 | 5 | 2 | sweets, Belgian showman tradition |
| 10 | fesch | Fouerfësch (Backfësch) / Backfisch / Fried fish with chips | M | 800 | 14 | 6 | 6 | 2 | **the** traditional dish (whiting in beer batter, with a beer or dry Moselle) |
| 11 | kette | Kettekarussell / Kettenkarussell / Chair-O-Planes | M | 1,040 | 20 | 4 | 8 | 2 | classic flat ride |
| 12 | scooter | Autoscooter / Autoscooter / Bumper cars | L | 2,070 | 30 | 4.5 | 12 | 2 | big capacity, loud, bright |
| 13 | crepes | Crêpes / Crêpes / Crêpes | S | 1,100 | 12 | 4.5 | 4 | 3 | sweets |
| 14 | schiess | Schéissbud / Schießbude / Shooting gallery | S | 2,040 | 12 | 4 | 6 | 3 | game (plush prizes) |
| 15 | bayern | Bayern-Kurve / Bayern-Kurve / Bayern curve | M | 4,080 | 26 | 5 | 12 | 3 | flat ride |
| 16 | happy | Schëffskarussell / Schiffskarussell / Boat carousel | M | 3,600 | 24 | 5 | 11 | 3 | flat ride |
| 17 | break | Break Dance / Break Dance / Break Dance (generic ride type) | M | 5,440 | 28 | 5.5 | 14 | 3 | flat ride |
| 18 | musik | Musik Express / Musik Express / Music Express | M | 4,400 | 26 | 5 | 12 | 3 | flat ride (German-fair reference photo only) |
| 19 | takeoff | Kippkarussell / Kipp-Fahrgeschäft / Tilt ride | M | 5,000 | 28 | 5.5 | 13 | 3 | flat/tilt ride |
| 20 | tent | Bierzelt a Restaurant / Bierzelt & Restaurant / Beer tent & restaurant | L | 6,120 | 40 | 9 | 14 | 3 | biggest food income, NW row |
| 21 | wheel | **Riserad** / Riesenrad / Big wheel | W | 45,000 | 70 | 7 | 50 | 3 | **the icon**, ride it in walk mode |
| 22 | maus | Wëll Maus / Wilde Maus / Wild Mouse | L | 11,050 | 34 | 6.5 | 20 | 3 | coaster (new in 2026) |
| 23 | geister | Geeschterbunn / Geisterbahn / Ghost train (haunted castle) | L | 18,400 | 36 | 6.5 | 22 | 4 | walk-through |
| 24 | jules | Tuerm-Schaukel / Turmschaukel (Kettenflieger) / Tower swing, 80 m | M | 21,850 | 30 | 7 | 22 | 4 | tall silhouette |
| 25 | hangover | Fallturm / Fallturm / Drop tower, 85 m | M | 24,500 | 30 | 7 | 23 | 4 | tallest thing, LED lines at night |
| 26 | splash | Waasserbunn / Wildwasserbahn / Log flume | L | 27,600 | 40 | 7.5 | 26 | 4 | water, splash particles |
| 27 | booster | Booster / Booster / Giant arm booster, 55 m | L | 32,200 | 34 | 8 | 28 | 4 | spinning arm |
| 28 | alpina | Alpebunn / Alpenbahn / Alpine coaster | XL | 55,200 | 56 | 8 | 40 | 4 | chalet entrance + bears |
| 29 | looping | Looping-Bunn / Looping-Bahn / Five-loop coaster | XL | 100,800 | 60 | 9 | 52 | 5 | end-game trophy |
| 30 | infinity | Pendelarm / Pendelarm / Giant pendulum arm | M | 38,000 | 30 | 8 | 30 | 5 | optional filler (cut first if scope grows) |
| S1 | gold | **Gëllent Karussell** / Goldenes Karussell / Gold carousel | M | pioneer only | 24 | 5 | 6 | - | migration reward, price x2 |
| S2 | museum | Mäin ale Park / Mein alter Park / My old park | S | pioneer only | - | - | 0 | - | diorama kiosk |
| S3 | lammy | Hämmi-Statu / Hämmi-Statue / Hämmi statue | S | stamp reward | - | - | 2 | - | decoration, 10 stamps |

Not in the catalogue on purpose: Toboggan (no reference photo, no Commons image; add later if Ian has photos), Maxi Twister Jump, Aqua Boats, Panamericana, Shaker's, One Man Show (all have good photos and can become "later content" or NPC background rides).

### 3.2 Visible upgrade levels and Looks (one rule set for all items)
- **L1** the plain attraction, white bulbs. **L2** (+0.6 x base): lit sign with the name, string lights, painted facade panels, flags, a second ticket booth/fryer/bar counter, one more animated detail. **L3** (+0.8 x base): full LED outline (chasing colours), mascot/figure props, a bigger forecourt with railings and a plinth, extra effects (steam, fog, sparks). Each level is a swap of a small merged "dressing" mesh on top of the base mesh, not a new model.
- **Looks** (free, per attraction): *Traditioun* (gilt baroque, red/cream), *Neon* (cyan/magenta/violet LED), *Retro* (blue/white Bavarian lozenge, bulbs). A Look changes the palette and 1-2 sign panels only.

### 3.3 Rides: reference photos and model notes
(`rides/` = `/Users/Ian/Library/Caches/fouer-refs/rides/`; G = rated GOOD model reference in `SOURCES-rides.md`)

| Item | Primary / secondary reference | What the modeller must reproduce |
|---|---|---|
| **Riserad "Bellevue"** (50 m) | `riesenrad-bellevue-2017-02.jpg` (G, night, whole wheel), `riesenrad-bellevue-2017-03.jpg` (G, legs), `unknown-schueberfouer-3.jpg` (G, hub), `riesenrad-bellevue-2013-big-wheel.jpg` (G, gondola), `riesenrad-bellevue-2018-102.jpg` (day silhouette), `riesenrad-bellevue-2007-construction.jpg` | double yellow LED rim, about 20 white lattice-truss spokes plus a fine cable web (no solid disc), 40-48 small gondolas (green box, cream band with the lit orange "BELLEVUE" panel, white roof slab), hub = round disc with a cream "B" on an orange dot field in a green LED ring and a sunburst of orange/red LED blades in two lengths, two pairs of A-frame legs wrapped in green/white spiral stripes with cyan LED lines, grey catwalk platforms. Animated: rim+spokes+gondolas (gondolas stay upright), hub light pattern. Day shots show a thinner, unlit version (same silhouette) |
| Wilde Maus | `wild-mouse-2017-15.jpg` (G), `unknown-2018-123.jpg` | lime-yellow tubular tower frame ~20 m, 4 tiers, purple single-rail ladder track with flat 180° hairpins, white 2-3 seat car with a striped nose; giant yellow corn-cob mascot, neon sign, lattice tower with orange bulbs beside it |
| Olympia Looping | `olympia-looping-2021-107.jpg` (G), `-108`, `roller-coaster-2021.jpg` (G, neon-outlined loops at night) | white lattice supports, orange box-profile track, 35 m lift hill, five loops (blue, yellow, black, green, red rings overlapping), flags on every support, next to the Bayern Kurve pavilion |
| Alpina Bahn | `alpina-bahn-2021-115.jpg` (G, chalet), `-117` (G), `fair-q350787-2025.jpg` (track detail) | two-storey Bavarian chalet ticket hall (dark timber, deep eaves with floral bargeboards, flower boxes, balcony with a dancing fibreglass bear in a dirndl), lime-green tubular supports, **blue track with a white diamond pattern**, row of flags (EU, DE, LU, Austrian...), alpine mural panels |
| Jules Verne Tower | `jules-verne-tower-2021-104/105/106.jpg` (G) | 80 m square lattice mast (green with gold bracing), rotating crown with ~12 radial arms carrying paired swing seats on wires, steampunk ticket booth + station deck at the foot |
| Hangover (drop tower) | `hangover-2021-102a.jpg` (G), `power-tower.jpg` (G, LED lines) | 85 m slender white lattice mast with three yellow blocks, maroon/gold flying-saucer seat ring at 2/3 height, purple tubular gate with bulb letters, vertical colour-LED strips (from the Power Tower photo) |
| Booster | `booster-maxxx-2021-119/120.jpg` (G), `booster-maxxx-4g-2018-118.jpg` | slender magenta tower (55 m), long cream box-section arm with oval windows and bulbs, yellow rider pod on the end, comic mural backdrop, hazard-stripe edges |
| Infinity | `infinity-2018-116.jpg` (G) | two magenta A-leg towers (~25 m) with a yellow zig-zag LED line, pale-blue tripod pylon, winged gold sign |
| Big Splash / Waasserbunn | `big-splash-2021-124.jpg` (G), `wildwasser3-log-flume-2007.jpg` | yellow timber-look A-frame lift trestle, white/blue chute, barge-shaped dark-wood boats with Polynesian paint, pool, bulb sign |
| Geeschterbunn | `thriller-2018-110.jpg` (G; the only real Fouer ghost train), `geisterbahn-ghost-train-ibbenbueren-2012-12.jpg` (G, German substitute) | haunted-castle facade of grey ashlar panels, clock tower with jester, green dragon head over the balcony, skulls, a giant hand, airbrushed horror mural, entry ramp |
| Autoscooter | `autoscooter-bumper-cars-2017-11.jpg` (G, interior night), `autoscooter-duelmen-2018-2616.jpg` (G, car profile, German substitute) | metallic silver-blue rounded cars with black rubber ring and a ~3 m pole with a small flag, dark steel floor, mesh ceiling with UV purple/blue lights, mirrored airbrush walls; exterior: boxy hall with a bright front (no day photo exists, reuse the 2017 Luxtram landmark idea of a blue hall with a yellow bulb frieze) |
| Bayern Kurve | `bayern-kurve-2021-103.jpg` (G), `-2017-07.jpg` (G) | open two-seat cars with national flags painted on the shells, chrome seat loops, dark guide rail on a white/blue wooden deck, blue-white lozenge pavilion with a scalloped bulb roof |
| Kettekarussell | `fair-overview-2018-0901-02.jpg` (G), `chair-o-planes-2017-08.jpg` | central column with a painted stage base, ~15 m umbrella canopy of 12 scalloped gabled panels with circus portraits, ~48 chair swings on long chains, gilt "Wellenflug" sign (do not copy the showman's name) |
| Break Dance | `break-dance-2021-109.jpg` (G), `one-man-show-2021-110.jpg` (G) | 15 m round platform with chequerboard floor, stepped red/yellow/orange plinth, hub with 4-5 rotating arms each with 4-6 open coloured gondolas, star-spangled spheres, a huge painted skyline backdrop |
| Take Off | `take-off-2018-106.jpg` (G) | raised grey checker-plate platform with blue stairs, rotating arm with two rows of seats, painted rear wall, gold bulb ellipse sign |
| Happy Sailor | `happy-sailor-2021-122.jpg` (G) | step-plinth, round platform of small striped-sail boats on a blue wavy floor, wave-shaped canopy with white foam bulbs, gilded Neptune at the top |
| Musik Express | `musik-express-moers-2010.jpg` (G, German fair) | undulating round track with ~16 low two-seat cars, central cone canopy with radial bulb ribs, a deep ceiling fascia covered in bulbs with portrait medallions |
| Kannerkarussell | `kids-manege-2018-112.jpg` (G), `panamericana-2021-114.jpg` (G) | ~8 m red/white striped conical tent roof with a gilded finial, ornate gold-and-red scalloped cornice, animals (camel, giraffe, horse) on brass poles |
| Gëllent Karussell | same as Kannerkarussell, gold palette | the pioneer's gold version: gilt animals, gold roof stripes, plaque "Pionéier" |
| Hauptportal (NE end) | `entrance-portal-2018-100b.jpg` (G) | 12 m x 8 m free-standing arch with a wavy scalloped top, fully airbrushed in saturated fantasy artwork (jester, dancer, masks, butterflies) and the green "SCHUEBERFOUER" lettering; a different artwork every year: make a game-specific painted one |

### 3.4 Food, games and shops: reference photos and model notes
(`food/` = `/Users/Ian/Library/Caches/fouer-refs/food/`; "generic" = a non-Luxembourg fair, used only for the shape of the stall type)

| Item | Reference | What the modeller must reproduce |
|---|---|---|
| Gromperekichelcher | `food/food-gromperekichelcher-stall-2017-27.jpg` (stall), `-28` (fryer, golden ~12 cm fritters), `food-gromperekichelcher-plate-fouer-2025-apple-sauce-beer.jpg` (two on a square paper tray with apple sauce and a beer) | chest-high counter with a brushed-metal top on black X-braced trestles, dark timber canopy beams **packed with rows of warm round bare bulbs**, white fascia with orange-red hand-lettered "Gromperekichelcher", small "APFELMUS" sign, carved brown hanging signs, sunflower garlands, steam from the double fryer, staff in orange vests |
| Fouerfësch (Backfësch) | `food/food-fesch-gebak-backfesch-fried-fish.jpg` (plate only: one whole flat fish in glossy golden batter, lettuce, lemon wedge) + the restaurant tent look below | M pitch: a fish-and-chips hut with a menu board, seats, a beer glass or a dry Moselle; the plate is the icon in the build card |
| Eisekuch / Waffel | `food-jean-la-gaufre-waffel-circus-2018-103.jpg` (best full view, daylight), `-waffles-2017-24.jpg` (night facade), `-churros-2017-26.jpg` | white box trailer on a diamond-plate platform, two sign levels, star/heart-printed white cladding, circus lettering, a giant fibreglass mascot (strawberry) holding a waffle: **do not copy the brand**, use a game-own mascot (the Hämmi sheep with a waffle) |
| Mandelen & Magenbrout | `food-roasted-almonds-stall-2017-32.jpg` (night, Art-Nouveau arched fascia with a double row of round bulbs, red 3D letters), `food-magenbrot-pile.jpg` (3-4 cm glazed chocolate-brown rhombus pieces) | curved arched fascia in dark green translucent with red letters and bulb rows, banner listing nuts and Magenbrot, copper kettle for the almonds |
| Grillwurscht | generic: `generic-bratwurst-stand-frankfurt.jpg` (hip-roofed kiosk, ridge bulbs, white arch sign, standing tables) | small hip-roofed kiosk, red-brown tiles, bulb ridge, grill with sausages, red-clothed standing tables |
| Fritten | generic: `generic-fries-baraque-a-frites-dieppe.jpg` (white kiosk, blue pyramidal roof with wave-stripe edge, lift-up awning) | small kiosk, paper cones, sauce pumps |
| Zockerwatt | generic: `generic-cotton-candy-stall-haagse-kermis-2010.jpg` (8 m open booth, pink/orange/yellow, chaser rows of red bulbs, bags hanging) | angled corner wings, red chaser bulbs, bags of candy floss hanging |
| Crêpes | generic: `generic-crepes-stand-making-of-00.jpg` (round cast-iron griddles, rakes, jars), `generic-bratwurst-stand-frankfurt-waeldchestag-foodbooths.jpg` (chalet booth with a "Crêpes" banner) | chalet-style booth with a shingle roof and the griddles in view |
| Lotteriebud | generic: `generic-losbude-lottery-booth-kaerlich.jpg` (ceiling of hanging plush, "everyone gets a consolation prize" sign) | trailer on a diamond-plate platform, counter, ceiling of plush toys, bulb header |
| Schéissbud | generic: `generic-schiessbude-shooting-gallery-welser-volksfest.jpg`, `rides/schiessbude-duelmen-2018-2666.jpg`, `rides/unknown-2017-20.jpg` (genuine Fouer plush-prize gallery) | 8 x 3 m trailer with a double bulb header, plush wall, tin-can pyramids, red chase fascia |
| Haut de Lukas | generic: `generic-hau-den-lukas-high-striker.jpg`, `rides/hau-den-lukas.jpg` | 8 m cut-out knight with a plumed helmet and white moustache on a pole, ladder of rank plates, bell on top, plush prizes |
| Bierzelt a Restaurant | generic interior: `generic-beer-tent-bierzelt-oktoberfest.jpg`; exterior from the 2025 aerials (`site/site-fair-from-ferris-wheel-2025-1..3.jpg`: **white hall tents with gable roofs**, "Crêperie-Ecaillerie Bretonne" lettering on the end wall) | L pitch: 30 x 18 m white hall tent, gabled, large lettered end wall, striped fabric ceiling inside, hanging chandeliers; the real fair has white tents everywhere (also used as NPC filler) |
| NPC filler (no gameplay) | `food-doener-kebab-stall-2017-29a.jpg` (Greek-temple gable), `food-flammlachs-stall-2017-31.jpg` (fisherman's hut with nets and wheels), `food-choucroute-sauerkraut-2017-30.jpg`, `food-street-vendor-stall-2017-22/23.jpg`, `food-camelots-allee-scheffer-2018-120/121.jpg` | 12-15 stall "skins" (chalet, kiosk, hall tent, trailer, themed gable) rotated over ~180 merged NPC stalls; camelot vendors stand **right beside the tram rails on both sides of Allée Scheffer (free lane only ~6 m wide)** |

Not Fouer reality, do not model as such: "Are you lucky?" (2017-21) is an arcade coin-pusher inside a hall, and "Gréngt Spill" (2018-122) is a Bofferding beer hoarding with a funfair skyline silhouette (a nice backdrop banner on a tent end wall, brand-free in our version).

### 3.5 Parade, tram stops, site: reference photos
| Subject | Reference | Notes |
|---|---|---|
| Hämmelsmarsch | `parade/parade-haemmelsmarsch-2019-102.jpg` (shepherds + sheep + band in an alley), `-2019-101/103/104/105/106`, `-2015-1/2/3`, `parade-unknown-band-1909.jpg`, `parade-fontaine-haemmelsmarsch-grand-rue.jpg` | **shepherds in blue farmer's smocks (blouses) with straw hats and red neckerchiefs, leading ~8 sheep on ropes, sheep wearing red-white-light-blue ribbons, a brass band in dark blue behind**, walking under the painted entrance portal; collection by musicians. 1909: band in dark tunics with peaked caps. The Grand-Rue fountain's sculpture is deliberately obscured in the photo (no freedom of panorama): do not copy it |
| Theater tram stop | `site/site-theater-tram-station-2018-07-01.jpg`, `-02` (tram arriving), `site-theater-tram-stop-101..105.jpg`, `site-luxtram-glacis-2019-4.jpg` | glass shelter, thin flat canopy (white underside, dark-grey rounded edge), slim silver posts, two dark perch benches, **charcoal sign "Theater" in white Frutiger-like type**, ticket machine, LED info mast, wisteria/ivy hedge wall behind, pale granite platform with yellow-grey tactile strip, rails flush in a pale granite-sett bed. **The tram has no overhead wire** (catenary-free) |
| Faïencerie stop | `site/site-faiencerie-tram-stop-102/103.jpg` | stop beside the Notre-Dame cemetery: low sandstone plinth with an ornate black iron railing, big tree crowns behind |
| Allée Scheffer | `food/food-camelots-allee-scheffer-2018-120/121.jpg`, `site/site-glacis-allee-scheffer-historic-1914.jpg`, `site-glacis-tram-construction-*.jpg` | tram rails in a pale pea-gravel lane with a narrow concrete edge, stalls right up to the track |
| The empty Glacis | `site/site-glacis-aerial-107.jpg` (drone, Dec 2024, looking NE to Kirchberg), `site-glacis-aerial-inf-2014.jpg`, `site-glacis-parking-1..7.jpg`, `site-fair-from-ferris-wheel-2008-01.jpg` | flat asphalt, **white bay lines stay visible between the rides** in the 2008 photo (keep faint bay lines, remove parked cars), regular plane trees along the NW edge, small white zinc-roofed kiosk at the SW corner |
| Whole fair from the wheel | `site/site-fair-from-ferris-wheel-2025-1/2/3.jpg`, `site-fair-2016-photodudau.jpg` (blue hour), `rides/fair-01-luxembourg-2008.jpg` | the **layout key**: ~100 m wide strip, one straight central alley with a crowd, rows of white hall tents on both sides, tall tower mid-field, coaster at the far NE end, Grand Théâtre lit gold at the end of the vista (2016), Kirchberg towers on the horizon |
| Grand Théâtre | `site/site-grand-theatre-facade-3.jpg` (materials: blue-grey slate crazy-paving, pale precast, pebbles), `-hvplux-theatersquare.jpg`, `site-ville-de-luxembourg-11-grand-theatre.jpg`, `-parvis-fountain.jpg` | long low 1964 block, band of hexagon/rhomboid concrete lattice, glass foyer, flush circular fountain on the parvis; the Luxtram `theatre` landmark already exists |
| Boulevard de la Foire, villas | `site/site-boulevard-de-la-foire-*.jpg`, `site-roudebierg-avenue-faiencerie.jpg` | 3+3 lane road with plane trees, 19th-century villas, an underpass at the NE end |
| Gate and the 2021 look | `rides/entrance-portal-2018-100b.jpg`, `site/site-fun-um-glacis-2021-entrance.jpg` | painted portal (2018) vs a truss gantry with LED screens (2021) |
## 4. World

### 4.1 The real Glacis (facts, OSM way ids, metres)
- Site: *Champ du Glacis*, Limpertsberg, Luxembourg City. Official figures: **4.44 ha, 7 public entrances (E1-E7)**, 214 establishments in 2026 (92 Luxembourg, 55 France, 43 Germany, 24 Belgium, 3 Netherlands; 11 restaurants, 42 savoury and 18 sweet takeaways, 15 confectioners, 15 shooting ranges, 21 game stands, 19 children's rides, 9 flat + 8 elevated rides, 2 rail-guided, 1 bumper-car hall, 6 ghost trains/walk-throughs, 7 arcades). Since 2017 the layout is adapted to the tram; **restaurants and big food outlets sit in the north-west section**, rides/attractions/retail across the rest; vendors ("camelots": nougat, roasted almonds, gadgets) line the Allée Scheffer side.
- OSM: the field is the car park `way 9647317` "Glacis" (parking, 1243 spaces, 2.97 ha, Wikidata Q13102840) plus the bus park `way 49905042` (0.49 ha) at the SW end; the fair adds the strips of sidewalk/verge around them. Raw data: `fouer-refs/osm/glacis_bbox.json` (2.4 km x 0.9 km box, 1392 `building=yes`, 907 trees, roads, tram, parking) and `glacis_around.json`; plots `glacis_overview_enu.png` and `glacis_pitch_layout_proposal.png`.
- Frame used by this game = the **frame of the Luxtram `fair` landmark**: `u` along the tram toward NE, `w` toward Boulevard de la Foire (SE); anchor lat 49.6167784, lon 6.1237435 = (u 140, w 62); `u = 140 + 0.743 E + 0.669 N`, `w = 62 + 0.669 E - 0.743 N` (E,N in metres from the anchor); yaw -0.7335 rad. In this frame the car park polygon spans **u 13-292 (about 280 m) and w 1-138**: it is **100 m wide at the SW end and 135 m at the NE end** (a wedge), the bus park is the annex at u -83..-12, w 14-95.
- Boundaries (u,w): NW **Allée Scheffer + the Luxtram line** at w about -12..4 (tram stops: Faïencerie at the SW corner, Theater at the NE end where the line curves SE; 422 m apart, same as the sim's `s` 8903 -> 8481); NE **Rue des Glacis / Rond-Point Robert Schuman** at u 290-300 with the **Grand Théâtre** (Alain Bourbonnais, 1964: long low block, white colonnade, diamond-panel frieze, lit gold at night) beyond at u 384-492; SE **Boulevard de la Foire / Avenue de la Faïencerie** (4 lanes, plane trees, villas, Institut national des langues, the Pétrusse park behind); SW **Avenue de la Faïencerie** leading to Roudebierg and Place de l'Étoile.
- **Terrain falls about 7 m from the Theater end to the Faïencerie end** (landmark comment); the ground is asphalt, not grass.

### 4.2 Layout plan (what the player sees)
- **Two layers**: (1) the 34 player pitches of `pitches.proposal.json`, (2) the rest of the 4.44 ha filled with **NPC showmen**: ~180 static stalls, white tents, background rides (merged, instanced, no interaction). Locked pitches show an NPC stall and a small padlock sign. This is what makes the fair look like the dense real thing from minute one (the real photos are wall-to-wall tents and rides; the Luxtram landmark is the counter-example).
- **Alleys** (centre lines in `w`): **Allée Scheffer lane** w about -3: the busiest promenade of the real fair (rows of plane trees on both sides, the tram's rails embedded in a pale gravel lane, vendor stalls "camelots" standing right up to the track on both sides, free lane only ~6 m; photos `food-camelots-allee-scheffer-2018-120/121`, `site-fair-from-ferris-wheel-2025-2/3`); *Fressgaass* w 28 (food/restaurants row N faces it); *Haaptallee* w 56-62, 12 m wide, the long straight inner alley; cross alleys at u 66, 130, 190, 250; a service lane at the SE rim behind the rim pitches. Guests walk 2 lanes per alley on this graph. The camelot stalls along the Allée Scheffer lane are NPC filler, not player pitches.
- **Access wave (23 Oct 2026, supersedes the alley list above where they differ)**: the walkway network is data in `pb/fouer/layout.js` (see `ACCESS-NOTES.md`): Haaptallee 12 m (w 50-62), Fressgaass 8 m (w 24-32), a south alley 7 m between the M2 and S rows (w 92/93-100), the Riserad passage and a cross alley through the M2 row (u 58-67, u 171-178), three cross alleys Fressgaass <-> Haaptallee, one entrance lane per gate, a 5.2 m SE service lane, and a **forecourt in front of every pitch** (full width, S 3.5 / M 5.5 / L 7.5 / XL + W 9 m, stretched to the alley when the gap is <= 6.5 m). Nothing of the NPC fair, props, clutter, plots or camelots may stand on any of it; `validateLayout` (harness.js, fouer-access flow) fails loudly with the offending pitch / stall ids.
- **Riserad (Bellevue)**: pitch "W" at the **SW end (u 26-66, w 74-98), beside the Avenue de la Faïencerie junction**; the 2007 assembly photo (`site/site-ferris-wheel-install-2007-city-11.jpg`) shows it behind the field's old sandstone perimeter wall at a signalised junction. Evidence: the four overview photos taken from the wheel (2008, 2016, 2018, 2025; `rides/fair-01-luxembourg-2008.jpg`, `fair-2016.jpg`, `fair-overview-2018-0901-01.jpg`, `site/site-fair-from-ferris-wheel-2025-*.jpg`) all look **along the whole field to the NE**: the central alley, white tents on both sides, the Grand Théâtre at the end of the vista and the Kirchberg towers on the horizon. The Luxtram landmark puts the wheel at the NE end (u 222); that is probably wrong and should be corrected there too.
- **Main gate (the painted 12 x 8 m portal)** at the **NE end** next to the Grand Théâtre forecourt, the Theater stop and the small cream tower pavilion with a steep dark-grey pyramidal roof (first-aid post): seen in the 2008, 2016, 2018 and drone photos (`rides/entrance-portal-2018-100b.jpg`, `site/site-fair-20180901-01.jpg`, `site-glacis-parking-3.jpg`); the Hämmelsmarsch walks in under it (`parade-haemmelsmarsch-2019-102.jpg`). The **SW end** has barrier lanes (red-white booms) at Avenue de la Faïencerie. The Luxtram landmark has its gate at the SW end (u 20): to be corrected. 7 public entrances in total (official); I could not find the city's plan with E1-E7, so the other five are placed at alley mouths on the SE and NW sides (open question 5). In the game the entrances **open progressively with the stars**: ⭐1 SW only, ⭐2 + SE middle, ⭐3 + the NE portal, ⭐4 two more, ⭐5 all seven; so the first minutes have a thin trickle of guests at the SW end near the starter pitches, and each star visibly opens a new door.
- A tall ride sets the skyline in the middle of the field (drop tower, photos 2025), the big coaster at the NE end (Alpina Bahn in the 2025 photos), arm rides near the SE rim.

### 4.3 What the surroundings show (only what is visible from the Glacis; checked in the photos)
| Direction | What is there | Source in the Luxtram level |
|---|---|---|
| NW, along Allée Scheffer | tree-lined avenue, tram, 5-7 storey Limpertsberg blocks | LOD2 + facade atlas tiles, LiDAR trees, OSM roads |
| NE | Rond-Point Robert Schuman, **Grand Théâtre** (forecourt with fountain), Pont Grande-Duchesse Charlotte (Red Bridge, fireworks launch point), Kirchberg towers beyond (4-5 office towers, the European institutions) | landmarks `theatre`, `rouge`, `kad1/kad2/ecj/eca/philharmonie`; `far` ring |
| SE, Boulevard de la Foire | 4-lane road with plane trees and traffic, villas, Institut national des langues + Fondation Pescatore | landmark `institut`, LOD2, OSM roads |
| S / SW | the wooded Pétrusse/Alzette valley and park, Ville-Haute roofs and spires | LiDAR terrain/canopy, `far` tiles |
| Sky | cumulus (2025 photos), sunset gradients, night with lit towers | procedural |

### 4.4 Reuse from the Luxtram world (exact)
Coordinates of the whole Luxtram level: origin lat 49.6055, lon 6.164; scene `x = (lon - 6.164) x 72,064`, `z = -(lat - 49.6055) x 111,194.93` (metres, x east, **z = minus north**); tile index `i = floor(x/128)`, `j = floor(z/128)` (`index.json` v6, `tile: 128`). The Glacis area is **i -26..-20, j -12..-9** (all present).

| What | File / API | Format | Verdict |
|---|---|---|---|
| Terrain (LiDAR 2024, 2-4 m grid) | `pb/train-sim/data/luxtram/h/<i>_<j>.bin` (26 tiles, 104 KB); index `tiles[key] = {step, d}`; reader `decodeHeights` in `luxtram-world.js:285` (zigzag varints, `H0=150`, 5 mm steps) | binary | **Reuse data, port the reader** |
| Painted ground | `.../g/<i>_<j>.bin` (26 tiles, 259 KB): class map PNG (0.5 m/px, 8 classes: asphalt, paving, lawn, meadow, forest, gravel, sett, water) + AO map + OSM vector layers in cm; module `luxtram-ground.js` (`TS.luxGround.create(ctx)`: splat shader, carriageways, 3D kerbs, markings, zebras, parking bays, water) | binary + JS | **Reuse**; add a mask so the Glacis polygon gets **asphalt with faint bay lines but no parked cars** (the 2008 photo shows the white bay lines between the rides) (the generator merges ~11,000 parked cars into car-park tiles). Rebuild with `scripts/build_luxtram_ground.py` for the 7x4 tiles |
| Buildings (national LOD 2.2) | `.../bf/<i>_<j>.bin` (21 tiles, 329 KB) written by `scripts/build_luxtram_facades.py`; reader `TS.luxFacades.create(ctx).parseTile(buf)`, `buildTile(t)` -> one merged mesh per tile with one material (`matWall`, day/mask/lit atlas, `setNight(k)` drives the lit windows) | binary + JS | **Reuse as is.** ctx needs `{T, ox, oz, oy, quality, castShadow, gy, nearest, replacedBy, logBuilding, atStop, sceneRing, localXZ}`: small shims for a static scene. **Drop the 20 m LOD2 "ghost" block on the Glacis** (`FP.fair` lists it) |
| Trees (LiDAR canopy) | `.../t/<i>_<j>.bin` (25 tiles, 8 KB) + `treeTemplate` in `luxtram-world.js` | binary | reuse |
| Skyline (far ring, 640 m tiles, 20 m nodes) | `index.json` `far`, `farTile 640`, `farNode 20`; files `data/luxtram/f/h_<i>_<j>.bin` (heights), `f/c_<i>_<j>.png` (class map), `f/b_<i>_<j>.json` (far buildings); the Glacis is in far tiles i -5, j -3 (and neighbours); loader `startFar` in `luxtram-world.js:971` | binary/PNG/JSON | reuse for Kirchberg and the valley |
| Hand-modelled landmarks | `luxtram-landmarks.js` (322 KB): `def('theatre')` (l. 2030), `def('institut')` (l. 2547), `def('rouge')` (Red Bridge), `def('fair')` (l. 2103, rotating wheel, towers, coaster, tents, gate; **to be replaced**), data `data/luxtram-landmarks.json` (1.8 MB, LOD2 roofs per landmark; the Glacis ones are a small part) | JS closures + JSON | **Do not load the file at runtime** (322 KB, needs the whole `TS` world). Spike in W2: run the landmark builder in Node and **bake** the 3-4 buildings into `glacis-world.bin`; its helper kit (`box`, `beam`, `cylinder`, `prism`, atlas `RECTS`) is also a good start for the new ride models |
| Tram track | `data/luxtram-track.json` (`path` = decimetres, first point absolute then deltas; `stops[{name,s}]`: Theater s 8481, Faïencerie s 8903) and `luxtram-track2.json` (second track) | JSON | reuse: cut out s 8400..8960 |
| Tram vehicle | `trains.js` (CAF Urbos "S.tram": black glazed sides, silver cab shell, C-shaped LED lights, amber destination display, `LUXTRAM` mark) and the **baked oncoming tram of `luxtram-traffic.js` (8 draw calls total)** | JS | W2 spike: reuse the bake if it can be driven on a straight path; else a simple 5-section model (~2k triangles) |
| Tram stop | `stations-luxtram.js` `Theater: {...}`, `Faïencerie` (iron fence) | JS | reuse the shelter design |
| Ground/road generator, LiDAR + LOD2 download | `scripts/fetch_luxtram_*.py`, `build_luxtram_*.py`, `luxtram_geo.py`, raw data in `/Users/Ian/Library/Caches/luxtram-work/raw` (218 MB: LAZ, footprints) | Python | reuse to bake a **Glacis-only** bundle (`scripts/bake_fouer_world.py`) |
| Sky/sun/weather | `landscape.js` (112 KB) | JS | read for ideas; port only dome + rain/fog parameters |
| Env choices | `TS.envChoices` in `copy.js` (weather random/clear/rain/fog/snow; time random/morning/noon/evening/night) | JS | copy the pattern (drop snow) |
| Procedural audio | `pb/train-sim/audio.js` | JS | reuse approach, not code |

Totals for the 7x4 tile window: about 0.5-0.7 MB raw (h 104 KB, g 259 KB, bf 329 KB, t 8 KB); the baked game bundle should stay **<= 700 KB**.

### 4.5 Time of day and weather (player-chosen)
- **Menu and in-game popover** (a small sun/moon button next to the cash counter), remembered per device in `localStorage`: Weather: 🎲 *Random* (default), ☀️ clear, ⛅ cloudy, 🌧️ rain, 🌫️ fog. Time: 🎲 *Random* (default), 🌅 morning (8:00), ☀️ noon (13:00), 🌇 evening (19:30), 🌙 night (22:30), plus 🕒 *Live* (Luxembourg clock). Random = a random start, then a slow drift (a day cycle takes 12 min, weather changes every 4-8 min).
- **Never affects income** (the economy has its own clock); only visuals and sound. So "I always play at night" is a free choice, not a penalty.
- Night is the hero: all stalls/rides switch their bulbs, LED outlines and signs on from ~19:30 (an emissive vertex-colour channel + one additive halo mesh), the facades' lit windows come from the Luxtram `lit` atlas, the Grand Théâtre glows gold, tram windows are lit, the wheel is the beacon. Rain: wet-look (darker, specular) ground, drops, umbrellas on the crowd, canvas rain sound. Fog: dense, the big rides vanish into it, bulbs bloom.

### 4.6 The passing tram
The tram **does run during the fair** (Luxtram runs on **one track at max 20 km/h** between Faïencerie and Theater while the Glacis is set up and open, service until 01:30 / 02:30 at night; ~500k passengers used it during one Fouer, chronicle.lu; `paperjam.lu`). So: one Luxtram every 5-8 min at walking pace on a single track along the NW edge (s 8481-8903 of the sim's track), alternating direction, dwell 20 s at Theater with doors open, bell and chime. **No overhead wire or pantograph** (the Luxtram is catenary-free here, checked in `site/site-theater-tram-station-2018-07-02.jpg`). On Allée Scheffer the rails run in a pale gravel lane with camelot stalls standing right up to the track on both sides (free lane ~6 m, `food/food-camelots-allee-scheffer-2018-120.jpg`), so the tram visibly threads through the fair's NW edge. From the Riserad it is the thing you watch. It never interacts with the economy.
## 5. Walk-through mode ("Ëmgesinn")

v1 already has a basic walk mode (perspective camera at 1.45 m, WASD/arrows, drag-to-look, touch joystick radius 38, blocked by footprints, Escape restores the builder camera). v2 keeps those controls and turns it into the game's second half.

**Controls**
- Desktop: WASD/arrows move (1.4 m/s, Shift 3.0 m/s), mouse drag or pointer-lock look, `E`/click interact, `Esc` or the 👣 button leaves. Eye height 1.65 m, FOV 70, pitch limit ±75°.
- iPad/phone: left-thumb joystick (move), right-side drag (look), one round **interact button** that appears only near something useful (stall, ride, Riesenrad), 👣 to leave. No tilt controls. Gyro look off by default.
- Walkable area = a 2D mask baked from the alley graph + pitch rectangles (pitches that hold an attraction are solid, locked/NPC stalls solid, fences solid, the entrance gates are passable). Collision is circle-vs-AABB, no physics.
- A "photo" button (camera icon) freezes the HUD and saves a PNG (`canvas.toBlob`), local only.

**Crowd** (cosmetic, driven by the economic `λ`)
- Up to 150 on iPad medium, 70 low, 320 desktop. One instanced low-poly figure (about 90 triangles, 1-2 draw calls total with colour per instance), a vertex-shader walk bob, no skinning. Colours: families, teenagers, couples with a pushchair, a few figures with a Kachelcher or a Zockerwatt in hand. Walking along 2 lanes per alley on the baked alley graph (they never collide with anything); some stop at stalls and rides according to the demand split of section 2.3; beyond 40 m they degrade to coloured dots. Queues are visible rows of figures at attractions with unserved demand.
- Sheep: Hämmi (mascot, wanders the main alley, tap = bleat, a free gift once a day), a small flock only on parade days.

**Sound** (all procedural WebAudio, no downloads, same approach as `pb/train-sim/audio.js`; created after the first tap, one master gain + limiter, mute button, `PB.instrument` shim respected)
- Layers: crowd murmur (filtered noise with random laughter blips), generator hum, per-attraction loops placed as `PannerNode` (equal-power, max 6 nearest voices): carousel/organ (generated melody), scooter zaps and bumps, coaster rattle + screams swell, drop-tower whoosh, shooting-gallery pops, Lukas bell, fryer sizzle at food stalls, rain on tent canvas when it rains, tram rumble/bell/chime when the tram passes (the Luxtram tram voice code is the reference), distant fireworks on the last night.
- Fouersonndeg/opening: the Hämmelsmarsch tune (a 19th-century folk melody, lyrics by Michel Lentz, public domain) as a brass-band synth, 20 s loops.
- Ambient bed is quieter in the builder view (30 %), full in walk mode.

**Eating (cosmetic with a tiny reward)**: stand at a food stall, tap interact: a 2-second animation (steam, napkin, the item appears in a hand at the bottom of the screen), a thought bubble in the chosen language ("Gromperekichelcher mat Apelmouss, lecker!"). Eating each distinct food once per session gives "Foodie" ×1.05 income for 3 minutes (max 3 stacked). No cash changes hands; guests' money is not simulated.

**Riesenrad ride** (the signature feature; available as soon as the Bellevue is built, and once for free as a 60 s "Probefahrt" during the pioneer tutorial)
- Interact at the boarding platform: the camera attaches to a gondola on the wheel rim; 2 revolutions at 6x real speed (about 40 s), the gondola stays upright, the player can look around freely (drag).
- What is actually visible from 50 m on the Glacis (verified in the Commons views from the wheel, `rides/riesenrad-view-from-wheel-2025-*.jpg`, `rides/fair-2016.jpg`): the whole fair as a dense carpet of white tent roofs and rides, the Grand Théâtre block and Rond-Point Schuman to the NE, the Red Bridge and the Kirchberg towers beyond, the Limpertsberg roofs NW, the wooded Pétrusse/Alzette valley edges and the city centre skyline to the S/SE (section 4 lists what is in the baked world; the `far` ring of the Luxtram data covers it).
- At night the wheel's own LED rim and the fair below are the show. Achievement "Op der Spëtzt" on the first ride (a collectible stamp).
- Optional later: a second POV on the Alpina Bahn (rail path camera), not in the first release.

**Tram pass-by**: every 5-8 min a Luxtram (CAF Urbos, silver-grey nose, black glazed sides, white LED "C" lights, no overhead wire) creeps at <= 20 km/h along the single track through the Allée Scheffer lane between the camelot stalls (Faïencerie to Theater, ~420 m), stops at "Theater" with doors open, chime and a short announcement; from the Riserad it is a toy train. Baked or simple multi-mesh model (<= 8 draw calls, see section 4.6).

**Performance budget** (target: school iPad 9th gen class, 3 GB RAM, Safari, inside the arcade iframe; auto quality probe over the first 3 s, remembered per device, same idea as Luxtram's `QUALITY`)

| | iPad low | iPad medium (default) | Desktop high |
|---|---|---|---|
| Frame rate target | 30 | 30-45 | 60 |
| Pixel ratio cap | 1.0 | 1.5 | 2.0 |
| Draw calls, builder view | <= 90 | <= 140 | <= 200 |
| Draw calls, walk view | <= 150 | <= 220 | <= 300 |
| Visible triangles | <= 150k | <= 300k | <= 700k |
| Texture memory | <= 24 MB | <= 40 MB | <= 80 MB |
| Shadows | blob decals | 1 x 1024 directional, 70 m around the camera | 2048, 120 m |
| Lights | none dynamic | none dynamic | none dynamic |
| Crowd | 70 | 150 | 320 |
| Rides animated | nearest 6 | nearest 10 | all |

How the budget is met: (1) the baked Glacis world is merged per material (ground, buildings, trees: ~12 draw calls); (2) NPC background showmen are merged into 2-3 static meshes (locked pitches and the other ~180 stalls); (3) every attraction is one merged static mesh plus at most 2-5 animated part meshes; far attractions (> 80 m) switch to the static LOD; (4) night lighting is emissive vertex colours + one additive instanced "bulb halo" mesh (<= 3000 instances, 1 draw call), no real lights, no bloom pass; (5) glass, haze and rain are one fullscreen-cheap overlay each; (6) one shared texture atlas for props (2048 px) plus the Luxtram facade atlas (1024 px day + 512 px mask + 512 px lit) for the surrounding buildings; (7) `renderer.info` counters are exposed by `?fouerDebug=1` and asserted by a flow on an iPad-profile run (the Luxtram flows already do this).

## 6. Real-date Fouer event

**Dates (Europe/Luxembourg calendar, computed on the client, no server needed).** Rule (Wikipedia lb, matches 5 published editions): let `eve` = 23 August. If `eve` is Wednesday, Thursday or Friday the fair opens that day; otherwise (Saturday-Tuesday) it opens on the **Friday before**. It runs **20 days**: `open = D`, `close = D + 19`.

| Year | `eve` weekday | Opens | Closes | Source check |
|---|---|---|---|---|
| 2023 | Wed | 23 Aug | 11 Sep | Wikipedia (681st edition) |
| 2025 | Sat | 22 Aug | 10 Sep | paperjam (683rd) |
| 2026 | Sun | 21 Aug | 9 Sep | vdl.lu / chronicle.lu (684th) |
| 2027 | Mon | **20 Aug** | **8 Sep** | vdl.lu |
| 2028 | Wed | 23 Aug | 11 Sep | vdl.lu |

The harness asserts all five. A tiny override table `FOUER_DATES[year]` wins over the rule if the city ever deviates. (Hours: 12:00-01:00 daily, food from 11:00; the 2025 paperjam piece said 14:00, the city site says 12:00, use 12:00.)

**What the game does**

| Real moment (Lux time) | In the game |
|---|---|
| Any day outside the 20 days | normal play; a small sign shows "Nächst Fouer: 20. Aug 2027 (301 Deeg)". The fair is never reset, nothing expires |
| Opening day `D`, 17:00 | **Opening ceremony**: a 3 min scripted scene at the SW gate: mayor-figure cuts the ribbon, Hämmi + shepherd + brass band, sheep. Plays for whoever is online at that time (and as a skippable replay card later). Stamp 1 |
| Daily during the 20 days | **Fouer-Stempelkaart**: one stamp per day the game is opened (Lux date). 5 stamps: golden bulb decoration pack; 10: Hämmi statue for any S pitch; 15: golden ticket booth look; 20: crown + "Fouer 20XX" plaque on the gate. Claimable until close + 7 days. Stored as one small mask per year (`st`), plaques kept forever |
| Daily | Fouer period economy: guests +10 %, offline away rate +10 pts and cap +2 h |
| Wednesdays of the fair (Familljendag) | families: guests x1.4, prices x0.8 (net about +12 % income), banner "Familljendag" |
| **Fouersonndeg** (the Sunday that falls in `D+8 .. D+14`; 2026: 30 Aug) | **Hämmelsmarsch**: at 11:00 and 15:00 shepherds in blue smocks with straw hats and red neckerchiefs lead ~8 sheep with red-white-light-blue ribbons, followed by a dark-blue brass band, along the whole main alley (3 min, brass tune, a collection box, model refs `parade/parade-haemmelsmarsch-2019-102.jpg`); stalls it passes get "Hämmelsmarsch-Bonus" x1.3 for 1 h; stamp + a collectible sheep |
| Last day `D+19`, until 20:00 | "Lescht Dag": half-price banner, +25 % guests |
| Last day, **22:00** | **Closing fireworks** from the Pont Grande-Duchesse Charlotte (the Red Bridge, NE of the Glacis, already modelled in the Luxtram level): 4 min show over the Grand Théâtre, 90 s of it in sync for everyone online, plus a one-time gift of 15 minutes of current income and the plaque. Offline players get the plaque and gift when they next open it (until close + 7 days) |

Everything is deterministic from `now` and the table, so a flow can set `Date` and assert each moment. No server involvement except optional admin gifts. The 2026 edition is over (today 22 Oct 2026): the first live event is **20 Aug 2027**; before then QA uses a `?fouerDate=2027-08-20T17:00` test override (test mode only).

## 7. Migration for existing Theme Park Tycoon players

### 7.1 Decision
**Keep game id `park`** (leaderboard rows, play counts, `?g=park` links, the pinned slot, the gallery and its likes, `scores.game_name` update only). New page `pb/fouer.html`; the arcade tile's `src` switches from `pb/park.html` to `pb/fouer.html` in the final wave. The old code under `pb/park/` stays as a **frozen legacy kernel** (its harness keeps passing): it is imported lazily, only to read an old blob and to render the "old park" diorama. Reasons: 33 scores and the 2 likes carry over for free, no second tile, the one-save-per-game plumbing of the arcade is unchanged.

Not a wipe, a **move**: "Däi Park ass op de Glacis geplënnert." Nothing is deleted: the original blob is copied once into `localStorage['pb_park_v1_backup']` (never removed) and a compact snapshot goes into the v2 save (`lg`).

### 7.2 Detection and sources (in this order)
1. `window.__pbSave` / the local `pb_save_park` is a v1 blob: `version === 1`, `g` array of 1600, `o` array, `v` string. Decode with the frozen `restoreSave` (it already validates, caps and clamps everything).
2. The cloud save row is a v1 blob (there are none today, handled anyway), or a **pioneer stub** `{v:2, stub:1, pv:<score>}` written once by SQL for the 33 players who have a park score but no readable save (their local parks live only on devices that may be wiped).
3. Last resort for a signed-in player with a published gallery entry: `park_layout` RPC returns their own v1 layout (4 players).
4. Nothing found: a normal new player (tutorial).

### 7.3 Conversion formula (all inputs from the decoded v1 state; `PV` = `derived.parkValue`)
```
P      = clamp(PV - 6200, 0, 20000)          // 6200 = an untouched v1 park (5000 cash + rating 40 x 30)
cash0  = 350 + min(9000, round(P)) + min(4000, round(0.5 x cost of objects not turned into vouchers))
rb     = min(75, round(P / 60))              // permanent rating bonus points, "Pionéier-Ruff" (75 = enough for ⭐3)
tb0    = 2000 + 8 x P                        // starting lifetime Fouer-Wäert = the score/leaderboard value
vouchers = the (up to 5) most expensive old rides/stalls, each mapped to a Fouer attraction (table 7.4): free to build once if the item costs <= €6,000, otherwise 50 % off
+ always: "Gëllent Karussell" (gold carousel, Pionéier-only, M, appeal 6, price x2) and the "Mäin ale Park" diorama kiosk (S)
badge  = pi:1, name = old park name (24 chars), shown on the gate sign and as a 🎢 prefix in the gallery
```
Examples: untouched park P=0 -> €350 + golden carousel + kiosk + badge, tb0 2,000; median player PV 10,259 -> P 4,059 -> cash ~€5,500, rb 68 (starts at ⭐2, one step from ⭐3), tb0 34,472, up to 5 vouchers; best player PV 13,362 -> P 7,162 -> cash up to about €11,500, rb 75 (⭐3), tb0 59,296. A voucher is usable on any pitch of its size **even if that pitch is still locked** (it opens that one pitch) and ignores the star requirement; a Riesenrad voucher halves the Bellevue's price (€22,500) and puts it on its Hauptplaz at the SW end, which gives every pioneer who built a Ferris wheel a first big goal that is actually reachable. Caps (cash 9k+4k, rb 75, tb0 <= 160k, 5 vouchers) make a forged v1 blob harmless.

### 7.4 What each old thing becomes (voucher mapping)
| v1 ride | -> Fouer | v1 stall | -> Fouer |
|---|---|---|---|
| carousel, mini-train, slide | Kannerkarussell | popcorn | Mandelen & Magenbrout |
| teacups, swing | Kettenkarussell | lemonade | Zockerwatt-Stand |
| wheel | **Riesenrad Bellevue** | balloons | Lous-Bud |
| dodgems | Autoscooter | burgers | Grillwurscht |
| ghost-train | Geeschterbunn | juice | Crêpes |
| log-flume, rapids | Big Splash | gifts | Schéissstand |
| pirate-ship | Happy Sailor | pizza | Fouerfësch |
| wild-mouse | Wilde Maus | smoothies | Eisekuch-Stand |
| drop-tower | Jules Verne Tower | emporium | Bierzelt |
| wooden-coaster | Alpina Bahn | toilets/bins/first aid/scenery | cash (50 %) |
| inverted-, launch-coaster | Olympia Looping / Booster Maxxx | | |

### 7.5 The moment
First open after migration: no tutorial wall. A full-screen **"Bréif vum Hämmi"** (paper letter, the old park drawn as a 2D minimap from the blob): *"Däi Park ass op de Glacis geplënnert! Alles wat s de gebaut hues, kënnt mat."* Then a plain list: Pionéier-Wäert +N, Cash €X, Rating-Bonus +N (⭐2), your vouchers with small icons (Riserad, Autoscooter, ...), Gëllent Karussell. One button **"Op d'Fouer!"**. The camera flies in to the first free pitch with a voucher glowing; a 3-step pioneer tutorial (place voucher, see the crowd, tap upgrade). The old park stays reachable: Settings > "Mäin ale Park" opens the diorama (the frozen models.js renders the v1 layout at 15 % scale on the kiosk pitch, 1 extra draw call group, loaded only on demand).

### 7.6 Old gallery entries
No schema change. `park_showcase` keeps its 4 rows: their `layout` is a JSON string starting `{`, v2 layouts start `F2|`. v2's gallery shows v1 entries as "Museum" cards that open the diorama viewer (read-only, same as visiting in v1); a player's next v2 publish replaces their row (one row per user) after the v1 layout was stored in their save as `lg`. Likes (2 rows) stay attached to the user. `scores.game_name` is renamed by SQL. Gallery columns keep their meaning in v2: `value` = `tb`, `guests` = built pitches, `rating` = stars x 100 + points/10.

### 7.7 Save-version logic and edge cases
`version` 1 = old (frozen kernel), `v: 2` = Schueberfouer. Loading order: parse `__pbSave` -> if v2 use it, else if v1 migrate -> compare with the cloud save by `tb` (higher wins; tie: later `t`) -> normalise.

| Case | Behaviour |
|---|---|
| Local v1 blob only (the normal case) | migrate, write v2 to local + cloud, set `mg = P`, keep `pb_park_v1_backup` |
| v2 exists and a v1 blob is also still there | ignore the blob (`mg` set) |
| Second device has its own, richer v1 blob (P_B > `mg` in the cloud v2) | one-time **top-up**: cash += (P_B - mg), `rb` = max, `mg` = P_B, vouchers filled up to 5 from B's list; toast "Däi zweete Park gouf och matgeholl" |
| Two devices both on v2 | higher `tb` wins wholesale (v1's own rule); the DB trigger `game_saves_keep_progress` (numeric `tb`) refuses lower saves server-side; offline credit is computed once from the winning save's `t` |
| A cached **old** v1 client opens after v2 exists | v1 rejects `v:2` ("version !== 1") and would write a fresh v1 over the *local* copy. Defence: `sw.js` cache bump, new URL `pb/fouer.html`, a rolling `pb_fouer_bak` copy (<= 1 per minute) and the cloud copy; v2 restores from backup/cloud when the local save is v1-fresh but a v2 with higher `tb` exists |
| Cloud has a pioneer stub and the device has the real v1 blob | the blob wins (richer); stub used only when no blob |
| Cloud has only the stub on a new device | cash/rb/tb0 from `pv` only, golden carousel and kiosk, no object vouchers |
| v1 blob corrupted or oversize (>= 7000 chars) | skip silently, the pioneer badge + golden carousel + €1,000 still granted ("we could not read the old park, here is a thank-you") |
| Cloud row would exceed the DB limit | impossible by design: v2 target <= 3 KB, asserted in the harness with a jsonb-size estimator |
| Player closes the letter without claiming | the migration is applied to state first and the letter is a pure display; nothing depends on a button |

**SQL (not run, for Wave 7, needs Ian's go):** `scripts/fouer-v2.sql`: (1) widen `game_gifts.game_id` check and the 3 gift functions' allowlists with `'park'`; (2) `update scores set game_name='Schueberfouer Tycoon' where game_id='park'`; (3) insert the 33 pioneer stubs `jsonb_build_object('v',2,'stub',1,'pv',score)` with `on conflict do nothing`; idempotent.
## 8. Architecture

### 8.1 Files
```
pb/fouer.html                  shell (arcade-kit data-arcade-id="park", three r160 from the same CDN tag as park.html, absolute /pb/fouer/... imports)
pb/fouer/DESIGN.md             this file
pb/fouer/pitches.json          34 pitches (id, zone, u, w, size, star, face), from pitches.proposal.json
pb/fouer/data.js               rules, catalogue (section 3), star table, i18n keys for names
pb/fouer/calendar.js           fouerDates(year), eventsAt(now), pure + tested
pb/fouer/sim.js                DOM-free: createState, build/upgrade/replace, income(), tick, offline(), applyGift(), stamps
pb/fouer/save.js               v2 codec (strings only), size guard, merge (higher tb), persistence (adapted from park/save.js), backup
pb/fouer/legacy.js             lazy: imports /pb/park/{data,build,sim,save}.js, readV1(blob) -> {PV,P,objects,snapshot}; migrate()
pb/fouer/i18n.js               lb/de/en strings (fr optional later; the arcade has fr)
pb/fouer/world/*.js            loader for the baked Glacis, sky/weather/time, ground+buildings+trees, NPC fillers, tram
pb/fouer/models/*.js           one file per attraction group (procedural, merged, hi/lo, animated parts)
pb/fouer/crowd.js, audio.js, walk.js, wheel.js, ui.js, social.js, main.js
pb/fouer/data/glacis-world.bin baked terrain/buildings/trees/ground/skyline (target <= 700 KB, built by scripts/bake_fouer_world.py)
pb/fouer/harness.js            node harness (target >= 200 checks), run: node pb/fouer/harness.js
scripts/fouer-v2.sql           gifts allowlist, scores.game_name, pioneer stubs (idempotent, for Wave 7 only)
scripts/flows/fouer*.mjs       Playwright flows (iPad portrait 820x1180, Supabase mocked, see lib.mjs)
```
Imports must be absolute (`/pb/fouer/...`) because the game runs in a `srcdoc` iframe (same trap as v1).

### 8.2 Reuse vs rewrite of the Theme Park modules
| v1 module | Decision |
|---|---|
| `data.js`, `build.js`, `sim.js`, `save.js` (v1 kernel) | **Frozen, kept**, imported lazily by `legacy.js` only; `node pb/park/harness.js` (229 checks) must keep passing |
| `models.js` (merged geometry per kind, procedural canvas textures, `animateParkModel`) | keep for the diorama; **copy the technique** (merge per kind, shared materials) into `pb/fouer/models/` but all models are new |
| `renderer.js` | port: pointer/pinch/pan, walk joystick + keys, `performanceSnapshot()`, hidden-tab loop stop, context-loss handling, `?...Debug=1` hook; scene content is new |
| `world.js` (hills, lake, clouds) | rewrite (real Glacis); keep the gradient-sky/cloud idea |
| `save.js` persistence (`createPersistence`: debounce 1.2 s / max 5 s, `pagehide` flush, `__pbWantSave` handshake, `applyIncoming` only-if-higher, test-mode guard) | copy and adapt |
| `social.js` (`createBridge`/`__pbRpc`, allow-listed functions, 8 s timeout, `textContent` only) | reuse nearly verbatim |
| `ui.js`, `main.js` | rewrite (3 verbs, goal card, letter, settings) |

### 8.3 Save format v2 (strings and small integers only; budget 3 KB, DB hard limit 8192 bytes as jsonb)
```
{ v:2, tb:34472,            // lifetime Fouer-Wäert: monotonic, protected by the DB trigger
  c:5530,                   // cash
  t:1792000000,             // last save, epoch s (offline earnings)
  p:"a1b0c2...",            // 34 pitches x 3 base36 chars: kind, level+look, flags (empty = "000")
  pu:"0",                   // extra pitches opened by vouchers (bitmask, base36)
  rb:68, pi:1, mg:4059,     // pioneer rating bonus, pioneer flag, migrated progress P
  vo:"w3a", lg:"...",       // unspent vouchers (kind chars), legacy diorama snapshot (<= 900 chars)
  st:"2026:1fffff",         // Fouer stamp masks per year (base36), plaques derive from it
  gi:[12,13], n:"Ian",      // last 50 applied gift ids, fair/sign name (24 chars)
  tu:7, ea:"x" }            // tutorial step, early-adopter/etc. flags
```
`gi` is the only array (<= 50 small ints = ~1 KB jsonb worst case); everything else is scalars/strings (the v1 failure was an array of 1600 numbers = 19 KB as jsonb). Preferences (weather, time of day, language, quality, sound) live in `localStorage` per device, never in the save. Validation at the boundary: every field clamped like v1's `normalizeSave`; unknown kinds -> empty pitch; pitch string length checked; `tb` and `c` finite and capped (1e12).

### 8.4 Harness tests to add (`pb/fouer/harness.js`, >= 200 checks)
- `calendar`: the five known editions, the rule for 2024-2035 (weekday logic), Fouersonndeg window, event moments with injected clocks, DST edges (Lux time).
- `economy`: invariants (cash never negative via commands, `tb` monotonic, level/price monotonic), the greedy-player simulation hits the pacing bands of 2.3 (+-25 %), offline credit = cap and rate formulas, no income without attractions, queue signal appears when demand > capacity, pitches never overlap and fit their size rule.
- `pitches`: JSON validity, every pitch inside the baked site polygon, no overlap, unlock counts 7/15/24/30/34, alley graph connected, every pitch has a frontage on a walkable edge.
- `save`: round trip, size <= 3000 bytes at maximum content, **jsonb-size estimator < 8192**, merge higher-`tb`-wins, stale cloud save never lowers anything, corrupt/forged inputs clamp, `gi` idempotent gift apply (same id twice pays once, 50-id window).
- `migration`: golden tests with three synthetic v1 blobs (untouched, median, maxed) -> exact cash/rb/tb0/vouchers of 7.3; forged blob capped; second-device top-up; stub-only; corrupt blob; v2-already-present ignores v1; formula never loses vs the v1 score (`tb0 >= PV` for every blob in a generated set).
- `i18n`: lb/de/en have identical key sets, no empty strings, placeholders match.
- Keep `node pb/park/harness.js` in the test matrix (frozen kernel).

### 8.5 Flows to add (`scripts/flows/fouer.mjs`, `fouer_migration.mjs`, `fouer_walk.mjs`; all with the existing `lib.mjs`: iPad portrait, Supabase mocked)
1. boot + tutorial: glowing pitch -> build -> cash rises -> upgrade -> goal card, zero console errors; 2. weather/time: Random is the default, menu and in-game popover change it, choice persists, income unchanged by the choice; 3. language switch lb/de/en; 4. migration: inject a v1 blob via `__pbSave`, letter shows exact numbers, vouchers placeable, reopening does not migrate twice, `pb_park_v1_backup` exists; 5. two-device/stale cloud (mock `game_saves` returning lower/higher `tb`); 6. offline return (mock `Date.now()` +6 h -> card with the right capped amount); 7. live gift (pattern of `idle_live_gift.mjs`: `__pbGift` -> cash + toast + `__pbGiftApplied`, redelivery pays once); 8. walk mode: enter/exit, collision, Riesenrad ride up/down, no console errors; 9. gallery publish/visit with mocked RPCs (v1 museum card + v2 card); 10. perf probe on the iPad profile: `renderer.info` draw calls and triangles under the section 5 budget at 5 reference camera positions; 11. test mode (`__pbTestMode`): everything unlocked, no cloud writes (update `test_mode.mjs` expectations for the new game).

### 8.6 Arcade and platform changes
- `pixelbreak.html` line 312: `{id:"park", name:"Schueberfouer Tycoon", emoji:"🎡", thumb:"pb/thumbs/park.webp" (regenerated), desc:..., src:"pb/fouer.html"}`; `DESC_I18N.park` lb/de/en/fr; `arc.about2` in `i18n-dict.js` mentions "Theme Park Tycoon" in 4 languages (update); `BIG_GAME_IDS`, `PINNED_GAME_IDS`, `arc.bg.sim` already contain `park` (unchanged). `data/game-plays.json` keeps `park: 32`.
- `sw.js`: bump the cache (`ianlu-v10` at the last check), add `pb/fouer.html` and the data file.
- `robots.txt` already disallows `/pb/`; sitemap unchanged (same `?g=park`).
- **Gifts**: `pixelbreak-records.js` `GIFT_GAMES` and `admin-saves.js` `GIFT_GAMES` + `GAME_NAMES.park`; SQL: `game_gifts.game_id` check constraint (`('idle-empire','cookie-clicker','bus-tycoon')` today) and the allowlists in `admin_gift_live` and `claim_game_gifts` get `'park'`; `IdleExtras.liveGifts` needs a `GIFT_WHAT.park` text (lb *Suen*, de *Geld*, en *cash*). The game must call `IdleExtras.liveGifts({game:'park', read:()=>state.gi, apply:(amount, ids)=>..., save, refresh, format})` and `ready()` only after its local save is loaded and the cloud save requested (ordering rules in the header comment of `idle-extras.js`).
- Admin tab "Saves" (`admin-saves.js`) shows park saves as `tb`/cash (add a case beside `bus-tycoon` at line ~50).

## 9. Build plan in waves (separate agents; every wave ends with: harness green, flows green, photo side-by-side montage saved under `website-overnight/reports/fouer/<wave>/`, perf numbers, no console errors)

| Wave | Scope | Depends on | Ships alone? | Size |
|---|---|---|---|---|
| **W1 Brain** | `data.js`, `calendar.js`, `sim.js`, `save.js`, `legacy.js` + migration, i18n skeleton, economy simulation script, `harness.js` | none | reviewable by numbers; no UI | M |
| **W2 Ground** | `bake_fouer_world.py` + loader: Glacis terrain, ground paint (no parked cars), LOD2 buildings + facade atlas, LiDAR trees, the Luxtram landmarks (Théâtre, Institut, Red Bridge), skyline, tram track + pass-by tram, sky/weather/time, builder camera, empty pitch markers. Photo comparison of site aerials, the tram stop, the Théâtre, Boulevard de la Foire | none (data from Luxtram) | an empty, beautiful, flyable Glacis, standalone page | L |
| **W3 Small stuff** | background NPC stalls (merged), alley props (lamps, bins, fences, signs, gate portal), the 14 S + 6 M attractions and all food stalls (models, 3 looks, 3 upgrade levels, lights) | W2 (scene) | yes, models page `pb/fouer.html?models=1` | L |
| **W4 Big rides** | Riesenrad (animated, LED, gondolas), Wilde Maus, Olympia Looping, Alpina Bahn, towers, Big Splash, Geeschterbunn, Autoscooter hall, Bierzelt; NPC big rides (static); night lighting pass | W2 | yes, models page | XL (split in 2 agents: wheel+towers, coasters+halls) |
| **W5 Game** | `ui.js`/`main.js`: onboarding, build/upgrade cards, goal card, offline card, settings (weather/time/language/sound), persistence + cloud, gifts, migration letter, pioneer items; wire W1+W2+W3+W4 | W1, W2, W3 (W4 can land after) | **first playable**; still behind the old tile | L |
| **W6 Walk** | first-person mode, crowd, procedural audio, eating, Riesenrad POV, tram pass-by audio, photo mode, iPad perf passes | W5 | yes | L |
| **W7 Social, event, launch** | gallery v2 + museum cards, Fouer calendar/event scenes, stamps, `scripts/fouer-v2.sql` (with Ian's go), arcade tile/thumb/i18n, sw bump, final QA on the iPad simulator, deploy | W5, W6 | release | M |

Parallelism: W1 || W2; then W3 || W4 (two agents) ; W5 after W1+W2 (can start with W3 models only); W6; W7. **Photo step inside every modelling wave**: for each attraction/building the agent renders a fixed set of views (day front, 3/4, night) in the real engine, builds a side-by-side montage against the listed reference photo (the format of `compare/lm2/fair.jpg`), writes "GOOD / needs work" per item, and fixes until the owner-visible items are GOOD; montages are committed to the overnight reports folder, not the repo. Ian's standing rules apply: no playtesting on ian.lu by Claude (flows only), commit + push after each wave, rotate agents with a HANDOFF.md before ~500k context.

## 10. Open questions and risks

**Questions for Ian (short)**
1. **Name and id**: "Schueberfouer Tycoon" with id kept as `park` (my recommendation), or a new tile? (Keeping the id carries the 33 scores, 2 likes, plays.)
2. **Real names**: use the *traditions* (Gromperekichelcher, Fouerfësch, Riserad, Hämmi, Hämmelsmarsch) but **no real showmen's company names** (Jean la Gaufre, Friture Armand, Bellevue/Barth/Alpina brand names) in a public repo. OK?
3. **lb copy**: I can write lb/de/en, but you are the native speaker: you proofread the lb strings before release (one file, `i18n.js`).
4. **Pioneer generosity** (7.3: cash up to ~€11k, ⭐3 head start, 5 free rides, golden carousel): fine, or smaller? (33 players, most are probably friends/classmates.)
5. **Site plan**: I could not find the city's official plan with the 7 entrances (E1-E7); the pitch layout is derived from OSM + aerial photos + the earlier Luxtram landmark. If you remember where the Riesenrad and the entrances really stand, tell me before Wave 2.

**Risks**
- *iPad performance* is only provable on a real iPad (the Luxtram notes say the same: draw calls were brought down in headless runs, device smoothness unverified). Budget in section 5, quality probe, and a device check by Ian before W7.
- *Reuse coupling*: `luxtram-world.js` (136 KB) is tied to the track-streaming; the plan bakes a Glacis-only bundle instead of running it. Spike first (W2): if facade/ground modules need too much shimming, port only the data format readers.
- *LOD2 ghost block and parked cars*: the Luxtram data has a 20 m LOD2 block on the Glacis (captured while the fair stood) and the ground generator paints parking bays and merges ~11,000 parked cars into the tiles; both must be masked inside the fair polygon.
- *Photo copyright*: the 200+ reference photos stay out of the repo; only own procedural models ship. Respect per-photo CC attribution in internal notes only (nothing is redistributed).
- *Density vs draw calls*: the real fair is far denser than the Luxtram landmark; the NPC filler must be instanced/merged from the start.
- *Hämmelsmarsch / Familljendag dates* are inferred from 2026 programme text (Fouersonndeg Sunday 30 Aug) and may vary by year: they are data in `FOUER_DATES`, easy to correct each August.
- *End-game saturation* (section 2.3): the model has no profitable purchase after ~2.5 h of optimal play. Decide in W1 with the harness bot: cheapest fixes are a third copy per type, cost sinks for Looks/plaques, raising late-game costs; a rebirth-style prestige (as in the idle games, with their reset-safety guard `IdleExtras.makeGuard`) only after launch.
- *DB limits*: any future field must keep the save under 8192 bytes as jsonb (arrays of numbers cost ~12 bytes each).
- *Leaderboard scale jump*: lifetime Fouer-Wäert reaches millions; the arcade's score column is bigint (`game-saves-guard.sql` raised it), fine; display with K/M formats.

## 11. Reviewer decisions (22 Oct 2026, binding for all waves)
1. **Name/id**: "Schueberfouer Tycoon", emoji 🎡, game id stays `park`, page `pb/fouer.html`.
2. **No real brands or showmen's names anywhere visible** (models, signs, strings, comments shipped to users): no "Bellevue" panels on the wheel gondolas (use a plain lit panel or "RISERAD"), no Alpina/Olympia/Jules Verne/Booster Maxxx/Jean la Gaufre etc. "Schueberfouer", "Glacis", "Hämmelsmarsch", "Gromperekichelcher" are fine (traditions/places).
3. **Mascot**: do NOT use the city's official mascot name "Lämmy" (it is the Ville de Luxembourg's branding). The game has its own sheep called **"Hämmi"** (own design: white fluffy sheep with a red-white-light-blue ribbon). (All mascot mentions in this doc already say Hämmi.)
4. **lb strings**: agents write lb/de/en; Ian proofreads lb before the W7 release.
5. **Pioneer generosity** (7.3) approved as specified.
6. **Site plan**: follow the photo evidence (Riserad at the SW end, painted portal at the NE end). Ian may correct later; keep pitch/entrance positions data-driven (pitches.json) so a correction is a data edit.
7. **End game**: W1 must fix the saturation found in 2.3: add a **4th "Gold" upgrade level** (cost 2.5 x base, +appeal, gold trim visible) and a **3rd copy per type at 2x cost**; retune so active play reaches ⭐5 in about 4 h and there is always a profitable purchase for at least ~8 h of active play. No resets/prestige in v2.
8. **Difficulty**: the onboarding of section 1 is a hard requirement; a flow must prove a fresh player gets two attractions within 2 minutes using only the glowing hints.
