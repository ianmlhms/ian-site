/* Minimal .docx writer — no dependencies.
 *
 * A .docx is just a ZIP holding three XML parts. We build it by hand rather
 * than pulling in a library, because ian.lu is served without compression, so
 * every imported kilobyte is paid for in full on a phone.
 *
 * The ZIP is written with method 0 (stored, uncompressed): Word accepts it,
 * and it avoids shipping a DEFLATE implementation. Documents here are a few KB
 * of text, so the size cost is irrelevant.
 */
(function () {
  'use strict';

  /* ---- CRC32, required by the ZIP format ---- */
  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    // Node fallback for tests
    return new Uint8Array(Buffer.from(str, 'utf8'));
  }

  function xmlEscape(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  /* ---- tiny stored-only ZIP ---- */
  function zip(files) {
    var chunks = [], central = [], offset = 0;

    function u16(n) { return [n & 0xFF, (n >>> 8) & 0xFF]; }
    function u32(n) { return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }

    files.forEach(function (f) {
      var name = utf8(f.name), data = utf8(f.data), sum = crc32(data);
      var local = [].concat(
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(sum), u32(data.length), u32(data.length), u16(name.length), u16(0));
      chunks.push(new Uint8Array(local), name, data);

      central.push([].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(sum), u32(data.length), u32(data.length),
        u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset)));
      central.push(name);

      offset += local.length + name.length + data.length;
    });

    var dirStart = offset, dirBytes = [];
    central.forEach(function (part) {
      if (part instanceof Uint8Array) { dirBytes.push(part); offset += part.length; }
      else { var a = new Uint8Array(part); dirBytes.push(a); offset += a.length; }
    });

    var end = new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(offset - dirStart), u32(dirStart), u16(0)));

    var all = chunks.concat(dirBytes, [end]);
    var total = all.reduce(function (n, a) { return n + a.length; }, 0);
    var out = new Uint8Array(total), pos = 0;
    all.forEach(function (a) { out.set(a, pos); pos += a.length; });
    return out;
  }

  /* ---- document body ---- */
  function para(text, opts) {
    opts = opts || {};
    var runProps = '<w:rPr>' +
      (opts.bold ? '<w:b/>' : '') +
      (opts.size ? '<w:sz w:val="' + (opts.size * 2) + '"/>' : '') +
      (opts.color ? '<w:color w:val="' + opts.color + '"/>' : '') +
      '</w:rPr>';
    var paraProps = '<w:pPr>' +
      (opts.align ? '<w:jc w:val="' + opts.align + '"/>' : '') +
      (opts.pageBreak ? '<w:pageBreakBefore/>' : '') +
      '</w:pPr>';
    return '<w:p>' + paraProps + '<w:r>' + runProps +
           '<w:t xml:space="preserve">' + xmlEscape(text) + '</w:t></w:r></w:p>';
  }

  function table(rows, widths) {
    var grid = '<w:tblGrid>' + widths.map(function (w) {
      return '<w:gridCol w:w="' + w + '"/>';
    }).join('') + '</w:tblGrid>';
    var body = rows.map(function (row) {
      return '<w:tr>' + row.map(function (cell, i) {
        return '<w:tc><w:tcPr><w:tcW w:w="' + widths[i] + '" w:type="dxa"/></w:tcPr>' +
               para(cell.text, cell) + '</w:tc>';
      }).join('') + '</w:tr>';
    }).join('');
    return '<w:tbl><w:tblPr><w:tblBorders>' +
      ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (s) {
        return '<w:' + s + ' w:val="single" w:sz="6" w:color="888888"/>';
      }).join('') +
      '</w:tblBorders></w:tblPr>' + grid + body + '</w:tbl>';
  }

  /* blocks: {type:'p'|'table', ...} */
  function build(blocks) {
    var body = blocks.map(function (b) {
      return b.type === 'table' ? table(b.rows, b.widths) : para(b.text, b);
    }).join('');

    var doc =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body>' + body +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900"/></w:sectPr>' +
      '</w:body></w:document>';

    var types =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>';

    var rels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>';

    return zip([
      { name: '[Content_Types].xml', data: types },
      { name: '_rels/.rels', data: rels },
      { name: 'word/document.xml', data: doc },
    ]);
  }

  var api = { build: build, _zip: zip, _crc32: crc32 };
  if (typeof window !== 'undefined') window.JQ_DOCX = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
