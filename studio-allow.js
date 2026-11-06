/* The accounts that may use the PPT and Word studios (ppt.html, doc.html) and
 * see their entries on the homepage. One list, imported by ppt-app.js,
 * doc-app.js and home.js. ian@ian.lu is the test account and stays out on
 * purpose (no admin rights since 24 Sep 2026). */
export const STUDIO_ALLOW = Object.freeze(["konto@ian.lu", "matthieugerouville@gmail.com"]);

export const isStudioEmail = (email) => STUDIO_ALLOW.includes(String(email || "").toLowerCase());
