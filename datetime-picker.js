/* datetime-picker.js — tiny, dependency-free date + time picker, dark-themed.
   The native <input type="datetime-local"> spinner is clumsy; this renders a
   tappable month calendar plus iOS-timer-style endless-scroll wheels for the
   hour and minute.

   mountPicker(host, opts) → { get, set }
     opts.value    Date | null   preselected date/time (null = nothing chosen)
     opts.time     boolean       show the hour/minute wheels (default true)
     opts.min      Date | null   earliest selectable day (earlier days disabled)
     opts.lang     "lb" | "de"   month/weekday labels (default "de")
     opts.minuteStep number      minute granularity for the wheel (default 1)
     opts.onChange (Date|null) => void   fired on every user pick
   get() returns the chosen Date (or null); set(Date|null) updates the widget. */

const L = {
  lb: { months: ["Januar","Februar","Mäerz","Abrëll","Mee","Juni","Juli","August","September","Oktober","November","Dezember"],
        dow: ["Mé","Dë","Më","Do","Fr","Sa","So"], time: "Zäit" },
  de: { months: ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"],
        dow: ["Mo","Di","Mi","Do","Fr","Sa","So"], time: "Uhrzeit" },
};

const pad = (n) => String(n).padStart(2, "0");
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const sameDay = (a, b) => a && b &&
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const ROW = 32;        // wheel item height (px)
const VISIBLE = 5;     // rows shown in the wheel viewport
const MID = (VISIBLE - 1) / 2;

const CSS = `
.dtp{background:var(--card2);border:1px solid var(--border);border-radius:12px;padding:12px;max-width:320px;user-select:none}
.dtp-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.dtp-title{font-weight:700;font-size:14px}
.dtp-nav{background:none;border:1px solid var(--border);color:var(--text);border-radius:8px;width:32px;height:32px;font-size:17px;cursor:pointer;line-height:1}
.dtp-nav:hover{border-color:var(--accent2)}
.dtp-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px}
.dtp-dow span{text-align:center;font-size:11px;color:var(--muted)}
.dtp-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.dtp-d,.dtp-e{height:34px;display:flex;align-items:center;justify-content:center;font-size:13px;border-radius:8px}
.dtp-d{background:none;border:1px solid transparent;color:var(--text);cursor:pointer;padding:0}
.dtp-d:hover{border-color:var(--accent2)}
.dtp-d.today{border-color:var(--border)}
.dtp-d.on{background:var(--accent2);color:#06121a;font-weight:800;border-color:var(--accent2)}
.dtp-d:disabled{color:var(--muted);opacity:.35;cursor:default;border-color:transparent}
.dtp-time{display:flex;flex-direction:column;align-items:center;gap:4px;margin-top:10px}
.dtp-time .lbl{align-self:flex-start;color:var(--muted);font-size:12px}
.dtp-wheels{display:flex;align-items:center;gap:4px;position:relative}
.dtp-wheels::after{content:"";position:absolute;left:6px;right:6px;top:50%;height:${ROW}px;transform:translateY(-50%);
  border-top:1px solid var(--accent2);border-bottom:1px solid var(--accent2);opacity:.55;pointer-events:none;border-radius:6px}
.wheel{height:${ROW * VISIBLE}px;width:60px;overflow-y:scroll;scroll-snap-type:y mandatory;scrollbar-width:none;
  -webkit-overflow-scrolling:touch;overscroll-behavior:contain;
  -webkit-mask-image:linear-gradient(to bottom,transparent,#000 32%,#000 68%,transparent);
  mask-image:linear-gradient(to bottom,transparent,#000 32%,#000 68%,transparent)}
.wheel::-webkit-scrollbar{display:none}
.wheel-item{height:${ROW}px;display:flex;align-items:center;justify-content:center;font-size:19px;scroll-snap-align:center;
  color:var(--muted);font-variant-numeric:tabular-nums;cursor:pointer}
.wheel-item.sel{color:var(--text);font-weight:800}
.dtp-colon{font-size:20px;color:var(--text);font-weight:800;margin-top:-2px}
`;

