/* Home page: tells the visit-org function once per browser session that somebody came, so the owner sees which COMPANIES look
 * at the site (the function keeps the organisation's name only, never the address). Off with Do Not Track / Global Privacy
 * Control, in test browsers and on local copies. Loaded with defer; nothing waits for it. */
(function () {
  var KEY = 'visit_org_sent';
  if (location.hostname !== 'ian.lu' && location.hostname !== 'www.ian.lu') return;
  if (navigator.webdriver || navigator.doNotTrack === '1' || navigator.globalPrivacyControl) return;
  try {
    if (sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY, '1');
  } catch (error) { return; }                       // no storage: every page view would count, so count none
  var ref = '';
  try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch (error) { ref = ''; }
  if (ref === location.hostname) ref = '';
  fetch('https://lvksqmgfwkfbblfsozfk.supabase.co/functions/v1/visit-org', {
    method: 'POST', keepalive: true, credentials: 'omit', headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ page: location.pathname.slice(0, 60), ref: ref.slice(0, 80) }),
  }).catch(function () { /* statistics only */ });
})();
