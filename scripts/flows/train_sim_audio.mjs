/* Zuchsimulator audio: the procedural graph builds without errors, stays quiet-safe (no NaN, no clipping), keeps its node counts bounded while driving,
 * and works in Chromium (real game, test mode) and WebKit (offline render of the same graph). No sound is ever played (the browsers are muted / offline).
 * The offline renders use scripts/train_sound_scenarios.js, the same scenarios that scripts/train_sound_render.mjs writes WAVs from. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, runIfMain } from './lib.mjs';

const SCEN_SRC = fs.readFileSync(path.join(REPO, 'scripts/train_sound_scenarios.js'), 'utf8');
const AUDIO_SRC = fs.readFileSync(path.join(REPO, 'pb/train-sim/audio.js'), 'utf8');
const MAX_LIVE = 60;          // alive one-shot node groups at any moment
const SCENARIOS = ['tram_city', 'railcar', 'emu', 'kiss', 'ic', 'hst', 'tunnel_rain', 'oneshots'];

/* In-page offline render of a scenario: returns { peak, nan, stats, warnings }. Needs window.TS.audio and window.TS_SCEN. */
function renderInPage({ name, cam, sr, maxDur }) {
  return (async () => {
    const warnings = [], realWarn = console.warn;
    console.warn = (...a) => { warnings.push(a.map(String).join(' ').slice(0, 160)); };
    const sc = window.TS_SCEN.build(name, cam, maxDur);
    const ctx = new OfflineAudioContext(2, Math.ceil(sc.dur * sr), sr);
    const audio = window.TS.audio.create({ context: ctx });
    const frames = sc.frames, events = sc.events.slice().sort((a, b) => a.t - b.t);
    let fi = 0, ei = 0;
    const step = (t) => {
      while (fi < frames.length && frames[fi].t <= t + 1e-6) { audio.update(frames[fi].p); fi++; }
      while (ei < events.length && events[ei].t <= t + 1e-6) { const e = events[ei++]; if (typeof audio[e.fn] === 'function') audio[e.fn](...e.args); }
    };
    const quantum = 128 / sr, uniq = new Set();
    for (let t = 0; t < sc.dur; t += 1 / 30) uniq.add(Math.round(t / quantum) * quantum);
    uniq.forEach((t) => { if (t > 0 && t < sc.dur - 2 * quantum) ctx.suspend(t).then(() => { step(ctx.currentTime); ctx.resume(); }); });
    step(0);
    const buf = await ctx.startRendering();
    const l = buf.getChannelData(0), r = buf.getChannelData(1);
    let peak = 0, nan = 0;
    for (let i = 0; i < l.length; i++) { if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) { nan++; continue; } peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i])); }
    const stats = audio.stats();
    audio.dispose();
    console.warn = realWarn;
    return { peak, nan, stats, warnings };
  })();
}

async function importPlaywright() {
  for (const spec of ['playwright', pathToFileURL('/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright/index.mjs').href]) {
    try { return await import(spec); } catch { /* next */ }
  }
  return null;
}

