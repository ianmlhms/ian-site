#!/usr/bin/env node
/* Runs every flow (scripts/flows/*.mjs) against a local server with Supabase mocked,
 * and records one video per flow (see lib.mjs for where videos go).
 *
 *   node scripts/flows/run_all.mjs                 # all flows
 *   node scripts/flows/run_all.mjs friends slf     # only flows whose name contains one of the words
 *   FLOW_SHOTS_DIR=/tmp/shots node scripts/flows/run_all.mjs   # also save step screenshots
 *
 * Exit code 0 = every flow passed. */
import { launchBrowser, runFlow, startServer, videoDir } from "./lib.mjs";
import { flow as newGroup } from "./messenger_new_group.mjs";
import { flow as addMember } from "./messenger_add_member.mjs";
import { flow as mediaCache } from "./messenger_media_cache.mjs";
import { flow as friendsAdd } from "./friends_add.mjs";
import { flow as slfRound } from "./slf_round.mjs";
import { flow as arcadePad } from "./arcade_pad.mjs";
import { flow as leaderboardTags } from "./leaderboard_tags.mjs";
import { flow as adminOnlineNotice } from "./admin_online_notice.mjs";
import { flow as adminKartSaves } from "./admin_kart_saves.mjs";
import { flow as ccSigninHint } from "./cc_signin_hint.mjs";
import { flow as accountCheck } from "./account_check.mjs";
import { flow as clientCommands } from "./client_commands.mjs";
import { flow as inboxCloud } from "./inbox_cloud.mjs";

import { flow as arcadeWeeklyStreak } from "./arcade_weekly_streak.mjs";
import { flow as idleRebirthHalloween } from "./idle_rebirth_halloween.mjs";
import { flow as idleMoreContent } from "./idle_more_content.mjs";
import { flow as idleSoftcap } from "./idle_softcap.mjs";
import { flow as idleLiveGift } from "./idle_live_gift.mjs";
import { flow as idleResetSafety } from "./idle_reset_safety.mjs";
import { flow as leaderboardBigScores } from "./leaderboard_big_scores.mjs";
import { flow as driveMadLevels } from "./drive_mad_levels.mjs";

import { flow as busTycoon } from "./bus_tycoon.mjs";

import { flow as paketExpress } from "./paket_express.mjs";
import { flow as kartLetzebuerg } from "./kart_letzebuerg.mjs";
import { flow as kartLetzebuergMp } from "./kart_letzebuerg_mp.mjs";
import { flow as kartLetzebuergArcade } from "./kart_letzebuerg_arcade.mjs";

import { flow as mpLobbyConnect4 } from "./mp_lobby_connect4.mjs";
import { flow as mpLobbySlf } from "./mp_lobby_slf.mjs";
import { flow as mpLobbyQuick } from "./mp_lobby_quick.mjs";
import { flow as mpLobbyGames } from "./mp_lobby_games.mjs";
import { flow as mpLobbyColor } from "./mp_lobby_color.mjs";
import { flow as mpLobbyParty } from "./mp_lobby_party.mjs";
import { flow as mpLobbyArcade } from "./mp_lobby_arcade.mjs";

import { flow as invitePop } from "./invite_pop.mjs";
import { flow as invitesLight } from "./invite_pop_light.mjs";
import { flow as testMode } from "./test_mode.mjs";
import { flow as mordsfall } from "./mordsfall.mjs";
import { flow as trainSim } from "./train_sim.mjs";
import { flow as trainSimAudio } from "./train_sim_audio.mjs";
import { flow as trainSimTouch } from "./train_sim_touch.mjs";
import { flow as trainSimCareerLock } from "./train_sim_career_lock.mjs";
import { flow as trainSimWorld } from "./train_sim_world.mjs";
import { flow as trainSimRoutes } from "./train_sim_routes.mjs";
import { flow as trainSimAbroad } from "./train_sim_abroad.mjs";
import { flow as trainSimTramHoles } from "./train_sim_tram_holes.mjs";
import { flow as fouerWorld } from "./fouer_world.mjs";
import { flow as fouerModels } from "./fouer_models.mjs";
import { flow as fouerBigModels } from "./fouer_big_models.mjs";
import { flow as fouerGame } from "./fouer_game.mjs";
import { flow as fouerMigration } from "./fouer_migration.mjs";
import { flow as fouerWalk } from "./fouer_walk.mjs";
import { flow as fouerRides } from "./fouer_rides.mjs";
import { flow as fouerLaunch } from "./fouer_launch.mjs";
import { flow as fouerAccess } from "./fouer_access.mjs";
import { flow as mtbWorld } from "./mtb_world.mjs";
import { flow as mtbHoles } from "./mtb_holes.mjs";
import { flow as mtbRide } from "./mtb_ride.mjs";
import { flow as mtbTrails } from "./mtb_trails.mjs";
import { flow as mtbMenu } from "./mtb_menu.mjs";
import { flow as mtbTouch } from "./mtb_touch.mjs";
import { flow as gameCache } from "./game_cache.mjs";

const ALL = [gameCache, mtbWorld, mtbHoles, mtbRide, mtbTrails, mtbMenu, mtbTouch, fouerWorld, fouerModels, fouerBigModels, fouerGame, fouerMigration, fouerWalk, fouerRides, fouerAccess, fouerLaunch, invitePop, invitesLight, mpLobbyConnect4, mpLobbySlf, mpLobbyQuick, mpLobbyGames, mpLobbyColor, mpLobbyParty, mpLobbyArcade, trainSim, trainSimAudio, trainSimTouch, trainSimCareerLock, trainSimWorld, trainSimRoutes, trainSimAbroad, trainSimTramHoles, paketExpress, kartLetzebuerg, kartLetzebuergMp, kartLetzebuergArcade, clientCommands, inboxCloud, busTycoon, newGroup, addMember, mediaCache, friendsAdd, slfRound, arcadePad, leaderboardTags, adminOnlineNotice, adminKartSaves, ccSigninHint, accountCheck, arcadeWeeklyStreak, idleRebirthHalloween, idleMoreContent, idleSoftcap, idleLiveGift, idleResetSafety, leaderboardBigScores, driveMadLevels, testMode, mordsfall];
const flows = words.length ? ALL.filter((f) => words.some((w) => f.name.includes(w))) : ALL;
if (!flows.length) { console.error(`No flow matches: ${words.join(", ")}\nAvailable: ${ALL.map((f) => f.name).join(", ")}`); process.exit(2); }

const [browser, { server, origin }] = await Promise.all([launchBrowser({ fullChromium: flows.some(flow => flow.fullChromium) }), startServer()]);
const results = [];
try {
  for (const flow of flows) results.push(await runFlow(flow, { browser, origin }));
} finally {
  await browser.close();
  server.close();
}

console.log("\n──────── flows ────────");
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.ok ? "" : "\n        " + r.failures.join("\n        ")}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed · videos in ${videoDir()}`);
process.exit(failed ? 1 : 0);
