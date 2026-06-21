// PixelBreak cloud config.
// Fill these in after creating your free Supabase project:
//   Supabase Dashboard ▸ Project Settings ▸ API ▸  "Project URL"  +  "anon public" key.
// The anon key is SAFE to commit — it's a public client key, and Row Level Security
// (see scripts/supabase-setup.sql) is what actually protects the data.
//
// Until both are filled, accounts/leaderboards stay off and PixelBreak still saves
// your best scores locally on the device.
window.PB_CONFIG = {
  url: "YOUR_SUPABASE_URL",
  anonKey: "YOUR_SUPABASE_ANON_KEY",
};
