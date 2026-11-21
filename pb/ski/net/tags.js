/* Round 7: name tags that never pile up when skiers bunch (pure: no DOM, the Node checks use it).
 * Tags are placed nearest skier first. A tag that would overlap one already placed is lifted above it (stacked, at most STACK_MAX
 * steps); the nearest ALWAYS tags are always shown (stacked as high as needed), any other tag that still overlaps is hidden. Tags of
 * skiers beyond FADE_FROM m fade out towards TAG_DIST, so a crowd far away is a few faint names, not a wall of labels. */
export const TAGS = Object.freeze({ ALWAYS: 3, STACK_MAX: 2, GAP: 2, FADE_FROM: 220, TAG_DIST: 600, CHAR_PX: 7.2, PAD_PX: 26, HEIGHT_PX: 22 });

/** Width (CSS px, before scale) of a tag with this name. */
export const tagWidth = (name) => TAGS.PAD_PX + String(name || '').length * TAGS.CHAR_PX;

/**
 * items = [{ x, y (anchor: bottom middle, CSS px), w, h (scaled box), d (m) }] -> [{ show, dy (px up), alpha }] in the same order.
 */
export function declutterTags(items, opts = TAGS) {
  const order = items.map((it, i) => i).sort((a, b) => items[a].d - items[b].d);
  const placed = [];
  const out = items.map(() => ({ show: false, dy: 0, alpha: 0 }));
  const hits = (x0, y0, x1, y1) => placed.some((p) => x0 < p[2] && x1 > p[0] && y0 < p[3] && y1 > p[1]);
  order.forEach((i, rank) => {
    const it = items[i];
    const x0 = it.x - it.w / 2, x1 = it.x + it.w / 2;
    const must = rank < opts.ALWAYS;
    const tries = must ? 12 : opts.STACK_MAX;
    let dy = 0, ok = false;
    for (let k = 0; k <= tries; k++) {
      const y1 = it.y - dy, y0 = y1 - it.h;
      if (!hits(x0, y0, x1, y1)) { ok = true; break; }
      dy += it.h + opts.GAP;
    }
    if (!ok && !must) return;
    const y1 = it.y - dy;
    placed.push([x0, y1 - it.h, x1, y1]);
    const fade = it.d <= opts.FADE_FROM ? 1 : Math.max(0, 1 - (it.d - opts.FADE_FROM) / (opts.TAG_DIST - opts.FADE_FROM));
    out[i] = { show: true, dy, alpha: must ? Math.max(0.55, fade) : fade };
  });
  return out;
}
