/* Kamera-Arcade core: the input layer (real MediaPipe camera source OR a scripted synthetic source), landmark maths, sound, drawing helpers.
 *
 * Games never touch MediaPipe or the camera. They read a "frame" from Input:
 *   { t, aspect, hands: [ [21 x {x,y,z}] ... ], pose: [33 x {x,y,z,visibility}] | null }
 * x/y are 0..1 in DISPLAY space (already mirrored like a selfie mirror, so x grows to the right on the screen the player sees).
 * Angles and distances are computed in "unit height" space (u = x * aspect, v = y) so they are not stretched by the 4:3 frame.
 *
 * Privacy: the video frames are drawn to a canvas on this device and handed to the on-device MediaPipe model. Nothing is uploaded,
 * recorded or stored; stop() stops every camera track.
 *
 * MediaPipe Tasks Vision 0.10.35 (Apache-2.0, Google), self-hosted in ./vision_bundle.mjs and ./data/ (wasm + .task models). */

export const MEDIAPIPE_VERSION = "0.10.35";
const ASSET_V = 1;   // bump with the ?v= of core.js when vision_bundle.mjs changes

export const HAND = Object.freeze({ WRIST: 0, THUMB_TIP: 4, INDEX_MCP: 5, INDEX_PIP: 6, INDEX_TIP: 8, MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_TIP: 12, RING_MCP: 13, RING_PIP: 14, RING_TIP: 16, PINKY_MCP: 17, PINKY_PIP: 18, PINKY_TIP: 20 });
export const POSE = Object.freeze({ NOSE: 0, L_SH: 11, R_SH: 12, L_EL: 13, R_EL: 14, L_WR: 15, R_WR: 16, L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26, L_ANK: 27, R_ANK: 28 });
export const HAND_LINKS = Object.freeze([[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]]);
export const POSE_LINKS = Object.freeze([[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]]);

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ landmark maths (unit-height space) */
const du = (a, b, aspect) => (a.x - b.x) * aspect;
export function dist(a, b, aspect = 4 / 3) { return Math.hypot(du(a, b, aspect), a.y - b.y); }

/** Is each of index/middle/ring/pinky stretched? A finger counts as stretched when its tip is clearly farther from the wrist than its middle joint. */
export function fingersUp(pts, aspect = 4 / 3) {
  const w = pts[HAND.WRIST];
  return [[HAND.INDEX_TIP, HAND.INDEX_PIP], [HAND.MIDDLE_TIP, HAND.MIDDLE_PIP], [HAND.RING_TIP, HAND.RING_PIP], [HAND.PINKY_TIP, HAND.PINKY_PIP]]
    .map(([tip, pip]) => dist(pts[tip], w, aspect) > dist(pts[pip], w, aspect) * 1.12);
}

/** fist = "rock", flat hand = "paper", two fingers = "scissors", anything else "unknown". */
export function classifyHand(pts, aspect = 4 / 3) {
  if (!pts || pts.length < 21) return { kind: "unknown", up: [false, false, false, false] };
  const up = fingersUp(pts, aspect);
  const count = up.filter(Boolean).length;
  let kind = "unknown";
  if (count === 0) kind = "rock";
  else if (count >= 3) kind = "paper";
  else if (up[0] && up[1] && !up[2] && !up[3]) kind = "scissors";
  return { kind, up };
}

export const handScale = (pts, aspect = 4 / 3) => dist(pts[HAND.WRIST], pts[HAND.MIDDLE_MCP], aspect) || 0.05;

/** Thumb + index pinch with hysteresis (closes below 0.42 palm lengths, opens above 0.7). */
export function isPinching(pts, wasPinching, aspect = 4 / 3) {
  const ratio = dist(pts[HAND.THUMB_TIP], pts[HAND.INDEX_TIP], aspect) / handScale(pts, aspect);
  return wasPinching ? ratio < 0.7 : ratio < 0.42;
}

export const palmCenter = (pts) => {
  const ids = [0, 5, 9, 13, 17];
  return { x: ids.reduce((s, i) => s + pts[i].x, 0) / ids.length, y: ids.reduce((s, i) => s + pts[i].y, 0) / ids.length };
};

const vis = (p, min = 0.45) => !!p && (p.visibility === undefined || p.visibility >= min);

