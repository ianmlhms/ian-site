/* Gates the full ShortsFactory dashboard behind Supabase admin login and loads
 * the data from the admin-only `dashboard_state` table (not the public file). */
import * as auth from "./auth.js";

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
  if (error) { $("dash").innerHTML = `<div class="wrap"><p class="muted">Couldn't load data (${error.message}).</p></div>`; return; }
  if (!data) { $("dash").innerHTML = `<div class="wrap"><p class="muted">No dashboard data yet — run the publisher on the Mac mini to populate it.</p></div>`; return; }
  window.renderDashboard(data.data);
}

async function evaluate() {
  if (!auth.session()) {
    showGate("Sign in with your admin account to view this dashboard.", "Sign in", auth.openAuthModal);
    return;
  }
  let admin = false;
  try { const { data } = await sb.rpc("is_admin"); admin = !!data; } catch {}
  if (!admin) {
    showGate("This account isn’t authorized. Sign in as the admin account.", "Sign out", async () => { await auth.signOut(); });
    return;
  }
  showDash();
}

async function boot() {
  if (!auth.authConfigured) { showGate("Accounts aren’t configured.", "Sign in", () => {}); return; }
  sb = await auth.client();
  auth.onAuth(() => evaluate());
  evaluate();
}
boot();
