import {
  createPinPad,
  DEFAULT_PIN_LENGTH,
  esc,
  translate,
} from "./pin-pad.js?v=5";
const USERNAME_SHAPE = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
let modal = null;
let modalLocked = false;
/* Runs once when the dialog closes or is redrawn: the face scan stops its camera here. */
let onLeave = null;
function leave() {
  const cleanup = onLeave;
  onLeave = null;
  cleanup?.();
}
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
  leave();
  if (!modal) return;
  modalLocked = false;
  modal.classList.remove("open");
}
function closeButton() {
  if (modalLocked) return "";
  return '<button class="auth-x" aria-label="Close">' +
    "&times;</button>";
}
/* Title and close button share one flex row. Floating the button over the
 * heading made it sit on the first field's label whenever the title was short. */
function dialogHead(title) {
  return `<div class="auth-head"><h3>${esc(title)}</h3>` +
    `${closeButton()}</div>`;
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

/* Every dialog is redrawn from scratch to switch PIN length or sign-in method,
 * which used to wipe whatever was already typed — changing 6 digits to 4 threw
 * away the username you had just entered. Lift the plain fields out first and
 * write them back after. The digit boxes are deliberately excluded: they belong
 * to the length you are leaving. */
function fieldValues() {
  const values = {};
  box().querySelectorAll("input[id]").forEach((input) => {
    if (!input.classList.contains("pin-box")) values[input.id] = input.value;
  });
  return values;
}

function restoreFields(values) {
  Object.entries(values || {}).forEach(([id, text]) => {
    const input = box().querySelector(`#${CSS.escape(id)}`);
    if (input) input.value = text;
  });
}
function lengthTabs(length) {
  return `<div class="auth-tabs">
    <button class="auth-tab ${length === 4 ? "active" : ""}"
      type="button" data-pin-length="4">${esc(t(
        "pin.fourDigits",
        "4 Zifferen",
      ))}</button>
    <button class="auth-tab ${length === 6 ? "active" : ""}"
      type="button" data-pin-length="6">${esc(t(
        "pin.sixDigits",
        "6 Zifferen",
      ))}</button>
  </div>`;
}

/** label + digit boxes, kept together so the label never sits on the pad. */
function pinGroup(labelKey, fallback, hostId) {
  return `<div class="pin-group">
    <label>${esc(t(labelKey, fallback))}</label>
    <div id="${hostId}"></div>
  </div>`;
}

function field(id, labelKey, fallback, attributes) {
  return `<div class="auth-field">
    <label for="${id}">${esc(t(labelKey, fallback))}</label>
    <input id="${id}" ${attributes}>
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
  return `${dialogHead(t("pin.account", "Kont"))}
  <div class="auth-tabs">
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
      const values = fieldValues();
      if (next === "up") drawSignUp(deps, DEFAULT_PIN_LENGTH, values);
      else drawSignIn(deps, DEFAULT_PIN_LENGTH, "pin", values);
    });
  });
}
function identifierField() {
  return field(
    "authIdentifier",
    "pin.identifier",
    "Benotzernumm oder E-Mail",
    'autocomplete="username" maxlength="254"',
  );
}
function loginLinks(method) {
  const switchText = method === "pin"
    ? t("pin.usePassword", "Mat Passwuert umellen")
    : t("pin.usePin", "Mat PIN umellen");
  return `<div class="auth-links">
    <button class="auth-link" id="authMethod" type="button">
      ${esc(switchText)}
    </button>
    <button class="auth-link" id="authForgot" type="button">
      ${esc(t("pin.forgot", "PIN vergiess?"))}
    </button>
  </div>${checkLink()}`;
}
function checkLink() {
  return `<div class="auth-links"><button class="auth-link" id="authCheck" type="button">
      ${esc(t("pin.check", "Hunn ech e Kont?"))}</button></div>`;
}
function wireCheckLink(deps, prefill) {
  box().querySelector("#authCheck")?.addEventListener("click", () => drawCheck(deps, prefill()));
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
/* "Mat Face ID aloggen" (passkey) and, on a device where a face was saved,
 * "Mam Gesiicht aloggen". Both sit under the normal login and only add to it. */
function quickLoginMarkup(deps) {
  const buttons = [];
  if (deps.passkeySupported()) {
    buttons.push(`<button class="auth-link" id="authPasskey" type="button">${esc(t(
      "quick.passkey",
      "Mat Face ID aloggen",
    ))}</button>`);
  }
  if (deps.faceEntries().length) {
    buttons.push(`<button class="auth-link" id="authFace" type="button">${esc(t(
      "quick.face",
      "Mam Gesiicht aloggen",
    ))}</button>`);
  }
  if (!buttons.length) return "";
  return `<div class="auth-or"><span>${esc(t("quick.or", "oder"))}</span></div>
    <div class="auth-links">${buttons.join("")}</div>`;
}

function passkeyError(deps, error) {
  console.warn("passkey login failed", error);
  if (deps.passkeyCancelled(error)) {
    return t(
      "quick.passkeyNone",
      "Face ID ofgebrach oder keng Passkey fir ian.lu op dësem Apparat. " +
        "Mell dech mam PIN un. Am Profil kanns du Face ID aschalten.",
    );
  }
  return t(
    "quick.passkeyError",
    "Face ID huet net geklappt. Mell dech w.e.g. mam PIN un.",
  );
}

function wireQuickLogin(deps) {
  box().querySelector("#authPasskey")?.addEventListener("click", async () => {
    setMessage("…");
    try {
      await deps.loginPasskey();
      closeModal();
    } catch (error) {
      setMessage(passkeyError(deps, error), "err");
    }
  });
  box().querySelector("#authFace")?.addEventListener("click", () => {
    openFaceDialog(deps, { mode: "login", values: fieldValues() });
  });
}

function loginMarkup(deps, mode, length, method) {
  const credential = method === "pin"
    ? `${lengthTabs(length)}${pinGroup(
      "pin.enter",
      "PIN aginn",
      "authPinHost",
    )}`
    : field(
      "authPassword",
      "pin.password",
      "Passwuert",
      'type="password" autocomplete="current-password"',
    );
  return `${authHeader(mode)}${identifierField()}${credential}
    <button class="auth-go" id="authSubmit">${esc(t(
      "pin.signIn",
      "Umellen",
    ))}</button>${quickLoginMarkup(deps)}${loginLinks(method)}
    <div class="auth-msg" id="authMsg"></div>`;
}

function loginError(error) {
  console.warn("PIN login failed", error);
  return t(
    "pin.loginError",
    "D'Umeldung ass net gaangen. Kontrolléier deng Donnéeën.",
  );
}

function drawSignIn(deps, length, method, values, message) {
  leave();
  box().innerHTML = loginMarkup(deps, "in", length, method);
  restoreFields(values);
  wireClose();
  wireModeTabs(deps, "in");
  wireQuickLogin(deps);
  if (message) setMessage(message, "err");
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
  wireLengthTabs(length, (next) => drawSignIn(deps, next, method, fieldValues()));
  box().querySelector("#authMethod").addEventListener("click", () => {
    drawSignIn(deps, length, method === "pin" ? "password" : "pin", fieldValues());
  });
  box().querySelector("#authForgot").addEventListener(
    "click",
    () => drawForgot(deps),
  );
  wireCheckLink(deps, () => value("authIdentifier"));
}

function signupMarkup(length) {
  return `${authHeader("up")}
    ${field("authUser", "pin.username", "Benotzernumm",
      'maxlength="20" autocomplete="username"')}
    ${field("authEmail", "pin.email", "E-Mail",
      'type="email" autocomplete="email"')}
    <p class="pin-note">${esc(t(
      "pin.chooseLength",
      "Wiel 4 oder 6 Zifferen.",
    ))}</p>${lengthTabs(length)}${pinWarning(length)}
    ${pinGroup("pin.enter", "PIN aginn", "authPinHost")}
    ${pinGroup("pin.repeat", "PIN widderhuelen", "authPinAgain")}
    <p class="pin-note">${esc(t("pin.recoveryAdvice", "Wanns du däi PIN vergiess hues, kanns du per E-Mail en neie setzen."))}</p>
    <button class="auth-go" id="authSubmit">${esc(t(
      "pin.signUp",
      "Kont erstellen",
    ))}</button><div class="auth-msg" id="authMsg"></div>${checkLink()}`;
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

function drawSignUp(deps, length, values) {
  box().innerHTML = signupMarkup(length);
  restoreFields(values);
  wireClose();
  wireModeTabs(deps, "up");
  const first = attachPinPad(length, () => second.focus());
  const second = createPinPad({
    length,
    label: t("pin.repeatDigit", "PIN nach eng Kéier, Ziffer"),
  });
  box().querySelector("#authPinAgain").appendChild(second.element);
  wireLengthTabs(length, (next) => drawSignUp(deps, next, fieldValues()));
  box().querySelector("#authSubmit").addEventListener(
    "click",
    () => submitSignUp(deps, first, second, length),
  );
  wireCheckLink(deps, () => value("authEmail") || value("authUser"));
}

/* "Do I have an account?" — yes/no for a username or e-mail, then one tap to
 * sign in (yes) or to create the account with what was typed (no). */
function drawCheck(deps, prefill = "") {
  box().innerHTML = `${dialogHead(t("pin.checkTitle", "Hunn ech e Kont?"))}
    <p class="pin-note">${esc(t("pin.checkText", "Gëff däi Benotzernumm oder deng E-Mail an."))}</p>
    ${field("authCheckId", "pin.identifier", "Benotzernumm oder E-Mail",
      'autocomplete="username" maxlength="254"')}
    <button class="auth-go" id="authSubmit">${esc(t("pin.checkBtn", "Iwwerpréiwen"))}</button>
    <div class="auth-msg" id="authMsg"></div>
    <div id="authCheckNext"></div>
    <div class="auth-links"><button class="auth-link" id="authBack" type="button">
      ${esc(t("pin.back", "← Zréck"))}</button></div>`;
  wireClose();
  const input = box().querySelector("#authCheckId");
  input.value = prefill;
  const next = box().querySelector("#authCheckNext");
  box().querySelector("#authBack").addEventListener("click",
    () => drawSignIn(deps, DEFAULT_PIN_LENGTH, "pin", { authIdentifier: value("authCheckId") }));
  const showNext = (labelKey, fallback, go) => {
    next.innerHTML = `<button class="auth-go" type="button">${esc(t(labelKey, fallback))}</button>`;
    next.querySelector("button").addEventListener("click", go);
  };
  const submit = async () => {
    const id = value("authCheckId");
    next.innerHTML = "";
    if (id.length < 3) {
      setMessage(t("pin.complete", "Fëll w.e.g. alles aus."), "err");
      return;
    }
    setMessage("…");
    try {
      const exists = await deps.accountExists(id);
      if (exists) {
        setMessage(t("pin.checkYes", "Jo, et gëtt e Kont fir „{id}“.").replace("{id}", id), "ok");
        showNext("pin.signIn", "Umellen",
          () => drawSignIn(deps, DEFAULT_PIN_LENGTH, "pin", { authIdentifier: id }));
      } else {
        setMessage(t("pin.checkNo", "Nee, et gëtt nach kee Kont fir „{id}“.").replace("{id}", id), "err");
        const isEmail = id.includes("@");
        showNext("pin.signUp", "Kont erstellen",
          () => drawSignUp(deps, DEFAULT_PIN_LENGTH, isEmail ? { authEmail: id } : { authUser: id }));
      }
    } catch (error) {
      console.warn("account check failed", error);
      setMessage(t("pin.checkError", "Konnt net iwwerpréiwen. Probéier nach eng Kéier."), "err");
    }
  };
  box().querySelector("#authSubmit").addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  input.focus();
}

function drawForgot(deps) {
  box().innerHTML = `${dialogHead(t(
    "pin.forgotTitle",
    "Neie PIN setzen",
  ))}<p class="pin-note">${esc(t(
    "pin.forgotText",
    "Gëff d'E-Mail vun dengem Kont an. Mir schécken dir e " +
      "Link, mat deem s du en neie PIN setze kanns.",
  ))}</p>${field("authEmail", "pin.email", "E-Mail",
    'type="email" autocomplete="email"')}
    <button class="auth-go" id="authSubmit">${esc(t(
      "pin.sendLink",
      "Link schécken",
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
        "Wann et e Kont mat dëser E-Mail gëtt, ass de Link " +
          "ënnerwee. Kuck och am Spam.",
      ), "ok");
    } catch (error) {
      console.warn("PIN recovery failed", error);
      setMessage(t(
        "pin.linkError",
        "De Link konnt net geschéckt ginn. Probéier et méi spéit nach eng Kéier.",
      ), "err");
    }
  });
}

function signedInMarkup(name) {
  return `${dialogHead(t("pin.signedIn", "Ugemellt"))}
    <p class="pin-note">${esc(t("pin.as", "als"))} <b>${esc(name)}</b></p>
    <button class="auth-go" id="authOut">${esc(t(
      "pin.signOut",
      "Ofmellen",
    ))}</button>`;
}

export function openAuthDialog(deps) {
  ensureModal();
  modalLocked = false;
  if (!deps.session()) {
    drawSignIn(deps, DEFAULT_PIN_LENGTH, "pin");
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
  return field(
    "authCurrent",
    "pin.currentCredential",
    "Aktuelle PIN (oder Passwuert bei engem ale Kont)",
    'type="password" autocomplete="current-password"',
  );
}

function pinSetupMarkup(length, title, needsProof) {
  return `${dialogHead(title)}
    ${currentProofMarkup(needsProof)}
    <p class="pin-note">${esc(t(
      "pin.chooseLength",
      "Wiel 4 oder 6 Zifferen.",
    ))}</p>${lengthTabs(length)}${pinWarning(length)}
    ${pinGroup("pin.enterNew", "Neie PIN aginn", "authPinHost")}
    ${pinGroup("pin.repeat", "PIN widderhuelen", "authPinAgain")}
    <button class="auth-go" id="authSubmit">${esc(t(
      "pin.save",
      "PIN späicheren",
    ))}</button><div class="auth-msg" id="authMsg"></div>`;
}

export function openPinDialog(deps, options = {}) {
  if (deps.isKartAccount?.()) return;
  const length = options.length === 6 ? 6 : DEFAULT_PIN_LENGTH;
  const needsProof = options.hasPin === true && !options.recovery;
  modalLocked = Boolean(options.required);
  const title = options.recovery
    ? t("pin.newTitle", "Neie PIN setzen")
    : t("pin.changeTitle", "PIN änneren");
  box().innerHTML = pinSetupMarkup(length, title, needsProof);
  restoreFields(options.values);
  wireClose();
  const first = attachPinPad(length, () => second.focus());
  const second = createPinPad({ length, label: t("pin.repeatDigit", "PIN nach eng Kéier, Ziffer") });
  box().querySelector("#authPinAgain").appendChild(second.element);
  wireLengthTabs(length, (next) => openPinDialog(
    deps,
    { ...options, length: next, values: fieldValues() },
  ));
  box().querySelector("#authSubmit").addEventListener("click", async () => {
    const pin = first.value();
    if (pin !== second.value() || pin.length !== length) {
      setMessage(t("pin.noMatch", "D'PINe sinn net d'selwecht."), "err");
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

/* ---------- face scan dialog ("Mam Gesiicht aloggen") ----------
 * mode "enroll": signed in, saves the face on this device.
 * mode "login":  signed out, matches the face against the ones saved here.
 * Every failure ends on a message plus a way back to the PIN login. */

const FACE_STEP_TEXT = Object.freeze({
  loading: ["face.loading", "Kamera a Gesiichtserkennung lueden … Déi éischte Kéier dauert dat e bëssen."],
  straight: ["face.straight", "Kuck riichtaus an d'Kamera."],
  turn: ["face.turn", "Elo de Kapp lues op eng Säit dréien."],
  back: ["face.back", "Super. An elo nach eng Kéier riichtaus kucken."],
});
const FACE_STEPS = ["straight", "turn", "back"];
const FACE_STEP_LABELS = Object.freeze([
  ["face.straightShort", "Riichtaus"],
  ["face.turnShort", "Kapp dréien"],
  ["face.backShort", "Erëm riichtaus"],
]);
const FACE_DONE_CLOSE_MS = 1200;

const FACE_ERRORS = Object.freeze({
  camera_denied: ["face.denied", "D'Kamera ass blockéiert. Erlaab se fir ian.lu (Safari: aA → Websäit-Astellungen → Kamera)."],
  no_camera: ["face.noCamera", "Hei gëtt et keng Kamera, déi ian.lu benotze kann."],
  load_failed: ["face.loadFailed", "D'Gesiichtserkennung konnt net lueden. Probéier et méi spéit nach eng Kéier."],
  timeout: ["face.timeout", "Ech hunn däi Gesiicht net richteg gesinn. Probéier et mat méi Liicht nach eng Kéier."],
  changed: ["face.changed", "Dat war net déiselwecht Persoun. Probéier nach eng Kéier."],
  no_match: ["face.noMatch", "Ech hunn dech net erkannt. Probéier nach eng Kéier oder mell dech mam PIN un."],
  invalid_login: ["face.expired", "Däi Gesiicht ass hei net méi aktiv. Mell dech mam PIN un a scann et am Profil nei."],
  storage: ["face.storage", "Dëse Browser léisst ian.lu näischt späicheren (privat Modus?)."],
});

function faceErrorText(mode, error) {
  const known = FACE_ERRORS[error?.code];
  if (known) return t(known[0], known[1]);
  return mode === "login"
    ? t("face.loginError", "Dat huet net geklappt. Mell dech w.e.g. mam PIN un.")
    : t("face.enrollError", "D'Gesiicht konnt net gespäichert ginn. Probéier et méi spéit nach eng Kéier.");
}

function faceMarkup(mode) {
  const title = mode === "login"
    ? t("quick.face", "Mam Gesiicht aloggen")
    : t("face.enrollTitle", "Gesiicht scannen");
  const intro = mode === "login"
    ? t("face.loginIntro", "Däi Gesiicht gëtt just hei um Apparat verglach.")
    : t("face.enrollIntro",
      "Däi Gesiicht gëtt just op dësem Apparat gespäichert, net um Server. " +
        "Duerno kanns du dech hei mam Gesiicht aloggen. Däi PIN bleift ëmmer.");
  const steps = FACE_STEPS.map((step, index) => {
    const [key, fallback] = FACE_STEP_LABELS[index];
    return `<li data-face-step="${step}">${index + 1}. ${esc(t(key, fallback))}</li>`;
  }).join("");
  const back = mode === "login"
    ? t("face.toPin", "← Mam PIN aloggen")
    : t("face.close", "Zoumaachen");
  return `${dialogHead(title)}
    <p class="pin-note">${esc(intro)}</p>
    <div class="face-cam"><video id="faceVideo" playsinline muted autoplay></video></div>
    <ol class="face-steps">${steps}</ol>
    <div class="auth-msg" id="authMsg" role="status" aria-live="polite"></div>
    <div class="auth-links">
      <button class="auth-link" id="faceRetry" type="button" hidden>${esc(t("face.retry", "Nach eng Kéier"))}</button>
      <button class="auth-link" id="faceBack" type="button">${esc(back)}</button>
    </div>`;
}

function showFaceStep(step) {
  const current = FACE_STEPS.indexOf(step);
  box().querySelectorAll("[data-face-step]").forEach((item) => {
    const index = FACE_STEPS.indexOf(item.dataset.faceStep);
    item.classList.toggle("on", index === current);
    item.classList.toggle("done", current > index);
  });
  const text = FACE_STEP_TEXT[step];
  if (text) setMessage(t(text[0], text[1]));
}

async function finishFace(deps, mode, face, scanner) {
  if (mode === "enroll") {
    await deps.enrollFace(face);
    return t("face.saved", "Fäerdeg! Däi Gesiicht ass op dësem Apparat gespäichert.");
  }
  const best = scanner.matchFace(face, deps.faceEntries());
  if (!best) throw Object.assign(new Error("no match"), { code: "no_match" });
  await deps.loginFace(best.candidate);
  return t("face.welcome", "Moien {name}!").replace("{name}", best.candidate.username);
}

export function openFaceDialog(deps, options = {}) {
  const mode = options.mode === "login" ? "login" : "enroll";
  leave();
  ensureModal();
  modalLocked = false;
  box().innerHTML = faceMarkup(mode);
  wireClose();
  openModal();
  const goBack = () => {
    if (mode === "login") drawSignIn(deps, DEFAULT_PIN_LENGTH, "pin", options.values);
    else closeModal();
  };
  box().querySelector("#faceBack").addEventListener("click", goBack);
  const retry = box().querySelector("#faceRetry");
  const run = async () => {
    leave();
    const controller = new AbortController();
    onLeave = () => controller.abort();
    retry.hidden = true;
    box().querySelector(".face-cam")?.classList.remove("ok", "bad");
    let scanner;
    try {
      scanner = await import("./face-scan.js?v=1");
    } catch (error) {
      console.warn("[face] module failed to load", error);
      setMessage(faceErrorText(mode, { code: "load_failed" }), "err");
      retry.hidden = false;
      return;
    }
    try {
      const face = await scanner.scanFace(box().querySelector("#faceVideo"), {
        signal: controller.signal,
        onStep: showFaceStep,
      });
      if (controller.signal.aborted) return;
      setMessage("…");
      const done = await finishFace(deps, mode, face, scanner);
      if (controller.signal.aborted) return;
      onLeave = null; // done: closing the dialog now must not count as a cancel
      box().querySelector(".face-cam")?.classList.add("ok");
      setMessage(done, "ok");
      setTimeout(() => {
        if (box().querySelector("#faceVideo")) closeModal();
        options.onDone?.();
      }, FACE_DONE_CLOSE_MS);
    } catch (error) {
      if (controller.signal.aborted || error?.code === "cancelled") return;
      console.warn(`[face] ${mode} failed`, error);
      box().querySelector(".face-cam")?.classList.add("bad");
      setMessage(faceErrorText(mode, error), "err");
      retry.hidden = false;
    }
  };
  retry.addEventListener("click", run);
  void run();
}
