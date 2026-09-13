/**
 * rdr-config.js — the one place the backend is configured.
 *
 * Both values are safe in the browser: the anon key only grants what the
 * database's row-level security allows. The service-role key must NEVER
 * appear in this file or anywhere else the site serves.
 *
 * While these are empty the site still works: the catalogue is read from
 * data/catalogue.json, ordering reports that it is not switched on yet, and
 * the admin dashboard explains what is missing.
 */
window.RDR_CONFIG = Object.freeze({
  supabaseUrl: "https://ntgfxsqzgxajkegxllro.supabase.co",
  supabaseAnonKey: "sb_publishable_zhlY4xkDxWlawKFVMRaVnQ_LSWOdZw2",
});
