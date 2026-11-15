/* Flows: Kamera-Arcade (pb/webcam.html), six games played with hands / body through the webcam.
 *
 *  webcam-arcade        the SCRIPTED input (?fake=hands / ?fake=pose, landmarks fed through window.__wc.feed): hub entry, menu, and the core loop of every game
 *                       (a fingertip pops a balloon, gestures win/lose/are not recognised, a pose passes a wall, a jump clears blocks, paddles follow hands,
 *                       a drawn circle scores well, free draw saves a PNG), scores reported once, no console errors, no camera in the denied/no-device case.
 *  webcam-arcade-camera Chromium's FAKE camera (--use-fake-device-for-media-stream): the real MediaPipe pipeline loads the self-hosted wasm + models, runs inference
 *                       on live frames without errors, nothing leaves the origin, and every camera track stops when the game is left.
 *  webcam-arcade-portrait  the hub and every intro on an iPad in portrait (touch): nothing overflows, the canvas fits.
 *
 * Screenshots (FLOW_SHOTS_DIR) are named webcam-arcade.<label>.png. */
import { runIfMain } from "./lib.mjs";

const SCORE_HOOK = () => {
  window.__wcAllowReport = true;                                   // the scripted input does not report scores unless a test asks for it
  window.__scores = [];
  window.addEventListener("arcade:score", (e) => window.__scores.push(e.detail));
};
const until = (page, fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 30 });
const wcState = (page) => page.evaluate(() => ({ ...window.__wc.state, d: window.__wc.debug() }));

/** Holds a gesture/pose in the scripted input (re-fed every 40 ms, like a camera would). `make` runs in the page and returns a frame. */
const hold = (page, makeSource) => page.evaluate((src) => {
  clearInterval(window.__hold);
  const make = new Function("S", "return (" + src + ")")(window.__wc.Synth);
  window.__make = make;
  window.__hold = setInterval(() => window.__wc.feed(window.__make()), 40);
  window.__wc.feed(window.__make());
}, makeSource);
const release = (page) => page.evaluate(() => { clearInterval(window.__hold); window.__hold = 0; });

function collect(page, h) {
  const errs = [], requests = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push("pageerror " + e.message));
  page.on("request", (r) => requests.push(r.url()));
  return { errs, requests };
}

async function openGame(h, id, { speed = 1, seed = 5, fake = "hands" } = {}) {
  const { page } = h;
  await h.goto(`/pb/webcam.html?fake=${fake}&seed=${seed}&speed=${speed}`);
  await page.waitForSelector(`#card-${id}`);
  await page.click(`#card-${id}`);
  await page.waitForSelector("#btnStart");
}
const startGame = async (page) => { await page.click("#btnStart"); await until(page, () => window.__wc.state.view === "play"); };

