const SERIF_FACES = /georgia|garamond|times|cambria|serif/i;
const GRID_STEPS = 4;

function rgb(color, fallback = [0, 0, 0]) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(color || ""));
  return match ? match.slice(1).map((part) => Number.parseInt(part, 16)) : fallback;
}

function fontFamily(face) {
  return SERIF_FACES.test(String(face || "")) ? "times" : "helvetica";
}

function short(value, max = 14) {
  const text = String(value || "");
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function extent(chart) {
  const values = chart.series.flatMap((series) => series.values);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  return { min, max: min === max ? min + 1 : max };
}

function plotFor(box) {
  return { x: box.x + 0.64, y: box.y + 0.46, w: box.w - 0.86, h: box.h - 1.1 };
}

function yFor(value, range, plot) {
  return plot.y + plot.h - (value - range.min) / (range.max - range.min) * plot.h;
}

function setText(doc, box, size = 9) {
  doc.setFont(fontFamily(box.colors?.font), "normal");
  doc.setFontSize(size);
  doc.setTextColor(...rgb(box.colors?.text));
}

function axes(doc, box, plot, range) {
  setText(doc, box, 7.5);
  for (let index = 0; index <= GRID_STEPS; index += 1) {
    const value = range.min + (range.max - range.min) * index / GRID_STEPS;
    const y = yFor(value, range, plot);
    doc.setDrawColor(...rgb(box.colors?.grid, [170, 170, 170]));
    doc.setLineWidth(0.006);
    doc.line(plot.x, y, plot.x + plot.w, y);
    doc.text(`${Math.round(value * 100) / 100}${box.chart.unit ? ` ${box.chart.unit}` : ""}`,
      plot.x - 0.08, y + 0.03, { align: "right" });
  }
}

function categories(doc, box, plot) {
  setText(doc, box, 7.5);
  const step = plot.w / box.chart.categories.length;
  box.chart.categories.forEach((category, index) => doc.text(short(category),
    plot.x + step * (index + 0.5), plot.y + plot.h + 0.25, { align: "center" }));
}

function legend(doc, box, plot) {
  if (box.chart.series.length < 2) return;
  const colors = box.colors?.palette || ["#4472C4"];
  setText(doc, box, 7.5);
  box.chart.series.forEach((series, index) => {
    const x = plot.x + index * Math.min(1.8, plot.w / box.chart.series.length);
    doc.setFillColor(...rgb(colors[index % colors.length]));
    doc.roundedRect(x, box.y + box.h - 0.18, 0.13, 0.13, 0.02, 0.02, "F");
    doc.text(short(series.name, 18), x + 0.19, box.y + box.h - 0.07);
  });
}

function bars(doc, box) {
  const plot = plotFor(box);
  const range = extent(box.chart);
  axes(doc, box, plot, range);
  const colors = box.colors?.palette || ["#4472C4"];
  const group = plot.w / box.chart.categories.length;
  const width = Math.min(0.6, group * 0.72 / box.chart.series.length);
  box.chart.series.forEach((series, seriesIndex) => series.values.forEach((value, index) => {
    const zero = yFor(0, range, plot);
    const y = yFor(value, range, plot);
    const x = plot.x + group * (index + 0.5) + width * (seriesIndex - box.chart.series.length / 2);
    doc.setFillColor(...rgb(colors[seriesIndex % colors.length]));
    doc.roundedRect(x, Math.min(zero, y), Math.max(0.03, width - 0.025),
      Math.max(0.015, Math.abs(zero - y)), 0.025, 0.025, "F");
  }));
  categories(doc, box, plot);
  legend(doc, box, plot);
}

function lines(doc, box) {
  const plot = plotFor(box);
  const range = extent(box.chart);
  axes(doc, box, plot, range);
  const colors = box.colors?.palette || ["#4472C4"];
  const step = plot.w / box.chart.categories.length;
  box.chart.series.forEach((series, seriesIndex) => {
    doc.setDrawColor(...rgb(colors[seriesIndex % colors.length]));
    doc.setFillColor(...rgb(colors[seriesIndex % colors.length]));
    doc.setLineWidth(0.045);
    series.values.forEach((value, index) => {
      const x = plot.x + step * (index + 0.5);
      const y = yFor(value, range, plot);
      if (index) doc.line(plot.x + step * (index - 0.5), yFor(series.values[index - 1], range, plot), x, y);
      doc.circle(x, y, 0.055, "F");
    });
  });
  categories(doc, box, plot);
  legend(doc, box, plot);
}

function pie(doc, box) {
  const values = box.chart.series[0].values.map((value) => Math.max(0, value));
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  const colors = box.colors?.palette || ["#4472C4"];
  let start = 0;
  values.forEach((value, index) => {
    const end = start + value / total * 360;
    doc.setFillColor(...rgb(colors[index % colors.length]));
    const radius = box.h * 0.34;
    const steps = Math.max(2, Math.ceil((end - start) / 12));
    const points = Array.from({ length: steps + 1 }, (_, step) => {
      const angle = (start + (end - start) * step / steps - 90) * Math.PI / 180;
      return [Math.cos(angle) * radius, Math.sin(angle) * radius];
    });
    const lines = [[points[0][0], points[0][1]], ...points.slice(1).map((point, pointIndex) =>
      [point[0] - points[pointIndex][0], point[1] - points[pointIndex][1]]), [-points.at(-1)[0], -points.at(-1)[1]]];
    doc.lines(lines, box.x + box.w * 0.34, box.y + box.h * 0.53, [1, 1], "F", true);
    doc.roundedRect(box.x + box.w * 0.65, box.y + 0.8 + index * 0.55, 0.16, 0.16, 0.02, 0.02, "F");
    setText(doc, box, 9);
    doc.text(`${short(box.chart.categories[index], 18)} · ${Math.round(value / total * 100)}%`,
      box.x + box.w * 0.65 + 0.24, box.y + 0.93 + index * 0.55);
    start = end;
  });
}

export function drawPdfChart(doc, box) {
  if (box.chart.title) {
    setText(doc, box, 10);
    doc.setFont(fontFamily(box.colors?.headlineFont), "bold");
    doc.text(box.chart.title, box.x + box.w / 2, box.y + 0.22, { align: "center" });
  }
  if (box.chart.type === "pie") pie(doc, box);
  else if (box.chart.type === "line") lines(doc, box);
  else bars(doc, box);
}
