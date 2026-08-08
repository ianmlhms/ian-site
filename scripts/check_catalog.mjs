import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APPS } from "../apps-catalog.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .trim();
}

function attribute(attributes, name) {
  return new RegExp(`\\b${name}=["']([^"']+)["']`).exec(attributes)?.[1];
}

function tilesFromIndex() {
  const tiles = [];
  const groupPattern = /<details\b([^>]*)>([\s\S]*?)<\/details>/g;
  for (const groupMatch of source.matchAll(groupPattern)) {
    const group = attribute(groupMatch[1], "data-group");
    if (!group) continue;
    const tilePattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
    for (const tileMatch of groupMatch[2].matchAll(tilePattern)) {
      const classes = attribute(tileMatch[1], "class") || "";
      const url = attribute(tileMatch[1], "data-app");
      if (!url || !classes.split(/\s+/).includes("tile")) continue;
      const nameMatch = /<span\b[^>]*class=["'][^"']*\btname\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/.exec(tileMatch[2]);
      if (!nameMatch) throw new Error(`Tile ${url} has no .tname`);
      tiles.push({
        url,
        name: decodeHtml(nameMatch[1].replace(/<[^>]*>/g, "")),
        locked: /class=["'][^"']*\blockb\b[^"']*["']/.test(tileMatch[2]),
      });
    }
  }
  return tiles;
}

const tiles = tilesFromIndex();
const tileByUrl = new Map(tiles.map((tile) => [tile.url, tile]));
const appByUrl = new Map(APPS.map((app) => [app.url, app]));
const differences = [];

for (const tile of tiles) {
  const app = appByUrl.get(tile.url);
  if (!app) {
    differences.push(`Missing from APPS: ${tile.url}`);
    continue;
  }
  if (app.name !== tile.name) {
    differences.push(`${tile.url}: name is "${tile.name}" in index.html but "${app.name}" in APPS`);
  }
  if (app.locked !== tile.locked) {
    differences.push(`${tile.url}: locked is ${tile.locked} in index.html but ${app.locked} in APPS`);
  }
}

for (const app of APPS) {
  if (!tileByUrl.has(app.url)) differences.push(`Missing tile in index.html: ${app.url}`);
}

const duplicateTiles = tiles.filter((tile, index) => tiles.findIndex((other) => other.url === tile.url) !== index);
const duplicateApps = APPS.filter((app, index) => APPS.findIndex((other) => other.url === app.url) !== index);
for (const tile of duplicateTiles) differences.push(`Duplicate tile URL: ${tile.url}`);
for (const app of duplicateApps) differences.push(`Duplicate APPS URL: ${app.url}`);

if (differences.length) {
  console.error(`Catalog mismatch:\n${differences.map((difference) => `- ${difference}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Catalog OK: ${APPS.length} apps`);
}
