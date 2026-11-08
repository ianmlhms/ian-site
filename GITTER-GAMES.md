# Gitter for the Arcade games — pilot status (branch `gitter-games`)

Pilot only: the shared kit is restyled and proven on 5 games. The rest follows after Ian has seen the pictures
(`/Users/Ian/Library/Caches/luxdrive-work/gitter-shots/games/<game>-<1280|375>.png`, before row above after row).

## What the shared kit now does
- `pb/arcade-ui.css?v=2` has two palettes on purpose.
  - `--g-*` = page chrome in Gitter (paper #f6f6f3, ink #16171a, one green #1f7a4d, hairlines, radius 0, Geist + Geist Mono from `/assets/fonts/`, absolute paths for srcdoc).
  - `--bg --card --text --accent --cyan ...` = the board palette. Games read these with `getComputedStyle` to paint their canvas, so since round 2 (Ian: dark boards stand out) they hold LIGHT values (#fbfbf8 board, ink text, deeper saturated accents) and every canvas game turns light at once. Boards sit in a 1 px ink hairline on the paper stage. `--radius*` are now 0, `--glow` is none, `--font*` is Geist.
- Restyled, class names and ids untouched: `.arcade-stage` (paper, no gradient), `.arcade-hud` + `.arcade-pill` (mono hairline cells, no blur), `.arcade-overlay` (paper veil .95, no blur) + `.arcade-panel` (white card, ink hairline, no glow), `.arcade-big`, `.arcade-btn` (green; ink on hover/press; `.secondary` = outline; `.danger`), `.arcade-seg` (hairline segmented control, ink = selected), `.arcade-hint`, new `.arcade-toast`.
- `.arcade-stage canvas` gets `box-shadow:0 0 0 1px ink` and radius 0 (beats the old per-game `canvas{...}` shadows); canvases inside a pill get none.
- `pb/arcade-kit.js?v=42`: the game bar (`.arcade-bar*`, `.arcade-context`) is now paper with an ink hairline, square 44 px buttons, Geist; emoji icons (trophy, restart, speaker) replaced by inline line icons; TEST badge is text only (still contains "TEST").
- `pixelbreak.html`: game overlay, iframe and on-screen D-pad strip are paper (were black); D-pad buttons are white hairline squares, action button green.
- Opt-out: `bus-tycoon` (another agent owns it) keeps the old dark palette via an `html:has(script[data-arcade-id="bus-tycoon"])` block at the end of `arcade-ui.css`. Remove it when bus-tycoon is restyled.
- Round 2: English game words (Game over, Play again, hints) are kept on purpose. `arcade-ui.css?v=3`.
- Idle games: `pb/idle-gitter.css` (new, loaded only by `idle-empire` and `cookie-clicker`; `idle-extras.css` is shared with bus-tycoon/fouer and untouched) restyles panels, shop/upgrade lists, buttons, notices, modals and the shared idle dialogs/toasts; numbers in Geist Mono; cookie art untouched.
- Tetris: 7 piece colours deepened, square blocks. Flappy: eye/cloud colours fixed for light. Asteroids/space games: light works (thin ink outlines on paper, faint stars); no game needed to stay dark. Space-invaders and run-3 read the same vars but were not screenshotted: check them.
- `?v=` bumped (css 1 to 2, kit 41 to 42) in every other file that loads them, including the root games (dots, connect4, wordle, ...) that load the kit. Skipped: the protected big games listed above, `lux-drive*`.

## Pilot games
- `2048` (own tile ramp): paper board with hairline, tiles go from paper-grey through green to ink; no shadows. Only colours changed, no logic.
- `tetris`: dark playfield in a hairline, NEXT cell is a plain pill; board hairline is ink.
- `flappy`, `breakout`: nothing game-specific needed; dark canvas framed on paper. Breakout canvas has the same colours as before.
- `memory`: DOM cards restyled: card backs warm grey with hairline, faces white, flipped/hover = green hairline; gradient removed.
- Snake and Minesweeper do not use `arcade-ui.css` (own inline CSS), so Breakout and Memory replaced them. They are in list (b).
- Not pixel-perfect yet: during start/game-over the .95 veil makes the board almost disappear (calm, but no "ghost board" any more); the canvas art itself is untouched (rounded bricks, glossy pieces).

## Remaining games
### (a) Covered by the kit, needs a quick look (dark boards on paper; check game-specific CSS for old shadows/blue accents/light text on stage)
air-hockey (lobby UI), asteroids, bubble-shooter, burger, color-clash, crossy-road, doodle-jump, fighters (lobby UI), fruit-slash, gravity-ball, maze, pixel-painter (palette/DOM tools), pong (lobby buttons and room-code input are still dark custom DOM), reaction, run-3, space-invaders, tank-wars (lobby UI), tower-stack, towerdefense (lots of DOM panels), typing (text on stage), whack-a-mole, word-scramble (DOM tiles; probably wants a light board like 2048). Root games that load only the kit: dots, connect4, checkers, reversi, wordle, mau-mau, battleship, draw, meme, color, mordsfall, dice-duel, slf, geometrydash, intro (own pages, they get the new bar only).

### (b) Need their own restyle
- snake, minesweeper: small inline CSS, light enough to restyle by hand (green/blue game theme to Gitter).
- dino, pacman, solitaire, tictactoe, drive-mad: own CSS, no arcade-ui.css.
- bus-tycoon, idle-empire, cookie-clicker: big DOM UIs, currently pinned dark by the opt-out block.
- train-sim, mtb, kart-letzebuerg, fouer / park (Schueberfouer), chill-drive, paket-express: big 3D games with own CSS (the hub bar above them is already Gitter).
- lux-drive: separate project, release branch, untouched.
