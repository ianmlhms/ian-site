import { createPinPad, esc, translate, weakPin } from "./pin-pad.js?v=2";
const USERNAME_SHAPE = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let modal = null;
let modalLocked = false;
function t(key, fallback) {
  return translate(key, fallback);
}
function ensureModal() {
  if (modal) return modal;
  modal = document.createElement("div");
  modal.className = "auth-modal";
  modal.innerHTML = '<div class="auth-box"></div>';
  modal.addEventListener("click", (event) => {
    if (event.target === modal && !modalLocked) closeModal();
  });
  document.body.appendChild(modal);
  return modal;
}
function box() {
  return ensureModal().querySelector(".auth-box");
}
function openModal(locked = false) {
  modalLocked = locked;
  ensureModal().classList.add("open");
}
function closeModal() {
  if (!modal) return;
  modalLocked = false;
  modal.classList.remove("open");
}
function closeButton() {
  if (modalLocked) return "";
  return '<button class="auth-x" aria-label="Close">' +
    "&times;</button>";
}
function wireClose() {
  box().querySelector(".auth-x")?.addEventListener(
    "click",
    closeModal,
  );
}
function setMessage(text, kind = "") {
  const element = box().querySelector("#authMsg");
  if (!element) return;
  element.className = `auth-msg${kind ? ` ${kind}` : ""}`;
  element.textContent = text;
}
function value(id) {
  return (box().querySelector(`#${id}`)?.value || "").trim();
}
function lengthTabs(length) {
  return `<div class="pin-row">
    <button class="auth-tab ${length === 4 ? "active" : ""}"
      type="button" data-pin-length="4">4</button>
    <button class="auth-tab ${length === 6 ? "active" : ""}"
      type="button" data-pin-length="6">6</button>
  </div>`;
}
function wireLengthTabs(current, onChange) {
  box().querySelectorAll("[data-pin-length]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = Number(button.dataset.pinLength);
      if (next !== current) onChange(next);
    });
  });
}
function pinWarning(length) {
  if (length !== 4) return "";
  return `<p class="pin-note">${esc(t(
    "pin.fourWarning",
    "E 4-stellege PIN ass méi einfach ze roden. " +
      "6 Stelle si recommandéiert.",
  ))}</p>`;
}
function authHeader(mode) {
  return `${closeButton()}<h3>${esc(t(
    "pin.account",
    "Kont",
  ))}</h3><div class="auth-tabs">
    <button class="auth-tab ${mode === "in" ? "active" : ""}"
      data-auth-mode="in">${esc(t("pin.signIn", "Umellen"))}</button>
    <button class="auth-tab ${mode === "up" ? "active" : ""}"
      data-auth-mode="up">${esc(t(
        "pin.signUp",
        "Kont erstellen",
      ))}</button></div>`;
}
function wireModeTabs(deps, mode) {
  box().querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const next = button.dataset.authMode;
      if (next === mode) return;
      if (next === "up") drawSignUp(deps, 6);
      else drawSignIn(deps, 6, "pin");
    });
  });
}
function identifierField() {
  return `<label for="authIdentifier">${esc(t(
    "pin.identifier",
    "Benotzernumm oder E-Mail",
  ))}</label>
  <input id="authIdentifier" autocomplete="username"
    maxlength="254">`;
}
function loginLinks(method) {
  const switchText = method === "pin"
    ? t("pin.usePassword", "Mat Passwuert umellen")
    : t("pin.usePin", "Mat PIN umellen");
  return `<div class="pin-row">
    <button class="auth-tab" id="authMethod" type="button">
      ${esc(switchText)}
    </button>
    <button class="auth-tab" id="authForgot" type="button">
      ${esc(t("pin.forgot", "PIN vergiess?"))}
    </button>
  </div>`;
}
function attachPinPad(length, onComplete) {
  const pad = createPinPad({
    length,
    label: t("pin.digit", "PIN Ziffer"),
    onComplete,
  });
  box().querySelector("#authPinHost")?.appendChild(pad.element);
  return pad;
}
function loginMarkup(mode, length, method) {
  const credential = method === "pin"
    ? `${lengthTabs(length)}<div id="authPinHost"></div>`
    : `<label for="authPassword">${esc(t(
      "pin.password",
      "Passwuert",
    ))}</label><input id="authPassword" type="password"
      autocomplete="current-password">`;
  return `${authHeader(mode)}${identifierField()}${credential}
    <button class="auth-go" id="authSubmit">${esc(t(
      "pin.signIn",
      "Umellen",
    ))}</button>${loginLinks(method)}
    <div class="auth-msg" id="authMsg"></div>`;
}

function loginError(error) {
  console.warn("PIN login failed", error);
  return t(
    "pin.loginError",
    "D'Umeldung ass net gaangen. Kontrolléier deng Donnéeën.",
  );
}