/** Body numbers the pose games need, or null when shoulders/hips are not clearly seen. Arm angles: 0 = hanging down, 90 = out sideways, 180 = straight up. */
export function poseMetrics(pose, aspect = 4 / 3) {
  if (!pose || pose.length < 29) return null;
  const P = (i) => pose[i];
  if (!(vis(P(POSE.L_SH), 0.5) && vis(P(POSE.R_SH), 0.5) && vis(P(POSE.L_HIP), 0.4) && vis(P(POSE.R_HIP), 0.4))) return null;
  const U = (p) => ({ u: p.x * aspect, v: p.y });
  const sl = U(P(POSE.L_SH)), sr = U(P(POSE.R_SH)), hl = U(P(POSE.L_HIP)), hr = U(P(POSE.R_HIP));
  const shMid = { u: (sl.u + sr.u) / 2, v: (sl.v + sr.v) / 2 }, hipMid = { u: (hl.u + hr.u) / 2, v: (hl.v + hr.v) / 2 };
  const sw = Math.hypot(sl.u - sr.u, sl.v - sr.v);
  const torso = Math.hypot(shMid.u - hipMid.u, shMid.v - hipMid.v);
  if (sw < 0.02 || torso < 0.04) return null;
  const arm = (shoulder, wrist, elbow, side) => {
    if (!vis(wrist, 0.35) || !vis(elbow, 0.35)) return null;
    const w = U(wrist);
    const dx = (w.u - shoulder.u) * (side === "L" ? -1 : 1), dy = w.v - shoulder.v;
    return Math.atan2(dx, dy) * 180 / Math.PI;
  };
  const la = vis(P(POSE.L_ANK), 0.4) ? U(P(POSE.L_ANK)) : null, ra = vis(P(POSE.R_ANK), 0.4) ? U(P(POSE.R_ANK)) : null;
  return {
    ok: true, sw, torso, shMid, hipMid, nose: vis(P(POSE.NOSE)) ? U(P(POSE.NOSE)) : null,
    armL: arm(sl, P(POSE.L_WR), P(POSE.L_EL), "L"), armR: arm(sr, P(POSE.R_WR), P(POSE.R_EL), "R"),
    ankleSpan: la && ra ? Math.abs(la.u - ra.u) / sw : null,
    ankleV: la && ra ? (la.v + ra.v) / 2 : null,
  };
}

/** Standing reference: the player stands still for a moment, after that rise/drop are measured in torso lengths. */
export class BodyRef {
  constructor() { this.reset(); }
  reset() { this.ready = false; this.base = null; this.samples = []; this.since = 0; }
  /** Feed one frame while calibrating. Returns progress 0..1 (1 = ready). */
  calibrate(m, now, holdMs = 1300) {
    if (this.ready) return 1;
    if (!m) { this.samples = []; this.since = 0; return 0; }
    const last = this.samples[this.samples.length - 1];
    if (last && Math.abs(last.v - m.shMid.v) > 0.025) { this.samples = []; this.since = 0; }
    if (!this.since) this.since = now;
    this.samples.push({ v: m.shMid.v, u: m.shMid.u, torso: m.torso, sw: m.sw, ankleV: m.ankleV });
    if (this.samples.length > 90) this.samples.shift();
    const progress = clamp((now - this.since) / holdMs, 0, 1);
    if (progress >= 1 && this.samples.length >= 4) {
      const med = (key) => { const a = this.samples.map((s) => s[key]).filter((x) => x !== null && x !== undefined).sort((p, q) => p - q); return a.length ? a[a.length >> 1] : null; };
      this.base = { v: med("v"), u: med("u"), torso: med("torso"), sw: med("sw"), ankleV: med("ankleV") };
      this.ready = true;
    }
    return progress;
  }
  /** Positive = the shoulders are higher than when standing (a jump), negative = lower (a squat), in torso lengths. */
  rise(m) { return this.base && m ? (this.base.v - m.shMid.v) / this.base.torso : 0; }
  /** Follow slow drifts (the player steps closer) but never a jump or a squat. */
  adapt(m, dt) {
    if (!this.ready || !m || Math.abs(this.rise(m)) > 0.12) return;
    const k = Math.min(1, dt * 0.8);
    this.base.v += (m.shMid.v - this.base.v) * k;
    this.base.torso += (m.torso - this.base.torso) * k;
    this.base.sw += (m.sw - this.base.sw) * k;
  }
}

