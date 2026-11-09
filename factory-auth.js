/* Gates the full ShortsFactory dashboard behind Supabase admin login and loads
 * the data from the admin-only `dashboard_state` table (not the public file). */
import * as auth from "./auth.js?v=40";

const $ = (id) => document.getElementById(id);
let sb = null;

function showGate(msg, btnLabel, btnAction) {
  $("dash").style.display = "none";
  $("gate").style.display = "";
  $("gateMsg").textContent = msg;
  const b = $("signInBtn");
  b.textContent = btnLabel;
  b.onclick = btnAction;
}

async function showDash() {
  $("gate").style.display = "none";
  $("dash").style.display = "";
  const { data, error } = await sb.from("dashboard_state").select("data").eq("id", 1).maybeSingle();
  if (error) { $("dash").innerHTML = `<div class="wrap"><p class="muted">D'Donnéeë konnte net gelueden ginn (${error.message}).</p></div>`; return; }
  if (!data) { $("dash").innerHTML = `<div class="wrap"><p class="muted">Nach keng Dashboard-Donnéeën — looss de Publisher um Mac mini lafen, fir se ze fëllen.</p></div>`; return; }
  window.renderDashboard(data.data);
}

async function evaluate() {
  if (!auth.session()) {
    showGate("Mell dech mam Admin-Kont un, fir dëst Dashboard ze gesinn.", "Umellen", auth.openAuthModal);
    return;
  }
  let admin = false;
  try { const { data } = await sb.rpc("is_admin"); admin = !!data; } catch {}
  if (!admin) {
    showGate("Dëse Kont ass net autoriséiert. Mell dech mam Admin-Kont un.", "Ofmellen", async () => { await auth.signOut(); });
    return;
  }
  showDash();
}

async function boot() {
  if (!auth.authConfigured) { showGate("Konten sinn net agestallt.", "Umellen", () => {}); return; }
  sb = await auth.client();
  auth.onAuth(() => evaluate());
  evaluate();
}
boot();