export const flow = {
  name: "webcam-arcade",
  viewport: { width: 1180, height: 820 },   // iPad landscape
  async run(h) {
    const { page } = h;
    const log = collect(page, h);
    await page.addInitScript(SCORE_HOOK);

    h.step("arcade hub: the Kamera-Arcade tile exists, has its own category and opens the page");
    await h.goto("/pixelbreak.html");
    await page.waitForFunction(() => typeof GAMES !== "undefined" && document.querySelectorAll(".game-card").length > 10);
    const entry = await page.evaluate(() => { const g = GAMES.find((x) => x.id === "webcam"); return g && { name: g.name, go: g.go, thumb: g.thumb, cats: g.cats, genre: !!document.querySelector('[data-genre="webcam"]') }; });
    h.expect(!!entry && entry.go === "pb/webcam.html" && entry.cats.includes("webcam") && entry.genre, `hub entry: ${JSON.stringify(entry)}`);
    await page.click('[data-genre="webcam"]');
    h.eq(await page.evaluate(() => [...document.querySelectorAll(".game-card")].filter((c) => c.offsetParent).length), 1, "the Kamera category shows exactly this game");
    await h.shot("hub-category");
    await page.evaluate(() => { const i = GAMES.findIndex((x) => x.id === "webcam"); openGo(i); });
    await page.waitForFunction(() => location.pathname.endsWith("/pb/webcam.html") || document.querySelector("#om"), null, { timeout: 8000 }).catch(() => {});

    h.step("menu: six games, the privacy note, no camera started yet");
    await h.goto("/pb/webcam.html?fake=hands&seed=5&speed=1");
    await page.waitForSelector(".wc-card");
    h.eq(await page.$$eval(".wc-card", (c) => c.length), 6, "six game cards");
    h.expect(/Your video never leaves this device/i.test(await page.innerText("#menu")), "the menu says: Your video never leaves this device");
    h.expect(/Apache-2\.0/.test(await page.innerText("#menuFoot")), "licence credit line");
    await h.shot("menu");

    /* ---------------- Ballonen ---------------- */
    h.step("Ballonen: the privacy note + permission explanation, then a scripted fingertip pops a balloon");
    await openGame(h, "balloons", { speed: 4 });
    h.expect(/Your video never leaves this device/i.test(await page.innerText("#panel")), "the intro panel carries the privacy note");
    await h.shot("balloons-intro");
    await startGame(page);
    await hold(page, "() => ({ hands: [S.hand({ x: 0.5, y: 0.1, g: 'point' })] })");
    await until(page, () => window.__wc.debug().phase === "play");
    await h.shot("balloons-play");
    // chase the first normal balloon with the fingertip, from below, like a swipe
    await page.evaluate(() => {
      clearInterval(window.__hold);
      window.__hold = setInterval(() => {
        const d = window.__wc.debug();
        const b = d.balloons.filter((x) => x.type !== "bomb").sort((p, q) => q.y - p.y).find((x) => x.y < 0.9) || d.balloons[0];
        const x = b ? b.x : 0.5, y = b ? b.y : 0.5;
        window.__wc.feed({ hands: [window.__wc.Synth.hand({ x, y, g: "point" })] });
      }, 30);
    });
    await until(page, () => window.__wc.debug().popped >= 3, null, 40000);
    const s1 = await wcState(page);
    h.expect(s1.d.score >= 3, `fingertip pops balloons (popped ${s1.d.popped}, score ${s1.d.score})`);
    // a bomb: put the fingertip on it, score does not rise and the clock loses 3 s
    await release(page);
    await until(page, () => window.__wc.debug().balloons.some((b) => b.type === "bomb"), null, 40000);
    const before = await wcState(page);
    await page.evaluate(() => {
      window.__hold = setInterval(() => {
        const b = window.__wc.debug().balloons.find((x) => x.type === "bomb");
        if (b) window.__wc.feed({ hands: [window.__wc.Synth.hand({ x: b.x, y: b.y, g: "point" })] });
      }, 30);
    });
    await until(page, (t) => window.__wc.debug().combo === 0 && window.__wc.debug().timeLeft < t - 2, before.d.timeLeft, 20000);
    const after = await wcState(page);
    h.expect(after.d.score <= before.d.score + 1 && after.d.combo === 0, `a bomb costs points and resets the combo (${before.d.score} -> ${after.d.score})`);
    await release(page);
    await page.evaluate(() => window.__wc.feed({ hands: [] }));
    await until(page, () => window.__wc.state.over, null, 60000);
    const over1 = await wcState(page);
    h.expect(over1.over && over1.over.score === over1.d.score, `the 60 s round ends with the game-over panel (score ${over1.over && over1.over.score})`);
    h.expect(over1.report && over1.report.final && over1.report.board === "webcam-balloons", "the final score goes to board webcam-balloons");
    const reported = await page.evaluate(() => window.__scores.filter((s) => s.final).map((s) => ({ score: s.score, board: s.board })));
    h.eq(reported, [{ score: over1.over.score, board: "webcam-balloons" }], "Arcade.gameOver fired once for that board");
    await page.waitForSelector("#btnAgain");
    await h.shot("balloons-over");

    /* ---------------- Steen, Pabeier, Schéier ---------------- */
    h.step("Steen, Pabeier, Schéier: gestures are recognised (paper, rock, scissors), a pointing finger is 'not recognised', the match ends");
    await openGame(h, "rps", { speed: 3 });
    await page.click('.arcade-seg button:has-text("5")');
    await startGame(page);
    const wait = (cond, timeout = 25000) => until(page, cond, null, timeout);
    const seen = [];
    for (const [gesture, kind] of [["flat", "paper"], ["fist", "rock"], ["two", "scissors"], ["point", "unknown"]]) {
      await hold(page, `() => ({ hands: [S.hand({ x: 0.5, y: 0.5, g: '${gesture}' })] })`);
      await wait(() => window.__wc.debug().phase === "count");
      await wait(() => window.__wc.debug().phase === "reveal");
      const d = (await wcState(page)).d;
      seen.push(`${gesture}->${d.yourPick}/${d.outcome}`);
      if (gesture === "flat") await h.shot("rps-reveal");
      h.expect(d.yourPick === kind, `${gesture} hand is read as ${kind} (got ${d.yourPick}, computer ${d.cpuPick}, ${d.outcome})`);
      if (kind === "unknown") h.eq(d.outcome, "retry", "an unreadable gesture repeats the round instead of counting");
      else {
        const beats = { rock: "scissors", paper: "rock", scissors: "paper" };
        const expected = d.yourPick === d.cpuPick ? "draw" : beats[d.yourPick] === d.cpuPick ? "win" : "lose";
        h.eq(d.outcome, expected, `outcome ${expected} follows the rules`);
      }
      await wait(() => window.__wc.debug().phase !== "reveal" || window.__wc.state.over);
    }
    await hold(page, "() => ({ hands: [S.hand({ x: 0.5, y: 0.5, g: 'flat' })] })");
    await until(page, () => window.__wc.state.over, null, 90000);
    const over2 = await wcState(page);
    const expectedScore = over2.d.you * 10 + (over2.d.you >= over2.d.target ? 20 : 0);
    h.expect(over2.over.score === expectedScore && (over2.d.you === over2.d.target || over2.d.cpu === over2.d.target), `match over ${over2.d.you}:${over2.d.cpu}, score ${over2.over.score} = ${expectedScore}`);
    h.eq(over2.report.board, "webcam-rps-5", "boards are per best-of length");
    await release(page);

    /* ---------------- D'Mauer ---------------- */
    h.step("D'Mauer: calibrate standing, strike every wall's pose to pass it, then miss until the game is over");
    await openGame(h, "wall", { speed: 4, fake: "pose" });
    await startGame(page);
    await hold(page, "() => ({ pose: S.pose({}) })");
    await until(page, () => ["wall", "count"].includes(window.__wc.debug().phase), null, 20000);
    h.expect((await wcState(page)).d.ready, "standing still calibrates");
    await until(page, () => window.__wc.debug().phase === "wall");
    await page.evaluate(() => {
      window.__follow = true;
      clearInterval(window.__hold);
      window.__hold = setInterval(() => {
        const d = window.__wc.debug(), S = window.__wc.Synth;
        const s = window.__follow && d.shape ? d.shape : { armL: 12, armR: 12, crouch: 0, wide: 0 };
        window.__wc.feed({ pose: S.pose({ armL: s.armL, armR: s.armR, crouch: s.crouch, wide: s.wide }) });
      }, 30);
    });
    await until(page, () => window.__wc.debug().passed >= 3, null, 60000);
    const w1 = await wcState(page);
    h.expect(w1.d.passed >= 3 && w1.d.score >= 30 && w1.d.lives === 3, `walls passed with the right pose (${w1.d.passed} passed, score ${w1.d.score}, lives ${w1.d.lives})`);
    await until(page, () => window.__wc.debug().phase === "wall" && window.__wc.debug().t > 0.6);
    await h.shot("wall-play");
    await page.evaluate(() => { window.__follow = false; });   // arms down: never fits any hole
    await until(page, () => window.__wc.state.over, null, 60000);
    const over3 = await wcState(page);
    h.expect(over3.d.lives === 0 && over3.over.score === over3.d.score, `three misses end the game (score ${over3.over.score})`);
    h.eq(over3.report.board, "webcam-wall", "board webcam-wall");
    await release(page);

    /* ---------------- Sprangen ---------------- */
    h.step("Sprangen: a scripted jump clears the blocks, a squat goes under the bars, doing nothing hits one");
    await openGame(h, "jump", { speed: 2, fake: "pose" });
    await startGame(page);
    await hold(page, "() => ({ pose: S.pose({}) })");
    await until(page, () => window.__wc.debug().phase === "run", null, 20000);
    await page.evaluate(() => {
      window.__auto = true; window.__jumps = 0; window.__ducks = 0;
      clearInterval(window.__hold);
      window.__hold = setInterval(() => {
        const d = window.__wc.debug(), S = window.__wc.Synth;
        let rise = 0, crouch = 0;
        if (window.__auto && d.phase === "run") {
          const ahead = d.obstacles.filter((o) => o.x + o.w > 0.22 - 0.03).sort((a, b) => a.x - b.x)[0];
          if (ahead) {
            const t = ((ahead.x - 0.22) * 960) / d.speed;   // seconds until the obstacle reaches the runner
            if (ahead.type === "block" && t < 0.3 && t > -0.2 && !d.airborne) { rise = 0.09; window.__jumps += 1; }
            if (ahead.type === "bar" && t < 0.45) { crouch = 1; window.__ducks += 1; }
          }
        }
        window.__wc.feed({ pose: S.pose({ rise, crouch }) });
      }, 16);
    });
    await until(page, () => window.__wc.debug().dist >= 80 || window.__wc.state.over, null, 90000);
    const j1 = await wcState(page);
    h.expect(!j1.over && j1.d.dist >= 80, `the runner cleared obstacles for ${Math.floor(j1.d.dist)} m (${await page.evaluate(() => window.__jumps)} jump frames, ${await page.evaluate(() => window.__ducks)} duck frames)`);
    await h.shot("jump-play");
    await page.evaluate(() => { window.__auto = false; });
    await until(page, () => window.__wc.state.over, null, 60000);
    const over4 = await wcState(page);
    h.expect(over4.over.score >= 80 && over4.over.score === Math.floor(over4.d.dist), `standing still hits an obstacle: ${over4.over.score} m`);
    h.eq(over4.report.board, "webcam-jump", "board webcam-jump");
    await release(page);

    /* ---------------- Hand-Pong ---------------- */
    h.step("Hand-Pong: left and right hand move two paddles, a rally bounces, a missed ball scores");
    await openGame(h, "pong", { speed: 2 });
    await startGame(page);
    await hold(page, "() => ({ hands: [S.hand({ x: 0.2, y: 0.3, g: 'flat' }), S.hand({ x: 0.8, y: 0.7, g: 'flat' })] })");
    await until(page, () => window.__wc.debug().phase === "serve" || window.__wc.debug().phase === "play");
    await page.waitForTimeout(600);
    const p1 = (await wcState(page)).d;
    h.expect(Math.abs(p1.paddles.l - 0.3) < 0.07 && Math.abs(p1.paddles.r - 0.7) < 0.07, `paddles follow the two hands (left ${p1.paddles.l.toFixed(2)}, right ${p1.paddles.r.toFixed(2)})`);
    await until(page, () => window.__wc.debug().phase === "play");
    await h.shot("pong-play");
    await page.evaluate(() => {
      window.__bounces = 0; let lastSign = 0;
      clearInterval(window.__hold);
      window.__hold = setInterval(() => {
        const d = window.__wc.debug(), S = window.__wc.Synth, y = Math.min(0.9, Math.max(0.1, d.ball.y));
        const sign = Math.sign(d.ball.vx); if (lastSign && sign && sign !== lastSign) window.__bounces += 1; if (sign) lastSign = sign;
        window.__wc.feed({ hands: [S.hand({ x: 0.2, y, g: "flat" }), S.hand({ x: 0.8, y, g: "flat" })] });
      }, 20);
    });
    await until(page, () => window.__bounces >= 3, null, 40000);
    h.expect(true, `rally: the ball bounced ${await page.evaluate(() => window.__bounces)} times off the paddles`);
    await page.evaluate(() => { clearInterval(window.__hold); window.__hold = setInterval(() => window.__wc.feed({ hands: [window.__wc.Synth.hand({ x: 0.2, y: 0.08, g: "flat" }), window.__wc.Synth.hand({ x: 0.8, y: 0.08, g: "flat" })] }), 20); });
    await until(page, () => { const d = window.__wc.debug(); return d.left + d.right >= 1; }, null, 40000);
    const p2 = (await wcState(page)).d;
    h.expect(p2.left + p2.right >= 1, `a missed ball scores a point (${p2.left} : ${p2.right})`);
    await release(page);
    h.eq(await page.evaluate(() => window.__scores.length), 0, "Hand-Pong saves no score");

    h.step("Hand-Pong vs the computer: one hand is enough");
    await openGame(h, "pong", { speed: 2 });
    await page.click('.arcade-seg button:has-text("Géint Computer")');
    await startGame(page);
    await hold(page, "() => ({ hands: [S.hand({ x: 0.3, y: 0.5, g: 'flat' })] })");
    await until(page, () => window.__wc.debug().phase === "play", null, 30000);
    h.expect((await wcState(page)).d.ai === true, "AI mode: the right paddle is the computer");

    /* ---------------- Loftmolerei ---------------- */
    h.step("Loftmolerei: shape scoring maths, a pinch-drawn shape scores well, a scribble does not");
    const maths = await page.evaluate(async () => {
      const m = await import("/pb/webcam/g-draw.js?v=1");
      const circle = m.SHAPES.find((s) => s.id === "circle"), pts = circle.refs[0][0];
      const good = [pts.map((p) => ({ x: 400 + p.x * 200, y: 300 + p.y * 200 }))];
      const line = [Array.from({ length: 40 }, (_, i) => ({ x: 100 + i * 10, y: 300 }))];
      return { good: m.scoreShape(good, circle).score, line: m.scoreShape(line, circle).score, shapes: m.SHAPES.length };
    });
    h.expect(maths.good >= 90 && maths.line <= 20 && maths.shapes >= 8, `scoring: circle ${maths.good}, straight line ${maths.line} (of ${maths.shapes} shapes)`);

    await openGame(h, "draw", { speed: 3 });
    await startGame(page);
    const drawShape = (quality) => page.evaluate(async (q) => {
      const m = await import("/pb/webcam/g-draw.js?v=1");
      const d0 = window.__wc.debug();
      const shape = m.SHAPES.find((s) => s.id === d0.shape);
      const refs = shape.refs[0], S = window.__wc.Synth;
      const all = refs.flat(), minX = Math.min(...all.map((p) => p.x)), maxX = Math.max(...all.map((p) => p.x)), minY = Math.min(...all.map((p) => p.y)), maxY = Math.max(...all.map((p) => p.y));
      const size = Math.max(maxX - minX, maxY - minY), cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const to = (p) => ({ x: 0.5 + (p.x - cx) / size * 0.42, y: 0.52 + (p.y - cy) / size * 0.5 });
      const track = [];
      refs.forEach((pl) => { for (let i = 1; i < pl.length; i += 1) for (let t = 0; t < 8; t += 1) track.push({ ...to({ x: pl[i - 1].x + (pl[i].x - pl[i - 1].x) * t / 8, y: pl[i - 1].y + (pl[i].y - pl[i - 1].y) * t / 8 }), down: true }); track.push({ x: track[track.length - 1].x, y: track[track.length - 1].y, down: false }); });
      const pts = q === "bad" ? Array.from({ length: 30 }, (_, i) => ({ x: 0.35 + i * 0.01, y: 0.5, down: true })) : track;
      for (const p of pts) { window.__wc.feed({ hands: [S.hand({ x: p.x, y: p.y, g: p.down ? "pinch" : "point" })] }); await new Promise((r) => setTimeout(r, 18)); }
      window.__wc.feed({ hands: [S.hand({ x: 0.5, y: 0.9, g: "flat" })] });   // let go: the drawing is handed in after a moment
      return shape.id;
    }, quality);
    await hold(page, "() => ({ hands: [S.hand({ x: 0.5, y: 0.9, g: 'flat' })] })");
    await until(page, () => window.__wc.debug().phase === "draw", null, 20000);
    await h.shot("draw-prompt");
    const ids = [];
    for (let round = 0; round < 5; round += 1) {
      await until(page, () => window.__wc.debug().phase === "draw", null, 30000);
      await release(page);
      const bad = round === 4;
      ids.push(await drawShape(bad ? "bad" : "good"));
      await until(page, () => window.__wc.debug().phase === "result" || window.__wc.state.over, null, 30000);
      const r = (await wcState(page)).d;
      if (round === 0) await h.shot("draw-result");
      if (!bad) h.expect(r.last.score >= 60, `round ${round + 1}: a drawn ${ids[round]} scores ${r.last.score}`);
      else h.expect(r.last.score <= 35, `round 5: a scribble scores low (${r.last.score})`);
      await hold(page, "() => ({ hands: [S.hand({ x: 0.5, y: 0.9, g: 'flat' })] })");
      await until(page, () => window.__wc.state.over || window.__wc.debug().phase === "draw" || window.__wc.debug().phase === "intro", null, 30000);
    }
    await until(page, () => window.__wc.state.over, null, 30000);
    const over5 = await wcState(page);
    h.expect(over5.over.score === over5.d.total && over5.d.results.length === 5, `five shapes, total ${over5.over.score}`);
    h.eq(over5.report.board, "webcam-draw", "board webcam-draw");
    h.eq(await page.evaluate(() => window.__scores.filter((s) => s.board === "webcam-draw" && s.final).length), 1, "one final score for the drawing round");
    await release(page);

    h.step("Loftmolerei free mode: draw, pick a colour by hovering, save a PNG");
    await openGame(h, "draw", { speed: 3 });
    await page.click('.arcade-seg button:has-text("Fräi")');
    await startGame(page);
    await hold(page, "() => ({ hands: [S.hand({ x: 0.036, y: 0.314, g: 'point' })] })");   // hover the third colour chip
    await page.waitForTimeout(900);
    h.eq((await wcState(page)).d.color, "#ffd23f", "hovering a colour chip with an open hand picks it");
    await release(page);
    await page.evaluate(async () => {
      const S = window.__wc.Synth;
      for (let i = 0; i < 40; i += 1) { window.__wc.feed({ hands: [S.hand({ x: 0.3 + i * 0.01, y: 0.4 + Math.sin(i / 5) * 0.05, g: "pinch" })] }); await new Promise((r) => setTimeout(r, 20)); }
      window.__wc.feed({ hands: [S.hand({ x: 0.5, y: 0.8, g: "flat" })] });
    });
    const f1 = (await wcState(page)).d;
    h.expect(f1.strokes === 1 && f1.points > 20, `free draw: ${f1.strokes} stroke, ${f1.points} points`);
    await h.shot("draw-free");
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }), page.click('.wc-tool:has-text("PNG späicheren")')]);
    const file = await download.path();
    const { size } = (await import("node:fs")).statSync(file);
    h.expect(download.suggestedFilename() === "loftmolerei.png" && size > 1500, `PNG download ${download.suggestedFilename()} (${size} bytes)`);
    h.eq(await page.evaluate(() => window.__scores.filter((s) => s.board === "webcam").length), 0, "free draw reports no score");

    /* ---------------- camera denied / missing ---------------- */
    h.step("no camera / refused permission: a clear message, a way back, never a blank page");
    await h.goto("/pb/webcam.html?seed=5");   // no ?fake: the real camera path; headless Chromium has no camera
    await page.click("#card-balloons");
    await page.click("#btnStart");
    await page.waitForSelector("#btnRetry", { timeout: 15000 });
    const err = await page.evaluate(() => ({ kind: window.__wc.lastError, text: document.getElementById("overlay").innerText, menuBtn: !!document.getElementById("btnErrMenu") }));
    h.expect(["nocam", "denied", "unsupported"].includes(err.kind) && err.menuBtn && /Kamera/.test(err.text), `error panel for "${err.kind}" with retry + back (${err.text.split("\n")[0]})`);
    await h.shot("camera-error");
    await page.click("#btnErrMenu");
    await page.waitForSelector(".wc-card");

    h.step("nothing failed: no uncaught errors, no console errors, no request left the site for a model or video");
    const bad = log.errs.filter((e) => !/Failed to load resource/i.test(e));
    h.eq(bad, [], "no console errors");
    const foreign = log.requests.filter((u) => /googleapis|mediapipe|storage\.google|gstatic/i.test(u));
    h.eq(foreign, [], "models and wasm are self-hosted");
    h.eq(await page.evaluate(() => window.__wc.errors), [], "no errors recorded by the page");
  },
};

