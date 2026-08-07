const SVG_NS = "http://www.w3.org/2000/svg";
const VIEW_W = 1000;
const VIEW_H = 520;
const PLOT = Object.freeze({ x: 82, y: 58, w: 850, h: 360 });

function svgNode(name, attributes = {}, text = "") {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  if (text) node.textContent = text;
  return node;
}

function label(text, x, y, options = {}) {
  return svgNode("text", { x, y, fill: options.color || "#111111",
    "font-family": options.font || "sans-serif", "font-size": options.size || 22,
    "font-weight": options.bold ? 700 : 400, "text-anchor": options.anchor || "start" }, text);
}

function palette(box) {
  const colors = Array.isArray(box.colors?.palette) ? box.colors.palette : ["#4472C4"];
  return colors.length ? colors : ["#4472C4"];
}

function extent(chart) {
  const values = chart.series.flatMap((series) => series.values);
  const minimum = Math.min(0, ...values);
  const maximum = Math.max(0, ...values);
  return { minimum, maximum: maximum === minimum ? minimum + 1 : maximum };
}

function yFor(value, range) {
  return PLOT.y + PLOT.h - (value - range.minimum) / (range.maximum - range.minimum) * PLOT.h;
}

function short(text, maximum = 14) {
  const value = String(text || "");
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function drawAxes(svg, box, range) {
  const color = box.colors?.grid || "#999999";
  const text = box.colors?.muted || box.colors?.text || "#333333";
  for (let index = 0; index <= 4; index += 1) {
    const value = range.minimum + (range.maximum - range.minimum) * index / 4;
    const y = yFor(value, range);
    svg.append(svgNode("line", { x1: PLOT.x, y1: y, x2: PLOT.x + PLOT.w, y2: y,
      stroke: color, "stroke-width": 1, opacity: 0.24 }));
    svg.append(label(`${Math.round(value * 100) / 100}${box.chart.unit ? ` ${box.chart.unit}` : ""}`,
      PLOT.x - 12, y + 7, { color: text, font: box.colors?.font, size: 17, anchor: "end" }));
  }
}

function categoryLabels(svg, box) {
  const step = PLOT.w / box.chart.categories.length;
  box.chart.categories.forEach((category, index) => svg.append(label(short(category),
    PLOT.x + step * (index + 0.5), PLOT.y + PLOT.h + 34,
    { color: box.colors?.text, font: box.colors?.font, size: 18, anchor: "middle" })));
}

function drawLegend(svg, box) {
  if (box.chart.series.length < 2) return;
  const colors = palette(box);
  box.chart.series.forEach((series, index) => {
    const x = PLOT.x + index * Math.min(210, PLOT.w / box.chart.series.length);
    svg.append(svgNode("rect", { x, y: 474, width: 18, height: 18, rx: 4,
      fill: colors[index % colors.length] }));
    svg.append(label(short(series.name, 18), x + 27, 490,
      { color: box.colors?.text, font: box.colors?.font, size: 18 }));
  });
}

function drawBars(svg, box) {
  const range = extent(box.chart);
  drawAxes(svg, box, range);
  const colors = palette(box);
  const group = PLOT.w / box.chart.categories.length;
  const width = Math.min(70, group * 0.72 / box.chart.series.length);
  box.chart.series.forEach((series, seriesIndex) => series.values.forEach((value, index) => {
    const zero = yFor(0, range);
    const valueY = yFor(value, range);
    const x = PLOT.x + group * (index + 0.5) + width * (seriesIndex - box.chart.series.length / 2);
    svg.append(svgNode("rect", { x, y: Math.min(zero, valueY), width: width - 3,
      height: Math.max(1, Math.abs(zero - valueY)), rx: 5, fill: colors[seriesIndex % colors.length] }));
  }));
  categoryLabels(svg, box);
  drawLegend(svg, box);
}

function drawLines(svg, box) {
  const range = extent(box.chart);
  drawAxes(svg, box, range);
  const colors = palette(box);
  const step = PLOT.w / box.chart.categories.length;
  box.chart.series.forEach((series, seriesIndex) => {
    const points = series.values.map((value, index) =>
      `${PLOT.x + step * (index + 0.5)},${yFor(value, range)}`).join(" ");
    svg.append(svgNode("polyline", { points, fill: "none", stroke: colors[seriesIndex % colors.length],
      "stroke-width": 7, "stroke-linecap": "round", "stroke-linejoin": "round" }));
    series.values.forEach((value, index) => svg.append(svgNode("circle", {
      cx: PLOT.x + step * (index + 0.5), cy: yFor(value, range), r: 7,
      fill: colors[seriesIndex % colors.length], stroke: "#FFFFFF", "stroke-width": 3,
    })));
  });
  categoryLabels(svg, box);
  drawLegend(svg, box);
}

function polar(cx, cy, radius, angle) {
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

function piePath(cx, cy, radius, start, end) {
  const first = polar(cx, cy, radius, start);
  const last = polar(cx, cy, radius, end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${first.x} ${first.y} A ${radius} ${radius} 0 ${large} 1 ${last.x} ${last.y} Z`;
}

function drawPie(svg, box) {
  const values = box.chart.series[0].values.map((value) => Math.max(0, value));
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  const colors = palette(box);
  let angle = -Math.PI / 2;
  values.forEach((value, index) => {
    const end = angle + value / total * Math.PI * 2;
    svg.append(svgNode("path", { d: piePath(350, 265, 190, angle, end),
      fill: colors[index % colors.length], stroke: "#FFFFFF", "stroke-width": 4 }));
    const y = 125 + index * 62;
    svg.append(svgNode("rect", { x: 620, y: y - 20, width: 24, height: 24, rx: 5,
      fill: colors[index % colors.length] }));
    svg.append(label(`${short(box.chart.categories[index], 18)} · ${Math.round(value / total * 100)}%`,
      660, y, { color: box.colors?.text, font: box.colors?.font, size: 22 }));
    angle = end;
  });
}

export function renderChartSvg(box, scale, pixels) {
  const svg = svgNode("svg", { viewBox: `0 0 ${VIEW_W} ${VIEW_H}`, role: "img",
    "aria-label": box.chart.title || "Chart" });
  Object.assign(svg.style, { position: "absolute", left: `${pixels(box.x, scale)}px`,
    top: `${pixels(box.y, scale)}px`, width: `${pixels(box.w, scale)}px`,
    height: `${pixels(box.h, scale)}px`, overflow: "visible" });
  if (box.chart.title) svg.append(label(box.chart.title, VIEW_W / 2, 31,
    { color: box.colors?.text, font: box.colors?.headlineFont, size: 24, anchor: "middle", bold: true }));
  if (box.chart.type === "pie") drawPie(svg, box);
  else if (box.chart.type === "line") drawLines(svg, box);
  else drawBars(svg, box);
  return svg;
}