function drawSignIn(deps, length, method) {
  box().innerHTML = loginMarkup("in", length, method);
  wireClose();
  wireModeTabs(deps, "in");
  let pad = null;
  const submit = async () => {
    const identifier = value("authIdentifier");
    const credential = method === "pin"
      ? pad?.value() || ""
      : value("authPassword");
    if (!identifier || !credential) {
      setMessage(t("pin.complete", "Fëll w.e.g. alles aus."), "err");
      return;
    }
    setMessage("…");
    try {
      if (method === "pin") await deps.loginPin(identifier, credential);
      else await deps.loginPassword(identifier, credential);
      closeModal();
    } catch (error) {
      setMessage(loginError(error), "err");
      pad?.clear();
    }
  };
  if (method === "pin") pad = attachPinPad(length, submit);
  box().querySelector("#authSubmit").addEventListener("click", submit);
  wireLengthTabs(length, (next) => drawSignIn(deps, next, method));
  box().querySelector("#authMethod").addEventListener("click", () => {
    drawSignIn(deps, length, method === "pin" ? "password" : "pin");
  });
  box().querySelector("#authForgot").addEventListener(
    "click",
    () => drawForgot(deps),
  );
}

function signupMarkup(length) {
  return `${authHeader("up")}
    <label for="authUser">${esc(t("pin.username", "Benotzernumm"))}</label>
    <input id="authUser" maxlength="20" autocomplete="username">
    <label for="authEmail">${esc(t("pin.email", "E-Mail"))}</label>
    <input id="authEmail" type="email" autocomplete="email">
    <p class="pin-note">${esc(t(
      "pin.chooseLength",
      "Wiel 4 oder 6 Zifferen.",
    ))}</p>${lengthTabs(length)}${pinWarning(length)}
    <label>${esc(t("pin.enter", "PIN aginn"))}</label>
    <div id="authPinHost"></div>
    <label>${esc(t("pin.repeat", "PIN widderhuelen"))}</label>
    <div id="authPinAgain"></div>
    <p class="pin-note">${esc(t("pin.recoveryAdvice", "Wann s de däi PIN vergëss, schreif dem Ian. En E-Mail-Reset kanns de och probéieren, mee en ass net garantéiert."))}</p>
    <button class="auth-go" id="authSubmit">${esc(t(
      "pin.signUp",
      "Kont erstellen",
    ))}</button><div class="auth-msg" id="authMsg"></div>`;
}

async function submitSignUp(deps, first, second, length) {
  const username = value("authUser");
  const email = value("authEmail");
  const pin = first.value();
  if (!USERNAME_SHAPE.test(username) || !EMAIL_SHAPE.test(email)) {
    setMessage(t("pin.signupFields", "Kontrolléier Numm an E-Mail."), "err");
    return;
  }
  if (pin.length !== length || pin !== second.value()) {
    setMessage(t("pin.noMatch", "D'PINe sinn net d'selwecht."), "err");
    return;
  }
  if (weakPin(pin)) {
    setMessage(t("pin.weak", "Wiel e manner bekannte PIN."), "err");
    return;
  }
  setMessage("…");
  try {
    const data = await deps.signUpRandom(email, username);
    if (data.session) {
      await deps.setPin(pin, length);
      closeModal();
      return;
    }
    setMessage(t(
      "pin.confirmEmail",
      "De Kont ass erstallt, mee de PIN konnt net direkt " +
        "gesat ginn. Schreif dem Ian.",
    ), "ok");
  } catch (error) {
    console.warn("PIN signup failed", error);
    setMessage(t("pin.signupError", "De Kont konnt net erstallt ginn."), "err");
  }
}

function drawSignUp(deps, length) {
  box().innerHTML = signupMarkup(length);
  wireClose();
  wireModeTabs(deps, "up");
  const first = attachPinPad(length, () => second.focus());
  const second = createPinPad({
    length,
    label: t("pin.repeatDigit", "PIN nach eng Kéier, Ziffer"),
  });
  box().querySelector("#authPinAgain").appendChild(second.element);
  wireLengthTabs(length, (next) => drawSignUp(deps, next));
  box().querySelector("#authSubmit").addEventListener(
    "click",
    () => submitSignUp(deps, first, second, length),
  );
}

