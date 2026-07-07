/* Ambient incoming-call listener (FaceTime mode). Drop on any signed-in page:
 *   <script type="module" src="rtc-ring.js?v=1"></script>
 * Subscribes to the user's personal ring inbox (rtc:<uid>) and shows an
 * Answer/Decline banner when a friend calls. Answering opens call.html. */
import * as auth from "./auth.js?v=4";

const T = (k) => (window.I18N ? window.I18N.t(k) : k);
let subbed = false, sb = null, current = null, ringOsc = null, ringTimer = null, ringGain = null;

async function start() {
  if (subbed || !auth.authConfigured) return;
  sb = await auth.client();
  const uid = auth.session()?.user?.id;
  if (!uid) return;                 // wait for sign-in (onAuth re-calls)
  subbed = true;
  sb.channel("rtc:" + uid, { config: { broadcast: { self: false } } })
    .on("broadcast", { event: "ring" }, ({ payload }) => showBanner(payload))
    .on("broadcast", { event: "cancel" }, ({ payload }) => { if (current && current.callId === payload.callId) dismiss(); })
    .subscribe();
}

function showBanner(p) {
  if (current) return;              // already ringing for a call
  current = p;
  const wrap = document.createElement("div");
  wrap.id = "rtc-ring";
  wrap.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:100000;" +
    "background:#161625;border:1px solid #2a2a4a;border-radius:16px;padding:14px 16px;display:flex;align-items:center;gap:14px;" +
    "box-shadow:0 12px 40px rgba(0,0,0,.55);max-width:calc(100vw - 24px);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#e8e8f0";
  wrap.innerHTML =
    `<div style="width:44px;height:44px;border-radius:50%;background:#1e1e35;display:flex;align-items:center;justify-content:center;font-size:22px;flex:none">📹</div>
     <div style="min-width:0"><div style="font-weight:800;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.fromName || "?")}</div>
       <div style="color:#9a9ab8;font-size:12.5px">${esc(T("ring.incoming"))}</div></div>
     <button id="rtc-decline" style="flex:none;width:42px;height:42px;border-radius:50%;border:none;background:#ff5d6c;color:#fff;font-size:18px;cursor:pointer">📵</button>
     <button id="rtc-answer" style="flex:none;width:42px;height:42px;border-radius:50%;border:none;background:#3fb950;color:#fff;font-size:18px;cursor:pointer">📞</button>`;
  document.body.appendChild(wrap);
  document.getElementById("rtc-answer").onclick = answer;
  document.getElementById("rtc-decline").onclick = decline;
  startRing();
  ringTimer = setTimeout(dismiss, 35000);   // stop ringing if unanswered
}

function answer() {
  const p = current; stopRing();
  const u = `call.html?call=${encodeURIComponent(p.callId)}&peer=${encodeURIComponent(p.from)}&name=${encodeURIComponent(p.fromName || "")}&answer=1`;
  location.href = u;
}
function decline() {
  const p = current;
  try { const c = sb.channel("call:" + p.callId); c.subscribe((s) => { if (s === "SUBSCRIBED") { c.send({ type: "broadcast", event: "bye", payload: {} }); setTimeout(() => sb.removeChannel(c), 300); } }); } catch {}
  dismiss();
}
function dismiss() {
  stopRing();
  const el = document.getElementById("rtc-ring"); if (el) el.remove();
  current = null;
}

/* simple two-tone ringtone via WebAudio (no asset needed) */
function startRing() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = new AC();
    ringGain = ctx.createGain(); ringGain.gain.value = 0.0001; ringGain.connect(ctx.destination);
    ringOsc = ctx.createOscillator(); ringOsc.type = "sine"; ringOsc.frequency.value = 480; ringOsc.connect(ringGain); ringOsc.start();
    ringOsc._ctx = ctx;
    let on = false;
    ringOsc._iv = setInterval(() => { on = !on; ringGain.gain.setTargetAtTime(on ? 0.06 : 0.0001, ctx.currentTime, 0.02); ringOsc.frequency.value = on ? 520 : 480; }, 500);
  } catch {}
}
function stopRing() {
  if (ringTimer) { clearTimeout(ringTimer); ringTimer = null; }
  if (ringOsc) { try { clearInterval(ringOsc._iv); ringOsc.stop(); ringOsc._ctx.close(); } catch {} ringOsc = null; }
}

const esc = (s) => (""+(s??"")).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

auth.onAuth(() => { if (auth.session()) start(); });
start();
