/* Fiche scanner: state, UI, capture pipeline and send flow.
 * Depends on ScanDetect, ScanPdf and ScanCamera (loaded before this file). */
(function () {
  'use strict';

  var Detect = window.ScanDetect;
  var Pdf = window.ScanPdf;
  var Camera = window.ScanCamera;

  var KEY_STORAGE = 'ficheScanKey';
  var AUTO_STORAGE = 'ficheScanAuto';
  var ENDPOINT = 'https://lvksqmgfwkfbblfsozfk.supabase.co/functions/v1/fiche-scan';
  var KEY_PATTERN = /^[\x21-\x7E]{1,512}$/; // printable ASCII: safe as an HTTP header value

  var DETECT_WIDTH = 480;
  var MAX_SOURCE_SIDE = 2600; // working size for photos from the file input
  var PAGE_MAX_SIDE = 1800;
  var JPEG_QUALITY = 0.72;
  var THUMB_SIDE = 200;
  var THUMB_QUALITY = 0.6;
  var MAX_PDF_BYTES = 12 * 1024 * 1024;
  var SMALL_PDF_SIDE = 1400;
  var SMALL_PDF_QUALITY = 0.65;
  var TOAST_MS = 4000;

  var MSG_KEY_INVALID = 'Schlëssel ongëlteg – maach de Scanner nach eng Kéier iwwer Slack op';
  var MSG_NO_CAMERA = 'Kamera net disponibel – benotz de Knäppchen fir Fotoen ze maachen';
  var MSG_CAPTURE_FAILED = 'D\'Foto konnt net verschafft ginn – probéier et nach eng Kéier';

  // ------------------------------------------------------------------ helpers

  function byId(id) { return document.getElementById(id); }

  function safeStorageGet(name) {
    try { return window.localStorage.getItem(name); } catch (err) { console.warn('[scan] storage read', err); return null; }
  }
  function safeStorageSet(name, value) {
    try { window.localStorage.setItem(name, value); } catch (err) { console.warn('[scan] storage write', err); }
  }
  function safeStorageRemove(name) {
    try { window.localStorage.removeItem(name); } catch (err) { console.warn('[scan] storage remove', err); }
  }

  function isValidKey(value) { return typeof value === 'string' && KEY_PATTERN.test(value); }

  /** Takes `k` from the URL hash, stores it, and strips the hash from the address bar. */
  function consumeKeyFromHash() {
    var hash = window.location.hash;
    if (!hash || hash.length < 2) return null;
    var fromHash = null;
    try { fromHash = new URLSearchParams(hash.slice(1)).get('k'); } catch (err) { console.warn('[scan] bad hash', err); }
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (err) { console.warn('[scan] replaceState failed', err); }
    if (!isValidKey(fromHash)) return null;
    safeStorageSet(KEY_STORAGE, fromHash);
    return fromHash;
  }

  function resolveKey() {
    var fromHash = consumeKeyFromHash();
    if (fromHash) return fromHash;
    var stored = safeStorageGet(KEY_STORAGE);
    return isValidKey(stored) ? stored : null;
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function buildFilename(date) {
    return 'Scan ' + date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()) +
      ' ' + pad2(date.getHours()) + '-' + pad2(date.getMinutes()) + '.pdf';
  }

  // -------------------------------------------------------------------- state

  var state = Object.freeze({
    key: resolveKey(),
    pages: [],
    autoOn: safeStorageGet(AUTO_STORAGE) !== '0',
    mode: 'camera', // 'camera' | 'fallback'
    isBusy: false,
    hasUnsentPages: false,
    previewId: null
  });
  var nextPageId = 1;

  function setState(patch) {
    state = Object.freeze(Object.assign({}, state, patch));
    if ('pages' in patch) renderPages();
    renderControls();
  }

  // --------------------------------------------------------------------- DOM

  var els = {
    noKey: byId('noKeyScreen'), camera: byId('cameraScreen'), preview: byId('previewScreen'),
    sending: byId('sendingScreen'), done: byId('doneScreen'),
    stage: byId('stage'), video: byId('video'), overlay: byId('overlay'),
    fallbackHint: byId('fallbackHint'), flash: byId('flash'),
    autoToggle: byId('autoToggle'), status: byId('status'), toast: byId('toast'),
    thumbs: byId('thumbs'), hint: byId('hintInput'), shutter: byId('shutter'), send: byId('sendBtn'),
    previewImg: byId('previewImg'), deleteBtn: byId('deleteBtn'), previewClose: byId('previewCloseBtn'),
    sendingText: byId('sendingText'), progress: byId('progress'), progressBar: byId('progressBar'),
    newScan: byId('newScanBtn'), fileInput: byId('fileInput')
  };

  var toastTimer = null;
  function showToast(message, options) {
    els.toast.textContent = message;
    els.toast.classList.toggle('is-error', !!(options && options.isError));
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    if (!(options && options.sticky)) toastTimer = setTimeout(hideToast, TOAST_MS);
  }
  function hideToast() {
    clearTimeout(toastTimer);
    els.toast.hidden = true;
  }

  function renderControls() {
    var count = state.pages.length;
    var isFallback = state.mode === 'fallback';
    els.send.textContent = count > 0 ? 'Schécken (' + count + ')' : 'Schécken';
    els.send.disabled = count === 0 || state.isBusy;
    els.shutter.disabled = state.isBusy;
    els.hint.hidden = count === 0;
    els.autoToggle.hidden = isFallback;
    els.fallbackHint.hidden = !isFallback;
    els.video.hidden = isFallback;
    els.overlay.hidden = isFallback;
    els.autoToggle.setAttribute('aria-checked', String(state.autoOn));
  }

  function renderPages() {
    els.thumbs.replaceChildren();
    state.pages.forEach(function (page, index) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'thumb';
      button.setAttribute('aria-label', 'Säit ' + (index + 1));
      var img = document.createElement('img');
      img.src = page.thumbUrl;
      img.alt = '';
      var num = document.createElement('span');
      num.className = 'thumb-num';
      num.textContent = String(index + 1);
      button.append(img, num);
      button.addEventListener('click', function () { openPreview(page.id); });
      els.thumbs.appendChild(button);
    });
    els.thumbs.scrollLeft = els.thumbs.scrollWidth;
  }

  // ------------------------------------------------------------- screen flow

  function showOnly(screen) {
    [els.noKey, els.camera].forEach(function (el) { el.hidden = el !== screen; });
  }

  function setOverlay(screen) {
    [els.preview, els.sending, els.done].forEach(function (el) { el.hidden = el !== screen; });
  }

  function isOverlayOpen() {
    return !els.preview.hidden || !els.sending.hidden || !els.done.hidden;
  }

  function openPreview(pageId) {
    var page = state.pages.find(function (p) { return p.id === pageId; });
    if (!page) return;
    els.previewImg.src = page.dataUrl;
    setState({ previewId: pageId });
    setOverlay(els.preview);
  }

  function closePreview() {
    els.previewImg.removeAttribute('src');
    setState({ previewId: null });
    setOverlay(null);
  }

  function deletePreviewedPage() {
    var id = state.previewId;
    var remaining = state.pages.filter(function (p) { return p.id !== id; });
    setState({ pages: remaining, hasUnsentPages: remaining.length > 0 });
    closePreview();
  }

  // ------------------------------------------------------- capture pipeline

  var camera = null; // created in init()

  /** Builds a finished page (cropped if a quad is given, enhanced, JPEG) from a canvas. */
  function buildPage(sourceCanvas, quad) {
    var temporaries = [];
    try {
      var cv = camera.getCv();
      var base = null;
      if (quad && cv) {
        try {
          base = Detect.warpToRect(cv, sourceCanvas, quad.corners, PAGE_MAX_SIDE);
          temporaries.push(base);
        } catch (err) {
          console.warn('[scan] warp failed, using whole frame', err);
        }
      }
      if (!base) {
        base = Detect.scaleToMaxSide(sourceCanvas, sourceCanvas.width, sourceCanvas.height, PAGE_MAX_SIDE);
        temporaries.push(base);
      }
      var enhanced = Detect.enhanceCanvas(base);
      temporaries.push(enhanced);
      var thumb = Detect.scaleToMaxSide(enhanced, enhanced.width, enhanced.height, THUMB_SIDE);
      temporaries.push(thumb);
      return Object.freeze({
        id: nextPageId++,
        dataUrl: enhanced.toDataURL('image/jpeg', JPEG_QUALITY),
        thumbUrl: thumb.toDataURL('image/jpeg', THUMB_QUALITY),
        width: enhanced.width,
        height: enhanced.height
      });
    } finally {
      temporaries.forEach(Detect.releaseCanvas);
    }
  }

  function addPage(page) {
    setState({ pages: state.pages.concat([page]), hasUnsentPages: true });
  }

  function playFlash() {
    els.flash.classList.remove('is-on');
    void els.flash.offsetWidth; // restart the animation
    els.flash.classList.add('is-on');
    try { if (navigator.vibrate) navigator.vibrate(25); } catch (err) { /* optional nicety */ }
  }

  function captureFromVideo(isAuto) {
    if (state.isBusy || state.mode !== 'camera') return;
    var grabbed = camera.grabFrame();
    if (!grabbed) return;
    setState({ isBusy: true });
    hideToast();
    playFlash();
    // Let the flash paint before the heavy work starts.
    setTimeout(function () {
      try {
        var page = buildPage(grabbed.canvas, grabbed.quad);
        addPage(page);
        camera.markCaptured(grabbed.quad);
        console.info('[scan] captured page', page.id, isAuto ? '(auto)' : '(manual)', grabbed.quad ? 'cropped' : 'whole frame');
      } catch (err) {
        console.error('[scan] capture failed', err);
        showToast(MSG_CAPTURE_FAILED, { isError: true });
      } finally {
        Detect.releaseCanvas(grabbed.canvas);
        setState({ isBusy: false });
      }
    }, 0);
  }

  function loadImageFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Bild konnt net gelies ginn')); };
      img.src = url;
    });
  }

  function detectQuadInCanvas(canvas) {
    var cv = camera.getCv();
    if (!cv) return null;
    var small = Detect.scaleToMaxSide(canvas, canvas.width, canvas.height, DETECT_WIDTH);
    try {
      return Detect.detectQuad(cv, small);
    } catch (err) {
      console.warn('[scan] detection on photo failed', err);
      return null;
    } finally {
      Detect.releaseCanvas(small);
    }
  }

  async function handlePhotoFile(file) {
    if (!file || !file.type || file.type.indexOf('image/') !== 0) {
      showToast('Dat ass kee Bild', { isError: true });
      return;
    }
    setState({ isBusy: true });
    hideToast();
    var source = null;
    try {
      var img = await loadImageFile(file);
      source = Detect.scaleToMaxSide(img, img.naturalWidth, img.naturalHeight, MAX_SOURCE_SIDE);
      addPage(buildPage(source, detectQuadInCanvas(source)));
    } catch (err) {
      console.error('[scan] photo failed', err);
      showToast(MSG_CAPTURE_FAILED, { isError: true });
    } finally {
      Detect.releaseCanvas(source);
      setState({ isBusy: false });
    }
  }

  function onShutter() {
    if (state.mode === 'fallback') {
      els.fileInput.value = '';
      els.fileInput.click();
    } else {
      captureFromVideo(false);
    }
  }

  // ------------------------------------------------------------------- send

  function showSending(text, showProgress) {
    els.sendingText.textContent = text;
    els.progress.hidden = !showProgress;
    els.progressBar.style.width = '0%';
    setOverlay(els.sending);
  }

  function updateProgress(fraction) {
    var percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
    els.progressBar.style.width = percent + '%';
    els.sendingText.textContent = 'Eroplueden… ' + percent + '%';
  }

  async function buildPdfWithinLimit(pages) {
    var blob = await Pdf.buildPdf(pages);
    if (blob.size <= MAX_PDF_BYTES) return blob;
    console.info('[scan] PDF too large (' + blob.size + ' B), rebuilding smaller');
    return Pdf.buildPdf(pages, { maxSide: SMALL_PDF_SIDE, quality: SMALL_PDF_QUALITY });
  }

  function handleSendError(err) {
    console.error('[scan] send failed', err);
    var message = err && err.message ? err.message : 'Onbekannte Feeler';
    if (err && err.status === 401) {
      safeStorageRemove(KEY_STORAGE);
      setState({ key: null });
      message = MSG_KEY_INVALID;
    }
    setOverlay(null);
    showToast(message, { isError: true, sticky: true });
  }

  async function sendPages() {
    if (state.isBusy || state.pages.length === 0) return;
    if (!state.key) {
      showToast(MSG_KEY_INVALID, { isError: true, sticky: true });
      return;
    }
    setState({ isBusy: true });
    hideToast();
    showSending('PDF gëtt gemaach…', false);
    try {
      var blob = await buildPdfWithinLimit(state.pages);
      showSending('Eroplueden… 0%', true);
      await Pdf.uploadPdf({
        endpoint: ENDPOINT,
        key: state.key,
        blob: blob,
        filename: buildFilename(new Date()),
        pageCount: state.pages.length,
        hint: els.hint.value.trim(),
        onProgress: updateProgress
      });
      setState({ hasUnsentPages: false });
      setOverlay(els.done);
    } catch (err) {
      handleSendError(err);
    } finally {
      setState({ isBusy: false });
    }
  }

  function startNewScan() {
    els.hint.value = '';
    camera.resetTracker();
    setState({ pages: [], hasUnsentPages: false });
    setOverlay(null);
  }

  // ----------------------------------------------------------------- wiring

  function toggleAuto() {
    var next = !state.autoOn;
    safeStorageSet(AUTO_STORAGE, next ? '1' : '0');
    camera.resetTracker();
    setState({ autoOn: next });
  }

  function wireEvents() {
    els.shutter.addEventListener('click', onShutter);
    els.autoToggle.addEventListener('click', toggleAuto);
    els.send.addEventListener('click', sendPages);
    els.deleteBtn.addEventListener('click', deletePreviewedPage);
    els.previewClose.addEventListener('click', closePreview);
    els.newScan.addEventListener('click', startNewScan);
    els.fileInput.addEventListener('change', function () {
      var file = els.fileInput.files && els.fileInput.files[0];
      if (file) handlePhotoFile(file);
    });
    els.hint.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') els.hint.blur();
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) camera.resumeVideo();
    });
    window.addEventListener('beforeunload', function (event) {
      if (!state.hasUnsentPages) return undefined;
      event.preventDefault();
      event.returnValue = '';
      return '';
    });
  }

  async function startScanner() {
    var result = await camera.start();
    if (!result.ok) {
      console.warn('[scan] fallback mode:', result.reason);
      setState({ mode: 'fallback' });
      showToast(MSG_NO_CAMERA);
    }
    // OpenCV loads only after the camera had its chance, so it never delays the preview.
    camera.startOpenCv();
  }

  function init() {
    if (!Detect || !Pdf || !Camera) {
      console.error('[scan] helper scripts missing');
      els.noKey.querySelector('.message').textContent = 'Scanner konnt net lueden – lued d\'Säit nei';
      showOnly(els.noKey);
      return;
    }
    if (!state.key) {
      showOnly(els.noKey);
      return;
    }
    camera = Camera.create({
      els: { video: els.video, stage: els.stage, overlay: els.overlay, shutter: els.shutter, status: els.status },
      isPaused: function () { return state.isBusy || state.mode !== 'camera' || isOverlayOpen(); },
      isAutoOn: function () { return state.autoOn; },
      onAutoCapture: function () { captureFromVideo(true); }
    });
    showOnly(els.camera);
    renderPages();
    renderControls();
    wireEvents();
    startScanner();
  }

  init();
})();
