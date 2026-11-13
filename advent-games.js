/* advent-games.js — the three interactive door kinds of the Adventskalenner: map, wordsearch, slider.
 * Same contract as advent-kinds.js: factory(content, ctx) -> { node, getGiven(), isReady(), submitLabel? }
 * ctx = { day, changed(), submit(), createTextInput(options) }. No answers live here, only the player's input. */
import { el, asArray, safeUrl, creditNode, session, readJson } from "./advent-util.js?v=1";

const SVG_NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
};

/* ================= map ================= */
const OUTLINE_URL = "assets/advent/lux-outline.json";
const MAP_WIDTH = 600;
const MAP_PAD = 24;
const MAP_REFERENCE_LATITUDE = 49.8;
const COORD_DECIMALS = 5;

let outlinePromise = null;
function loadOutline() {
  if (!outlinePromise) {
    outlinePromise = fetch(OUTLINE_URL)
      .then((response) => { if (!response.ok) throw new Error(`outline ${response.status}`); return response.json(); })
      .catch((error) => { outlinePromise = null; throw error; });
  }
  return outlinePromise;
}

/* Equirectangular, x scaled by cos(49.8°). Returns pure functions; the SVG is MAP_WIDTH wide. */
export function makeProjection(bbox, width = MAP_WIDTH, pad = MAP_PAD) {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const k = Math.cos((MAP_REFERENCE_LATITUDE * Math.PI) / 180);
  const scale = (width - 2 * pad) / ((maxLon - minLon) * k);
  return {
    width,
    height: Math.round((maxLat - minLat) * scale + 2 * pad),
    project: (lat, lon) => ({ x: pad + (lon - minLon) * k * scale, y: pad + (maxLat - lat) * scale }),
    unproject: (x, y) => ({ lat: maxLat - (y - pad) / scale, lon: minLon + (x - pad) / (k * scale) }),
  };
}

const validOutline = (data) => Array.isArray(data?.points) && data.points.length > 20 && Array.isArray(data.bbox) && data.bbox.length === 4;

