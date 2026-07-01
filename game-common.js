/* game-common.js — shared plumbing for the two-player realtime games.
 * Load AFTER pixelbreak-config.js and the supabase-js UMD bundle:
 *   <script src="pixelbreak-config.js"></script>
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="game-common.js?v=1"></script>
 *
 * Provides (window.GameCommon):
 *   room / AI / role / other / clientId — parsed + sanitised URL context
 *   esc(s)                              — HTML escape
 *   createChannel(prefix[, key])        — realtime-only channel for this room
 *   joinRoom(ch, hooks)                 — presence + refresh-safe state resync
 *   recordResult(game, result)          — leaderboard via the shared auth client
 *   difficultyFromUrl()                 — easy | normal | hard from ?diff=
 *   mountDifficulty(get, set)           — difficulty picker in the top bar
 */
window.GameCommon = (() => {
  const params = new URLSearchParams(location.search);

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // Room codes land in innerHTML and channel names — restrict them to a safe
  // charset instead of trusting the URL.
  const room = ((params.get("room") || "demo").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "demo").slice(0, 40);
  const AI = params.get("ai") === "1";
  const role = params.get("role") === "guest" ? "guest" : "host";
  const other = role === "host" ? "guest" : "host";
  const clientId = Math.random().toString(36).slice(2, 10);

  function createChannel(prefix, presenceKey = role) {
    const cfg = window.PB_CONFIG;
    // Realtime-only client: never persist/refresh auth, or it races the shared
    // signed-in client on the same localStorage (see HANDOFF §4).
    const sb = window.supabase.createClient(cfg.url.replace(/\/$/, ""), cfg.anonKey,
      { auth: { persistSession: false, autoRefreshToken: false } });
    return sb.channel(prefix + ":" + room, { config: { broadcast: { self: false }, presence: { key: presenceKey } } });
  }

  function recordResult(game, result) {
    try { const a = window.__pbAuth; if (a && a.session && a.sb) a.sb.rpc("record_match", { p_game: game, p_result: result }); } catch {}
  }

  /* Presence + state sync that survives refreshes:
   *  - every client asks for the current state when it (re)joins ("gc-req");
   *  - a peer whose game has already progressed answers with the full state —
   *    nobody pushes a fresh board over a live one (that used to wipe the
   *    match for both players whenever the host refreshed);
   *  - two tabs claiming the same seat: the newer one backs off (onSeatTaken).
   *
   * hooks: getState() → payload            state to send to a rejoining peer
   *        setState(payload)               apply a peer's state
   *        isStarted() → bool              has this client's game progressed?
   *        onPeers(oppHere, presenceState) presence changed
   *        onSeatTaken()                   my role is already taken in this room
   */
  function joinRoom(ch, { getState, setState, isStarted, onPeers, onSeatTaken }) {
    let seated = true;
    const seatTime = Date.now();
    ch.on("broadcast", { event: "gc-req" }, () => {
        if (seated && isStarted()) ch.send({ type: "broadcast", event: "gc-state", payload: getState() });
      })
      .on("broadcast", { event: "gc-state" }, ({ payload }) => { if (seated) setState(payload); })
      .on("presence", { event: "sync" }, () => {
        const st = ch.presenceState();
        const mine = st[role] || [];
        const olderClaim = (m) => m.id !== clientId && (m.t < seatTime || (m.t === seatTime && m.id < clientId));
        if (seated && mine.length > 1 && mine.some(olderClaim)) {
          seated = false;
          try { ch.untrack(); } catch {}
          if (onSeatTaken) onSeatTaken();
          return;
        }
        if (seated && onPeers) onPeers(!!(st[other] && st[other].length), st);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await ch.track({ role, id: clientId, t: seatTime });
          ch.send({ type: "broadcast", event: "gc-req", payload: {} });
        }
      });
  }

  function difficultyFromUrl() {
    const d = (params.get("diff") || "normal").toLowerCase();
    return ["easy", "normal", "hard"].includes(d) ? d : "normal";
  }

  function mountDifficulty(get, set) {
    const bar = document.querySelector(".bar");
    if (!bar || document.getElementById("diffPick")) return;
    const wrap = document.createElement("div");
    wrap.id = "diffPick";
    wrap.style.cssText = "display:flex;gap:4px;margin-left:auto";
    const paint = () => wrap.querySelectorAll("button").forEach((b) => {
      const on = b.dataset.d === get();
      b.style.background = on ? "var(--accent)" : "var(--card2)";
      b.style.color = on ? "#fff" : "var(--muted)";
    });
    [["easy", "Easy"], ["normal", "Normal"], ["hard", "Hard"]].forEach(([d, label]) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.dataset.d = d;
      b.style.cssText = "background:var(--card2);border:1px solid var(--border);color:var(--muted);border-radius:8px;padding:5px 9px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit";
      b.onclick = () => { set(d); paint(); };
      wrap.appendChild(b);
    });
    bar.appendChild(wrap);
    paint();
  }

  return { params, esc, room, AI, role, other, clientId, createChannel, joinRoom, recordResult, difficultyFromUrl, mountDifficulty };
})();