function drawForgot(deps) {
  box().innerHTML = `${closeButton()}<h3>${esc(t(
    "pin.forgotTitle",
    "Neie PIN setzen",
  ))}</h3><p class="pin-note">${esc(t(
    "pin.forgotText",
    "Déi sécher Method ass: Schreif dem Ian. En E-Mail-Link " +
      "kanns du hei och probéieren, mee en ass net garantéiert.",
  ))}</p><label for="authEmail">${esc(t(
    "pin.email",
    "E-Mail",
  ))}</label><input id="authEmail" type="email" autocomplete="email">
    <button class="auth-go" id="authSubmit">${esc(t(
      "pin.sendLink",
      "E-Mail-Link probéieren",
    ))}</button><div class="auth-msg" id="authMsg"></div>`;
  wireClose();
  box().querySelector("#authSubmit").addEventListener("click", async () => {
    const email = value("authEmail");
    if (!EMAIL_SHAPE.test(email)) {
      setMessage(t("pin.validEmail", "Gëff eng valabel E-Mail un."), "err");
      return;
    }
    setMessage("…");
    try {
      await deps.resetPin(email);
      setMessage(t(
        "pin.linkSent",
        "Wann d'E-Mail ukënnt, benotz de Link. " +
          "Wann net, schreif dem Ian.",
      ), "ok");
    } catch (error) {
      console.warn("PIN recovery failed", error);
      setMessage(t(
        "pin.linkError",
        "Den E-Mail-Link geet hei net. Schreif dem Ian.",
      ), "err");
    }
  });
}

function signedInMarkup(name) {
  return `${closeButton()}<h3>${esc(t(
    "pin.signedIn",
    "Ugemellt",
  ))}</h3><p class="pin-note">${esc(t("pin.as", "als"))} <b>${esc(name)}</b></p>
    <button class="auth-go" id="authOut">${esc(t(
      "pin.signOut",
      "Ofmellen",
    ))}</button>`;
}

export function openAuthDialog(deps) {
  ensureModal();
  modalLocked = false;
  if (!deps.session()) {
    drawSignIn(deps, 6, "pin");
    openModal();
    return;
  }
  box().innerHTML = signedInMarkup(deps.username());
  wireClose();
  box().querySelector("#authOut").addEventListener("click", async () => {
    try {
      await deps.signOut();
      closeModal();
    } catch (error) {
      console.warn("sign out failed", error);
    }
  });
  openModal();
}

function currentProofMarkup(required) {
  if (!required) return "";
  return `<label for="authCurrent">${esc(t(
    "pin.currentCredential",
    "Aktuelle PIN (oder Passwuert bei engem ale Kont)",
  ))}</label><input id="authCurrent" type="password"
    autocomplete="current-password">`;
}

function pinSetupMarkup(length, title, needsProof) {
  return `${closeButton()}<h3>${esc(title)}</h3>
    ${currentProofMarkup(needsProof)}
    <p class="pin-note">${esc(t(
      "pin.chooseLength",
      "Wiel 4 oder 6 Zifferen.",
    ))}</p>${lengthTabs(length)}${pinWarning(length)}
    <label>${esc(t("pin.enterNew", "Neie PIN aginn"))}</label>
    <div id="authPinHost"></div>
    <label>${esc(t("pin.repeat", "PIN widderhuelen"))}</label>
    <div id="authPinAgain"></div>
    <button class="auth-go" id="authSubmit">${esc(t(
      "pin.save",
      "PIN späicheren",
    ))}</button><div class="auth-msg" id="authMsg"></div>`;
}

export function openPinDialog(deps, options = {}) {
  const length = options.length === 4 ? 4 : 6;
  const needsProof = options.hasPin === true && !options.recovery;
  modalLocked = Boolean(options.required);
  const title = options.recovery
    ? t("pin.newTitle", "Neie PIN setzen")
    : t("pin.changeTitle", "PIN änneren");
  box().innerHTML = pinSetupMarkup(length, title, needsProof);
  wireClose();
  const first = attachPinPad(length, () => second.focus());
  const second = createPinPad({ length, label: t("pin.repeatDigit", "PIN nach eng Kéier, Ziffer") });
  box().querySelector("#authPinAgain").appendChild(second.element);
  wireLengthTabs(length, (next) => openPinDialog(deps, { ...options, length: next }));
  box().querySelector("#authSubmit").addEventListener("click", async () => {
    const pin = first.value();
    if (pin !== second.value() || pin.length !== length) {
      setMessage(t("pin.noMatch", "D'PINe sinn net d'selwecht."), "err");
      return;
    }
    if (weakPin(pin)) {
      setMessage(t("pin.weak", "Wiel e manner bekannte PIN."), "err");
      return;
    }
    setMessage("…");
    try {
      await deps.setPin(pin, length, {
        currentCredential: value("authCurrent"),
        recovery: options.recovery === true,
      });
      closeModal();
      options.onDone?.();
    } catch (error) {
      console.warn("PIN set failed", error);
      setMessage(t("pin.setError", "De PIN konnt net gespäichert ginn."), "err");
    }
  });
  openModal(Boolean(options.required));
}