/* ------------------------------------------------------------------ synthetic landmarks (tests, ?fake=, thumbnails) */
const HAND_BASE = [
  [0, 0], [-.38, .22], [-.62, .5], [-.78, .78], [-.92, 1.02],
  [-.32, 1.0], [-.32, 1.5], [-.32, 1.82], [-.32, 2.08],
  [0, 1.05], [0, 1.6], [0, 1.97], [0, 2.25],
  [.3, 1.0], [.3, 1.5], [.3, 1.82], [.3, 2.05],
  [.58, .9], [.58, 1.32], [.58, 1.54], [.58, 1.74],
];
const FINGER_X = { index: -.32, middle: 0, ring: .3, pinky: .58 };
const FINGER_MCP_ID = { index: 5, middle: 9, ring: 13, pinky: 17 };
const GESTURE_UP = { point: [1, 0, 0, 0], pinch: [1, 0, 0, 0], fist: [0, 0, 0, 0], flat: [1, 1, 1, 1], two: [1, 1, 0, 0] };

export const Synth = Object.freeze({
  /** A hand in display space. g: point | pinch | fist | flat | two. (x,y) is the index fingertip for point/pinch, the palm centre otherwise. s = palm length (unit-height). */
  hand({ x = 0.5, y = 0.5, g = "point", s = 0.085, aspect = 4 / 3 } = {}) {
    const local = HAND_BASE.map(([lx, ly]) => [lx, ly]);
    const up = GESTURE_UP[g] || GESTURE_UP.flat;
    Object.keys(FINGER_X).forEach((name, i) => {
      if (up[i]) return;
      const base = FINGER_MCP_ID[name], fx = FINGER_X[name];
      local[base + 1] = [fx, 1.25]; local[base + 2] = [fx, 1.02]; local[base + 3] = [fx, 0.74];
    });
    if (g === "fist" || g === "two" || g === "point") { local[2] = [-.5, .55]; local[3] = [-.38, .72]; local[4] = [-.2, .85]; }
    if (g === "pinch") { local[4] = [local[8][0] + .03, local[8][1] - .04]; local[3] = [local[4][0] - .12, local[4][1] - .2]; local[2] = [-.6, .55]; }
    const anchorLocal = g === "point" || g === "pinch" ? local[8] : [0, .55];
    return local.map(([lx, ly]) => ({ x: x + (lx - anchorLocal[0]) * s / aspect, y: y - (ly - anchorLocal[1]) * s, z: 0 }));
  },
  /** A standing person in display space. armL/armR: 0 down, 90 sideways, 180 up (screen-left arm is "L"). crouch 0..1, rise = jump height (unit-height), wide = legs apart 0..1. */
  pose({ cx = 0.5, sy = 0.3, sw = 0.15, armL = 12, armR = 12, crouch = 0, rise = 0, wide = 0, aspect = 4 / 3, visibility = 1 } = {}) {
    const out = Array.from({ length: 33 }, () => ({ x: cx, y: sy, z: 0, visibility }));
    const cu = cx * aspect;
    const torso = 1.4 * sw, ua = 0.85 * sw, fa = 0.75 * sw;
    const floorV = sy + 3.9 * sw;
    const shV = sy + crouch * 1.25 * sw - rise;
    const set = (i, u, v) => { out[i] = { x: u / aspect, y: v, z: 0, visibility }; };
    set(POSE.NOSE, cu, shV - 0.95 * sw);
    for (let i = 1; i <= 10; i += 1) set(i, cu + (i % 2 ? -0.1 : 0.1) * sw, shV - 0.95 * sw);
    set(POSE.L_SH, cu - 0.5 * sw, shV); set(POSE.R_SH, cu + 0.5 * sw, shV);
    const hipV = shV + torso * (1 - 0.12 * crouch);
    set(POSE.L_HIP, cu - 0.25 * sw, hipV); set(POSE.R_HIP, cu + 0.25 * sw, hipV);
    const ankV = floorV - rise, ankOut = (0.3 + wide * 1.1 + crouch * 0.25) * sw, kneeOut = ankOut * 0.55 + crouch * 0.3 * sw;
    const kneeV = (hipV + ankV) / 2 + crouch * 0.1 * sw;
    set(POSE.L_KNEE, cu - 0.25 * sw - kneeOut, kneeV); set(POSE.R_KNEE, cu + 0.25 * sw + kneeOut, kneeV);
    set(POSE.L_ANK, cu - 0.25 * sw - ankOut, ankV); set(POSE.R_ANK, cu + 0.25 * sw + ankOut, ankV);
    set(29, cu - 0.25 * sw - ankOut, ankV); set(30, cu + 0.25 * sw + ankOut, ankV);
    set(31, cu - 0.25 * sw - ankOut - 0.1 * sw, ankV); set(32, cu + 0.25 * sw + ankOut + 0.1 * sw, ankV);
    [[POSE.L_SH, POSE.L_EL, POSE.L_WR, armL, -1], [POSE.R_SH, POSE.R_EL, POSE.R_WR, armR, 1]].forEach(([s, e, w, deg, side]) => {
      const a = deg * Math.PI / 180, dx = side * Math.sin(a), dy = Math.cos(a);
      const sp = { u: out[s].x * aspect, v: out[s].y };
      set(e, sp.u + dx * ua, sp.v + dy * ua); set(w, sp.u + dx * (ua + fa), sp.v + dy * (ua + fa));
      [17, 19, 21].forEach((k) => { const idx = side < 0 ? k : k + 1; set(idx, sp.u + dx * (ua + fa), sp.v + dy * (ua + fa)); });
    });
    return out;
  },
});

