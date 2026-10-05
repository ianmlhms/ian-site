export const esc = (s) => ("" + (s ?? "")).replace(
  /[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;" })[c],
);

const KEY_HINT = '<p class="hint">Mat de Pfeiltaste <strong>←</strong> / <strong>→</strong> geet et nach méi séier.</p>';

export function loadingMarkup(text) {
  return `<div class="ui-card state" role="status"><div class="gate-ico" aria-hidden="true">📷</div><p class="big">${esc(text)}</p></div>`;
}

export function emptyDuelMarkup() {
  return `<div class="ui-card state"><div class="gate-ico" aria-hidden="true">🤷</div>
    <h2>Keen Duell fräi</h2>
    <p>Et gëtt elo kee passenden neie Foto-Puer.</p>
    <button class="ui-btn ui-btn--ghost" id="overviewBtn">Iwwersiicht</button></div>`;
}

export function homeMarkup(me, percent) {
  const hasFinished = me.swiped >= me.total;
  const left = Math.max(0, me.total - me.swiped);
  const swipeSub = hasFinished
    ? "Alles gekuckt – du kanns nach emol iwwerdenken"
    : `${left} Fotoe waarden op däin Daum`;
  const duelSub = hasFinished
    ? "Zwee Fotoe géigeneen, du wielt de Gewënner"
    : "Geet op, wann s du all d'Fotoe gewäscht hues";
  const ownerTile = me.is_owner
    ? `<button class="ui-tile" id="standingsBtn" style="--h:#f2b84b">
        <span class="ui-tile__ico" aria-hidden="true">🏆</span>
        <span class="ui-tile__name">Ranglëscht</span>
        <span class="ui-tile__sub">D'beléiftst Fotoe vun alleguer</span>
      </button>`
    : "";
  return `<section class="ui-card ui-card--accent hero">
    <p class="kicker">Skandinavien-Fotobuch</p>
    <h2 class="ui-title">Moien, ${esc(me.name)}! <span aria-hidden="true">👋</span></h2>
    <p class="sub">Deng Auswiel fir d'Skandinavien-Fotobuch.</p>
    <div class="prog-row"><strong>Wëschen</strong><span>${me.swiped} / ${me.total} · ${percent}%</span></div>
    <div class="progress" role="progressbar" aria-label="Wëschen" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div>
  </section>
  <div class="stats">
    <div class="stat"><strong>${me.kept}</strong><span>behalen</span></div>
    <div class="stat"><strong>${me.survivors}</strong><span>Iwwerliewender</span></div>
    <div class="stat"><strong>${me.my_duels}</strong><span>Dueller</span></div>
  </div>
  <div class="menu">
    <button class="ui-tile" id="swipeBtn" style="--h:#4fc37a">
      <span class="ui-tile__ico" aria-hidden="true">🖼️</span>
      <span class="ui-tile__name">Wëschen</span>
      <span class="ui-tile__sub">${esc(swipeSub)}</span>
    </button>
    <button class="ui-tile" id="duelBtn" style="--h:#ff9f43" ${hasFinished ? "" : "disabled"}>
      <span class="ui-tile__ico" aria-hidden="true">⚔️</span>
      <span class="ui-tile__name">Duell</span>
      <span class="ui-tile__sub">${esc(duelSub)}</span>
    </button>
    ${ownerTile}
  </div>`;
}

export function swipeMarkup(photo, me, canUndo, url) {
  const percent = me.total
    ? Math.min(100, Math.round(100 * me.swiped / me.total)) : 100;
  return `<div class="stage-head">
    <button class="ui-btn ui-btn--ghost" id="overviewBtn"><span aria-hidden="true">‹</span>&nbsp;Iwwersiicht</button>
    <div class="spacer"></div><h2>Wëschen</h2>
  </div>
  <div class="progress slim" role="progressbar" aria-label="Wëschen" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div>
  <div class="photo-meta"><strong>${me.swiped + 1} / ${me.total}</strong><span>${esc(photo.day_label || "")}</span></div>
  <div class="photo-stage"><img src="${esc(url)}" alt="Foto fir ofzestëmmen" draggable="false"></div>
  <div class="swipe-actions">
    <button class="ui-btn skip" id="skipBtn" aria-keyshortcuts="ArrowLeft"><span aria-hidden="true">✕</span> Ewech</button>
    <button class="ui-btn ui-btn--primary keep" id="keepBtn" aria-keyshortcuts="ArrowRight"><span aria-hidden="true">♥</span> Behalen</button>
  </div>
  <button class="undo" id="undoBtn" ${canUndo ? "" : "disabled"}>Zréck</button>
  ${KEY_HINT}`;
}

export function finishedMarkup(canUndo) {
  return `<div class="ui-card ui-card--accent state"><div class="gate-ico" aria-hidden="true">🎉</div>
    <h2>Fäerdeg!</h2>
    <p>Du hues all d'Fotoe gekuckt.</p>
    <button class="ui-btn ui-btn--primary" id="finishedDuel">Bei d'Dueller</button>
    <button class="undo" id="finishedUndo" ${canUndo ? "" : "disabled"}>Zréck</button>
  </div>`;
}

export function duelMarkup(pair, urlA, urlB, count, target) {
  return `<div class="stage-head">
    <button class="ui-btn ui-btn--ghost" id="overviewBtn"><span aria-hidden="true">‹</span>&nbsp;Iwwersiicht</button>
    <div class="spacer"></div>
    <span class="pill">${count} Dueller · ${esc(target)}</span>
  </div>
  <div class="duel-grid">
    <button class="duel-pick" id="pickA" aria-label="Lénkst Foto wielen" aria-keyshortcuts="ArrowLeft"><img src="${esc(urlA)}" alt="Lénkst Foto" draggable="false"><span class="key" aria-hidden="true">←</span></button>
    <button class="duel-pick" id="pickB" aria-label="Rietst Foto wielen" aria-keyshortcuts="ArrowRight"><img src="${esc(urlB)}" alt="Rietst Foto" draggable="false"><span class="key" aria-hidden="true">→</span></button>
  </div>
  ${KEY_HINT}`;
}

function standingCard(row, url) {
  const contributor = row.contributor
    ? ` · ${esc(row.contributor)}` : "";
  return `<article class="ui-card standing">
    <img src="${esc(url)}" alt="Foto op Plaz ${Number(row.rank)}" loading="lazy">
    <p><span class="rank">#${Number(row.rank)}</span><br>${Math.round(Number(row.elo))} Elo<br>
    ${Number(row.duels)} Dueller · ${Number(row.keeps)} Behaler<br>${esc(row.day_label || "")}${contributor}</p>
  </article>`;
}

export function standingsMarkup(rows, urlForRow) {
  const cards = rows.map((row) => standingCard(
    row, urlForRow(row),
  )).join("");
  return `<div class="stage-head">
    <button class="ui-btn ui-btn--ghost" id="overviewBtn"><span aria-hidden="true">‹</span>&nbsp;Iwwersiicht</button>
    <div class="spacer"></div><h2>Ranglëscht</h2>
  </div>
  <div class="standings">${cards || '<p class="ui-card state empty">Nach keng Iwwerliewender.</p>'}</div>`;
}
