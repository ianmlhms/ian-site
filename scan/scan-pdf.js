/* Fiche scanner: PDF building (jsPDF) and multipart upload (XHR with progress). */
(function (root) {
  'use strict';

  var JSPDF_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
  var PDF_PAGE_WIDTH_PT = 595;
  var UPLOAD_TIMEOUT_MS = 180000;

  /** Error carrying the HTTP status (0 = network problem) for the UI to branch on. */
  function UploadError(status, message) {
    var error = new Error(message);
    error.name = 'UploadError';
    error.status = status;
    return error;
  }

  function loadJsPdf() {
    if (root.jspdf && root.jspdf.jsPDF) return Promise.resolve(root.jspdf.jsPDF);
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.async = true;
      el.src = JSPDF_SRC;
      el.onload = function () {
        if (root.jspdf && root.jspdf.jsPDF) resolve(root.jspdf.jsPDF);
        else reject(new Error('jsPDF loaded but not available'));
      };
      el.onerror = function () {
        el.remove();
        reject(new Error('Konnt d\'PDF-Bibliothéik net lueden. Ass d\'Internet do?'));
      };
      document.head.appendChild(el);
    });
  }

  function loadImage(dataUrl) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Eng Säit konnt net gelies ginn')); };
      img.src = dataUrl;
    });
  }

  /** Returns NEW page objects re-encoded smaller; inputs stay untouched. */
  async function downscalePages(pages, maxSide, quality) {
    var result = [];
    for (var i = 0; i < pages.length; i++) {
      var page = pages[i];
      var img = await loadImage(page.dataUrl);
      var scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      var width = Math.max(1, Math.round(img.naturalWidth * scale));
      var height = Math.max(1, Math.round(img.naturalHeight * scale));
      var canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      var dataUrl = canvas.toDataURL('image/jpeg', quality);
      canvas.width = 0;
      canvas.height = 0;
      result.push({ dataUrl: dataUrl, width: width, height: height });
    }
    return result;
  }

  function pageFormat(page) {
    var height = Math.max(1, Math.round(PDF_PAGE_WIDTH_PT * page.height / page.width));
    // Explicit orientation: jsPDF otherwise swaps width/height to match its default.
    return { size: [PDF_PAGE_WIDTH_PT, height], orientation: height < PDF_PAGE_WIDTH_PT ? 'l' : 'p' };
  }

  /**
   * Builds one PDF (Blob) from pages [{dataUrl,width,height}].
   * options: { maxSide, quality } -> re-encode images smaller first.
   */
  async function buildPdf(pages, options) {
    if (!Array.isArray(pages) || pages.length === 0) throw new Error('Keng Säite fir ze schécken');
    var JsPdf = await loadJsPdf();
    var source = options && options.maxSide
      ? await downscalePages(pages, options.maxSide, options.quality || 0.65)
      : pages;

    var first = pageFormat(source[0]);
    var doc = new JsPdf({ unit: 'pt', format: first.size, orientation: first.orientation, compress: true });
    source.forEach(function (page, index) {
      var format = pageFormat(page);
      if (index > 0) doc.addPage(format.size, format.orientation);
      doc.addImage(page.dataUrl, 'JPEG', 0, 0, format.size[0], format.size[1], undefined, 'FAST');
    });
    return doc.output('blob');
  }

  function extractMessage(json, status) {
    if (json && typeof json.error === 'string' && json.error) return json.error;
    if (json && typeof json.message === 'string' && json.message) return json.message;
    return 'HTTP ' + status;
  }

  function parseJson(text) {
    try { return JSON.parse(text); } catch (err) { return null; }
  }

  /**
   * POSTs the PDF as multipart/form-data. Resolves with the JSON body when
   * {ok:true}; rejects with an UploadError otherwise.
   * params: { endpoint, key, blob, filename, pageCount, hint, onProgress(fraction) }
   */
  function uploadPdf(params) {
    return new Promise(function (resolve, reject) {
      var form = new FormData();
      form.append('file', params.blob, params.filename);
      form.append('pages', String(params.pageCount));
      form.append('hint', params.hint || '');

      var xhr = new XMLHttpRequest();
      xhr.open('POST', params.endpoint);
      xhr.setRequestHeader('x-scan-key', params.key);
      xhr.timeout = UPLOAD_TIMEOUT_MS;

      xhr.upload.onprogress = function (event) {
        if (event.lengthComputable && params.onProgress) params.onProgress(event.loaded / event.total);
      };
      xhr.onload = function () {
        var json = parseJson(xhr.responseText);
        var isSuccess = xhr.status >= 200 && xhr.status < 300;
        if (isSuccess && json && json.ok === true) { resolve(json); return; }
        console.error('[scan] upload failed', xhr.status, xhr.responseText);
        reject(UploadError(xhr.status, extractMessage(json, xhr.status)));
      };
      xhr.onerror = function () {
        console.error('[scan] upload network error');
        reject(UploadError(0, 'Keng Verbindung – probéier et nach eng Kéier'));
      };
      xhr.ontimeout = function () {
        console.error('[scan] upload timeout');
        reject(UploadError(0, 'D\'Eropluede huet ze laang gedauert – probéier et nach eng Kéier'));
      };
      xhr.send(form);
    });
  }

  root.ScanPdf = { buildPdf: buildPdf, uploadPdf: uploadPdf };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.ScanPdf;
})(typeof window !== 'undefined' ? window : globalThis);