/** A tiny moving demo for ?fake= (screenshots, the thumbnail, a visible "something happens" when nobody is testing). */
function demoFrame(kind, t, aspect) {
  const s = t / 1000;
  if (kind === "pose") {
    return { hands: [], pose: Synth.pose({ cx: 0.5 + Math.sin(s * 0.6) * 0.04, armL: 100 + Math.sin(s * 1.3) * 60, armR: 100 + Math.cos(s * 1.1) * 60, aspect }) };
  }
  const gestures = ["point", "flat", "fist", "two"];
  const g = gestures[Math.floor(s / 2.5) % 4];
  return {
    hands: [Synth.hand({ x: 0.5 + Math.sin(s * 0.9) * 0.28, y: 0.5 + Math.cos(s * 1.3) * 0.22, g, aspect }), Synth.hand({ x: 0.5 + Math.cos(s * 0.7) * 0.3, y: 0.55 + Math.sin(s * 1.1) * 0.2, g: "flat", aspect })],
    pose: null,
  };
}

/* ------------------------------------------------------------------ errors + asset loading */
export class CamError extends Error {
  constructor(kind, detail = "") { super(kind + (detail ? ": " + detail : "")); this.kind = kind; this.detail = detail; }
}

const DATA_URL = new URL("./data/", import.meta.url);
const ASSETS = Object.freeze({
  loader: { url: new URL("wasm/vision_wasm_internal.js", DATA_URL).href, bytes: 322044, type: "text/javascript" },
  wasm: { url: new URL("wasm/vision_wasm_internal.wasm", DATA_URL).href, bytes: 11153617, type: "application/wasm" },
  hands: { url: new URL("models/hand_landmarker.task", DATA_URL).href, bytes: 7819105 },
  pose: { url: new URL("models/pose_landmarker_lite.task", DATA_URL).href, bytes: 5777746 },
});
/** Decoded download sizes (MB) for the "first time only" note on the menu. */
export const DOWNLOAD_MB = Object.freeze({ hands: Math.round((ASSETS.loader.bytes + ASSETS.wasm.bytes + ASSETS.hands.bytes) / 1e6), pose: Math.round((ASSETS.loader.bytes + ASSETS.wasm.bytes + ASSETS.pose.bytes) / 1e6) });

async function fetchBytes(url, expected, onBytes, signal) {
  let response;
  try { response = await fetch(url, { signal }); } catch (error) { throw new CamError("model", "network: " + error.message); }
  if (!response.ok) throw new CamError("model", url + " -> " + response.status);
  if (!response.body || !response.body.getReader) { const all = new Uint8Array(await response.arrayBuffer()); onBytes(all.length); return all; }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); total += value.length; onBytes(value.length);
  }
  const all = new Uint8Array(total);
  let at = 0;
  chunks.forEach((chunk) => { all.set(chunk, at); at += chunk.length; });
  return all;
}

let visionModule = null;
let wasmBlobs = null;   // { loader: blobUrl, wasm: blobUrl } shared by both landmarkers: downloaded once per page
const modelBytes = new Map();