export const flow = {
  name: 'train-sim-audio', fullChromium: true,
  async run(h) {
    const consoleErrors = [];
    h.page.on('console', (m) => {   // every console error, plus every warning that comes from Web Audio / our audio code (the game's own WebGL / canvas warnings are not ours)
      const text = m.text();
      if (/favicon/.test(m.location().url || '') || /Failed to load resource/.test(text)) return;
      if (m.type() === 'error' || (m.type() === 'warning' && /Lokféierer|audio|Oscillator|Biquad|AudioParam|AudioNode|AudioBuffer|Convolver|PeriodicWave/i.test(text))) consoleErrors.push(m.type() + ': ' + text.slice(0, 160));
    });
    await h.context.addInitScript(() => { window.__pbTestMode = true; });
    await h.goto('/pb/train-sim.html?test=1');
    await h.page.waitForFunction(() => window.__tsTest && window.__tsTest.state().phase === 'menu' && !document.getElementById('bootStatus').textContent, null, { timeout: 90000 });
    await h.page.addScriptTag({ content: SCEN_SRC });

    h.step('Chromium: the audio graph of every vehicle builds and renders (no NaN, no clipping, no warnings, bounded one-shots)');
    for (const name of SCENARIOS) {
      for (const cam of name === 'tram_city' ? ['cab', 'outside', 'inside'] : ['cab']) {
        const r = await h.page.evaluate(renderInPage, { name, cam, sr: 22050, maxDur: 45 });
        h.expect(r.nan === 0 && r.peak > 0.002 && r.peak < 0.99 && r.warnings.length === 0 && r.stats.live <= MAX_LIVE && r.stats.livePeak <= MAX_LIVE && r.stats.dropped === 0,
          `${name}/${cam}: peak ${r.peak.toFixed(2)}, NaN ${r.nan}, warnings ${r.warnings.length}, live peak ${r.stats.livePeak}, dropped ${r.stats.dropped}, pending ${r.stats.pending}`);
      }
    }

    h.step('Chromium: the real game (Luxtram, then Schinnebus) builds its audio and the node counts stay bounded while driving');
    for (const route of ['luxtram', 'west']) {
      await h.page.evaluate((r) => { __tsTest.setSeed(7); __tsTest.setCalm(true); __tsTest.setRoute(r); }, route);
      await h.page.waitForFunction(() => __tsTest.state().phase === 'running' && document.getElementById('loading').hidden, null, { timeout: 120000 });
      await h.page.mouse.click(450, 300);
      const woke = await h.page.evaluate(() => __tsTest.wakeAudio());
      h.expect(woke === true, `${route}: the audio object exists after the first gesture`);
      await h.page.evaluate(() => { const s = __tsTest.state(); __tsTest.placeAt(s.s + 200, 30); __tsTest.forceSimStep(0, 5); });
      const samples = [];
      for (let i = 0; i < 7; i++) {
        await h.page.waitForTimeout(2000);
        const lever = [5, 3, 0, -3, 5, 2, 4][i];
        await h.page.evaluate((l) => { __tsTest.forceSimStep(0, l); __tsTest.audioCall('horn', true); setTimeout(() => __tsTest.audioCall('horn', false), 600); __tsTest.audioCall('doorOpen'); __tsTest.audioCall('signalBell', 1, 0.5); }, lever);
        samples.push(await h.page.evaluate(() => __tsTest.audioStats()));
      }
      const last = samples[samples.length - 1];
      h.expect(samples.every((s) => s && s.state === 'running' && s.livePeak <= MAX_LIVE && s.dropped === 0), `${route}: running context, one-shots bounded (live peak ${Math.max(...samples.map((s) => s.livePeak))}), none dropped`);
      h.expect(samples.slice(1).every((s) => s.sources === samples[1].sources), `${route}: the number of looping sources stays constant while driving (${samples.map((s) => s.sources).join(',')})`);
      h.expect(last.live <= 30, `${route}: finished one-shots are released (${last.live} alive after the last burst)`);
      if (route === 'luxtram') {
        const ok = await h.page.evaluate(() => __tsTest.audioCall('announceClips', ['/data/luxtram/voice/exit-left-en.mp3'], 'x', 'en', 0));
        await h.page.waitForTimeout(900);
        const a = await h.page.evaluate(() => __tsTest.audioStats());
        h.expect(ok === true && a.clips > 0 && a.duck < 0.9, `luxtram: announcement clip decodes + plays and the vehicle sound is ducked (clips ${a.clips}, duck ${a.duck})`);
        await h.page.evaluate(() => __tsTest.audioCall('stopClips'));
      }
      await h.page.evaluate(() => __tsTest.audioCall('setMuted', true));
      await h.page.waitForTimeout(500);
      const m1 = await h.page.evaluate(() => __tsTest.audioStats());
      await h.page.evaluate(() => __tsTest.audioCall('setMuted', false));
      await h.page.waitForTimeout(500);
      const m2 = await h.page.evaluate(() => __tsTest.audioStats());
      h.expect(m1.muted === true && m1.master < 0.02 && m2.muted === false && m2.master > 0.5, `${route}: mute silences the master bus and unmute restores it (${m1.master} -> ${m2.master})`);
      await h.page.evaluate(() => __tsTest.toMenu());
      await h.page.waitForFunction(() => __tsTest.state().phase === 'menu', null, { timeout: 30000 });
    }
    h.expect(consoleErrors.length === 0, 'Chromium: no console errors or warnings during the drives' + (consoleErrors.length ? ' - ' + consoleErrors.slice(0, 3).join(' | ') : ''));

    h.step('WebKit (Safari engine): the same graph builds and renders');
    const pw = await importPlaywright();
    if (!pw || !pw.webkit) { h.expect(true, 'WebKit not installed here - skipped'); return; }
    const wk = await pw.webkit.launch();
    try {
      const wp = await wk.newPage();
      const wkErrors = [];
      wp.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') wkErrors.push(m.text().slice(0, 160)); });
      wp.on('pageerror', (e) => wkErrors.push('pageerror ' + e.message));
      await wp.goto('about:blank');
      await wp.addScriptTag({ content: SCEN_SRC });
      await wp.addScriptTag({ content: AUDIO_SRC });
      for (const [name, cam] of [['tram_city', 'cab'], ['tram_city', 'outside'], ['railcar', 'cab'], ['emu', 'inside'], ['hst', 'cab'], ['oneshots', 'outside']]) {
        const r = await wp.evaluate(renderInPage, { name, cam, sr: 22050, maxDur: 30 });
        h.expect(r.nan === 0 && r.peak > 0.002 && r.peak < 0.99 && r.warnings.length === 0 && r.stats.livePeak <= MAX_LIVE, `WebKit ${name}/${cam}: peak ${r.peak.toFixed(2)}, NaN ${r.nan}, warnings ${r.warnings.length}, live peak ${r.stats.livePeak}`);
      }
      h.expect(wkErrors.length === 0, 'WebKit: no console errors or warnings' + (wkErrors.length ? ' - ' + wkErrors.slice(0, 3).join(' | ') : ''));
    } finally { await wk.close(); }
  },
};

runIfMain(import.meta.url, flow);