function ensureCSS() {
  if (document.getElementById("dtp-css")) return;
  const s = document.createElement("style");
  s.id = "dtp-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* An endless-scroll wheel: `values` are repeated many times so the user can
   flick forever; after each settle we silently jump back to the middle copy
   (identical-looking, so no visible seam). onChange(valueIndex) on settle. */
function makeWheel(host, values, initIdx, onChange) {
  const len = values.length;
  const reps = 2 * Math.ceil(240 / len) + 1;     // enough buffer that a fling never hits an edge
  const midRep = Math.floor(reps / 2);
  const el = document.createElement("div");
  el.className = "wheel";
  let html = "";
  for (let r = 0; r < reps; r++)
    for (let i = 0; i < len; i++) html += `<div class="wheel-item" data-i="${i}">${values[i]}</div>`;
  el.innerHTML = html;
  host.appendChild(el);
  const items = el.children;

  let valueIdx = ((initIdx % len) + len) % len;
  let settleT = null, muted = false;

  const scrollFor = (abs) => (abs - MID) * ROW;
  const centeredAbs = () => Math.round(el.scrollTop / ROW) + MID;

  function markSel() {
    const c = centeredAbs();
    for (let k = 0; k < items.length; k++) items[k].classList.toggle("sel", k === c);
  }
  function place(smooth) {
    el.scrollTo({ top: scrollFor(midRep * len + valueIdx), behavior: smooth ? "smooth" : "auto" });
  }
  function onSettle() {
    const c = centeredAbs();
    valueIdx = ((c % len) + len) % len;
    const desired = midRep * len + valueIdx;
    if (c !== desired) { muted = true; el.scrollTop = scrollFor(desired); muted = false; }
    markSel();
    onChange && onChange(valueIdx);
  }

  el.addEventListener("scroll", () => {
    if (muted) return;
    markSel();
    clearTimeout(settleT);
    settleT = setTimeout(onSettle, 110);
  });
  el.addEventListener("scrollend", () => { if (!muted) { clearTimeout(settleT); onSettle(); } });
  el.addEventListener("click", (e) => {
    const it = e.target.closest(".wheel-item");
    if (it) el.scrollTo({ top: scrollFor([].indexOf.call(items, it)), behavior: "smooth" });
  });

  requestAnimationFrame(() => { place(false); markSel(); });

  return {
    get: () => valueIdx,
    set: (i) => { valueIdx = ((i % len) + len) % len; requestAnimationFrame(() => { place(false); markSel(); }); },
  };
}

export function mountPicker(host, opts = {}) {
  ensureCSS();
  const lang = L[opts.lang] ? opts.lang : "de";
  const t = L[lang];
  const withTime = opts.time !== false;
  const step = opts.minuteStep || 1;
  const min = opts.min ? startOfDay(opts.min) : null;

  let cur = opts.value ? new Date(opts.value) : new Date();
  let selected = opts.value ? new Date(cur) : null;
  let view = new Date(cur.getFullYear(), cur.getMonth(), 1);

  host.classList.add("dtp");
  host.innerHTML =
    `<div class="dtp-head">
       <button type="button" class="dtp-nav" data-d="-1" aria-label="prev">‹</button>
       <span class="dtp-title"></span>
       <button type="button" class="dtp-nav" data-d="1" aria-label="next">›</button>
     </div>
     <div class="dtp-dow">${t.dow.map((d) => `<span>${d}</span>`).join("")}</div>
     <div class="dtp-grid"></div>` +
    (withTime
      ? `<div class="dtp-time"><span class="lbl">${t.time}</span>
           <div class="dtp-wheels"><div class="wh-h"></div><b class="dtp-colon">:</b><div class="wh-m"></div></div>
         </div>`
      : "");

  const q = (s) => host.querySelector(s);
  const grid = q(".dtp-grid");
  const title = q(".dtp-title");

  const emit = () => opts.onChange && opts.onChange(selected ? new Date(cur) : null);
  const commitTime = () => { if (!selected) selected = new Date(cur); emit(); };

  let hourWheel = null, minWheel = null;
  const minVals = [];
  for (let m = 0; m < 60; m += step) minVals.push(pad(m));
  const minToIdx = (m) => Math.round(m / step) % minVals.length;
  if (withTime) {
    const hourVals = Array.from({ length: 24 }, (_, h) => pad(h));
    hourWheel = makeWheel(q(".wh-h"), hourVals, cur.getHours(), (i) => { cur.setHours(i, cur.getMinutes(), 0, 0); commitTime(); });
    minWheel = makeWheel(q(".wh-m"), minVals, minToIdx(cur.getMinutes()), (i) => { cur.setMinutes(+minVals[i], 0, 0); commitTime(); });
  }

  function renderCal() {
    title.textContent = `${t.months[view.getMonth()]} ${view.getFullYear()}`;
    const lead = (new Date(view.getFullYear(), view.getMonth(), 1).getDay() + 6) % 7; // Monday-first
    const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    let html = "";
    for (let i = 0; i < lead; i++) html += `<span class="dtp-e"></span>`;
    for (let d = 1; d <= days; d++) {
      const day = new Date(view.getFullYear(), view.getMonth(), d);
      const disabled = min && startOfDay(day) < min;
      const isSel = selected && sameDay(day, cur);
      const isToday = sameDay(day, new Date());
      html += `<button type="button" class="dtp-d${isSel ? " on" : ""}${isToday ? " today" : ""}" ` +
        `data-d="${d}"${disabled ? " disabled" : ""}>${d}</button>`;
    }
    grid.innerHTML = html;
  }

  host.querySelectorAll(".dtp-nav").forEach((b) => (b.onclick = () => {
    view = new Date(view.getFullYear(), view.getMonth() + Number(b.dataset.d), 1);
    renderCal();
  }));
  grid.addEventListener("click", (e) => {
    const b = e.target.closest(".dtp-d");
    if (!b || b.disabled) return;
    cur.setFullYear(view.getFullYear(), view.getMonth(), +b.dataset.d);
    selected = new Date(cur);
    renderCal();
    emit();
  });

  renderCal();

  return {
    get: () => (selected ? new Date(cur) : null),
    set: (d) => {
      if (d) {
        cur = new Date(d);
        selected = new Date(cur);
        view = new Date(cur.getFullYear(), cur.getMonth(), 1);
        if (withTime) { hourWheel.set(cur.getHours()); minWheel.set(minToIdx(cur.getMinutes())); }
      } else {
        selected = null;
      }
      renderCal();
    },
  };
}
