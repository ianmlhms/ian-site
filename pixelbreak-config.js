// PixelBreak cloud config (Supabase).
// The publishable/anon key is a PUBLIC client key — safe to commit. Row Level Security
// (scripts/supabase-setup.sql) is what protects the data.
window.PB_CONFIG = {
  url: "https://lvksqmgfwkfbblfsozfk.supabase.co",
  anonKey: "sb_publishable_aqZ5h0dyxzgwqnpAv-oiuA_2O60dNH2",
  // Web Push VAPID *public* key — safe to expose (the private key lives only as a
  // Supabase Edge Function secret). Used by notify.js to subscribe a device.
  vapidPublicKey: "BHdzW-Ddjk2OnSmwvF0QdvbkcZW6FjRKQQhSzEQ-6V_UKvNmzf1Cxl1K6R4whS1JJzsFtjkmUt_gbz7RF8_jPxw",
  // FaceTime (call.html) fetches TURN credentials from the `turn` Edge Function,
  // which mints them from the Metered secret (kept server-side). No keys here.
};
