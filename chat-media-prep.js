/* chat-media-prep.js — shrink chat photos before upload and make a small thumbnail.
 *
 * Chat bubbles show the ~480 px thumbnail (~30-40 KB); the full picture (max 1600 px) is only
 * downloaded when someone taps it. JPEG everywhere (WebKit can't encode WebP). Everything here
 * is best effort: on any failure the caller uploads the original file as before. */
export const FULL_MAX_EDGE = 1600;
export const FULL_QUALITY = 0.8;
export const THUMB_MAX_EDGE = 480;
export const THUMB_QUALITY = 0.72;
export const KEEP_ORIGINAL_BYTES = 400 * 1024;       // already small enough: don't re-encode
export const GIF_MAX_BYTES = 6 * 1024 * 1024;        // animated pictures are kept as-is up to this size
const POSTER_TIMEOUT_MS = 6000;

const EXT_BY_TYPE = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
export const extOf = (file) => EXT_BY_TYPE[file.type] || (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";

const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));

/* Draw `source` (w x h) scaled so its long edge is at most `maxEdge`; returns a JPEG blob. */
async function scaledJpeg(source, w, h, maxEdge, quality) {
  const k = Math.min(1, maxEdge / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * k)); canvas.height = Math.max(1, Math.round(h * k));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);   // transparent PNGs must not turn black
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await toBlob(canvas, quality);
  canvas.width = canvas.height = 0;                                           // free the bitmap (iPad memory)
  return blob && blob.type === "image/jpeg" ? blob : null;
}

async function decode(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { img, w: img.naturalWidth, h: img.naturalHeight };
  } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}

/* -> { full: Blob|File, ext, thumb: Blob }   |   { tooLarge: true } (huge GIF)   |   null (could not process) */
export async function prepareImage(file) {
  try {
    if (file.type === "image/gif" && file.size > GIF_MAX_BYTES) return { tooLarge: true };
    const { img, w, h } = await decode(file);
    if (!w || !h) return null;
    const thumb = await scaledJpeg(img, w, h, THUMB_MAX_EDGE, THUMB_QUALITY);
    if (!thumb) return null;
    if (file.type === "image/gif") return { full: file, ext: "gif", thumb };          // keep animation
    const small = Math.max(w, h) <= FULL_MAX_EDGE;
    if (small && file.size <= KEEP_ORIGINAL_BYTES && EXT_BY_TYPE[file.type]) return { full: file, ext: extOf(file), thumb };
    const full = await scaledJpeg(img, w, h, FULL_MAX_EDGE, FULL_QUALITY);
    if (!full || (small && full.size >= file.size && EXT_BY_TYPE[file.type])) return { full: file, ext: extOf(file), thumb };
    return { full, ext: "jpg", thumb };
  } catch { return null; }
}

/* A still from the video (about 1 s in) as a JPEG, or null if the browser can't give one in time. */
export function videoPoster(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    let done = false;
    const finish = (blob) => { if (done) return; done = true; clearTimeout(timer); v.removeAttribute("src"); v.load(); URL.revokeObjectURL(url); resolve(blob); };
    const timer = setTimeout(() => finish(null), POSTER_TIMEOUT_MS);
    v.muted = true; v.playsInline = true; v.preload = "auto";
    v.addEventListener("error", () => finish(null));
    v.addEventListener("loadedmetadata", () => { try { v.currentTime = Math.min(1, (v.duration || 2) / 2); } catch { finish(null); } });
    v.addEventListener("seeked", async () => {
      try { finish(v.videoWidth ? await scaledJpeg(v, v.videoWidth, v.videoHeight, THUMB_MAX_EDGE, THUMB_QUALITY) : null); } catch { finish(null); }
    });
    v.src = url;
  });
}