async function loadVisionAssets(kind, onProgress, signal) {
  const need = [];
  if (!wasmBlobs) need.push("loader", "wasm");
  if (!modelBytes.has(kind)) need.push(kind);
  const total = need.reduce((sum, key) => sum + ASSETS[key].bytes, 0) || 1;
  let done = 0;
  const bump = (n) => { done += n; onProgress(clamp(done / total, 0, 0.98)); };
  onProgress(0);
  if (!visionModule) visionModule = await import("./vision_bundle.mjs?v=" + ASSET_V).catch((error) => { throw new CamError("model", "bundle: " + error.message); });
  if (!wasmBlobs) {
    const [loader, wasm] = await Promise.all([fetchBytes(ASSETS.loader.url, ASSETS.loader.bytes, bump, signal), fetchBytes(ASSETS.wasm.url, ASSETS.wasm.bytes, bump, signal)]);
    wasmBlobs = {
      loader: URL.createObjectURL(new Blob([loader], { type: ASSETS.loader.type })),
      wasm: URL.createObjectURL(new Blob([wasm], { type: ASSETS.wasm.type })),
    };
  }
  if (!modelBytes.has(kind)) modelBytes.set(kind, await fetchBytes(ASSETS[kind].url, ASSETS[kind].bytes, bump, signal));
  onProgress(1);
  return { vision: visionModule, fileset: { wasmLoaderPath: wasmBlobs.loader, wasmBinaryPath: wasmBlobs.wasm }, model: modelBytes.get(kind) };
}

async function createLandmarker(kind, onProgress, preferred, signal) {
  const { vision, fileset, model } = await loadVisionAssets(kind, onProgress, signal);
  const Task = kind === "hands" ? vision.HandLandmarker : vision.PoseLandmarker;
  const options = kind === "hands"
    ? { numHands: 2, minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5 }
    : { numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 };
  const order = preferred === "cpu" ? ["CPU"] : ["GPU", "CPU"];
  let lastError = null;
  for (const delegate of order) {
    try {
      const landmarker = await Task.createFromOptions(fileset, { baseOptions: { modelAssetBuffer: model.slice(), delegate }, runningMode: "VIDEO", ...options });
      return { landmarker, delegate };
    } catch (error) { lastError = error; console.warn("[webcam] " + kind + " landmarker with " + delegate + " failed", error && error.message); }
  }
  throw new CamError("model", "landmarker: " + (lastError && lastError.message));
}

/* ------------------------------------------------------------------ the Input */
export const HINT_TEXT = Object.freeze({
  hands: "Ech gesinn keng Hand. Halt se an d'Kamera a maach d'Liicht un.",
  pose: "Ech gesinn däi Kierper net. Gëff 2 Schrëtt zréck, sou dass een ganze Kierper am Bild ass.",
  close: "Du bass ze no. Gëff e Stéck zréck.",
  far: "Du bass ze wäit ewech. Kënn e Stéck méi no.",
  dark: "Et ass ze däischter. Maach d'Liicht un.",
});

export class Input {
  /** need: "hands" | "pose". fake: "" (real camera) | "hands" | "pose" | "1" (scripted source, no camera). */
  constructor({ need, fake = "", delegate = "", onLost = () => {} }) {
    this.need = need; this.fake = fake; this.delegate = delegate; this.onLost = onLost;
    this.status = "idle"; this.aspect = 4 / 3;
    this.frame = { t: 0, aspect: this.aspect, hands: [], pose: null };
    this.lastSeenAt = 0; this.avgMs = 0; this.interval = 40; this.inferCount = 0; this.luma = 1; this.usedDelegate = "";
    this.video = null; this.stream = null; this.landmarker = null;
    this.lastVideoTime = -1; this.lastInfer = 0; this.lastTs = 0; this.lastLumaAt = 0; this.lumaCanvas = null;
    this.prevHands = []; this.prevPose = null; this.manual = false; this.demo = true;
  }

  /** Loads the model (progress callback 0..1) and opens the camera. Throws CamError. */
  async start(onProgress = () => {}) {
    this.status = "loading";
    try {
      if (this.fake) {
        onProgress(1); this.aspect = 4 / 3; this.status = "ready"; return;
      }
      // The model downloads while the permission prompt is open; if the camera is refused the download is cancelled.
      const abort = new AbortController();
      const loading = this.landmarker ? Promise.resolve(null) : createLandmarker(this.need, (p) => onProgress(p * 0.97), this.delegate, abort.signal);
      loading.catch(() => {});   // reported through Promise.all below; avoids an unhandled rejection when the camera fails first
      const [model] = await Promise.all([loading, this.openCamera().catch((error) => { abort.abort(); throw error; })]).catch((error) => { this.stop(); throw error; });
      if (model) { this.landmarker = model.landmarker; this.usedDelegate = model.delegate; }
      onProgress(1);
      this.status = "ready";
    } catch (error) { this.status = "error"; throw error; }
  }

