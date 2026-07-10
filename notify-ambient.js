/* Drop-in on any page (except messenger itself) to get live in-app + system
 * notifications for new messages while you're elsewhere on the site. */
import { initAmbient } from "./notify.js?v=3";
initAmbient();
