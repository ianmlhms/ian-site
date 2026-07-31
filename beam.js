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
    { label: 'Sécher',  block: 180,  qr: 10 },
    { label: 'Normal',  block: 600,  qr: 20 },
    { label: 'Séier',   block: 1000, qr: 26 },
    { label: 'Maximal', block: 1400, qr: 32 }
  ];
  var DEFAULT_LEVEL = 1;

  var META_EVERY = 7;              // frames between filename frames
  var MAX_BYTES = 2 * 1024 * 1024;
  var QR_ECC = 'L';                // least redundancy, most payload
  var QUIET = 2;                   // QR quiet-zone modules
  var CAM_WIDTH = 900;             // downscale before decoding, for speed

  /* Measured: the codec needs ~1.2 packets per block, and only 6 of every 7
     frames carry data — the rest carry the filename. */
  var OVERHEAD = 1.2 * (META_EVERY / (META_EVERY - 1));

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

  function drawQR(canvas, text) {
    var qr = qrcode(0, QR_ECC);          // 0 = smallest version that fits
    qr.addData(text);
    qr.make();
    var n = qr.getModuleCount();
    var total = n + QUIET * 2;
    /* Integer scale keeps module edges crisp; blurred edges kill decode rates.
       Denser codes need more physical pixels, so scale up to the display box. */
    var box = Math.min(canvas.parentNode.clientWidth || 320, 720);
    var scale = Math.max(2, Math.floor(box / total));
    canvas.width = canvas.height = total * scale;
    canvas.style.width = '100%';
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect((c + QUIET) * scale, (r + QUIET) * scale, scale, scale);
        }
      }
    }
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
    var metaText = W.metaFrame(file.name, file.mime, file.bytes.length);

    var canvas = document.createElement('canvas');
    $('qrwrap').innerHTML = '';
    $('qrwrap').appendChild(canvas);

    var seed = 1, sent = 0;

    function tick() {
      var text;
      if (sent % META_EVERY === 0) {
        text = metaText;                       // repeated, so a receiver that
      } else {                                 // joins late still gets the name
        var s = seed++ & 0xffff;
        if (s === 0) s = 1;
        text = W.dataFrame(file.bytes.length, lv.block, s, enc.packet(s));
      }
      drawQR(canvas, text);
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

  function describeFile() {
    if (!picked) return;
    var lv = level();
    var k = Math.max(1, Math.ceil(picked.bytes.length / lv.block));
    var frames = Math.ceil(k * OVERHEAD);
    var secs = Math.max(1, Math.round(frames / fps()));
    $('sSize').textContent = humanSize(picked.bytes.length);
    $('sK').textContent = k + ' Blocken, ≈' + frames + ' Frames';
    $('sTime').textContent = '≈' + secs + ' s am beschte Fall';
  }

  function describeRate() {
    var lv = level();
    $('sDensity').textContent = lv.label + ' (QR v' + lv.qr + ', ' + lv.block + ' B)';
    $('sFps').textContent = fps() + ' / Sek.';
    var rate = lv.block * fps() / OVERHEAD;
    $('sRate').textContent = '≈' + (rate / 1024).toFixed(1) + ' KB/s theoretesch';
  }

  /* ---------- receiver ---------- */

  var recv = { stream: null, raf: null, decoder: null, meta: null,
               frames: 0, collected: 0, needed: 0, done: false };

  function stopReceiving() {
    if (recv.raf) { cancelAnimationFrame(recv.raf); recv.raf = null; }
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

  function handleFrame(text) {
    if (recv.done || !text) return;
    var f = W.parseFrame(text);
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
          height: { ideal: 1080 }
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
        $('rEngine').textContent = backend.name;
        var busy = false;

        function loop() {
          recv.raf = requestAnimationFrame(loop);
          if (busy || recv.done || video.readyState < 2) return;

          var w = video.videoWidth, h = video.videoHeight;
          if (!w || !h) return;

          busy = true;
          var scale = Math.min(1, CAM_WIDTH / w);
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          recv.frames++;
          $('rFrames').textContent = String(recv.frames);

          var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          backend.detect(canvas, img)
            .then(function (text) { if (text) handleFrame(text); })
            .catch(function () { /* a bad frame, not a fatal error */ })
            .then(function () { busy = false; });
        }
        loop();
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

    if (f.size > MAX_BYTES) {
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
