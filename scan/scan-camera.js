/* Fiche scanner: live camera, detection loop, overlay drawing and the
 * auto-capture trigger. Knows nothing about pages or uploading.
 *
 * ScanCamera.create({ els, isPaused, isAutoOn, onAutoCapture }) returns
 *   start()      -> Promise<{ ok: boolean, reason?: string }>  (camera running?)
 *   startOpenCv()-> begins loading OpenCV in the background
 *   getCv()      -> the cv object or null while not ready
 *   isVideoReady(), grabFrame() -> { canvas, quad } | null   (caller releases canvas)
 *   markCaptured(quad), resetTracker(), resumeVideo()
 */
(function (root) {
  'use strict';

  var Detect = root.ScanDetect;

  var DETECT_INTERVAL_MS = 200;
  var DETECT_WIDTH = 480;
  var MAX_DETECT_ERRORS = 5;
  var QUAD_MAX_AGE_MS = 700;
  var MAX_SOURCE_SIDE = 2600;
  var VIDEO_READY_TIMEOUT_MS = 8000;
  var OVERLAY_LINE_WIDTH = 3;
  var COLOR_DETECTED = '#ffd60a';
  var COLOR_STABLE = '#3ddc84';

  function create(options) {
    var els = options.els; // { video, stage, overlay, shutter, status }
    var cv = null;
    var tracker = Detect.createAutoTracker();
    var latestQuad = null; // { quad, at }
    var detectCanvas = document.createElement('canvas');
    var detectTimer = null;
    var detectErrors = 0;

    // ---- readiness

    function isVideoReady() {
      return els.video.videoWidth > 0 && els.video.readyState >= 2;
    }

    function canDetect() {
      return !!cv && isVideoReady() && !document.hidden && !options.isPaused();
    }

    function freshQuad() {
      if (!latestQuad) return null;
      return performance.now() - latestQuad.at <= QUAD_MAX_AGE_MS ? latestQuad.quad : null;
    }

    // ---- overlay

    function sizeOverlay() {
      var dpr = root.devicePixelRatio || 1;
      var width = Math.round(els.stage.clientWidth * dpr);
      var height = Math.round(els.stage.clientHeight * dpr);
      if (els.overlay.width !== width || els.overlay.height !== height) {
        els.overlay.width = width;
        els.overlay.height = height;
      }
      return dpr;
    }

    /** Maps normalised frame coordinates to overlay pixels (video is letterboxed: object-fit contain). */
    function frameToOverlay(point, dpr) {
      var cw = els.stage.clientWidth;
      var ch = els.stage.clientHeight;
      var vw = els.video.videoWidth;
      var vh = els.video.videoHeight;
      var scale = Math.min(cw / vw, ch / vh);
      var offsetX = (cw - vw * scale) / 2;
      var offsetY = (ch - vh * scale) / 2;
      return { x: (offsetX + point.x * vw * scale) * dpr, y: (offsetY + point.y * vh * scale) * dpr };
    }

    function drawOverlay(quad, isStable) {
      var dpr = sizeOverlay();
      var ctx = els.overlay.getContext('2d');
      ctx.clearRect(0, 0, els.overlay.width, els.overlay.height);
      if (!quad) return;
      var pts = quad.corners.map(function (p) { return frameToOverlay(p, dpr); });
      var color = isStable ? COLOR_STABLE : COLOR_DETECTED;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.globalAlpha = isStable ? 0.18 : 0.1;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = OVERLAY_LINE_WIDTH * dpr;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = color;
      ctx.stroke();
    }

    function setShutterProgress(fraction) {
      els.shutter.style.setProperty('--p', String(fraction));
    }

    // ---- detection loop

    function runDetection() {
      if (!canDetect()) {
        drawOverlay(null, false);
        setShutterProgress(0);
        return;
      }
      var vw = els.video.videoWidth;
      var vh = els.video.videoHeight;
      detectCanvas.width = DETECT_WIDTH;
      detectCanvas.height = Math.max(1, Math.round(DETECT_WIDTH * vh / vw));
      detectCanvas.getContext('2d').drawImage(els.video, 0, 0, detectCanvas.width, detectCanvas.height);

      var quad = Detect.detectQuad(cv, detectCanvas);
      var now = performance.now();
      if (quad) latestQuad = { quad: quad, at: now };
      var result = tracker.update(quad, now);
      var isAuto = options.isAutoOn();
      drawOverlay(quad, result.isStable);
      setShutterProgress(isAuto ? result.progress : 0);
      detectErrors = 0;
      if (isAuto && result.shouldCapture) options.onAutoCapture();
    }

    function detectTick() {
      try {
        runDetection();
      } catch (err) {
        detectErrors += 1;
        console.error('[scan] detection error', err);
        if (detectErrors >= MAX_DETECT_ERRORS) {
          console.error('[scan] giving up on detection');
          els.status.textContent = 'Ouni Säitenerkennung';
          drawOverlay(null, false);
          return; // stop the loop; manual capture keeps working
        }
      }
      detectTimer = setTimeout(detectTick, DETECT_INTERVAL_MS);
    }

    function startDetectLoop() {
      clearTimeout(detectTimer);
      detectTimer = setTimeout(detectTick, DETECT_INTERVAL_MS);
    }

    function startOpenCv() {
      els.status.textContent = 'Säitenerkennung lued…';
      Detect.loadOpenCv().then(function (loaded) {
        cv = loaded.cv;
        els.status.textContent = '';
        console.info('[scan] OpenCV ready');
      }).catch(function (err) {
        console.error('[scan] OpenCV unavailable, scanning without cropping', err);
        els.status.textContent = 'Ouni Säitenerkennung';
      });
    }

    // ---- camera

    function waitForVideoReady() {
      return new Promise(function (resolve, reject) {
        var started = Date.now();
        (function check() {
          if (els.video.videoWidth > 0) { resolve(); return; }
          if (Date.now() - started > VIDEO_READY_TIMEOUT_MS) { reject(new Error('Video never became ready')); return; }
          setTimeout(check, 100);
        })();
      });
    }

    async function start() {
      var media = navigator.mediaDevices;
      if (!media || typeof media.getUserMedia !== 'function') {
        return { ok: false, reason: 'getUserMedia unavailable' };
      }
      try {
        var stream = await media.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false
        });
        els.video.srcObject = stream;
        try { await els.video.play(); } catch (err) { console.warn('[scan] video.play() rejected', err); }
        await waitForVideoReady();
      } catch (err) {
        console.error('[scan] camera failed', err);
        return { ok: false, reason: err && err.name ? err.name : 'camera error' };
      }
      startDetectLoop();
      return { ok: true };
    }

    function resumeVideo() {
      if (!els.video.srcObject) return;
      els.video.play().catch(function (err) { console.warn('[scan] resume failed', err); });
    }

    /** Copies the current video frame (+ the freshest detected quad). Caller releases the canvas. */
    function grabFrame() {
      if (!isVideoReady()) return null;
      var canvas = Detect.scaleToMaxSide(els.video, els.video.videoWidth, els.video.videoHeight, MAX_SOURCE_SIDE);
      return { canvas: canvas, quad: freshQuad() };
    }

    return {
      start: start,
      startOpenCv: startOpenCv,
      getCv: function () { return cv; },
      isVideoReady: isVideoReady,
      grabFrame: grabFrame,
      markCaptured: function (quad) { tracker.markCaptured(quad); },
      resetTracker: function () { tracker.reset(); setShutterProgress(0); },
      resumeVideo: resumeVideo
    };
  }

  root.ScanCamera = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
