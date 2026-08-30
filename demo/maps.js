import { GEOPORTAL_SRC } from "./content.js?v=1";
import { COPY, UI } from "./copy.js?v=1";

export const meta = { badge: null };

export function mount(host, opts = {}) {
  let destroyed = false;
  const timers = [];
  const audience = opts.audience === "adults" ? "adults" : "friends";
  const frame = document.createElement("iframe");
  const openLink = document.createElement("a");

  frame.className = "dframe tall";
  frame.title = COPY[audience].cards.maps.t;
  frame.loading = "lazy";
  openLink.className = "dbtn";
  openLink.href = GEOPORTAL_SRC;
  openLink.textContent = UI.openApp;
  host.append(frame, openLink);

  const observer = new IntersectionObserver((entries) => {
    if (destroyed) return;
    if (!entries.some((entry) => entry.isIntersecting)) return;
    frame.src = GEOPORTAL_SRC;
    observer.disconnect();
  });
  observer.observe(frame);

  return {
    destroy() {
      destroyed = true;
      timers.splice(0).forEach((timerId) => {
        window.clearTimeout(timerId);
        window.clearInterval(timerId);
      });
      observer.disconnect();
      frame.src = "about:blank";
    },
  };
}