/* Chromium's fake camera: proves the real MediaPipe path (self-hosted wasm + models, inference on live frames) without a person in front of it. */
export const flowCamera = {
  name: "webcam-arcade-camera",
  viewport: { width: 1180, height: 820 },
  chromiumArgs: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  permissions: ["camera"],
  async run(h) {
    const { page } = h;
    const log = collect(page, h);
    const hostOf = (u) => { try { return new URL(u).host; } catch { return ""; } };
    for (const [id, need, query] of [["balloons", "hands", ""], ["wall", "pose", "&delegate=cpu"]]) {   // hands: GPU delegate first (software GL here), pose: the CPU path
      h.step(`${id}: the real pipeline loads the ${need} model from this site and runs inference on the (fake) camera`);
      await h.goto("/pb/webcam.html?seed=5" + query);
      await page.click(`#card-${id}`);
      await page.click("#btnStart");
      await page.waitForFunction(() => document.getElementById("loadFill") || window.__wc.state.view === "play" || window.__wc.lastError, null, { timeout: 10000 });
      await page.waitForFunction(() => window.__wc.state.view === "play" || window.__wc.lastError, null, { timeout: 120000 });
      h.eq(await page.evaluate(() => window.__wc.lastError), "", `${id}: no camera/model error`);
      await page.waitForFunction(() => window.__wc.input && window.__wc.input.inferCount >= 15, null, { timeout: 60000 });
      const s = await page.evaluate(() => { const i = window.__wc.input; return { n: i.inferCount, ms: Math.round(i.avgMs), delegate: i.usedDelegate, on: i.cameraOn, need: i.need, aspect: +i.aspect.toFixed(2), luma: +i.luma.toFixed(2) }; });
      h.expect(s.n >= 15 && s.on, `${id}: ${s.n} inferences, ${s.ms} ms each, delegate ${s.delegate}, camera on, aspect ${s.aspect}`);
      await h.shot(`${id}-fake-camera`);
      const pixels = await page.evaluate(() => { const cv = document.getElementById("cv"), c = cv.getContext("2d"); const d = c.getImageData(0, 0, cv.width, cv.height).data; let lit = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] > 60) lit += 1; return lit; });
      h.expect(pixels > 20, `${id}: the camera picture is drawn on the canvas (${pixels} lit samples)`);
      await page.click("#btnMenu");
      const off = await page.evaluate(() => { const i = window.__wc.input; return { stream: !!i.stream, live: i.cameraOn, video: !!i.video, hidden: !document.querySelector("video") }; });
      h.expect(!off.stream && !off.live && !off.video && off.hidden, `${id}: leaving the game stops every camera track (${JSON.stringify(off)})`);
    }
    h.step("a hidden tab stops the camera too");
    await page.click("#card-balloons"); await page.click("#btnStart");
    await page.waitForFunction(() => window.__wc.state.view === "play", null, { timeout: 60000 });
    await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
    await page.waitForSelector("#btnResume");
    h.expect(!(await page.evaluate(() => window.__wc.input.cameraOn)), "tab hidden: camera tracks stopped, pause panel shown");
    await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); });
    await page.click("#btnResume");
    await page.waitForFunction(() => window.__wc.state.view === "play" && window.__wc.input.cameraOn, null, { timeout: 30000 });
    h.expect(true, "resume restarts the camera");

    h.step("everything came from this origin; no console errors");
    const origin = hostOf(h.origin);
    const foreign = log.requests.filter((u) => /^https?:/.test(u) && hostOf(u) !== origin && !/supabase|jsdelivr|esm\.sh/.test(u));
    h.eq(foreign, [], "no request to another host (models + wasm are self-hosted)");
    // MediaPipe's wasm prints its own INFO lines (the CPU delegate message) through console.error: not an error
    const bad = log.errs.filter((e) => !/Failed to load resource/i.test(e) && !/^INFO:/.test(e));
    h.eq(bad, [], "no console errors from the real pipeline");
  },
};

