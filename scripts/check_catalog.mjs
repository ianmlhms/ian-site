// Keeps apps-catalog.js (the ⌘K quick-open list) and the home page in step.
//
// Since the Gitter home page (6 Nov 2026) the home page is a short curated list,
// no longer one tile per app — so the catalog may hold more than the home page.
// What still has to be true:
//   1. every catalog entry points at a page that exists, no duplicates;
//   2. every home-page app link (data-app) is in the catalog, and its href exists;
//   3. what the home page shows only to Ian (data-gate="ian") is `admin: true`
//      in the catalog — otherwise ⌘K offers it to everyone.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APPS } from "../apps-catalog.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const IAN_GATE = "ian";

function attribute(attributes, name) {
  return new RegExp(`\\b${name}=["']([^"']+)["']`).exec(attributes)?.[1];
}

function pageExists(url) {
  const file = url.split(/[?#]/)[0];
  const target = path.join(ROOT, file.endsWith("/") ? `${file}index.html` : file);
  return fs.existsSync(target);
}

// Ranges of index.html that sit inside an element carrying data-gate="ian".
function ianOnlyRanges() {
  const ranges = [];
  const openPattern = /<(div|section)\b[^>]*\bdata-gate=["']ian["'][^>]*>/g;
  for (const open of source.matchAll(openPattern)) {
    const tag = open[1];
    const step = new RegExp(`<(/?)${tag}\\b[^>]*>`, "g");
    step.lastIndex = open.index + open[0].length;
    let depth = 1;
    let end = source.length;
    for (let hit = step.exec(source); hit; hit = step.exec(source)) {
      depth += hit[1] ? -1 : 1;
      if (depth === 0) { end = hit.index; break; }
    }
    ranges.push([open.index, end]);
  }
  return ranges;
}

function homeLinks() {
  const ranges = ianOnlyRanges();
  const links = [];
  for (const match of source.matchAll(/<a\b([^>]*)>/g)) {
    const app = attribute(match[1], "data-app");
    if (!app) continue;
    const isInIanBlock = ranges.some(([from, to]) => match.index > from && match.index < to);
    links.push({
      app,
      href: attribute(match[1], "href") || "",
      isIanOnly: attribute(match[1], "data-gate") === IAN_GATE || isInIanBlock,
    });
  }
  return links;
}

const appByUrl = new Map(APPS.map((app) => [app.url, app]));
const differences = [];

for (const app of APPS) {
  if (!pageExists(app.url)) differences.push(`APPS entry points at a missing page: ${app.url}`);
}
const duplicateApps = APPS.filter((app, index) => APPS.findIndex((other) => other.url === app.url) !== index);
for (const app of duplicateApps) differences.push(`Duplicate APPS URL: ${app.url}`);

const links = homeLinks();
if (!links.length) differences.push("index.html has no data-app links — did the home page markup change?");
for (const link of links) {
  if (link.href && !pageExists(link.href)) differences.push(`Home link points at a missing page: ${link.href}`);
  const app = appByUrl.get(link.app);
  if (!app) {
    differences.push(`Home link is missing from APPS: ${link.app}`);
    continue;
  }
  if (link.isIanOnly && !app.admin) {
    differences.push(`${link.app}: Ian-only on the home page but not admin: true in APPS (⌘K would offer it to everyone)`);
  }
}

if (differences.length) {
  console.error(`Catalog mismatch:\n${differences.map((difference) => `- ${difference}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Catalog OK: ${APPS.length} apps, ${links.length} home links`);
}
