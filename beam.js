/* Beam — optical file transfer.
 *
 * Sender:   file -> fountain packets -> animated QR codes on screen.
 * Receiver: camera -> QR decode -> fountain decode -> file.
 *
 * There is no back-channel: the receiver can never ask for a missed frame.
 * That is why the payload is a fountain code (beam-fountain.js) rather than
 * numbered chunks — any ~1.2*K frames rebuild the file, whichever ones landed.
 *
 * Frame encoding lives in beam-wire.js (unit-tested) and QR decoding in
 * beam-decode.js; this file is the UI, the animation loop and the camera.
 */
(function () {
  'use strict';

  var F = window.BEAM_FOUNTAIN;
  var W = window.BEAM_WIRE;

  /* Density levels. Bigger frames move far more data per frame but need a
     steadier hand and a better camera — the right level is device-dependent,
     so it is the user's dial rather than a constant. QR versions here are
     measured, not estimated. */
  var LEVELS = [
    { label: 'Sécher',     block: 400,  qr: 13 },
    { label: 'Normal',     block: 1200, qr: 25 },
    { label: 'Séier',      block: 1800, qr: 31 },
    { label: 'Ganz séier', block: 2400, qr: 36 },
    { label: 'Maximal',    block: 2943, qr: 40 }
  ];
  var DEFAULT_LEVEL = 2;

  /* qrcode-generator hands its input through stringToBytes; the default
     mangles anything above 0x7F. In byte mode one char is one byte, so latin1
     round-trips our binary frames exactly. Set once, globally. */
  qrcode.stringToBytes = function (str) {
    var out = [];
    for (var i = 0; i < str.length; i++) out.push(str.charCodeAt(i) & 255);
    return out;
  };

  var META_EVERY = 24;             // frames between filename frames
  var MAX_BYTES = 512 * 1024 * 1024;   // only a sanity bound; time is the real limit
  var QR_ECC = 'L';                // least redundancy, most payload
  /* The QR spec's minimum quiet zone is 4 modules. Going below it works with
     some decoders and not others, and the page background behind the code is
     dark, so anything less is a real decode hazard. */
  var QUIET = 4;
  /* A v40 code is 177 modules; at ~3 px per module the code alone needs
     ~530 px, and it rarely fills more than half the frame. Downscaling
     further is the difference between decoding and not. */
  var CAM_WIDTH = 1080;

  /* Measured: the codec needs ~1.2 packets per block, and only 6 of every 7
     frames carry data — the rest carry the filename. */
  var OVERHEAD = 1.2 * (META_EVERY / (META_EVERY - 1));

  /* 16-bit seeds: past this many blocks the sender starts repeating packets
     the decoder already has, and progress crawls. */
  var MAX_USEFUL_BLOCKS = 40000;

  /* ---------- helpers ---------- */

  function $(id) { return document.getElementById(id); }

  function show(id) {
    var all = document.querySelectorAll('.screen');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('on');
    $(id).classList.add('on');
  }

  function humanSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  function level() { return LEVELS[parseInt($('density').value, 10)]; }
  function fps() { return parseInt($('fps').value, 10); }

  /* ---------- QR drawing ---------- */

  /* Painting a v40 code as one fillRect per module is ~31k canvas calls per
     frame, which throttles the sender before the camera is even the limit.
     Instead: write the modules into an ImageData at one pixel per module on a
     tiny offscreen canvas, then blit it up with smoothing off. One drawImage,
     and the nearest-neighbour scale keeps module edges hard — soft edges are
     what kill decode rates. */
  var qrSrc = document.createElement('canvas');

  function drawQR(canvas, frameBytes) {
    var qr = qrcode(0, QR_ECC);          // 0 = smallest version that fits
    qr.addData(W.toLatin1(frameBytes), 'Byte');
    qr.make();
    var n = qr.getModuleCount();
    var total = n + QUIET * 2;

    if (qrSrc.width !== total) { qrSrc.width = qrSrc.height = total; }
    var sctx = qrSrc.getContext('2d');
    var img = sctx.createImageData(total, total);
    var px = img.data;
    px.fill(255);                        // white page, including the quiet zone
    for (var r = 0; r < n; r++) {
      var rowStart = ((r + QUIET) * total + QUIET) * 4;
      for (var c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        var o = rowStart + c * 4;
        px[o] = px[o + 1] = px[o + 2] = 0;
      }
    }
    sctx.putImageData(img, 0, 0);

    /* Integer scale so every module lands on a whole number of pixels. */
    var box = Math.min(canvas.parentNode.clientWidth || 320, 760);
    var scale = Math.max(2, Math.floor(box / total));
    var size = total * scale;
    if (canvas.width !== size) { canvas.width = canvas.height = size; }
    var ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(qrSrc, 0, 0, total, total, 0, 0, size, size);
    canvas.style.width = '100%';
  }

  /* ---------- sender ---------- */

  var sender = { timer: null, wakeLock: null };
  var picked = null;

  function stopSending() {
    if (sender.timer) { clearInterval(sender.timer); sender.timer = null; }
    if (sender.wakeLock) {
      try { sender.wakeLock.release(); } catch (e) { /* already gone */ }
      sender.wakeLock = null;
    }
    $('startSend').textContent = 'Start';
  }

  function startSending(file) {
    var lv = level();
    var enc = new F.Encoder(file.bytes, lv.block);
    /* Pad the filename frame to the data-frame size so every frame in the
       stream renders at the same QR version — a code that changes size makes
       the camera refocus and costs far more than the padding does. */
    var metaFrame = W.metaFrame(file.name, file.mime, file.bytes.length,
                                lv.block + W.HEADER_BYTES);

    var canvas = document.createElement('canvas');
    $('qrwrap').innerHTML = '';
    $('qrwrap').appendChild(canvas);

    var seed = 1, sent = 0;

    function tick() {
      var frame;
      if (sent % META_EVERY === 0) {
        frame = metaFrame;                     // repeated, so a receiver that
      } else {                                 // joins late still gets the name
        var s = seed++ & 0xffff;
        if (s === 0) s = 1;
        frame = W.dataFrame(file.bytes.length, lv.block, s, enc.packet(s));
      }
      drawQR(canvas, frame);
      sent++;
      $('sSent').textContent = String(sent);
    }

    tick();
    sender.timer = setInterval(tick, Math.round(1000 / fps()));
    $('startSend').textContent = 'Stop';

    /* Screen sleeping mid-transfer would silently stall it. */
    if (navigator.wakeLock && navigator.wakeLock.request) {
      navigator.wakeLock.request('screen')
        .then(function (w) { sender.wakeLock = w; })
        .catch(function () { /* best effort only */ });
    }
  }

  function humanTime(secs) {
    if (secs < 90) return '≈' + secs + ' s';
    var m = Math.round(secs / 60);
    if (m < 90) return '≈' + m + ' min';
    return '≈' + (m / 60).toFixed(1) + ' Stonnen';
  }

  function describeFile() {
    if (!picked) return;
    var lv = level();
    var k = Math.max(1, Math.ceil(picked.bytes.length / lv.block));
    var frames = Math.ceil(k * OVERHEAD);
    var secs = Math.max(1, Math.round(frames / fps()));
    $('sSize').textContent = humanSize(picked.bytes.length);
    $('sK').textContent = k + ' Blocken, ≈' + frames + ' Frames';

    /* The best case assumes every displayed frame is read. In practice the
       camera misses plenty, so say so rather than promising the floor. */
    var t = $('sTime');
    t.textContent = humanTime(secs) + ' am beschte Fall';
    if (k > MAX_USEFUL_BLOCKS) {
      t.textContent = 'Ze vill Blocken (' + k + ') — gëff méi Dicht';
      t.className = 'warn';
    } else {
      t.className = '';
    }
  }

  function describeRate() {
    var lv = level();
    $('sDensity').textContent = lv.label + ' (QR v' + lv.qr + ', ' + lv.block + ' B)';
    $('sFps').textContent = fps() + ' / Sek.';
    var rate = lv.block * fps() / OVERHEAD;
    $('sRate').textContent = '≈' + (rate / 1024).toFixed(1) + ' KB/s theoretesch';
  }

  /* ---------- receiver ---------- */

  var recv = { stream: null, raf: null, rvfc: null, backend: null, decoder: null,
               meta: null, frames: 0, collected: 0, needed: 0, done: false };

  function stopReceiving() {
    if (recv.raf) { cancelAnimationFrame(recv.raf); recv.raf = null; }
    if (recv.rvfc) {
      var v = $('cam');
      if (v && v.cancelVideoFrameCallback) { try { v.cancelVideoFrameCallback(recv.rvfc); } catch (e) {} }
      recv.rvfc = null;
    }
    if (recv.stream) {
      recv.stream.getTracks().forEach(function (t) { t.stop(); });
      recv.stream = null;
    }
  }

  function setNote(text, cls) {
    $('rNote').className = 'note' + (cls ? ' ' + cls : '');
    $('rNote').textContent = text;
  }

  function resetReceiver() {
    recv.decoder = null; recv.meta = null;
    recv.frames = 0; recv.collected = 0; recv.needed = 0; recv.done = false;
    $('bar').style.width = '0';
    $('rBlocks').textContent = '0 / ?';
    $('rFrames').textContent = '0';
    $('saveFile').style.display = 'none';
    setNote("Riicht d'Kamera op den anere Ecran.");
  }

  function handleFrame(bytes) {
    if (recv.done || !bytes) return;
    var f = W.parseFrame(bytes);
    if (!f) return;                            // junk from the camera

    if (f.kind === 'meta') { recv.meta = f; return; }

    if (!recv.decoder) {
      var k = Math.max(1, Math.ceil(f.size / f.blockSize));
      recv.decoder = new F.Decoder(k, f.blockSize, f.size);
      recv.needed = Math.ceil(k * 1.2);
    } else if (f.size !== recv.decoder.size || f.blockSize !== recv.decoder.blockSize) {
      return;                                  // a different file came into view
    }

    var fresh = !recv.decoder.hasSeen(f.seed);
    recv.decoder.add(f.seed, f.payload);
    if (fresh) recv.collected++;

    var d = recv.decoder;
    /* Progress is reported from frames collected, not blocks solved: an LT
       decoder solves almost nothing until it avalanches near the end, so a
       blocks-solved bar sits under 10% for about half the transfer and then
       jumps. Frames collected rises smoothly and is what the user controls. */
    var pct = recv.needed ? Math.min(99, recv.collected / recv.needed * 100) : 0;
    if (d.isComplete()) pct = 100;
    $('bar').style.width = pct.toFixed(1) + '%';
    $('rBlocks').textContent = recv.collected + ' / ≈' + recv.needed +
                              ' (' + d.solvedCount + '/' + d.k + ' fäerdeg)';
    if (d.isComplete()) finishReceive();
  }

  function finishReceive() {
    recv.done = true;
    stopReceiving();
    var bytes = recv.decoder.result();
    var name = (recv.meta && recv.meta.name) || 'beam-fichier.bin';
    var mime = (recv.meta && recv.meta.mime) || 'application/octet-stream';
    var url = URL.createObjectURL(new Blob([bytes], { type: mime }));

    var btn = $('saveFile');
    btn.style.display = 'block';
    btn.textContent = '⬇ ' + name;
    btn.onclick = function () {
      var a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
    };
    setNote('Komplett! ' + humanSize(bytes.length) + ' empfaangen.', 'ok');
  }

  function startReceiving() {
    resetReceiver();
    var video = $('cam');
    var canvas = $('work');
    var ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setNote('Dëse Browser ënnerstëtzt keng Kamera.', 'warn');
      return;
    }

    var camReady = navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },     // detail matters more than frame rate
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: false
      })
      .then(function (stream) {
        recv.stream = stream;
        video.srcObject = stream;
        return video.play();
      });

    Promise.all([camReady, window.BEAM_DECODE.create()])
      .then(function (both) {
        var backend = both[1];
        if (!backend) {
          setNote('Kee QR-Decoder disponibel an dësem Browser.', 'warn');
          stopReceiving();
          return;
        }
        recv.backend = backend;
        $('rEngine').textContent = backend.name;

        function grabAndSubmit() {
          var w = video.videoWidth, h = video.videoHeight;
          if (!w || !h) return;
          var scale = Math.min(1, CAM_WIDTH / w);
          var cw = Math.round(w * scale), chh = Math.round(h * scale);
          if (canvas.width !== cw || canvas.height !== chh) {
            canvas.width = cw; canvas.height = chh;
          }
          ctx.drawImage(video, 0, 0, cw, chh);
          recv.frames++;
          $('rFrames').textContent = String(recv.frames);
          backend.submit(ctx.getImageData(0, 0, cw, chh))
            .then(function (bytes) { if (bytes) handleFrame(bytes); })
            .catch(function () { /* a bad frame, not a fatal error */ });
        }

        function onFrame() {
          if (recv.done) return;
          /* Frames are disposable — the fountain does not care which ones are
             dropped — so when every decoder is busy, skip rather than queue.
             Queueing would only decode stale frames later. */
          if (video.readyState >= 2 && backend.free() > 0) grabAndSubmit();
          schedule();
        }

        function schedule() {
          if (recv.done) return;
          /* requestVideoFrameCallback fires once per NEW camera frame. With
             requestAnimationFrame at 60 Hz and a 30 fps camera, half of every
             decode was the same image twice — pure waste at the exact place
             that limits throughput. */
          if (video.requestVideoFrameCallback) {
            recv.rvfc = video.requestVideoFrameCallback(onFrame);
          } else {
            recv.raf = requestAnimationFrame(onFrame);
          }
        }
        schedule();
      })
      .catch(function (err) {
        var why = err && err.name ? err.name : 'Feeler';
        setNote('Kamera net disponibel (' + why + '). Kontrolléier d’Autorisatioun am Browser.', 'warn');
      });
  }

  /* ---------- wiring ---------- */

  $('beSender').onclick = function () { show('s-send'); };
  $('beReceiver').onclick = function () { show('s-recv'); startReceiving(); };
  $('backSend').onclick = function () { stopSending(); show('s-pick'); };
  $('backRecv').onclick = function () { stopReceiving(); show('s-pick'); };

  function settingChanged() {
    describeRate();
    describeFile();
    if (sender.timer && picked) {            // restart with the new settings
      stopSending();
      startSending(picked);
    }
  }
  $('fps').oninput = settingChanged;
  $('density').oninput = settingChanged;

  $('file').onchange = function () {
    var f = this.files && this.files[0];
    stopSending();
    picked = null;
    $('startSend').disabled = true;
    $('sTime').textContent = '—';
    if (!f) { $('sSize').textContent = '—'; $('sK').textContent = '—'; return; }

    if (f.size > MAX_BYTES) {                // sanity only; no practical cap
      $('sSize').textContent = humanSize(f.size) + ' — ze grouss';
      $('sK').textContent = 'max ' + humanSize(MAX_BYTES);
      return;
    }
    if (f.size === 0) {
      $('sSize').textContent = 'Fichier ass eidel';
      $('sK').textContent = '—';
      return;
    }

    var reader = new FileReader();
    reader.onerror = function () {
      $('sSize').textContent = 'Fichier net liesbar';
      $('sK').textContent = '—';
    };
    reader.onload = function () {
      picked = { bytes: new Uint8Array(reader.result), name: f.name,
                 mime: f.type || 'application/octet-stream' };
      describeFile();
      $('startSend').disabled = false;
    };
    reader.readAsArrayBuffer(f);
  };

  $('startSend').onclick = function () {
    if (!picked) return;
    if (sender.timer) { stopSending(); return; }
    startSending(picked);
  };

  $('density').value = String(DEFAULT_LEVEL);
  describeRate();
})();
