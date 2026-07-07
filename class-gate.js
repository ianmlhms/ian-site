/* Class gate. Drop on any signed-in page:
 *   <script type="module" src="class-gate.js?v=1"></script>
 * The first time a signed-in user is seen without a school class on their
 * profile, a required modal asks for it (new users at sign-up, existing users
 * the next time they open the site). Saved via the set_class RPC; the class is
 * then shown next to their name everywhere (see friends.js / messenger.js). */
import * as auth from "./auth.js?v=4";

// Use i18n when the key exists; otherwise fall back to the Luxembourgish default
// (t() returns the key unchanged when it's missing — treat that as "not found").
const T = (k, fb) => { try { const v = window.I18N && window.I18N.t && window.I18N.t(k); return (v && v !== k) ? v : fb; } catch { return fb; } };
let sb = null, checking = false, shown = false, done = false;

// A class must name a *specific* class inside a year (e.g. 5C6, 7C1, 2CG, 3CB),
// not just the year level ("5e", "7", "5EME"). Normalize to a compact upper form,
// then require year-digits + section letters (+ optional class number) and reject
// the bare-year idioms.
const normClass = (raw) => (""+(raw??"")).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const YEAR_ONLY = /^\d{1,2}(E|È|EME|ÈME|IEME|IÈME)?$/;   // 5, 5E, 5EME, 5ÈME…
const CLASS_SHAPE = /^\d{1,2}[A-Z]{1,4}\d{0,2}$/;         // 5C6, 7C1, 2CG, 4GPS…
const validClass = (raw) => { const v = normClass(raw); return CLASS_SHAPE.test(v) && !YEAR_ONLY.test(v); };

async function start() {
  if (done || shown || checking || !auth.authConfigured) return;
  const uid = auth.session()?.user?.id;
  if (!uid) return;                       // wait for sign-in (onAuth re-calls)
  checking = true;
  try {
    sb = sb || await auth.client();
    const { data } = await sb.from("profiles").select("class").eq("id", uid).maybeSingle();
    if (data && data.class && String(data.class).trim()) { done = true; return; }
    showModal();
  } catch (e) {
    console.warn("[class] check failed", e);   // fail open — don't block the page on error
  } finally {
    checking = false;
  }
}

function showModal() {
  if (shown || document.getElementById("class-gate")) return;
  shown = true;
  const ov = document.createElement("div");
  ov.id = "class-gate";
  ov.style.cssText = "position:fixed;inset:0;z-index:100001;background:rgba(6,6,14,.72);backdrop-filter:blur(4px);" +
    "display:flex;align-items:center;justify-content:center;padding:18px;" +
    "font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";
  ov.innerHTML =
    `<div style="width:100%;max-width:360px;background:#141426;border:1px solid #2a2a4a;border-radius:18px;padding:22px;color:#e8e8f0;box-shadow:0 20px 60px rgba(0,0,0,.6)">
       <div style="font-size:34px;line-height:1;margin-bottom:10px">🎓</div>
       <div style="font-weight:800;font-size:18px;margin-bottom:6px">${esc(T("class.title", "Wéi eng Klass bass du?"))}</div>
       <div style="color:#9a9ab8;font-size:13.5px;margin-bottom:14px">${esc(T("class.sub", "Gëff deng genau Klass an (net nëmmen d'Joer), z.B. 5C6, 7C1, 2CG."))}</div>
       <input id="class-input" type="text" autocomplete="off" maxlength="12" placeholder="${esc(T("class.ph", "z.B. 5C6"))}"
         style="width:100%;box-sizing:border-box;background:#0e0e1c;border:1px solid #33335a;border-radius:12px;padding:12px 14px;color:#fff;font-size:16px;outline:none;margin-bottom:6px">
       <div id="class-err" style="color:#ff7b86;font-size:12.5px;min-height:16px;margin-bottom:8px"></div>
       <button id="class-save" disabled
         style="width:100%;border:none;border-radius:12px;padding:12px;font-size:15px;font-weight:800;cursor:pointer;color:#04121f;background:#4ea6ff;opacity:.5">${esc(T("class.save", "Späicheren"))}</button>
     </div>`;
  document.body.appendChild(ov);

  const inp = document.getElementById("class-input");
  const btn = document.getElementById("class-save");
  const err = document.getElementById("class-err");
  const sync = () => {
    const ok = validClass(inp.value);
    btn.disabled = !ok; btn.style.opacity = ok ? "1" : ".5"; btn.style.cursor = ok ? "pointer" : "default";
  };
  inp.addEventListener("input", () => {
    const raw = inp.value.trim();
    // Only nag once there's something that clearly isn't a full class yet.
    err.textContent = (raw && !validClass(raw)) ? T("class.errFormat", "Gëff eng genau Klass an, z.B. 5C6 — net nëmmen d'Joer.") : "";
    sync();
  });
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !btn.disabled) save(); });
  btn.onclick = save;
  setTimeout(() => inp.focus(), 60);

  async function save() {
    if (!validClass(inp.value)) {
      err.textContent = T("class.errFormat", "Gëff eng genau Klass an, z.B. 5C6 — net nëmmen d'Joer.");
      return;
    }
    const v = normClass(inp.value);
    btn.disabled = true; btn.style.opacity = ".5"; err.textContent = "";
    try {
      const { error } = await sb.rpc("set_class", { p_class: v });
      if (error) throw error;
      done = true; shown = false;
      ov.remove();
    } catch (e) {
      err.textContent = T("class.err", "Konnt net gespäichert ginn, probéier nach eng Kéier.");
      btn.disabled = false; btn.style.opacity = "1";
      console.warn("[class] save failed", e);
    }
  }
}

const esc = (s) => (""+(s??"")).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

auth.onAuth(() => { if (auth.session()) start(); });
start();
