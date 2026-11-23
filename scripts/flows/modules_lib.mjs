/* Shared by the module-cache flows (ski-modules, mtb-modules, fouer-modules): the temporary site where a "deploy" is made up and the hash helpers. */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { REPO } from "./lib.mjs";

export const HASH_LEN = 10;
// code of every page of PAGES in scripts/game_importmap.py (its generator reads all of them), without data / img
const MAP_FOLDERS = ["pb/ski", "pb/towerdefense", "pb/mtb", "pb/fouer", "pb/park"];
const MAP_PAGES = ["pb/ski.html", "pb/towerdefense.html", "pb/mtb.html", "pb/fouer.html", "pb/park.html"];

export const sha = (body) => crypto.createHash("sha256").update(body).digest("hex").slice(0, HASH_LEN);

/** Copies the code of the games with an import map + the generator into a temporary site. */
export function copySite(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  const skip = (source) => !/\/pb\/[^/]+\/(?:data|img)(?:\/|$)/.test(source);
  for (const rel of [...MAP_FOLDERS, ...MAP_PAGES, "scripts/game_importmap.py"]) {
    fs.cpSync(path.join(REPO, rel), path.join(root, rel), { recursive: true, filter: skip });
  }
  const generate = (...args) => {
    const run = spawnSync("python3", [path.join(root, "scripts/game_importmap.py"), ...args], { encoding: "utf8" });
    return { status: run.status, out: `${run.stdout}${run.stderr}` };
  };
  /** Files of the copy that differ from the repository: what a deploy would publish. */
  const changedFiles = () => {
    const found = [];
    const walk = (rel) => {
      for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        const child = `${rel}/${entry.name}`;
        if (entry.isDirectory()) walk(child);
        else if (!fs.readFileSync(path.join(REPO, child)).equals(fs.readFileSync(path.join(root, child)))) found.push(child);
      }
    };
    MAP_FOLDERS.forEach((folder) => walk(folder));
    for (const page of MAP_PAGES) if (!fs.readFileSync(path.join(REPO, page)).equals(fs.readFileSync(path.join(root, page)))) found.push(page);
    return found.sort();
  };
  return { root, generate, changedFiles, read: (rel) => fs.readFileSync(path.join(root, rel)), write: (rel, body) => fs.writeFileSync(path.join(root, rel), body) };
}
