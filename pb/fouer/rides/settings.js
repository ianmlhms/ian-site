/* The reduce-motion option of the rides (settings menu): lower shake and head-bob, a calmer camera, slower spin. Defaults to the system's prefers-reduced-motion. */
const MOTION_KEY = "pb_fouer_reduce_motion";

export function readReduceMotion() {
  try { const v = localStorage.getItem(MOTION_KEY); if (v === "1") return true; if (v === "0") return false; } catch (error) { /* storage blocked */ }
  try { return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (error) { return false; }
}
export function writeReduceMotion(on) { try { localStorage.setItem(MOTION_KEY, on ? "1" : "0"); } catch (error) { /* storage blocked */ } }
