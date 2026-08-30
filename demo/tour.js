import { TOUR, UI } from "/demo/copy.js?v=1";

const MODULE_PATHS = Object.freeze(Object.fromEntries(
  TOUR.steps.map(({ id }) => [id, `/demo/${id}.js?v=1`]),
));
const FIRST_STEP = 0;
const LAST_STEP = TOUR.steps.length - 1;

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function button(text, className = "dbtn") {
  const element = makeElement("button", className, text);
  element.type = "button";
  return element;
}

function hashStep() {
  const match = /^#(\d+)$/.exec(location.hash);
  if (!match) return null;
  const step = Number(match[1]);
  return Number.isInteger(step) && step >= 1 && step <= TOUR.steps.length
    ? step - 1
    : null;
}

export function mountTour(root) {
  if (!root) throw new TypeError("Invalid tour root");
  const stage = root.querySelector(":scope > .tstage");
  if (!stage) throw new TypeError("Tour stage is missing");

  let activeInstance = null;
  let currentStep = null;
  let transition = 0;

  function destroyActive() {
    if (!activeInstance) return;
    const outgoing = activeInstance;
    activeInstance = null;
    try {
      outgoing.destroy();
    } catch (error) {
      console.error("[demo] showcase cleanup failed", error);
    }
  }

  function removeBar() {
    root.querySelector(":scope > .tbar")?.remove();
  }

  function replaceHash(step) {
    history.replaceState(null, "", `${location.pathname}${location.search}#${step + 1}`);
  }

  function goToStep(step) {
    const safeStep = Math.min(LAST_STEP, Math.max(FIRST_STEP, step));
    const nextHash = `#${safeStep + 1}`;
    if (location.hash === nextHash) {
      void renderStep(safeStep);
    } else {
      location.hash = nextHash;
    }
  }

  function renderIntro() {
    transition += 1;
    destroyActive();
    currentStep = null;
    removeBar();

    const intro = makeElement("section", "dhero");
    const start = button(TOUR.intro.start, "dbtn dbtn-primary");
    start.addEventListener("click", () => goToStep(FIRST_STEP));
    intro.append(
      makeElement("span", "dkicker", TOUR.intro.kicker),
      makeElement("h1", "dtitle", TOUR.intro.title),
      makeElement("p", "dsub", TOUR.intro.sub),
      start,
    );
    stage.replaceChildren(intro);
  }

  function renderOutro() {
    transition += 1;
    destroyActive();
    currentStep = null;
    removeBar();

    const outro = makeElement("section", "dhero");
    const cta = makeElement("a", "dbtn dbtn-primary", TOUR.outro.cta);
    cta.href = "/";
    const again = button(TOUR.outro.again);
    again.addEventListener("click", () => goToStep(FIRST_STEP));
    outro.append(
      makeElement("h1", "dtitle", TOUR.outro.title),
      makeElement("p", "dsub", TOUR.outro.sub),
      cta,
      again,
    );
    stage.replaceChildren(outro);
  }

  function renderBar(step) {
    removeBar();
    const bar = makeElement("nav", "tbar");
    const prev = button(TOUR.nav.prev);
    prev.disabled = step === FIRST_STEP;
    prev.addEventListener("click", () => goToStep(step - 1));

    const dots = makeElement("div", "tdots");
    TOUR.steps.forEach((item, index) => {
      const dot = button(undefined, `tdot${index === step ? " on" : ""}`);
      dot.setAttribute("aria-label", `${TOUR.nav.step} ${index + 1}`);
      dot.addEventListener("click", () => goToStep(index));
      dots.append(dot);
    });

    const next = button(TOUR.nav.next, "dbtn dbtn-primary");
    next.addEventListener("click", () => {
      if (step === LAST_STEP) renderOutro();
      else goToStep(step + 1);
    });
    bar.append(prev, dots, next);
    root.append(bar);
  }

  async function renderStep(step) {
    const token = ++transition;
    destroyActive();
    currentStep = step;

    const copy = TOUR.steps[step];
    const wrapper = makeElement("div", "tstep");
    const head = makeElement("div", "tstep-head");
    head.append(
      makeElement("div", "tstep-n", `${TOUR.nav.step} ${step + 1}/${TOUR.steps.length}`),
      makeElement("h2", "tstep-t", copy.t),
      makeElement("p", "tstep-n2", copy.n),
    );
    const body = makeElement("div", "dbody");
    body.append(makeElement("p", "dmuted", UI.loading));
    wrapper.append(head, body);
    stage.replaceChildren(wrapper);
    renderBar(step);

    try {
      const module = await import(MODULE_PATHS[copy.id]);
      if (token !== transition) return;
      body.replaceChildren();
      const instance = module.mount(body, { audience: "friends" });
      if (!instance || typeof instance.destroy !== "function") {
        throw new TypeError(`${copy.id} did not return a destroy handle`);
      }
      if (token !== transition) {
        instance.destroy();
        return;
      }
      activeInstance = instance;
    } catch (error) {
      if (token !== transition) return;
      body.replaceChildren(makeElement("p", "dfail", UI.failed));
      console.error(`[demo] ${copy.id} failed to load`, error);
    }
  }

  function onHashChange() {
    const step = hashStep();
    if (step === null) {
      replaceHash(FIRST_STEP);
      void renderStep(FIRST_STEP);
      return;
    }
    void renderStep(step);
  }

  function onKeyDown(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (currentStep === null) {
      if (event.key === "ArrowRight") goToStep(FIRST_STEP);
      else if (stage.querySelector(".dtitle")?.textContent === TOUR.outro.title) goToStep(LAST_STEP);
      return;
    }
    if (event.key === "ArrowLeft" && currentStep > FIRST_STEP) goToStep(currentStep - 1);
    if (event.key === "ArrowRight") {
      if (currentStep === LAST_STEP) renderOutro();
      else goToStep(currentStep + 1);
    }
  }

  function onPageHide() {
    transition += 1;
    destroyActive();
    window.removeEventListener("hashchange", onHashChange);
    window.removeEventListener("keydown", onKeyDown);
  }

  window.addEventListener("hashchange", onHashChange);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("pagehide", onPageHide, { once: true });

  if (!location.hash) renderIntro();
  else onHashChange();

  return { destroy: onPageHide };
}
