/* R7-D: name tags without overlaps (pure: the Node test imports it). When skiers bunch (a mass start, a lift queue, friends waiting
 * at a station) their tags used to pile on top of each other. Layout per frame, nearest first:
 *   - the NEAREST few are always shown in full; if one overlaps a tag already placed it moves up in steps of one tag height (a stack);
 *   - the others try the same few steps, else shrink to a coloured dot (no label), else fold into a "+N" badge on the tag they hit;
 *   - far tags fade and shrink (and in the free ride show the distance), so a crowd far away never hides the near ones.
 * Input boxes are in CSS px of the overlay (the anchor = the bottom centre of the tag, over the helmet). */
export const TAGS = Object.freeze({
  ALWAYS: 3,            // the nearest this many are always shown with their name
  STEPS: 3,             // up-shifts tried before a tag collapses (each one tag height + a gap)
  GAP: 2,               // px between stacked tags
  FADE_FROM: 180,       // m: from here tags fade ...
  FADE_TO: 900,         // ... down to MIN_ALPHA here (and beyond)
  MIN_ALPHA: 0.5,
  MIN_SCALE: 0.72,
  NEAR_SCALE_AT: 60,    // m: full size nearer than this
  DOT: 12,              // px: a collapsed tag
  H: 22,                // px: tag height at scale 1 (13 px bold + padding)
  CHAR_W: 7.4,          // px per character at scale 1 (13 px bold, a rough mean)
  PAD_W: 28,            // px: padding + the colour square
});

/** width (px, scale 1) of a tag with this label */
export const tagWidth = (label) => TAGS.PAD_W + TAGS.CHAR_W * String(label || '').length;

const overlaps = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** the scale and opacity of a tag at distance d (m) */
export function tagLook(d) {
  const s = Math.max(TAGS.MIN_SCALE, Math.min(1, TAGS.NEAR_SCALE_AT / Math.max(d, 1)));
  const f = Math.max(0, Math.min(1, (d - TAGS.FADE_FROM) / (TAGS.FADE_TO - TAGS.FADE_FROM)));
  return { scale: s, alpha: 1 - f * (1 - TAGS.MIN_ALPHA) };
}

/**
 * items: [{ id, x, y (anchor px), d (m), w (px at scale 1) }] (only the ones on screen and in range)
 * -> Map id -> { mode: 'full' | 'dot' | 'merged', x, y (anchor px after the stack shift), scale, alpha, more (extra count folded in), into }
 */
export function layoutTags(items, { always = TAGS.ALWAYS } = {}) {
  const order = [...items].sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
  const placed = [];                  // { box, id }
  const out = new Map();
  const boxOf = (x, y, w, h) => ({ x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y });
  const hit = (box) => placed.find((p) => overlaps(p.box, box));
  order.forEach((it, rank) => {
    const { scale, alpha } = tagLook(it.d);
    const w = it.w * scale, h = TAGS.H * scale;
    const step = h + TAGS.GAP;
    const must = rank < always;
    // full tag: as is, else stacked up a few steps (the nearest always find a place: they go up as far as needed)
    const tries = must ? 12 : TAGS.STEPS;
    for (let k = 0; k <= tries; k++) {
      const y = it.y - k * step, box = boxOf(it.x, y, w, h);
      if (!hit(box) || (must && k === tries)) {
        placed.push({ box, id: it.id });
        out.set(it.id, { mode: 'full', x: it.x, y, scale, alpha, more: 0 });
        return;
      }
    }
    // a dot at the anchor
    const dot = boxOf(it.x, it.y, TAGS.DOT, TAGS.DOT);
    const on = hit(dot);
    if (!on) {
      placed.push({ box: dot, id: it.id });
      out.set(it.id, { mode: 'dot', x: it.x, y: it.y, scale: 1, alpha, more: 0 });
      return;
    }
    // folded into the tag it hits: "+N" there
    const host = out.get(on.id);
    if (host) host.more += 1;
    out.set(it.id, { mode: 'merged', x: it.x, y: it.y, scale, alpha, more: 0, into: on.id });
  });
  return out;
}

/** distance text for a far tag: "640 m", "1.2 km" */
export const distText = (d) => (d < 950 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`);
