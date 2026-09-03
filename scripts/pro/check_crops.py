#!/usr/bin/env python3
"""Fail when a loaded object-fit: cover image is cropped below 60 percent."""
import json
import os
import statistics
import subprocess
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
VIEWPORTS = ((390, 844), (768, 1024), (1440, 900))
MINIMUM_VISIBLE = 0.60


NODE_PROGRAM = r'''
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closePage, evaluate, freePort, launchChrome, openPage, sleep } from "./scripts/audit/cdp.mjs";

const sites = JSON.parse(process.argv.at(-1));
const profile = mkdtempSync(join(tmpdir(), "pro-crops-"));
let client;
const measurements = [];

try {
  client = await launchChrome(await freePort(9222), profile);
  for (const site of sites) {
    for (const viewport of site.viewports) {
      const { targetId, sessionId } = await openPage(client, site.url, viewport.width, viewport.height);
      await sleep(250);
      const images = await evaluate(client, sessionId, () => Array.from(document.images)
        .map((img) => {
          const style = getComputedStyle(img);
          const box = img.getBoundingClientRect();
          if (!img.complete || !img.naturalWidth || !img.naturalHeight ||
              !box.width || !box.height || style.objectFit !== "cover") return null;
          const boxAR = box.width / box.height;
          const imageAR = img.naturalWidth / img.naturalHeight;
          return {
            image: img.getAttribute("src") || img.currentSrc,
            boxWidth: box.width,
            boxHeight: box.height,
            visible: boxAR > imageAR ? imageAR / boxAR : boxAR / imageAR,
          };
        }).filter(Boolean));
      measurements.push(...images.map((image) => ({ ...image, site: site.name, viewport })));
      await closePage(client, targetId);
    }
  }
} finally {
  if (client) {
    client.close();
    client.kill();
  }
  rmSync(profile, { recursive: true, force: true });
}

console.log(JSON.stringify(measurements));
'''


def read_measurements() -> list[dict]:
    sites = []
    for page in sorted((REPO / "pro").glob("*/index.html")):
        sites.append({
            "name": page.parent.name,
            "url": page.resolve().as_uri(),
            "viewports": [{"width": width, "height": height}
                          for width, height in VIEWPORTS],
        })
    command = ["node", "--input-type=module", "--eval", NODE_PROGRAM,
               json.dumps(sites)]
    result = subprocess.run(command, cwd=REPO, text=True,
                            capture_output=True, check=False)
    if result.returncode:
        sys.stderr.write(result.stderr or result.stdout)
        raise SystemExit(result.returncode)
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        sys.stderr.write(result.stderr)
        raise SystemExit("error: Chrome did not return crop measurements") from error


def main() -> int:
    measurements = read_measurements()
    failures = []
    for measurement in measurements:
        if measurement["visible"] < MINIMUM_VISIBLE:
            failures.append(measurement)

    for width, _height in VIEWPORTS:
        visible = [entry["visible"] for entry in measurements
                   if entry["viewport"]["width"] == width]
        if visible:
            print("%dpx median: %.1f%% (%d loaded cover images)" %
                  (width, statistics.median(visible) * 100, len(visible)))
        else:
            print("%dpx median: no loaded cover images" % width)

    for entry in failures:
        print("ERROR pro/%s %s at %dx%d: box %.0fx%.0f, %.1f%% visible" %
              (entry["site"], entry["image"], entry["viewport"]["width"],
               entry["viewport"]["height"], entry["boxWidth"],
               entry["boxHeight"], entry["visible"] * 100))
    print("Checked %d loaded cover images across %d preview sites." %
          (len(measurements), len({entry["site"] for entry in measurements})))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
