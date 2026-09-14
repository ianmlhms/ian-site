/**
 * tasting.js — requests for a private tasting at Hagen, or a weekday
 * appointment at the shop.
 *
 * Submits through rdr_request_tasting (SECURITY DEFINER) rather than inserting
 * directly: a request carries a name, an email and a phone number, so it must
 * never be readable by the public.
 */
(() => {
  const form = document.querySelector("[data-tasting-form]");
  if (!form) return;

  const errorSlot = document.querySelector("[data-tasting-error]");
  const confirmation = document.querySelector("[data-tasting-confirmation]");
  const successText = document.querySelector("[data-tasting-success]");
  const guestsField = document.querySelector("[data-guests-field]");
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const REQUIRED = ["firstName", "lastName", "email"];
  const MAX_GUESTS = 200;

  let isSubmitting = false;

  function text(key) {
    return window.I18N ? window.I18N.t(key) : key;
  }

  function setFieldError(control, message) {
    const slot = control.closest(".field")?.querySelector(".field-error");
    if (slot) slot.textContent = message || "";
    control.setAttribute("aria-invalid", message ? "true" : "false");
  }

  function chosenKind() {
    return form.querySelector('input[name="kind"]:checked')?.value || "tasting";
  }

  /** A weekday appointment at the shop is not a group booking. */
  function syncKindFields() {
    if (guestsField) guestsField.hidden = chosenKind() !== "tasting";
  }

  function todayIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function validate() {
    let firstInvalid = null;
    const fail = (control, message) => {
      setFieldError(control, message);
      if (!firstInvalid) firstInvalid = control;
    };

    REQUIRED.forEach((name) => {
      const control = form.elements[name];
      const value = String(control.value || "").trim();
      if (!value) fail(control, text("form.required"));
      else if (name === "email" && !EMAIL_PATTERN.test(value)) fail(control, text("form.emailInvalid"));
      else setFieldError(control, "");
    });

    const guests = form.elements.guests;
    const guestValue = String(guests.value || "").trim();
    if (chosenKind() === "tasting" && guestValue) {
      const count = Number.parseInt(guestValue, 10);
      if (!Number.isFinite(count) || count < 1 || count > MAX_GUESTS) {
        fail(guests, text("tasting.guestsInvalid"));
      } else setFieldError(guests, "");
    } else setFieldError(guests, "");

    // A date in the past is a typo, not a request.
    ["preferredOn", "alternativeOn"].forEach((name) => {
      const control = form.elements[name];
      const value = String(control.value || "").trim();
      if (value && value < todayIso()) fail(control, text("tasting.datePast"));
      else setFieldError(control, "");
    });

    return firstInvalid;
  }

  form.addEventListener("change", (event) => {
    if (event.target.name === "kind") syncKindFields();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isSubmitting) return;
    errorSlot.textContent = "";

    const firstInvalid = validate();
    if (firstInvalid) { firstInvalid.focus(); return; }

    if (!window.RdrSupabase?.isConfigured?.()) {
      errorSlot.textContent = text("tasting.notConfigured");
      return;
    }

    const data = new FormData(form);
    const payload = {
      kind: chosenKind(),
      first_name: String(data.get("firstName")).trim(),
      last_name: String(data.get("lastName")).trim(),
      email: String(data.get("email")).trim(),
      phone: String(data.get("phone") || "").trim(),
      guests: chosenKind() === "tasting" ? String(data.get("guests") || "").trim() : "",
      preferred_on: String(data.get("preferredOn") || "").trim(),
      alternative_on: String(data.get("alternativeOn") || "").trim(),
      message: String(data.get("message") || "").trim(),
      lang: window.I18N?.lang || "fr",
    };

    const submitButton = form.querySelector('button[type="submit"]');
    isSubmitting = true;
    if (submitButton) submitButton.disabled = true;

    try {
      const reference = await window.RdrSupabase.rpc("rdr_request_tasting", { payload });
      if (typeof reference !== "string" || !reference) throw new Error("No reference returned.");
      form.hidden = true;
      successText.textContent = `${text("tasting.successRef")} ${reference}. ${text("tasting.successBody")}`;
      confirmation.hidden = false;
      confirmation.focus();
    } catch (error) {
      console.error("The tasting request could not be sent.", error);
      errorSlot.textContent = `${text("tasting.sendFailed")} ${error.message}`;
    } finally {
      isSubmitting = false;
      if (submitButton) submitButton.disabled = false;
    }
  });

  syncKindFields();
})();