export function createMapKind(content, ctx) {
  let pin = null;   // { lat, lon }
  const host = el("div", { class: "adv-map", role: "group", "aria-label": "Kaart vu Lëtzebuerg" }, el("p", { class: "adv-small", text: "Kaart gëtt gelueden…" }));

  function build(outline) {
    const proj = makeProjection(outline.bbox);
    const svg = svgEl("svg", { viewBox: `0 0 ${proj.width} ${proj.height}`, class: "adv-map-svg", preserveAspectRatio: "xMidYMid meet" });
    const path = outline.points.map(([lon, lat], i) => {
      const { x, y } = proj.project(lat, lon);
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join("") + "Z";
    svg.append(svgEl("path", { d: path, class: "adv-map-land" }));
    for (const ref of asArray(outline.refs)) {
      const { x, y } = proj.project(ref.lat, ref.lon);
      const label = svgEl("text", { x: x + 9, y: y + 4, class: "adv-map-label" });
      label.textContent = ref.name;
      svg.append(svgEl("circle", { cx: x, cy: y, r: 4.5, class: "adv-map-ref", "data-ref": ref.name }), label);
    }
    const marker = svgEl("g", { class: "adv-map-pin", visibility: "hidden" });
    marker.append(svgEl("circle", { r: 11, class: "adv-pin-ring" }), svgEl("circle", { r: 3.5, class: "adv-pin-dot" }));
    svg.append(marker);

    const place = (event) => {
      const matrix = svg.getScreenCTM();
      if (!matrix) return;
      const point = svg.createSVGPoint();
      point.x = event.clientX; point.y = event.clientY;
      const local = point.matrixTransform(matrix.inverse());
      pin = proj.unproject(local.x, local.y);
      marker.setAttribute("transform", `translate(${local.x.toFixed(1)} ${local.y.toFixed(1)})`);
      marker.setAttribute("visibility", "visible");
      ctx.changed();
    };
    let dragging = false;
    svg.addEventListener("pointerdown", (event) => { dragging = true; svg.setPointerCapture?.(event.pointerId); place(event); });
    svg.addEventListener("pointermove", (event) => { if (dragging) place(event); });
    const stop = () => { dragging = false; };
    svg.addEventListener("pointerup", stop);
    svg.addEventListener("pointercancel", stop);
    host.replaceChildren(svg, el("p", { class: "adv-small", text: "Tipp op d'Kaart, wou et ass. Du kanns de Punkt nach réckelen." }), creditLine(outline));
  }

  loadOutline().then((outline) => {
    if (!validOutline(outline)) throw new Error("outline invalid");
    build(outline);
  }).catch((error) => {
    console.warn("[advent] map outline failed", error);
    host.replaceChildren(el("p", { class: "adv-error", text: "D'Kaart konnt net gelueden ginn. Lued d'Säit nei." }));
  });

  return {
    node: host,
    getGiven: () => ({ lat: Number(pin.lat.toFixed(COORD_DECIMALS)), lon: Number(pin.lon.toFixed(COORD_DECIMALS)) }),
    isReady: () => pin !== null,
    submitLabel: "Hei!",
  };
}

const creditLine = () => el("p", { class: "adv-credit", text: "Konturen: geoBoundaries, © OpenStreetMap contributors" });

/* ================= wordsearch ================= */
const DRAG_POINTERS = new Set(["mouse", "pen"]);   // touch scrolls the page, so it uses tap-first-tap-last

const normaliseWord = (value) => String(value).toUpperCase().replace(/\s+/g, "").normalize("NFC");
const reverseText = (text) => [...text].reverse().join("");

/* Cells of the straight line a -> b (inclusive), or null when the two are not on one of the 8 lines. */
export function lineBetween(a, b, cols) {
  const dr = Math.floor(b / cols) - Math.floor(a / cols);
  const dc = (b % cols) - (a % cols);
  if (a === b || !(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) return null;
  const steps = Math.max(Math.abs(dr), Math.abs(dc));
  return Array.from({ length: steps + 1 }, (_, i) => a + i * (Math.sign(dr) * cols + Math.sign(dc)));
}

export function createWordsearchKind(content, ctx) {
  const rows = asArray(content.grid).map((row) => [...String(row).toUpperCase().normalize("NFC")]);
  const cols = rows.length ? Math.max(...rows.map((row) => row.length)) : 0;
  const letters = rows.flatMap((row) => Array.from({ length: cols }, (_, i) => row[i] ?? " "));
  const words = asArray(content.words).map(normaliseWord).filter(Boolean);
  const storageKey = `advent_ws_${ctx.day}`;
  const stored = readJson(session.get(storageKey), []);
  let found = asArray(stored).filter((f) => words.includes(f?.word) && asArray(f.cells).every((i) => Number.isInteger(i) && i >= 0 && i < letters.length));
  let start = null;
  let dragFrom = null;

  const status = el("p", { class: "adv-small", role: "status", "aria-live": "polite" });
  const wordList = el("ul", { class: "adv-words" });
  const strip = el("p", { class: "adv-strip", hidden: true });
  const input = ctx.createTextInput({ placeholder: "Dat gesicht Wuert" });
  const cells = letters.map((letter, index) => el("button", {
    type: "button", class: "adv-ws-cell", text: letter, data: { i: index },
    "aria-label": `Reih ${Math.floor(index / cols) + 1}, Spalt ${(index % cols) + 1}, ${letter}`,
    on: { click: () => tap(index) },
  }));
  const grid = el("div", { class: "adv-ws", style: `--cols:${cols}`, role: "group", "aria-label": "Buschtawegitter" }, cells);

  const foundSet = () => new Set(found.flatMap((f) => f.cells));
  const allFound = () => words.length > 0 && words.every((w) => found.some((f) => f.word === w));

  function paint() {
    const used = foundSet(), done = allFound();
    cells.forEach((cell, i) => {
      cell.classList.toggle("start", i === start);
      cell.classList.toggle("found", used.has(i));
      cell.classList.toggle("spare", done && !used.has(i) && letters[i].trim() !== "");
    });
    wordList.replaceChildren(...words.map((w) => el("li", { class: found.some((f) => f.word === w) ? "done" : "", text: w })));
    const spare = done ? letters.filter((l, i) => !used.has(i) && l.trim() !== "").join("") : "";
    strip.hidden = !done;
    strip.textContent = [...spare].join(" ");
    strip.setAttribute("aria-label", spare ? `Iwwreg Buschtawen: ${[...spare].join(" ")}` : "");
  }

  function evaluate(a, b) {
    start = null;
    const line = lineBetween(a, b, cols);
    const text = line ? line.map((i) => letters[i]).join("") : "";
    const word = words.find((w) => w === text || w === reverseText(text));
    if (!word || found.some((f) => f.word === word)) {
      status.textContent = "Dat ass kee Wuert vun der Lëscht.";
      paint();
      return;
    }
    found = [...found, { word, cells: line }];
    session.set(storageKey, JSON.stringify(found));
    status.textContent = allFound() ? "Alles fonnt! Kuck wat iwwreg bleift." : `${word} fonnt!`;
    paint();
    ctx.changed();
  }

  function tap(index) {
    if (start === null) { start = index; status.textContent = ""; paint(); return; }
    if (start === index) { start = null; paint(); return; }
    evaluate(start, index);
  }

  const cellAt = (event) => {
    const hit = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(".adv-ws-cell");
    return hit ? Number(hit.dataset.i) : null;
  };
  grid.addEventListener("pointerdown", (event) => {
    dragFrom = DRAG_POINTERS.has(event.pointerType) ? cellAt(event) : null;
  });
  grid.addEventListener("pointerup", (event) => {
    const end = cellAt(event);
    if (dragFrom !== null && end !== null && end !== dragFrom) evaluate(dragFrom, end);
    dragFrom = null;
  });

  paint();
  return {
    node: el("div", { class: "adv-kind adv-wordsearch" }, grid, status, wordList,
      el("p", { class: "adv-small", text: "Tipp den éischte an dann de leschte Buschtaw vun engem Wuert." }),
      strip, input),
    getGiven: () => ({ text: input.value.trim() }),
    isReady: () => input.value.trim().length > 0,
  };
}

/* ================= slider ================= */
const SLIDER_MIN = 2;
const SLIDER_MAX = 5;
const SHUFFLE_FACTOR = 40;

const solvedTiles = (n) => Array.from({ length: n * n }, (_, i) => (i === n * n - 1 ? 0 : i + 1));
export const isSolvedTiles = (tiles) => tiles.every((value, i) => value === (i === tiles.length - 1 ? 0 : i + 1));

/* Slides the tile at `index` (and the ones between it and the blank) toward the blank. Returns a new array, or null when it cannot move. */
export function slideTiles(tiles, n, index) {
  const blank = tiles.indexOf(0);
  const sameRow = Math.floor(blank / n) === Math.floor(index / n);
  const sameCol = blank % n === index % n;
  if (index === blank || !(sameRow || sameCol)) return null;
  const step = sameRow ? Math.sign(index - blank) : Math.sign(index - blank) * n;
  const next = [...tiles];
  for (let at = blank; at !== index; at += step) next[at] = tiles[at + step];
  next[index] = 0;
  return next;
}

/* Random legal moves from the solved board: always solvable, never the solved board. */
export function shuffledTiles(n, random = Math.random) {
  let tiles = solvedTiles(n);
  let previousBlank = -1;
  const steps = n * n * SHUFFLE_FACTOR;
  for (let step = 0; step < steps || isSolvedTiles(tiles); step++) {
    const blank = tiles.indexOf(0);
    const neighbours = [blank - n, blank + n, blank % n ? blank - 1 : -1, (blank + 1) % n ? blank + 1 : -1]
      .filter((i) => i >= 0 && i < tiles.length && i !== previousBlank);
    const pick = neighbours[Math.floor(random() * neighbours.length)];
    previousBlank = blank;
    tiles = slideTiles(tiles, n, pick);
  }
  return tiles;
}

export function createSliderKind(content, ctx) {
  const n = Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, Math.round(Number(content.size)) || 3));
  const image = content.image && typeof content.image === "object" ? content.image : {};
  const imageUrl = safeUrl(image.url);
  let tiles = shuffledTiles(n);
  let moves = 0;
  const board = el("div", { class: "adv-slider", style: `--n:${n}` });
  const counter = el("p", { class: "adv-small", "aria-live": "polite" });
  const input = ctx.createTextInput({ placeholder: "Wat gesäis du?" });
  const answer = el("div", { class: "adv-slider-answer", hidden: true }, input);
  const credit = creditNode(image);
  const wrap = el("div", { class: "adv-kind adv-slider-wrap" }, board, counter, answer, credit);

  if (imageUrl) {
    const probe = new Image();
    probe.onerror = () => wrap.classList.add("noimg");
    probe.src = imageUrl;
  } else wrap.classList.add("noimg");

  const solved = () => isSolvedTiles(tiles);

  function tileNode(value, index) {
    if (value === 0) return el("div", { class: "adv-slider-blank", "aria-hidden": "true" });
    const x = (value - 1) % n, y = Math.floor((value - 1) / n);
    return el("button", {
      type: "button", class: "adv-slider-tile", text: String(value), "aria-label": `Stéck ${value}`,
      style: imageUrl ? `background-image:url("${imageUrl.replace(/["\\()\s]/g, encodeURIComponent)}");background-size:${n * 100}% ${n * 100}%;background-position:${(x * 100) / (n - 1)}% ${(y * 100) / (n - 1)}%` : "",
      on: { click: () => move(index) },
    });
  }

  function draw() {
    if (solved()) {
      board.classList.add("done");
      board.replaceChildren(imageUrl
        ? el("img", { class: "adv-slider-full", src: imageUrl, alt: "Dat fäerdegt Bild", referrerpolicy: "no-referrer" })
        : el("p", { class: "adv-slider-full", text: "Geléist!" }));
      answer.hidden = false;
      counter.textContent = `Geléist an ${moves} Zich.`;
      return;
    }
    board.classList.remove("done");
    board.replaceChildren(...tiles.map(tileNode));
    counter.textContent = moves ? `${moves} Zich` : "Schib d'Stécker op déi richteg Plaz.";
  }

  function move(index) {
    const next = slideTiles(tiles, n, index);
    if (!next) return;
    tiles = next;
    moves += 1;
    draw();
    ctx.changed();
  }
  draw();
  return {
    node: wrap,
    getGiven: () => ({ text: input.value.trim() }),
    isReady: () => solved() && input.value.trim().length > 0,
  };
}
