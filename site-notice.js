/* One-time personal popups ("notices", table user_notices). Loaded lazily by
 * auth.js once a session exists; shows the oldest unseen notice as a card and
 * marks it seen when closed. Texts come as {lb, de, en}. */

const LANGS = ["lb", "de", "en"];
const OK_LABEL = Object.freeze({ lb: "OK", de: "OK", en: "OK" });
const STYLE_ID = "site-notice-style";

let checkedUserId = null;

const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function lang() {
  if (LANGS.includes(window.I18N?.lang)) return window.I18N.lang;
  try {
    const saved = localStorage.getItem("site_lang");
    if (LANGS.includes(saved)) return saved;
  } catch (error) {
    console.warn("[notice] site language", error);
  }
  return "lb";
}

function pick(texts) {
  if (!texts || typeof texts !== "object") return "";
  const value = texts[lang()] ?? texts.lb ?? texts.en ?? "";
  return typeof value === "string" ? value : "";
}

/* Only same-site paths: a notice must never send someone off ian.lu. */
function safeUrl(url) {
  return typeof url === "string" && /^\/(?!\/)[^\s]*$/.test(url) ? url : null;
}

function injectCss() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .site-notice{position:fixed;inset:0;z-index:100001;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.55)}
    .site-notice__card{width:min(420px,100%);border-radius:18px;padding:22px 20px 18px;background:var(--card-opaque,var(--card,#161625));color:var(--text,#e8e8f0);border:1px solid var(--border,rgba(255,255,255,.12));box-shadow:0 18px 50px rgba(0,0,0,.45);font-family:var(--font,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif)}
    .site-notice__title{margin:0 0 8px;font-size:19px;font-weight:800;line-height:1.3}
    .site-notice__body{margin:0 0 18px;font-size:15px;line-height:1.5;color:var(--muted,#b8b8cc)}
    .site-notice__actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}
    .site-notice__btn{min-height:44px;min-width:96px;padding:0 18px;border-radius:12px;border:1px solid var(--border,rgba(255,255,255,.14));background:transparent;color:inherit;font:inherit;font-weight:750;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;justify-content:center}
    .site-notice__btn--primary{background:var(--accent,#6c5ce7);border-color:transparent;color:#fff}
    .site-notice__btn:focus-visible{outline:3px solid var(--accent2,#74b9ff);outline-offset:2px}
  `;
  document.head.appendChild(style);
}

async function dismiss(sb, id) {
  try {
    const { error } = await sb.rpc("dismiss_notice", { p_id: id });
    if (error) throw error;
  } catch (error) {
    console.warn("[notice] could not mark the notice as seen", error);
  }
}

function render(sb, notice) {
  injectCss();
  const url = safeUrl(notice.url);
  const cta = pick(notice.cta);
  const wrap = document.createElement("div");
  wrap.className = "site-notice";
  wrap.innerHTML = `<div class="site-notice__card" role="dialog" aria-modal="true" aria-labelledby="siteNoticeTitle">
    <h2 class="site-notice__title" id="siteNoticeTitle">${esc(pick(notice.title))}</h2>
    <p class="site-notice__body">${esc(pick(notice.body))}</p>
    <div class="site-notice__actions">
      <button type="button" class="site-notice__btn" data-act="ok">${esc(OK_LABEL[lang()])}</button>
      ${url && cta ? `<a class="site-notice__btn site-notice__btn--primary" data-act="go" href="${esc(url)}">${esc(cta)}</a>` : ""}
    </div>
  </div>`;
  const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (event) => { if (event.key === "Escape") { void dismiss(sb, notice.id); close(); } };
  wrap.addEventListener("click", async (event) => {
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (act === "ok") { void dismiss(sb, notice.id); close(); }
    if (act === "go") {
      event.preventDefault();
      await dismiss(sb, notice.id);   // mark seen before leaving the page
      location.href = url;
    }
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(wrap);
  (wrap.querySelector('[data-act="go"]') || wrap.querySelector('[data-act="ok"]')).focus({ preventScroll: true });
}

/* Called by auth.js whenever the session may have changed; checks once per user per page. */
export async function showNotices(sb, getSession) {
  const userId = getSession()?.user?.id || null;
  if (!userId || userId === checkedUserId || !sb?.rpc || window.top !== window) return;
  checkedUserId = userId;
  try {
    const { data, error } = await sb.rpc("my_notices");
    if (error) throw error;
    const notice = Array.isArray(data) ? data[0] : null;
    if (!notice?.id) return;
    if (document.body) render(sb, notice);
    else document.addEventListener("DOMContentLoaded", () => render(sb, notice), { once: true });
  } catch (error) {
    console.warn("[notice] could not load notices", error);
  }
}
