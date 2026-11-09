/* Screenshots for the Gitter conversion: GITTER_PAGES="messenger.html,lobby.html" GITTER_PREFIX=pages-messenger GITTER_OUT=/dir
 * [GITTER_SIGNED=1]. Saves <prefix>-<page>-<signed|out>-<1280|375>.png full-page, mocked backend (see lib.mjs). */
import path from "node:path";
import fs from "node:fs";
import { ME, ME_NAME, PEOPLE, profilesTable, runIfMain } from "./lib.mjs";

const PAGES = (process.env.GITTER_PAGES || "").split(",").filter(Boolean);
const OUT = process.env.GITTER_OUT || "/tmp/gitter-shots";
const PREFIX = process.env.GITTER_PREFIX || "pages";

export const flow = {
  name: "gitter-shots",
  backend: {
    rpc: {
      has_pin: () => true, is_view_restricted: () => false, admin_user_ids: () => [],
      my_chats: () => [{ id: 1, display: "Klassegrupp 4C6", is_dm: false, invite_code: "abc123", unread: 2 }, { id: 2, display: "Emma", is_dm: true, invite_code: "x", unread: 0 }],
      game_leaderboard: () => [{ username: ME_NAME, wins: 12, losses: 3, total: 15, winpct: 80 }, { username: "Emma", wins: 9, losses: 4, total: 13, winpct: 69 }],
    },
    tables: { profiles: profilesTable, group_members: () => [{ user_id: ME, username: ME_NAME, joined_at: "2026-10-01T08:00:00Z" }] },
    functions: { "auth-pin": () => ({ hasPin: true, isLegacy: false }) },
  },
  async run(h) {
    const { page } = h;
    fs.mkdirSync(OUT, { recursive: true });
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    for (const mode of (process.env.GITTER_SIGNED === "1" ? ["out", "signed"] : ["out"])) {
      if (mode === "signed") await h.signIn();
      for (const p of PAGES) {
        await h.goto("/" + p);
        await h.pause(900);
        for (const w of [1280, 375]) {
          await page.setViewportSize({ width: w, height: w === 375 ? 812 : 900 });
          await h.pause(300);
          const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
          h.expect(!over, `${p} ${mode} @${w}: no horizontal scroll`);
          await page.screenshot({ path: path.join(OUT, `${PREFIX}-${p.replace(".html", "").replace(/[^a-z0-9-]/gi, "_")}-${mode}-${w}.png`), fullPage: true });
        }
      }
    }
    h.expect(errors.length === 0, "no console errors: " + errors.join(" | ").slice(0, 300));
  },
};
runIfMain(import.meta.url, flow);
