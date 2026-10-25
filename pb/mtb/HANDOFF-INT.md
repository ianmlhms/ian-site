# HANDOFF-INT (integration wave, branch mtb-play, worktree website-mtb-play)

Brief: scratchpad/brief-mtb-integrate.md. Updated after every step.

## Done
- [x] Merged `mtb` (art) into `mtb-play` (conflicts: main.js, harness.js, mtb_world.mjs: both behaviours kept).
- [x] ONE deck system: `decks.js` (knots profile, `landmarkDeck()` for the stone arch bridge, `kind: 'plank'|'stone'`), `surface.js` back to the plain lattice (art's `addDeck` overlay removed), `play-world.js` returns `bridge` + decks incl. the stone one, `props.js` skips stone decks, `main.js` uses `world.bridge`.
- [x] camera.js: shake could dip the lens 1 mm below the ground clearance, clamp after the shake.
- harness.js 86 checks PASS.

## Open (order of the brief)
see the brief; gates 1, bugs 2, first impression 3, Schiessentuempel end 4, keep-off-trail 5, notes 6, thumb 7, montage 8, release notes 9.