  async openCamera() {
    if (!window.isSecureContext) throw new CamError("insecure");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new CamError("unsupported");
    const wanted = { video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } }, audio: false };
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia(wanted); }
    catch (error) {
      const name = (error && error.name) || "";
      if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
        try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); } catch (retry) { throw mapCameraError(retry); }
      } else throw mapCameraError(error);
    }
    this.stream = stream;
    stream.getTracks().forEach((track) => { track.onended = () => { if (this.stream === stream) { this.status = "lost"; this.onLost(); } }; });
    const video = document.createElement("video");
    video.setAttribute("playsinline", ""); video.setAttribute("webkit-playsinline", ""); video.muted = true; video.autoplay = true;
    video.style.cssText = "position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:.01;pointer-events:none";
    video.setAttribute("aria-hidden", "true");
    document.body.appendChild(video);
    video.srcObject = stream;
    this.video = video;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new CamError("busy", "no video frames")), 10000);
      const ready = () => { if (video.videoWidth > 0) { clearTimeout(timer); resolve(); } };
      video.addEventListener("loadedmetadata", ready); video.addEventListener("playing", ready); ready();
    });
    try { await video.play(); } catch (error) { /* autoplay can be refused until a gesture; the game starts from a tap, so this is rare */ }
    this.aspect = video.videoWidth / video.videoHeight;
  }

  /** Stops every camera track and removes the hidden video element. The model stays loaded for the next game. */
  stop() {
    if (this.stream) this.stream.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    this.stream = null;
    if (this.video) { this.video.pause(); this.video.srcObject = null; this.video.remove(); }
    this.video = null; this.prevHands = []; this.prevPose = null; this.lastVideoTime = -1;
    if (this.status !== "error") this.status = "idle";
  }

  dispose() {
    this.stop();
    if (this.landmarker) { try { this.landmarker.close(); } catch (error) { /* already closed */ } this.landmarker = null; }
  }

  get cameraOn() { return !!this.stream && this.stream.getTracks().some((track) => track.readyState === "live"); }

  /** Test hook: replace the frame (fake source only). Partial frames are fine: {hands:[...]} or {pose:[...]}. */
  feed(partial) {
    this.manual = true; this.demo = false;
    const frame = { t: performance.now(), aspect: this.aspect, hands: partial.hands || [], pose: partial.pose || null };
    this.frame = frame;
    if (frame.hands.length || frame.pose) this.lastSeenAt = frame.t;
  }

  /** Call every animation frame. Runs the model when one is due; returns the latest frame. */
  tick(now) {
    if (this.status !== "ready") return this.frame;
    if (this.fake) {
      if (this.demo) {
        const f = demoFrame(this.fake === "pose" || (this.fake === "1" && this.need === "pose") ? "pose" : "hands", now, this.aspect);
        this.frame = { t: now, aspect: this.aspect, hands: f.hands, pose: f.pose };
        this.lastSeenAt = now;
      }
      return this.frame;
    }
    const video = this.video;
    if (!video || video.readyState < 2 || !this.landmarker) return this.frame;
    if (video.videoWidth && Math.abs(video.videoWidth / video.videoHeight - this.aspect) > 0.01) this.aspect = video.videoWidth / video.videoHeight;
    this.sampleLight(now);
    if (now - this.lastInfer < this.interval || video.currentTime === this.lastVideoTime) return this.frame;
    this.lastVideoTime = video.currentTime; this.lastInfer = now;
    const started = performance.now();
    const ts = Math.max(started, this.lastTs + 1);
    this.lastTs = ts;
    try {
      if (this.need === "hands") this.readHands(this.landmarker.detectForVideo(video, ts), now);
      else this.readPose(this.landmarker.detectForVideo(video, ts), now);
    } catch (error) {
      this.errors = (this.errors || 0) + 1;
      if (this.errors < 4) console.warn("[webcam] detect failed", error && error.message);
    }
    const spent = performance.now() - started;
    this.avgMs = this.avgMs ? this.avgMs * 0.9 + spent * 0.1 : spent;
    this.inferCount += 1;
    this.interval = clamp(this.avgMs * 1.4, 33, 100);   // leave the browser time to draw: inference blocks the main thread
    return this.frame;
  }

  readHands(result, now) {
    const raw = (result.landmarks || []).map((hand) => hand.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z })));
    const smoothed = raw.map((hand) => {
      const prev = this.prevHands.reduce((best, cand) => (!best || dist(cand[0], hand[0]) < dist(best[0], hand[0]) ? cand : best), null);
      if (!prev || dist(prev[0], hand[0]) > 0.25) return hand;
      const speed = dist(prev[0], hand[0]);
      const alpha = clamp(0.4 + speed * 9, 0.4, 0.95);
      return hand.map((p, i) => ({ x: lerp(prev[i].x, p.x, alpha), y: lerp(prev[i].y, p.y, alpha), z: p.z }));
    });
    if (smoothed.length) { this.prevHands = smoothed; this.lastSeenAt = now; this.frame = { t: now, aspect: this.aspect, hands: smoothed, pose: null }; }
    else if (now - this.lastSeenAt < 160 && this.prevHands.length) this.frame = { t: now, aspect: this.aspect, hands: this.prevHands, pose: null, stale: true };   // bridge one dropped frame so a balloon is not missed
    else { this.prevHands = []; this.frame = { t: now, aspect: this.aspect, hands: [], pose: null }; }
  }

  readPose(result, now) {
    const first = result.landmarks && result.landmarks[0];
    if (!first) {
      if (now - this.lastSeenAt < 250 && this.prevPose) this.frame = { t: now, aspect: this.aspect, hands: [], pose: this.prevPose, stale: true };
      else { this.prevPose = null; this.frame = { t: now, aspect: this.aspect, hands: [], pose: null }; }
      return;
    }
    const prev = this.prevPose;
    const pose = first.map((p, i) => {
      const next = { x: 1 - p.x, y: p.y, z: p.z, visibility: p.visibility === undefined ? 1 : p.visibility };
      if (!prev) return next;
      const speed = Math.hypot(next.x - prev[i].x, next.y - prev[i].y);
      const alpha = clamp(0.45 + speed * 8, 0.45, 0.95);
      return { ...next, x: lerp(prev[i].x, next.x, alpha), y: lerp(prev[i].y, next.y, alpha) };
    });
    this.prevPose = pose; this.lastSeenAt = now;
    this.frame = { t: now, aspect: this.aspect, hands: [], pose };
  }

  sampleLight(now) {
    if (now - this.lastLumaAt < 1000 || !this.video) return;
    this.lastLumaAt = now;
    try {
      if (!this.lumaCanvas) { this.lumaCanvas = document.createElement("canvas"); this.lumaCanvas.width = 32; this.lumaCanvas.height = 24; }
      const c = this.lumaCanvas.getContext("2d", { willReadFrequently: true });
      c.drawImage(this.video, 0, 0, 32, 24);
      const data = c.getImageData(0, 0, 32, 24).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      this.luma = sum / (data.length / 4) / 255;
    } catch (error) { /* a canvas read can be refused; the light hint is then skipped */ }
  }

  /** A short reason why nothing is detected (key of HINT_TEXT), or "" when all is fine. */
  hint(now) {
    if (this.status !== "ready" || this.fake) return "";
    const missing = now - this.lastSeenAt > 1800;
    if (this.need === "hands") return missing ? (this.luma < 0.16 ? "dark" : "hands") : "";
    const m = poseMetrics(this.frame.pose, this.aspect);
    if (missing || !this.frame.pose) return this.luma < 0.16 ? "dark" : "pose";
    if (!m) return "pose";
    if (m.sw > 0.42) return "close";
    if (m.sw < 0.07) return "far";
    return "";
  }

  /** The dimmed, mirrored camera picture (or a calm grid for the scripted source). */
  drawFeed(c, W, H) {
    c.fillStyle = "#0b0d0f"; c.fillRect(0, 0, W, H);
    if (this.video && this.video.readyState >= 2) {
      c.save(); c.translate(W, 0); c.scale(-1, 1); c.globalAlpha = 0.42; c.drawImage(this.video, 0, 0, W, H); c.restore();
      return;
    }
    c.strokeStyle = "rgba(255,255,255,.05)"; c.lineWidth = 1;
    for (let x = 0; x <= W; x += 60) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = 0; y <= H; y += 60) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  }
}

