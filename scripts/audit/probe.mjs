/* The in-page half of the layout audit.
 *
 * `auditPage` is serialised with toString() and evaluated inside the tab, so it
 * must be entirely self-contained: no imports, no closures over module scope.
 * It reports the four failure modes Ian actually hit in the studios — panels
 * overlapping, text running off the side, text unreadable on its background,
 * and controls too small to tap. */
export function auditPage(options) {
  const MIN_OVERLAP_PX = 120;          // ignore 1px antialiasing touches
  const MIN_OVERLAP_SHARE = 0.28;      // …and grazes of the smaller element
  const EDGE_TOLERANCE = 2;            // sub-pixel rounding around the viewport edge
  const HIT_TARGET = 44;               // Apple HIG minimum, in CSS px
  const LARGE_TEXT_PX = 24;            // WCAG "large text" starts here (18.66px bold)
  const BODY_RATIO = 4.5;
  const LARGE_RATIO = 3;
  const MAX_COMPARE_AREA = 0.4;        // skip page-sized containers as collision candidates
  const CAP = 12;                      // findings reported per category per page
  const INTERACTIVE = "a,button,input,select,textarea,summary,[role=button],[tabindex]";

  const findings = [];
  const view = { w: window.innerWidth, h: window.innerHeight };
  const add = (kind, node, detail) => findings.push({ kind, where: describe(node), detail });

  function describe(node) {
    if (!node || node === document.documentElement) return "<html>";
    const id = node.id ? `#${node.id}` : "";
    const cls = typeof node.className === "string" && node.className.trim()
      ? `.${node.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
    return `${node.tagName.toLowerCase()}${id}${cls}`;
  }

  function ownText(node) {
    let text = "";
    for (const child of node.childNodes) {
      if (child.nodeType === 3) text += child.nodeValue;
    }
    return text.trim();
  }

  function isVisible(node, style, rect) {
    if (style.visibility === "hidden" || style.display === "none") return false;
    if (Number(style.opacity) < 0.05) return false;
    return rect.width > 0 && rect.height > 0;
  }

  /* ---- colour maths (WCAG 2.1) ---- */
  function parseColour(value) {
    const parts = String(value).match(/[\d.]+/g);
    if (!parts || parts.length < 3) return null;
    const alpha = parts.length > 3 ? Number(parts[3]) : 1;
    return { r: Number(parts[0]), g: Number(parts[1]), b: Number(parts[2]), a: alpha };
  }
  function over(top, bottom) {
    const a = top.a;
    return { a: 1,
      r: top.r * a + bottom.r * (1 - a),
      g: top.g * a + bottom.g * (1 - a),
      b: top.b * a + bottom.b * (1 - a) };
  }
  function luminance(colour) {
    const channel = (raw) => {
      const v = raw / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return channel(colour.r) * 0.2126 + channel(colour.g) * 0.7152 + channel(colour.b) * 0.0722;
  }
  function ratio(first, second) {
    const a = luminance(first);
    const b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }
  /** Composite every translucent ancestor background down to an opaque colour. */
  function effectiveBackground(node) {
    const stack = [];
    for (let cur = node; cur && cur !== document.documentElement.parentNode; cur = cur.parentElement) {
      const style = getComputedStyle(cur);
      if (style.backgroundImage && style.backgroundImage !== "none") return null; // photo/gradient
      const colour = parseColour(style.backgroundColor);
      if (!colour || colour.a === 0) continue;
      stack.push(colour);
      if (colour.a === 1) break;
    }
    if (!stack.length) return { r: 255, g: 255, b: 255, a: 1 };
    let result = stack[stack.length - 1];
    if (result.a < 1) result = over(result, { r: 255, g: 255, b: 255, a: 1 });
    for (let i = stack.length - 2; i >= 0; i -= 1) result = over(stack[i], result);
    return result;
  }

  /* ---- 1. page-level horizontal overflow ---- */
  const docWidth = document.documentElement.scrollWidth;
  if (docWidth > view.w + EDGE_TOLERANCE) {
    findings.push({ kind: "overflow", where: "<html>",
      detail: `page scrolls ${Math.round(docWidth - view.w)}px horizontally (scrollWidth ${docWidth} > viewport ${view.w})` });
  }

  /* ---- collect candidates in one pass ---- */
  const textBoxes = [];
  const seen = new Set();
  for (const node of document.body ? document.body.querySelectorAll("*") : []) {
    if (node.closest("svg, canvas, [aria-hidden=true]")) continue;
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    if (!isVisible(node, style, rect)) continue;
    const text = ownText(node);

    /* 2. text pushed outside the viewport */
    if (text && (rect.right > view.w + EDGE_TOLERANCE || rect.left < -EDGE_TOLERANCE)) {
      const key = `off:${describe(node)}`;
      if (!seen.has(key)) {
        seen.add(key);
        add("offscreen", node,
          `text box spans ${Math.round(rect.left)}…${Math.round(rect.right)}px, viewport is 0…${view.w}px`);
      }
    }

    /* 3. text clipped by its own container */
    if (text && style.overflow !== "visible" && node.scrollWidth > node.clientWidth + EDGE_TOLERANCE
      && style.overflowX !== "auto" && style.overflowX !== "scroll") {
      add("clipped", node, `content is ${node.scrollWidth}px wide in a ${node.clientWidth}px box (overflow: ${style.overflow})`);
    }

    /* 4. unreadable text */
    if (text && text.length > 1) {
      const background = effectiveBackground(node);
      const foreground = parseColour(style.color);
      if (background && foreground) {
        const size = Number.parseFloat(style.fontSize) || 16;
        const bold = Number(style.fontWeight) >= 700;
        const needed = size >= LARGE_TEXT_PX || (bold && size >= 18.66) ? LARGE_RATIO : BODY_RATIO;
        const blended = foreground.a < 1 ? over(foreground, background) : foreground;
        const measured = ratio(blended, background);
        if (measured < needed) {
          add("contrast", node,
            `${measured.toFixed(2)}:1 (needs ${needed}:1) — ${style.color} on rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)}) — "${text.slice(0, 40)}"`);
        }
      }
    }

    /* 5. collision candidates: block boxes in normal flow, not page-sized.
     * Purely inline elements are excluded — an inline rect spans every line box
     * it touches, so a <strong> mid-paragraph "overlaps" the <a> after it
     * without anything being visually wrong. */
    if (text && style.position === "static" && style.display !== "inline"
      && rect.width * rect.height < view.w * view.h * MAX_COMPARE_AREA) {
      textBoxes.push({ node, rect });
    }
  }

  /* 6. hit targets. Only real controls: a bare text link inside a sentence or a
   * nav bar is not something you tap at, and holding it to 44px would wreck
   * every line of prose on the site. */
  for (const node of document.querySelectorAll(INTERACTIVE)) {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    if (!isVisible(node, style, rect) || style.pointerEvents === "none") continue;
    if (node.getAttribute("tabindex") === "-1") continue;
    const isTextLink = node.tagName === "A" && style.display.startsWith("inline")
      && parseColour(style.backgroundColor)?.a === 0 && style.borderStyle === "none";
    if (isTextLink) continue;
    if (rect.width >= HIT_TARGET && rect.height >= HIT_TARGET) continue;
    if (rect.bottom < 0 || rect.top > view.h) continue;   // off-screen, not on this view
    add("hit-target", node, `${Math.round(rect.width)}×${Math.round(rect.height)}px (needs ${HIT_TARGET}×${HIT_TARGET})`);
  }

  /* 7. overlapping text boxes that are NOT deliberate overlays */
  for (let i = 0; i < textBoxes.length; i += 1) {
    for (let j = i + 1; j < textBoxes.length; j += 1) {
      const a = textBoxes[i];
      const b = textBoxes[j];
      if (a.node.contains(b.node) || b.node.contains(a.node)) continue;
      const width = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
      const height = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
      if (width <= 0 || height <= 0) continue;
      const area = width * height;
      const smaller = Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height);
      if (area < MIN_OVERLAP_PX || area / smaller < MIN_OVERLAP_SHARE) continue;
      findings.push({ kind: "collision", where: describe(a.node),
        detail: `overlaps ${describe(b.node)} over ${Math.round(area)}px² (${Math.round(100 * area / smaller)}% of the smaller box)` });
    }
  }

  const byKind = {};
  for (const finding of findings) {
    byKind[finding.kind] = byKind[finding.kind] || [];
    if (byKind[finding.kind].length < CAP) byKind[finding.kind].push(finding);
  }
  const totals = {};
  for (const finding of findings) totals[finding.kind] = (totals[finding.kind] || 0) + 1;
  return { url: location.pathname, width: view.w, theme: options && options.theme, totals, findings: byKind };
}
