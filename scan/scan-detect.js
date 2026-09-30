/* Fiche scanner: page detection (OpenCV.js), perspective warp, enhancement and
 * the auto-capture stability tracker. Pure helpers are exported so they can be
 * unit-tested in Node (module.exports) as well as used in the browser
 * (window.ScanDetect). */
(function (root) {
  'use strict';

  var OPENCV_SOURCES = [
    'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js',
    'https://unpkg.com/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js',
    'https://docs.opencv.org/4.9.0/opencv.js'
  ];
  var OPENCV_POLL_MS = 150;
  var OPENCV_TIMEOUT_MS = 90000;

  var MIN_QUAD_AREA = 0.12; // fraction of the frame; smaller quads are ignored
  var MAX_QUAD_AREA = 0.98; // a quad spanning the whole frame is a border artefact
  var APPROX_EPSILON = 0.02;
  var MIN_EDGE_FRACTION = 0.1;
  var MAX_OPPOSITE_EDGE_RATIO = 2.5;
  var CANNY_LOW = 50;
  var CANNY_HIGH = 150;

  var ENHANCE_LOW_PERCENTILE = 0.01;
  var ENHANCE_HIGH_PERCENTILE = 0.9;
  var ENHANCE_LOW_CAP = 80;
  var ENHANCE_HIGH_FLOOR = 150;
  var ENHANCE_SAMPLE_STEP = 4;

  var TRACKER_DEFAULTS = {
    minArea: 0.2, // quad must cover more than 20% of the frame
    stableShift: 0.02, // corners may move < 2% of the frame size
    holdMs: 1200,
    stableShowMs: 400, // when the overlay turns green
    releaseMissingMs: 800, // quad must be gone this long to count as "disappeared"
    bigMoveShift: 0.15, // sheet moved a lot -> it was swapped
    differentShift: 0.06, // "clearly different" quad ...
    differentMs: 2500 // ... for this long -> allow a new capture
  };

  // ---------------------------------------------------------------- geometry

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Orders four points as [topLeft, topRight, bottomRight, bottomLeft]. */
  function orderCorners(points) {
    if (!Array.isArray(points) || points.length !== 4) {
      throw new Error('orderCorners needs exactly 4 points');
    }
    var bySum = points.slice().sort(function (a, b) { return (a.x + a.y) - (b.x + b.y); });
    var byDiff = points.slice().sort(function (a, b) { return (a.y - a.x) - (b.y - b.x); });
    return [bySum[0], byDiff[0], bySum[3], byDiff[3]];
  }

  /** Shoelace area of a polygon. */
  function polygonArea(points) {
    var sum = 0;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var q = points[(i + 1) % points.length];
      sum += p.x * q.y - q.x * p.y;
    }
    return Math.abs(sum) / 2;
  }

  /** Largest single-axis move of any corner between two quads (normalised units). */
  function maxCornerShift(a, b) {
    var worst = 0;
    for (var i = 0; i < 4; i++) {
      worst = Math.max(worst, Math.abs(a[i].x - b[i].x), Math.abs(a[i].y - b[i].y));
    }
    return worst;
  }

  /** Rejects degenerate quads. Corners are normalised; width/height give the aspect. */
  function isPlausibleQuad(corners, width, height) {
    var px = corners.map(function (p) { return { x: p.x * width, y: p.y * height }; });
    var top = distance(px[0], px[1]);
    var right = distance(px[1], px[2]);
    var bottom = distance(px[2], px[3]);
    var left = distance(px[3], px[0]);
    var minEdge = MIN_EDGE_FRACTION * Math.min(width, height);
    if (Math.min(top, right, bottom, left) < minEdge) return false;
    var horizontalRatio = Math.max(top, bottom) / Math.min(top, bottom);
    var verticalRatio = Math.max(left, right) / Math.min(left, right);
    return horizontalRatio <= MAX_OPPOSITE_EDGE_RATIO && verticalRatio <= MAX_OPPOSITE_EDGE_RATIO;
  }

  /** Size that fits within maxSide on the long edge; never upscales. */
  function fitWithin(width, height, maxSide) {
    var scale = Math.min(1, maxSide / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
  }

  // -------------------------------------------------------------- OpenCV load

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.async = true;
      el.src = src;
      el.onload = function () { resolve(); };
      el.onerror = function () {
        el.remove();
        reject(new Error('Script load failed: ' + src));
      };
      document.head.appendChild(el);
    });
  }

  function isCvReady() {
    return !!(root.cv && typeof root.cv.Mat === 'function' && typeof root.cv.imread === 'function');
  }

  /**
   * Resolves with { cv } once the WASM runtime is ready. The module is wrapped on
   * purpose: `cv` is itself thenable, so resolving a promise with it directly
   * would make Promise resolution call cv.then() forever.
   */
  function waitForCvRuntime() {
    return new Promise(function (resolve, reject) {
      var started = Date.now();
      var cvGlobal = root.cv;
      // Newer builds expose a thenable module; older ones use onRuntimeInitialized.
      if (cvGlobal && typeof cvGlobal.then === 'function') {
        cvGlobal.then(function (module) {
          if (module && typeof module.Mat === 'function') root.cv = module;
        });
      } else if (cvGlobal) {
        cvGlobal.onRuntimeInitialized = function () { /* polled below */ };
      }
      (function poll() {
        if (isCvReady()) { resolve({ cv: root.cv }); return; }
        if (Date.now() - started > OPENCV_TIMEOUT_MS) {
          reject(new Error('OpenCV runtime timed out'));
          return;
        }
        setTimeout(poll, OPENCV_POLL_MS);
      })();
    });
  }

  var cvPromise = null;

  /** Loads OpenCV.js asynchronously (tries each mirror in turn). Cached. Resolves with { cv }. */
  function loadOpenCv() {
    if (cvPromise) return cvPromise;
    cvPromise = (async function () {
      if (isCvReady()) return { cv: root.cv };
      var lastError = null;
      for (var i = 0; i < OPENCV_SOURCES.length; i++) {
        try {
          await loadScript(OPENCV_SOURCES[i]);
          return await waitForCvRuntime();
        } catch (err) {
          lastError = err;
          console.warn('[scan] OpenCV source failed:', OPENCV_SOURCES[i], err);
        }
      }
      throw lastError || new Error('OpenCV could not be loaded');
    })();
    cvPromise.catch(function () { cvPromise = null; });
    return cvPromise;
  }

  // ------------------------------------------------------------ page detection

  function findBestQuad(cv, binary, width, height, own) {
    var contours = own(new cv.MatVector());
    var hierarchy = own(new cv.Mat());
    cv.findContours(binary, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    var best = null;
    for (var i = 0; i < contours.size(); i++) {
      var contour = contours.get(i);
      var approx = new cv.Mat();
      try {
        var perimeter = cv.arcLength(contour, true);
        cv.approxPolyDP(contour, approx, APPROX_EPSILON * perimeter, true);
        if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue;
        var raw = [];
        for (var k = 0; k < 4; k++) {
          raw.push({ x: approx.data32S[k * 2] / width, y: approx.data32S[k * 2 + 1] / height });
        }
        var corners = orderCorners(raw);
        var area = polygonArea(corners);
        if (area < MIN_QUAD_AREA || area > MAX_QUAD_AREA) continue;
        if (!isPlausibleQuad(corners, width, height)) continue;
        if (!best || area > best.area) best = { corners: corners, area: area };
      } finally {
        contour.delete();
        approx.delete();
      }
    }
    return best;
  }

  /**
   * Finds the largest page-like quadrilateral in `canvas` (a downscaled frame).
   * Returns { corners: [tl,tr,br,bl] (normalised 0..1), area } or null.
   */
  function detectQuad(cv, canvas) {
    var owned = [];
    function own(mat) { owned.push(mat); return mat; }
    try {
      var width = canvas.width;
      var height = canvas.height;
      var src = own(cv.imread(canvas));
      var gray = own(new cv.Mat());
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      var blurred = own(new cv.Mat());
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

      var edges = own(new cv.Mat());
      cv.Canny(blurred, edges, CANNY_LOW, CANNY_HIGH);
      var kernel = own(cv.Mat.ones(3, 3, cv.CV_8U));
      cv.dilate(edges, edges, kernel, new cv.Point(-1, -1), 1);
      var fromEdges = findBestQuad(cv, edges, width, height, own);
      if (fromEdges) return fromEdges;

      // Fallback for low-contrast edges: bright paper on a darker surface.
      var binary = own(new cv.Mat());
      cv.threshold(blurred, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      return findBestQuad(cv, binary, width, height, own);
    } finally {
      owned.forEach(function (mat) { mat.delete(); });
    }
  }

  // ------------------------------------------------------------ canvas helpers

  function createCanvas(width, height) {
    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  /** Frees the backing store (iOS Safari keeps detached canvases alive otherwise). */
  function releaseCanvas(canvas) {
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }

  /** Returns a NEW canvas with `source` drawn at most `maxSide` on its long edge. */
  function scaleToMaxSide(source, sourceWidth, sourceHeight, maxSide) {
    var size = fitWithin(sourceWidth, sourceHeight, maxSide);
    var canvas = createCanvas(size.width, size.height);
    var ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not available');
    ctx.drawImage(source, 0, 0, size.width, size.height);
    return canvas;
  }

  /** Perspective-warps the quad (normalised corners) out of srcCanvas into a new canvas. */
  function warpToRect(cv, srcCanvas, cornersNorm, maxSide) {
    var width = srcCanvas.width;
    var height = srcCanvas.height;
    var pts = cornersNorm.map(function (p) { return { x: p.x * width, y: p.y * height }; });
    var rawWidth = Math.max(distance(pts[0], pts[1]), distance(pts[3], pts[2]));
    var rawHeight = Math.max(distance(pts[0], pts[3]), distance(pts[1], pts[2]));
    var out = fitWithin(rawWidth, rawHeight, maxSide);

    var owned = [];
    function own(mat) { owned.push(mat); return mat; }
    try {
      var src = own(cv.imread(srcCanvas));
      var from = own(cv.matFromArray(4, 1, cv.CV_32FC2, [
        pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y
      ]));
      var to = own(cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0, out.width, 0, out.width, out.height, 0, out.height
      ]));
      var transform = own(cv.getPerspectiveTransform(from, to));
      var dst = own(new cv.Mat());
      cv.warpPerspective(src, dst, transform, new cv.Size(out.width, out.height),
        cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
      var canvas = createCanvas(out.width, out.height);
      cv.imshow(canvas, dst);
      return canvas;
    } finally {
      owned.forEach(function (mat) { mat.delete(); });
    }
  }

  // -------------------------------------------------------------- enhancement

  function percentileFromHistogram(histogram, total, fraction) {
    var target = total * fraction;
    var running = 0;
    for (var i = 0; i < histogram.length; i++) {
      running += histogram[i];
      if (running >= target) return i;
    }
    return histogram.length - 1;
  }

  /** Builds the 256-entry brightness lookup table used by the "scan" look. */
  function buildEnhanceLut(histogram, total) {
    var low = Math.min(percentileFromHistogram(histogram, total, ENHANCE_LOW_PERCENTILE), ENHANCE_LOW_CAP);
    var high = Math.max(percentileFromHistogram(histogram, total, ENHANCE_HIGH_PERCENTILE), ENHANCE_HIGH_FLOOR);
    var range = Math.max(1, high - low);
    var lut = new Uint8ClampedArray(256);
    for (var i = 0; i < 256; i++) {
      lut[i] = ((i - low) / range) * 255;
    }
    return lut;
  }

  /** Returns a NEW canvas with a mild contrast/brightness stretch (colour kept). */
  function enhanceCanvas(source) {
    var width = source.width;
    var height = source.height;
    var sourceCtx = source.getContext('2d', { willReadFrequently: true });
    if (!sourceCtx) throw new Error('2D canvas not available');
    var image = sourceCtx.getImageData(0, 0, width, height);
    var data = image.data;

    var histogram = new Uint32Array(256);
    var sampled = 0;
    var stride = 4 * ENHANCE_SAMPLE_STEP;
    for (var i = 0; i < data.length; i += stride) {
      var luma = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      histogram[luma | 0]++;
      sampled++;
    }
    var lut = buildEnhanceLut(histogram, Math.max(1, sampled));
    for (var j = 0; j < data.length; j += 4) {
      data[j] = lut[data[j]];
      data[j + 1] = lut[data[j + 1]];
      data[j + 2] = lut[data[j + 2]];
    }
    var result = createCanvas(width, height);
    result.getContext('2d').putImageData(image, 0, 0);
    return result;
  }

  // ------------------------------------------------------- auto-capture tracker

  /**
   * Decides when to auto-capture. Feed it one detection result per tick:
   *   update(quad|null, nowMs) -> { isStable, progress (0..1), shouldCapture }
   * After a capture call markCaptured(quad, nowMs). It then refuses to capture
   * again until the sheet vanished, moved a lot, or stayed clearly different.
   */
  function createAutoTracker(overrides) {
    var cfg = Object.assign({}, TRACKER_DEFAULTS, overrides || {});
    var anchor = null;
    var anchorSince = 0;
    var lockedCorners = null;
    var missingSince = null;
    var differentSince = null;

    function unlock() {
      lockedCorners = null;
      differentSince = null;
      anchor = null;
    }

    function updateLock(corners, now) {
      if (!lockedCorners) return;
      var shift = maxCornerShift(corners, lockedCorners);
      if (shift >= cfg.bigMoveShift) { unlock(); return; }
      if (shift < cfg.differentShift) { differentSince = null; return; }
      if (differentSince === null) differentSince = now;
      if (now - differentSince >= cfg.differentMs) unlock();
    }

    function update(quad, now) {
      var isUsable = !!quad && quad.area >= cfg.minArea;
      if (!isUsable) {
        anchor = null;
        differentSince = null;
        if (missingSince === null) missingSince = now;
        if (lockedCorners && now - missingSince >= cfg.releaseMissingMs) unlock();
        return { isStable: false, progress: 0, shouldCapture: false };
      }
      missingSince = null;
      updateLock(quad.corners, now);

      if (!anchor || maxCornerShift(anchor, quad.corners) >= cfg.stableShift) {
        anchor = quad.corners;
        anchorSince = now;
      }
      var held = now - anchorSince;
      var isLocked = lockedCorners !== null;
      return {
        isStable: held >= cfg.stableShowMs,
        progress: isLocked ? 0 : Math.min(1, held / cfg.holdMs),
        shouldCapture: !isLocked && held >= cfg.holdMs
      };
    }

    function markCaptured(quad) {
      lockedCorners = quad && quad.corners ? quad.corners : null;
      anchor = null;
      differentSince = null;
      missingSince = null;
    }

    function reset() {
      unlock();
      missingSince = null;
    }

    return { update: update, markCaptured: markCaptured, reset: reset };
  }

  var api = {
    loadOpenCv: loadOpenCv,
    detectQuad: detectQuad,
    warpToRect: warpToRect,
    enhanceCanvas: enhanceCanvas,
    scaleToMaxSide: scaleToMaxSide,
    releaseCanvas: releaseCanvas,
    createAutoTracker: createAutoTracker,
    // exported for tests
    orderCorners: orderCorners,
    polygonArea: polygonArea,
    maxCornerShift: maxCornerShift,
    isPlausibleQuad: isPlausibleQuad,
    fitWithin: fitWithin,
    buildEnhanceLut: buildEnhanceLut
  };

  root.ScanDetect = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