function mapCameraError(error) {
  const name = (error && error.name) || "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return new CamError("denied", name);
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return new CamError("nocam", name);
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") return new CamError("busy", name);
  return new CamError("unsupported", name || String(error));
}

/* ------------------------------------------------------------------ drawing */
export function drawHand(c, pts, W, H, { color = "#6df0b0", alpha = 0.9, line = 3 } = {}) {
  c.save(); c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = line; c.lineCap = "round";
  c.beginPath();
  HAND_LINKS.forEach(([a, b]) => { c.moveTo(pts[a].x * W, pts[a].y * H); c.lineTo(pts[b].x * W, pts[b].y * H); });
  c.stroke();
  c.fillStyle = "#fff";
  pts.forEach((p, i) => { c.beginPath(); c.arc(p.x * W, p.y * H, i % 4 === 0 && i > 0 ? 5 : 3, 0, TAU); c.fill(); });
  c.restore();
}

export function drawPose(c, pose, W, H, { color = "#7cc4ff", alpha = 0.85, line = 4 } = {}) {
  c.save(); c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = line; c.lineCap = "round";
  c.beginPath();
  POSE_LINKS.forEach(([a, b]) => { if (vis(pose[a], 0.3) && vis(pose[b], 0.3)) { c.moveTo(pose[a].x * W, pose[a].y * H); c.lineTo(pose[b].x * W, pose[b].y * H); } });
  c.stroke();
  c.fillStyle = "#fff";
  [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].forEach((i) => { if (vis(pose[i], 0.3)) { c.beginPath(); c.arc(pose[i].x * W, pose[i].y * H, 4, 0, TAU); c.fill(); } });
  c.restore();
}

