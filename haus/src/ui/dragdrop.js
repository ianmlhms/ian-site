// Gemeinsame Zieh-/Skalier-Mechanik für Lageplan, Grundriss- und Möbel-Editor.
// Übernommen aus dem Hotel-Bausimulator-Muster: HTML5-DnD nur für Palette→Raster,
// eigene mousedown/mousemove/mouseup-Handler fürs Verschieben und Skalieren.

export function attachPaletteDrag(node, getPayload) {
  node.draggable = true;
  node.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', JSON.stringify(getPayload()));
    e.dataTransfer.effectAllowed = 'copy';
  });
}

export function attachDropZone(zone, onDrop) {
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dropok');
  });
  zone.addEventListener('dragleave', (e) => {
    if (e.target === zone) zone.classList.remove('dropok');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dropok');
    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;
    let data;
    try { data = JSON.parse(raw); } catch { return; }
    const rect = zone.getBoundingClientRect();
    const x = e.clientX - rect.left + zone.scrollLeft;
    const y = e.clientY - rect.top + zone.scrollTop;
    onDrop(data, x, y);
  });
}

// Verschiebe-Handler: meldet Pixel-Delta relativ zum mousedown-Punkt.
// onClick feuert statt onEnd, wenn sich die Maus kaum bewegt hat (reiner Klick = Auswahl).
export function attachDrag(node, { onStart, onMove, onEnd, onClick, threshold = 4 } = {}) {
  node.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    let moved = false;
    if (onStart) onStart(e);

    function onMouseMove(ev) {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > threshold) moved = true;
      if (moved && onMove) onMove(dx, dy, ev);
    }
    function onMouseUp(ev) {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (moved) { if (onEnd) onEnd(dx, dy, ev); }
      else if (onClick) onClick(ev);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}

export function attachResizeHandle(handle, { onMove, onEnd } = {}) {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    function onMouseMove(ev) {
      onMove(ev.clientX - startX, ev.clientY - startY, ev);
    }
    function onMouseUp(ev) {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (onEnd) onEnd(ev.clientX - startX, ev.clientY - startY, ev);
    }
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
}
