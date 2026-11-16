/* On-site face scan for "Mam Gesiicht aloggen". ES module, loaded on demand.
 *
 * Everything here runs in the browser: camera frames, face detection and the
 * 128-number face template (face-api.js and its models, served by ian.lu itself
 * from assets/face/). Nothing of the face is uploaded. A scan has three steps so a printed photo is not enough:
 *   1. look straight      → a few face templates
 *   2. turn the head      → the nose moves off the line between the eyes,
 *                           which a flat photo (even tilted) cannot do
 *   3. look straight again → must still be the same face as in step 1
 * The caller gets the averaged template; matching against saved ones is
 * matchFace() below. */

/* @vladmandic/face-api 1.7.15, self-hosted so no CDN can swap the code that
 * decides who you are: dist/face-api.esm.js and the three models used here,
 * byte for byte from the npm tarball (integrity sha512-WDMmK3CfNLo8jylWqMoQgf4n
 * Ist3M0fzx1dnac96wv/dvMTN4DxC/Pq1DGtduDk1lktCamQ3MIDXFnvrdHTXDw==); the SHA-256
 * of every file is in assets/face/1.7.15/SHA256SUMS. Another version goes in
 * another folder, so a stored copy is never stale. */
const FACE_API_DIR = new URL("assets/face/1.7.15/", import.meta.url);
const FACE_API_URL = new URL("face-api.esm.js", FACE_API_DIR).href;
const MODEL_URL = new URL("model/", FACE_API_DIR).href;
const DETECT_INPUT_SIZE = 320;
const DETECT_MIN_SCORE = 0.5;
const STRAIGHT_SAMPLES = 3;
const STRAIGHT_MAX_YAW = 0.08;
const TURN_MIN_YAW = 0.17;
const FRAME_GAP_MS = 120;
const SCAN_TIMEOUT_MS = 30000;
/* face-api's usual same-person cut-off is 0.6; 0.45 is stricter so two
 * classmates sharing an iPad are not mixed up. */
export const MATCH_DISTANCE = 0.45;
const SAME_SCAN_DISTANCE = 0.5;

const NOSE_TIP = 30;
const LEFT_EYE_OUTER = 36;
const RIGHT_EYE_OUTER = 45;

export class FaceScanError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

let faceApiPromise = null;

function loadFaceApi() {
  if (!faceApiPromise) {
    faceApiPromise = (async () => {
      const faceapi = await import(FACE_API_URL);
      await faceapi.tf.ready();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      return faceapi;
    })().catch((error) => {
      faceApiPromise = null;
      throw error;
    });
  }
  return faceApiPromise;
}

export function cameraSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
}

async function openCamera(video) {
  if (!cameraSupported()) throw new FaceScanError("no_camera", "camera API missing");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    });
  } catch (error) {
    const denied = error?.name === "NotAllowedError" || error?.name === "SecurityError";
    throw new FaceScanError(denied ? "camera_denied" : "no_camera", error?.message || "camera");
  }
  video.srcObject = stream;
  video.muted = true;
  video.setAttribute("playsinline", "");
  await video.play();
  return stream;
}

function stopCamera(stream, video) {
  stream?.getTracks().forEach((track) => track.stop());
  if (video) video.srcObject = null;
}

/** Head turn: nose tip offset from the eye midpoint, in eye-widths. */
function yawOf(landmarks) {
  const points = landmarks.positions;
  const left = points[LEFT_EYE_OUTER];
  const right = points[RIGHT_EYE_OUTER];
  const nose = points[NOSE_TIP];
  const eyeWidth = right.x - left.x;
  if (!eyeWidth) return 0;
  return (nose.x - (left.x + right.x) / 2) / eyeWidth;
}

export function faceDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) {
    const difference = a[index] - b[index];
    sum += difference * difference;
  }
  return Math.sqrt(sum);
}

function average(descriptors) {
  const size = descriptors[0].length;
  const mean = new Array(size).fill(0);
  descriptors.forEach((descriptor) => {
    for (let index = 0; index < size; index += 1) mean[index] += descriptor[index];
  });
  return mean.map((value) => Number((value / descriptors.length).toFixed(5)));
}

/** Best saved face within MATCH_DISTANCE, or null. */
export function matchFace(template, candidates) {
  let best = null;
  candidates.forEach((candidate) => {
    const distance = faceDistance(template, candidate.face);
    if (distance <= MATCH_DISTANCE && (!best || distance < best.distance)) {
      best = { candidate, distance };
    }
  });
  return best;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function detect(faceapi, video) {
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: DETECT_INPUT_SIZE,
    scoreThreshold: DETECT_MIN_SCORE,
  });
  const result = await faceapi.detectSingleFace(video, options)
    .withFaceLandmarks(true)
    .withFaceDescriptor();
  if (!result) return null;
  return { yaw: yawOf(result.landmarks), descriptor: Array.from(result.descriptor) };
}

/**
 * Runs the three-step scan on `video`. onStep(step) gets
 * "loading" | "straight" | "turn" | "back"; `signal` (AbortSignal) cancels.
 * Resolves to the averaged face template (array of 128 numbers).
 */
export async function scanFace(video, { onStep = () => {}, signal } = {}) {
  onStep("loading");
  const models = loadFaceApi();
  models.catch(() => {}); // awaited below; keeps an early failure from going unhandled
  const stream = await openCamera(video);
  try {
    let faceapi;
    try {
      faceapi = await models;
    } catch (error) {
      throw new FaceScanError("load_failed", error?.message || "face models");
    }
    const deadline = Date.now() + SCAN_TIMEOUT_MS;
    const samples = [];
    let step = "straight";
    onStep(step);
    while (true) {
      if (signal?.aborted) throw new FaceScanError("cancelled", "cancelled");
      if (Date.now() > deadline) throw new FaceScanError("timeout", "no face in time");
      const frame = await detect(faceapi, video);
      if (frame && step === "straight" && Math.abs(frame.yaw) <= STRAIGHT_MAX_YAW) {
        samples.push(frame.descriptor);
        if (samples.length >= STRAIGHT_SAMPLES) {
          step = "turn";
          onStep(step);
        }
      } else if (frame && step === "turn" && Math.abs(frame.yaw) >= TURN_MIN_YAW) {
        step = "back";
        onStep(step);
      } else if (frame && step === "back" && Math.abs(frame.yaw) <= STRAIGHT_MAX_YAW) {
        const first = average(samples);
        if (faceDistance(first, frame.descriptor) > SAME_SCAN_DISTANCE) {
          throw new FaceScanError("changed", "different face after the turn");
        }
        return average([...samples, frame.descriptor]);
      }
      await pause(FRAME_GAP_MS);
    }
  } finally {
    stopCamera(stream, video);
  }
}

/** Starts downloading the models early (e.g. when a face dialog opens). */
export function preloadFaceScan() {
  void loadFaceApi().catch((error) => console.warn("[face] models failed to load", error));
}
