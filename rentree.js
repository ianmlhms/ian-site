(function () {
  "use strict";

  const STORAGE_KEY = "rentree2026";
  const FORCE_QUERY_VALUE = "1";
  const FIRST_SLIDE_INDEX = 0;
  const SWIPE_THRESHOLD_PX = 48;
  const CLICK_SUPPRESSION_MS = 300;
  const FOCUSABLE_SELECTOR = "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

  const SLIDES = Object.freeze([
    Object.freeze({
      emoji: "🎢",
      headline: "Bau däin eegene Fräizäitpark",
      text: "Am neien Theme Park Tycoon baus du Achterbunnen, Weeër a Stänn. D’Gäscht kommen a bezuelen – an du kanns d’Parke vun anere Spiller besichen.",
      href: "/pixelbreak.html?g=park",
      image: "/assets/rentree/slide-park.webp",
      imageAlt: "Theme Park Tycoon mat Attraktiounen, Weeër a Gäscht",
    }),
    Object.freeze({
      emoji: "🍔",
      headline: "Burger Rush an neiem Gewand",
      text: "De ganze Restaurant gouf nei gezeechent. Elo gesäis du e richtege Restaurant an der Perspektiv amplaz vu flaache Panneauen.",
      href: "/pixelbreak.html?g=burger",
      image: "/assets/rentree/slide-burger.webp",
      imageAlt: "Den neie Burger Rush Restaurant an der Perspektiv",
    }),
    Object.freeze({
      emoji: "🕹️",
      headline: "Nei Arkadespiller an 3D",
      text: "Et sinn nei Spiller dobäi. Road Rage an Tower Defense goufen ausserdeem an 3D nei opgebaut.",
      href: "/pixelbreak.html",
      image: "/assets/rentree/slide-arcade.webp",
      imageAlt: "Déi nei Spiller an der PixelBreak-Arkad",
    }),
    Object.freeze({
      emoji: "🥾",
      headline: "191 Touren op enger Kaart",
      text: "Entdeck 154 Auto-Pédestre-Wanderweeër a 37 Mountainbike-Touren – all zesummen op enger Kaart.",
      href: "/kaart/",
      image: "/assets/rentree/slide-trails.webp",
      imageAlt: "Kaart mat Auto-Pédestre-Wanderweeër a Mountainbike-Touren",
    }),
    Object.freeze({
      emoji: "🇱🇺",
      headline: "ian.lu schwätzt nees Lëtzebuergesch",
      text: "De ganze Site ass nees op Lëtzebuergesch – elo och d’Wanderweeër.",
      href: "/",
      image: "/assets/rentree/slide-lb.webp",
      imageAlt: "ian.lu op Lëtzebuergesch",
    }),
    Object.freeze({
      emoji: "🌍",
      headline: "Dem Quinn säi Länner-Verglach",
      text: "Vergläich Länner mateneen: Awunner, Fläch, Wirtschaft a méi – eng nei App vum Quinn.",
      href: "/countries.html",
      image: "/assets/rentree/slide-quinn.webp",
      imageAlt: "De Länner-Verglach mat véier Länner niewenteneen",
    }),
  ]);

  function hasSeenStory() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch (error) {
      console.warn("Rentrée flag could not be read", error);
      return true;
    }
  }

  function markStoryAsSeen() {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch (error) {
      console.warn("Rentrée flag could not be saved", error);
    }
  }

  function shouldForceStory() {
    try {
      return new URLSearchParams(location.search).get("rentree") === FORCE_QUERY_VALUE;
    } catch (error) {
      console.warn("Rentrée query could not be read", error);
      return false;
    }
  }

  function shouldShowStory(isForced) {
    if (isForced) return true;
    if (location.hash) return false;
    if (window.__ianReturning !== true) return false;
    return !hasSeenStory();
  }

  function createStoryMarkup() {
    const progress = SLIDES.map((_, index) =>
      `<span class="rentree-progress-segment" data-progress="${index}"><span></span></span>`
    ).join("");
    const slides = SLIDES.map((slide, index) => `
      <article class="rentree-slide" data-slide="${index}" ${index === FIRST_SLIDE_INDEX ? "" : "hidden"}>
        <div class="rentree-media">
          <div class="rentree-fallback" aria-hidden="true"><span>${slide.emoji}</span></div>
          <img data-src="${slide.image}" alt="${slide.imageAlt}">
          <button class="rentree-tap rentree-tap-back" type="button" tabindex="-1" aria-label="Zeréck op déi viregt Säit"></button>
          <button class="rentree-tap rentree-tap-next" type="button" tabindex="-1" aria-label="Weider op déi nächst Säit"></button>
        </div>
        <div class="rentree-copy">
          <span class="rentree-emoji" aria-hidden="true">${slide.emoji}</span>
          <div>
            <h2 id="rentree-slide-title-${index}">${slide.headline}</h2>
            <p>${slide.text}</p>
          </div>
        </div>
        <div class="rentree-actions">
          <button class="rentree-button rentree-button-look" type="button" data-href="${slide.href}" aria-label="${slide.headline}: Kuck der et un">Kuck der et un</button>
          <div class="rentree-step-buttons">
            <button class="rentree-button rentree-button-back" type="button" aria-label="Zeréck op déi viregt Säit">← <span>Zeréck</span></button>
            <button class="rentree-button rentree-button-next" type="button" aria-label="${index === SLIDES.length - 1 ? "Zoumaachen" : "Weider op déi nächst Säit"}">${index === SLIDES.length - 1 ? "Zoumaachen" : "Weider →"}</button>
          </div>
        </div>
      </article>`).join("");

    return `
      <div class="rentree-dialog" role="dialog" aria-modal="true" aria-labelledby="rentree-title" tabindex="-1">
        <div class="rentree-progress" role="progressbar" aria-label="Fortschrëtt" aria-valuemin="1" aria-valuemax="${SLIDES.length}" aria-valuenow="1">${progress}</div>
        <header class="rentree-header">
          <p id="rentree-title">Wat an der Summervakanz geschitt ass</p>
          <button class="rentree-close" type="button" aria-label="Zoumaachen">×</button>
        </header>
        <div class="rentree-stage">${slides}</div>
      </div>`;
  }

  function getFocusableElements(dialog) {
    return Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR)).filter((element) =>
      !element.closest("[hidden]") && element.getAttribute("aria-hidden") !== "true"
    );
  }

  function openStory(isForced) {
    const overlay = document.createElement("div");
    overlay.className = "rentree-overlay";
    overlay.innerHTML = createStoryMarkup();
    document.body.appendChild(overlay);

    const dialog = overlay.querySelector(".rentree-dialog");
    const slideElements = Array.from(overlay.querySelectorAll(".rentree-slide"));
    const progressElements = Array.from(overlay.querySelectorAll("[data-progress]"));
    const progressBar = overlay.querySelector(".rentree-progress");
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const previouslyFocused = document.activeElement;
    const scrollPosition = Object.freeze({ x: window.scrollX, y: window.scrollY });
    const previousBodyStyle = Object.freeze({
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
    });
    let currentIndex = FIRST_SLIDE_INDEX;
    let pointerStartX = null;
    let shouldSuppressClick = false;

    if (prefersReducedMotion) overlay.classList.add("rentree-reduced-motion");
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollPosition.y}px`;
    document.body.style.left = `-${scrollPosition.x}px`;
    document.body.style.right = "0";
    document.body.style.width = "100%";

    overlay.querySelectorAll("img[data-src]").forEach((image) => {
      image.addEventListener("error", () => {
        image.hidden = true;
        image.closest(".rentree-media").classList.add("is-missing");
      }, { once: true });
      image.src = image.dataset.src;
    });

    function renderSlide(nextIndex, direction) {
      const boundedIndex = Math.max(FIRST_SLIDE_INDEX, Math.min(SLIDES.length - 1, nextIndex));
      if (boundedIndex === currentIndex && nextIndex !== FIRST_SLIDE_INDEX) return;

      currentIndex = boundedIndex;
      slideElements.forEach((element, index) => {
        const isCurrent = index === currentIndex;
        element.hidden = !isCurrent;
        element.classList.remove("rentree-enter-forward", "rentree-enter-back");
        if (isCurrent && direction) {
          element.classList.add(direction === "back" ? "rentree-enter-back" : "rentree-enter-forward");
        }
      });
      progressElements.forEach((element, index) => {
        element.classList.toggle("is-complete", index < currentIndex);
        element.classList.toggle("is-current", index === currentIndex);
      });
      progressBar.setAttribute("aria-valuenow", String(currentIndex + 1));
      progressBar.setAttribute("aria-valuetext", `Säit ${currentIndex + 1} vu ${SLIDES.length}`);

      const currentSlide = slideElements[currentIndex];
      currentSlide.querySelector(".rentree-button-back").disabled = currentIndex === FIRST_SLIDE_INDEX;
      currentSlide.querySelector(".rentree-tap-back").disabled = currentIndex === FIRST_SLIDE_INDEX;
      dialog.setAttribute("aria-labelledby", `rentree-title rentree-slide-title-${currentIndex}`);
      if (document.activeElement?.closest?.(".rentree-slide") !== currentSlide) dialog.focus();
    }

    function goBack() {
      if (currentIndex === FIRST_SLIDE_INDEX) return;
      renderSlide(currentIndex - 1, "back");
    }

    function closeStory() {
      document.removeEventListener("keydown", handleKeydown, true);
      overlay.remove();
      Object.entries(previousBodyStyle).forEach(([property, value]) => {
        document.body.style[property] = value;
      });
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
      window.scrollTo(scrollPosition.x, scrollPosition.y);
    }

    function goForward() {
      if (currentIndex === SLIDES.length - 1) {
        closeStory();
        return;
      }
      renderSlide(currentIndex + 1, "forward");
    }

    function handleKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeStory();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goBack();
        return;
      }
      if (event.key === "ArrowRight" || (event.key === " " && event.target === dialog)) {
        event.preventDefault();
        goForward();
        return;
      }
      if (event.key !== "Tab") return;

      const focusableElements = getFocusableElements(dialog);
      if (!focusableElements.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (document.activeElement === dialog || !dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? lastElement : firstElement).focus();
      } else if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    overlay.addEventListener("click", (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      if (shouldSuppressClick) {
        shouldSuppressClick = false;
        event.preventDefault();
        return;
      }
      if (target.classList.contains("rentree-close")) closeStory();
      else if (target.classList.contains("rentree-button-look")) location.href = target.dataset.href;
      else if (target.classList.contains("rentree-button-back")) goBack();
      else if (target.classList.contains("rentree-button-next")) goForward();
      else if (target.classList.contains("rentree-tap-back")) goBack();
      else if (target.classList.contains("rentree-tap-next")) goForward();
    });

    overlay.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary) return;
      pointerStartX = event.clientX;
    });
    overlay.addEventListener("pointerup", (event) => {
      if (!event.isPrimary || pointerStartX === null) return;
      const distance = event.clientX - pointerStartX;
      pointerStartX = null;
      if (Math.abs(distance) < SWIPE_THRESHOLD_PX) return;
      shouldSuppressClick = true;
      window.setTimeout(() => { shouldSuppressClick = false; }, CLICK_SUPPRESSION_MS);
      if (distance < 0) goForward();
      else goBack();
    });
    overlay.addEventListener("pointercancel", () => { pointerStartX = null; });
    document.addEventListener("keydown", handleKeydown, true);

    renderSlide(FIRST_SLIDE_INDEX);
    dialog.focus();
    if (!isForced) markStoryAsSeen();
  }

  function initializeStory() {
    const isForced = shouldForceStory();
    if (!shouldShowStory(isForced)) return;
    openStory(isForced);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeStory, { once: true });
  } else {
    initializeStory();
  }
}());
