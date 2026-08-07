import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRAST, contrastRatio, themeContrastValues } from "../glass-contrast.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const THEME_SOURCE = fs.readFileSync(path.join(ROOT, "theme.js"), "utf8");
const CUSTOM_ACCENTS = Object.freeze(["#ffff00", "#000080", "#777777", "#00ff7f"]);

function literalAfter(name) {
  const marker = `const ${name} = `;
  const start = THEME_SOURCE.indexOf(marker);
  assert(start >= 0, `${name} is missing from theme.js`);
  const valueStart = start + marker.length;
  const opening = THEME_SOURCE[valueStart];
  const closing = opening === "[" ? "]" : "}";
  let depth = 0;
  for (let index = valueStart; index < THEME_SOURCE.length; index += 1) {
    if (THEME_SOURCE[index] === opening) depth += 1;
    if (THEME_SOURCE[index] !== closing) continue;
    depth -= 1;
    if (depth === 0) return THEME_SOURCE.slice(valueStart, index + 1);
  }
  throw new Error(`${name} literal is incomplete in theme.js`);
}

function readThemeData() {
  const accents = Function(`"use strict"; return (${literalAfter("ACCENTS")});`)();
  const palettes = Function(`"use strict"; return (${literalAfter("PALETTES")});`)();
  assert.equal(accents.length, 6, "theme.js must keep six preset accents");
  assert.deepEqual(Object.keys(palettes).sort(), ["dark", "light"]);
  return { accents, palettes };
}

function checkPair(label, foreground, background, minimum) {
  const ratio = contrastRatio(foreground, background);
  assert(ratio >= minimum, `${label}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1; needs ${minimum}:1`);
  return ratio;
}

const { accents, palettes } = readThemeData();
let pairCount = 0;
let lowest = { label: "", ratio: Number.POSITIVE_INFINITY };

for (const [mode, palette] of Object.entries(palettes)) {
  for (const accent of [...accents, ...CUSTOM_ACCENTS]) {
    const values = themeContrastValues(palette, accent);
    const pairs = [
      [`${mode}/${accent} accent label`, values.accentForeground, accent, CONTRAST.body],
      [`${mode}/${accent} body text`, palette["--text"], values.glass, CONTRAST.body],
      [`${mode}/${accent} muted text`, palette["--muted"], values.glass, CONTRAST.body],
      [`${mode}/${accent} accent border`, values.accentBorder, values.glass, CONTRAST.ui],
      [`${mode}/${accent} focus ring`, values.focusRing, values.glass, CONTRAST.ui],
    ];
    for (const [label, foreground, background, minimum] of pairs) {
      const ratio = checkPair(label, foreground, background, minimum);
      pairCount += 1;
      if (ratio < lowest.ratio) lowest = { label, ratio };
    }
  }
}

console.log(`Contrast OK: ${pairCount} pairs; lowest ${lowest.ratio.toFixed(2)}:1 (${lowest.label})`);