export function text(c, str, x, y, { size = 28, color = "#fff", align = "left", weight = 800, baseline = "alphabetic", shadow = true, font = "Geist, system-ui, -apple-system, sans-serif" } = {}) {
  c.save();
  c.font = `${weight} ${Math.round(size)}px ${font}`; c.textAlign = align; c.textBaseline = baseline;
  if (shadow) { c.lineJoin = "round"; c.lineWidth = Math.max(3, size / 6); c.strokeStyle = "rgba(0,0,0,.55)"; c.strokeText(str, x, y); }
  c.fillStyle = color; c.fillText(str, x, y);
  c.restore();
}

export function pill(c, x, y, w, h, fill = "rgba(10,12,14,.62)") {
  c.save(); c.fillStyle = fill; c.beginPath(); c.roundRect ? c.roundRect(x, y, w, h, h / 2) : c.rect(x, y, w, h); c.fill(); c.restore();
}

/* ------------------------------------------------------------------ sound (WebAudio beeps, nothing sampled) */
export const sfx = {
  muted: (() => { try { return localStorage.getItem("pb_muted") === "1"; } catch (error) { return false; } })(),
  ctx: null,
  unlock() {
    if (this.ctx || typeof AudioContext === "undefined") { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {}); return; }
    try { this.ctx = new AudioContext(); } catch (error) { this.ctx = null; }
  },
  tone(freq, dur = 0.12, type = "sine", vol = 0.12, slide = 0, delay = 0) {
    if (this.muted || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay, osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    gain.gain.setValueAtTime(vol, t0); gain.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    osc.connect(gain).connect(this.ctx.destination); osc.start(t0); osc.stop(t0 + dur + 0.02);
  },
  pop() { this.tone(520, 0.09, "triangle", 0.14, 380); },
  gold() { this.tone(880, 0.1, "square", 0.08); this.tone(1320, 0.16, "square", 0.08, 0, 0.08); },
  bad() { this.tone(160, 0.28, "sawtooth", 0.14, -90); },
  tick() { this.tone(660, 0.07, "square", 0.07); },
  go() { this.tone(990, 0.22, "square", 0.09); },
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, "triangle", 0.12, 0, i * 0.1)); },
  lose() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.2, "triangle", 0.12, 0, i * 0.13)); },
  jump() { this.tone(300, 0.16, "square", 0.07, 360); },
  hit() { this.tone(110, 0.3, "sawtooth", 0.16, -60); },
};
