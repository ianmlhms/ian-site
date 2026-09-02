export const esc = (s) => ("" + (s ?? "")).replace(
  /[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;" })[c],
);

export function homeMarkup(me, percent) {
  const hasFinished = me.swiped >= me.total;
  const ownerButton = me.is_owner
    ? '<button class="btn secondary" id="standingsBtn">Ranglëscht</button>'
    : "";
  const hint = hasFinished ? ""
    : '<p class="hint">Duell geet op, wann s du all d\'Fotoe gewäscht hues.</p>';
  return `<div class="card">
    <h2 class="title">Moien, ${esc(me.name)}!</h2>
    <p class="muted">Deng Auswiel fir d'Skandinavien-Fotobuch.</p>
    <p><strong>Wëschen</strong> · ${me.swiped} / ${me.total}</p>
    <div class="progress"><span style="width:${percent}%"></span></div>
    <div class="stats">
      <div class="stat"><strong>${me.kept}</strong><span>behalen</span></div>
      <div class="stat"><strong>${me.survivors}</strong><span>Iwwerliewender</span></div>
      <div class="stat"><strong>${me.my_duels}</strong><span>Dueller</span></div>
    </div>
    <div class="actions">
      <button class="btn" id="swipeBtn">Wëschen</button>
      <button class="btn" id="duelBtn" ${hasFinished ? "" : "disabled"}>Duell</button>
      ${ownerButton}
    </div>${hint}
  </div>`;
}

export function swipeMarkup(photo, me, canUndo, url) {
  return `<div class="stage-head">
    <button class="btn secondary" id="overviewBtn">Iwwersiicht</button>
    <div class="spacer"></div><h2>Wëschen</h2>
  </div>
  <div class="photo-meta"><span>${me.swiped + 1} / ${me.total}</span><span>${esc(photo.day_label || "")}</span></div>
  <div class="photo-stage"><img src="${esc(url)}" alt="Foto fir ofzestëmmen" draggable="false"></div>
  <div class="swipe-actions">
    <button class="btn skip" id="skipBtn">✕ Ewech</button>
    <button class="btn keep" id="keepBtn">♥ Behalen</button>
  </div>
  <button class="undo" id="undoBtn" ${canUndo ? "" : "disabled"}>Zréck</button>`;
}

export function finishedMarkup(canUndo) {
  return `<div class="card gate">
    <h2 class="title">Fäerdeg! 🎉</h2>
    <p>Du hues all d'Fotoe gekuckt.</p>
    <div class="actions"><button class="btn" id="finishedDuel">Bei d'Dueller</button></div>
    <button class="undo" id="finishedUndo" ${canUndo ? "" : "disabled"}>Zréck</button>
  </div>`;
}

export function duelMarkup(pair, urlA, urlB, count, target) {
  return `<div class="stage-head">
    <button class="btn secondary" id="overviewBtn">Iwwersiicht</button>
    <div class="spacer"></div>
    <span class="muted">${count} Dueller · ${esc(target)}</span>
  </div>
  <div class="duel-grid">
    <button class="duel-pick" id="pickA"><img src="${esc(urlA)}" alt="Lénkst Foto" draggable="false"></button>
    <button class="duel-pick" id="pickB"><img src="${esc(urlB)}" alt="Rietst Foto" draggable="false"></button>
  </div>`;
}

function standingCard(row, url) {
  const contributor = row.contributor
    ? ` · ${esc(row.contributor)}` : "";
  return `<article class="card standing">
    <img src="${esc(url)}" alt="Foto op Plaz ${Number(row.rank)}" loading="lazy">
    <p><span class="rank">#${Number(row.rank)}</span> · ${Math.round(Number(row.elo))} Elo<br>
    ${Number(row.duels)} Dueller · ${Number(row.keeps)} Behaler<br>${esc(row.day_label || "")}${contributor}</p>
  </article>`;
}

export function standingsMarkup(rows, urlForRow) {
  const cards = rows.map((row) => standingCard(
    row, urlForRow(row),
  )).join("");
  return `<div class="stage-head">
    <button class="btn secondary" id="overviewBtn">Iwwersiicht</button>
    <div class="spacer"></div><h2>Ranglëscht</h2>
  </div>
  <div class="standings">${cards || '<p class="gate">Nach keng Iwwerliewender.</p>'}</div>`;
}