/* iPad portrait (touch): hub + every game's intro fit the screen. */
export const flowPortrait = {
  name: "webcam-arcade-portrait",
  touch: true,
  async run(h) {
    const { page } = h;
    const log = collect(page, h);
    h.step("hub and intros on an iPad in portrait");
    await h.goto("/pb/webcam.html?fake=hands&seed=5");
    await page.waitForSelector(".wc-card");
    const over = async (label) => { const o = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth, w: innerWidth })); h.expect(o.x <= 1, `${label}: no horizontal overflow (${o.x})`); };
    await over("menu"); await h.shot("portrait-menu");
    for (const id of ["balloons", "rps", "wall", "jump", "pong", "draw"]) {
      await page.click(`#card-${id}`);
      await page.waitForSelector("#btnStart");
      await over(id);
      const fit = await page.evaluate(() => { const f = document.getElementById("frame").getBoundingClientRect(), b = document.getElementById("box").getBoundingClientRect(), p = document.getElementById("panel").getBoundingClientRect(); return { frameFits: f.width <= b.width + 1 && f.height <= b.height + 1, panelFits: p.bottom <= b.bottom + 1 && p.top >= b.top - 1, w: Math.round(f.width), h: Math.round(f.height) }; });
      h.expect(fit.frameFits && fit.panelFits, `${id}: canvas ${fit.w}x${fit.h} and the intro panel fit the box`);
      if (id === "balloons") { await page.click("#btnStart"); await page.waitForFunction(() => window.__wc.state.view === "play"); await page.waitForTimeout(1500); await h.shot("portrait-balloons"); }
      await page.click(id === "balloons" ? "#btnMenu" : "#btnIntroMenu");
      await page.waitForSelector(".wc-card");
    }
    h.eq(log.errs.filter((e) => !/Failed to load resource/i.test(e)), [], "no console errors");
  },
};

runIfMain(import.meta.url, flow);
