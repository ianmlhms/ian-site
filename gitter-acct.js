/* gitter-acct.js — header account button of the Gitter look: "Umellen" for visitors, the username once signed in.
 * Usage: <button class="gt-acct" id="gtAcct">Umellen</button> + <script type="module" src="gitter-acct.js?v=1"></script>. */
import * as auth from "./auth.js?v=40";

const button = document.getElementById("gtAcct");

function sync() {
  button.textContent = auth.session() ? auth.username() || "Kont" : "Umellen";
}

if (button) {
  button.addEventListener("click", () => auth.openAuthModal());
  sync();
  auth.onAuth(sync);
  auth.client().then(sync).catch(sync);
}
