/* Jeopardy — custom categories, JSON transfer, and the Word export.
 *
 * Custom categories live only in this browser's localStorage. They are stored
 * flat (one language, whatever the author typed) rather than as {lb,de,en},
 * because asking someone to write every clue three times to add one category
 * would make the feature unusable.
 */
(function () {
  'use strict';

  var STORE = 'jq_custom';

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch (e) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(STORE, JSON.stringify(list)); } catch (e) {}
  }

  /* A custom category is stored as {id, name, clues:[{q,a}x5]} and wrapped so
     the rest of the app can treat it exactly like a built-in one. */
  function asCategory(c) {
    function tri(s) { return { lb: s, de: s, en: s }; }
    return {
      id: c.id, topic: 'eegen', custom: true, name: tri(c.name),
      clues: c.clues.map(function (x) { return { q: tri(x.q), a: tri(x.a) }; }),
    };
  }

  function all() { return load().map(asCategory); }

  function upsert(entry) {
    var list = load();
    var i = list.findIndex(function (c) { return c.id === entry.id; });
    if (i >= 0) list[i] = entry; else list.push(entry);
    save(list);
  }

  function remove(id) {
    save(load().filter(function (c) { return c.id !== id; }));
  }

  function validate(entry) {
    if (!entry || !entry.name || !String(entry.name).trim()) return 'name';
    if (!Array.isArray(entry.clues) || entry.clues.length !== 5) return 'clues';
    for (var i = 0; i < 5; i++) {
      if (!entry.clues[i] || !String(entry.clues[i].q || '').trim()) return 'q' + i;
      if (!String(entry.clues[i].a || '').trim()) return 'a' + i;
    }
    return null;
  }

  /* ---- JSON transfer, so a set can be shared or backed up ---- */
  function exportJson() {
    var blob = new Blob([JSON.stringify({ jeopardy: 1, categories: load() }, null, 1)],
                        { type: 'application/json' });
    download(blob, 'jeopardy-kategorien.json');
  }

  function importJson(text) {
    var data = JSON.parse(text);
    var incoming = Array.isArray(data) ? data : (data.categories || []);
    var added = 0;
    incoming.forEach(function (c) {
      if (validate(c)) return;                       // skip anything malformed
      if (!c.id) c.id = 'c' + Date.now() + Math.random().toString(36).slice(2, 7);
      upsert(c); added++;
    });
    return added;
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---- Word export: a printable board plus an answer key ---- */
  function exportWord(cats, values, tx, labels) {
    var blocks = [];
    blocks.push({ type: 'p', text: labels.title, bold: true, size: 22, align: 'center' });
    blocks.push({ type: 'p', text: labels.subtitle, size: 10, align: 'center', color: '666666' });
    blocks.push({ type: 'p', text: '' });

    // 1) The empty board, to cut up or read from.
    blocks.push({ type: 'p', text: labels.board, bold: true, size: 14 });
    var width = Math.floor(9900 / cats.length);
    var rows = [cats.map(function (c) {
      return { text: tx(c.name), bold: true, align: 'center' };
    })];
    values.forEach(function (v) {
      rows.push(cats.map(function () { return { text: String(v), align: 'center' }; }));
    });
    blocks.push({ type: 'table', widths: cats.map(function () { return width; }), rows: rows });

    // 2) The answer key, one page per category so it can be handed out.
    cats.forEach(function (c, ci) {
      blocks.push({ type: 'p', text: tx(c.name), bold: true, size: 16, pageBreak: ci === 0 });
      c.clues.forEach(function (clue, i) {
        blocks.push({ type: 'p', text: values[i] + ' — ' + tx(clue.q) });
        blocks.push({ type: 'p', text: '        → ' + tx(clue.a), bold: true });
      });
      blocks.push({ type: 'p', text: '' });
    });

    var bytes = window.JQ_DOCX.build(blocks);
    download(new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }), 'jeopardy.docx');
  }

  window.JQ_EDIT = {
    load: load, all: all, upsert: upsert, remove: remove, validate: validate,
    exportJson: exportJson, importJson: importJson, exportWord: exportWord,
  };
})();
