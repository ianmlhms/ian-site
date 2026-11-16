/* Flow — Face ID (passkey) + "Mam Gesiicht aloggen" (Nov 2026, hardened v2 16 Nov).
 * Passkeys use Chromium's virtual WebAuthn authenticator (CDP) against mocked
 * /auth/v1/passkeys endpoints. The face scan's camera + ML part
 * (face-scan.js?v=2) is replaced by a stub that returns a chosen face template;
 * the real matcher (matchFace) is still used. auth-face is a small stateful
 * mock of the real one: PIN re-check, rotating device keys, replay = revoke,
 * expiry, admin refusal. Checks that every failure leaves the normal PIN login
 * working, which is the one thing that must never break. */
import crypto from "node:crypto";
import { runIfMain, ME, ME_NAME } from "./lib.mjs";

const SESSION_KEY = "sb-lvksqmgfwkfbblfsozfk-auth-token";
const FACE_KEY = "ianlu-face-v1";
const PIN = "4821";
const WRONG_PIN = "1111";
const OLD_DEVICE = "3f2b8c1e-9a4d-4e2f-8b6a-1c2d3e4f5a6b";
const myFace = Array.from({ length: 128 }, (_, i) => Number((Math.sin(i) * 0.1).toFixed(5)));
const otherFace = myFace.map((v) => Number((v + 0.08).toFixed(5)));   // distance ≈ 0.9
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };

const FACE_STUB = `
export const MATCH_DISTANCE = 0.45;
export { matchFace, faceDistance } from "/face-scan.js?v=real";
export async function scanFace(video, { onStep } = {}) {
  const stub = window.__faceStub || {};
  for (const step of ["loading", "straight", "turn", "back"]) onStep?.(step);
  await new Promise((r) => setTimeout(r, 150));
  if (stub.error) throw Object.assign(new Error(stub.error), { code: stub.error });
  return stub.face;
}`;

const ENGLISH = /Sign in with|Face scan|Try again|Passkey failed|Delete|Remove/;

function b64url(text) {
  return Buffer.from(text).toString("base64url");
}

/* The auth-face edge function as the browser sees it (rules of security-fix-face-v2.sql). */
function faceServer() {
  const devices = new Map();   // id -> { userId, name, secret, retired: [], createdAt, lastUsedAt }
  const state = { admin: false, expireNext: false, devices };
  const secret = () => crypto.randomBytes(32).toString("base64url");
  state.add = (name, userId = ME) => {
    const id = crypto.randomUUID();
    devices.set(id, { userId, name, secret: secret(), retired: [], createdAt: new Date().toISOString(), lastUsedAt: null });
    return id;
  };
  state.handle = (body) => {
    const action = body?.action;
    if (action === "reauth" || action === "enroll") {
      if (action === "enroll" && state.admin) return [403, { error: "admin_forbidden" }];
      if (body.credential !== PIN) return [403, { error: "reauth_failed" }];
      if (action === "reauth") return [200, { ok: true }];
      const id = state.add(String(body.name || "Apparat"));
      return [200, { deviceId: id, secret: devices.get(id).secret }];
    }
    const device = devices.get(body?.deviceId);
    if (action === "forget") {
      if (device && device.secret === body.secret) devices.delete(body.deviceId);
      return [200, { ok: true }];
    }
    if (action !== "login") return [400, { error: "bad_action" }];
    if (!device) return [401, { error: "invalid_login" }];
    if (device.secret !== body.secret) {
      if (device.retired.includes(body.secret)) { devices.delete(body.deviceId); return [401, { error: "device_revoked" }]; }
      return [401, { error: "invalid_login" }];
    }
    if (state.expireNext) { state.expireNext = false; devices.delete(body.deviceId); return [401, { error: "expired" }]; }
    if (state.admin) { devices.delete(body.deviceId); return [401, { error: "admin_forbidden" }]; }
    device.retired = [device.secret, ...device.retired].slice(0, 10);
    device.secret = secret();
    device.lastUsedAt = new Date().toISOString();
    return [200, { hashed_token: "face-hash", secret: device.secret }];
  };
  state.mine = () => [...devices.entries()].filter(([, d]) => d.userId === ME)
    .map(([id, d]) => ({ id, name: d.name, created_at: d.createdAt, last_used_at: d.lastUsedAt }));
  return state;
}

export const flow = {
  name: "quick-login",
  backend: {
    rpc: {
      admin_user_ids: () => [], game_leaderboard: () => [],
      my_profile_private: () => [{ account_checked_at: "2026-10-01T00:00:00Z" }],   // keeps the account-check card away
    },
    tables: { profiles: () => [{ id: ME, avatar: null, class: "4C6", username: ME_NAME, class_confirmed: "2026-09", account_checked_at: "2026-10-01T00:00:00Z" }] },
    functions: {
      "auth-pin": (body) => (body?.action === "login" ? { hashed_token: "pin-hash" } : { hasPin: true, isLegacy: false }),
    },
  },
  async run(h) {
    const { page, context, backend } = h;
    // WebAuthn refuses IP addresses as its domain: talk to the same server as "localhost".
    const goto = (rel) => page.goto(h.origin.replace("127.0.0.1", "localhost") + rel, { waitUntil: "domcontentloaded" });
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const dialogs = [];
    page.on("dialog", (dialog) => { dialogs.push(dialog.message()); void dialog.accept(); });

    /* ---------- mocks ---------- */
    const srv = faceServer();
    const faceCalls = (action) => backend.callsTo("auth-face").filter((c) => c.body?.action === action);
    await context.route(/\/functions\/v1\/auth-face$/, async (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      const body = JSON.parse(request.postData() || "{}");
      backend.calls.push({ kind: "function", name: "auth-face", body });
      const [status, data] = srv.handle(body);
      return route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(data) });
    });
    backend.rpc.is_admin = () => srv.admin;
    backend.rpc.face_devices_mine = () => srv.mine();
    backend.rpc.face_device_delete = (args) => {
      const device = srv.devices.get(args.p_id);
      if (!device || device.userId !== ME) return false;   // the SQL only deletes auth.uid()'s rows
      srv.devices.delete(args.p_id);
      return true;
    };
    backend.rpc.face_devices_forget_all = () => {
      const mine = srv.mine();
      mine.forEach((row) => srv.devices.delete(row.id));
      return mine.length;
    };
    await context.route(/face-scan\.js\?v=2$/, (route) =>
      route.fulfill({ contentType: "application/javascript", body: FACE_STUB }));
    const passkeyCalls = [];
    let passkeys = [];
    await context.route(/\/auth\/v1\/passkeys(\/|\?|$)/, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const rpId = new URL(page.url()).hostname;
      passkeyCalls.push(`${request.method()} ${url.pathname}`);
      const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", headers: CORS, body: JSON.stringify(data) });
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      const challenge = b64url("challenge-" + Date.now());
      if (url.pathname.endsWith("/authentication/options")) {
        return json({ challenge_id: "c1", options: { challenge, rpId, timeout: 60000, userVerification: "preferred" }, expires_at: Date.now() / 1000 + 300 });
      }
      if (url.pathname.endsWith("/registration/options")) {
        return json({ challenge_id: "c2", expires_at: Date.now() / 1000 + 300, options: {
          challenge, rp: { name: "ian.lu", id: rpId },
          user: { id: b64url(ME), name: "tester@example.test", displayName: ME_NAME },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
          authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
          attestation: "none", timeout: 60000,
        } });
      }
      if (url.pathname.endsWith("/registration/verify")) {
        const key = { id: "pk1", friendly_name: "iPad", created_at: new Date().toISOString(), last_used_at: null };
        passkeys = [key];
        return json(key);
      }
      if (url.pathname.endsWith("/authentication/verify")) {
        const now = Math.floor(Date.now() / 1000);
        const payload = b64url(JSON.stringify({ sub: ME, role: "authenticated", exp: now + 86400, aud: "authenticated" }));
        return json({ access_token: `e30.${payload}.sig`, refresh_token: "r", token_type: "bearer", expires_in: 86400, expires_at: now + 86400,
          user: { id: ME, aud: "authenticated", email: "tester@example.test", user_metadata: { username: ME_NAME }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" } });
      }
      if (request.method() === "DELETE") {
        const id = url.pathname.split("/").pop();
        passkeys = passkeys.filter((key) => key.id !== id);
        return route.fulfill({ status: 204, headers: CORS });
      }
      return json(passkeys);   // GET /passkeys (list)
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
      protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true,
      isUserVerified: true, automaticPresenceSimulation: true,
    } });

    const signOut = async () => {
      await page.evaluate((key) => localStorage.removeItem(key), SESSION_KEY);
      await goto("/profile.html");
      await page.waitForSelector("#signin", { timeout: 15000 });
    };
    const signInDirect = async () => {
      await page.evaluate(([key, session]) => localStorage.setItem(key, session), [SESSION_KEY, await sessionJson()]);
      await goto("/profile.html");
      await page.waitForSelector("#quickBtns button", { timeout: 15000 });
    };
    const openLogin = async () => {
      await page.click("#gtAcct");
      await page.waitForSelector(".auth-modal.open #authIdentifier", { timeout: 8000 });
    };
    const signedInName = () => page.waitForFunction((name) => document.getElementById("gtAcct")?.textContent === name, ME_NAME, { timeout: 8000 });
    const msg = () => page.textContent("#authMsg");
    const waitMsg = (pattern, id = "authMsg") => page.waitForFunction(([source, el]) => new RegExp(source).test(document.getElementById(el)?.textContent || ""), [pattern.source, id], { timeout: 8000 });
    const stored = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), FACE_KEY);
    const typePin = async (pin) => {
      const boxes = await page.$$("#authPinHost .pin-box");
      for (let i = 0; i < boxes.length; i += 1) await boxes[i].type(pin[i]);
    };
    const backToPinWorks = async (label) => {
      await page.click("#faceBack");
      await page.waitForSelector("#authPinHost .pin-box", { timeout: 5000 });
      await page.fill("#authIdentifier", ME_NAME);
      await typePin(PIN);
      await signedInName();
      h.expect(true, `${label}: PIN login works right after`);
    };
    const faceLoginFromDialog = async (face = myFace) => {
      await openLogin();
      await page.evaluate((value) => { window.__faceStub = { face: value }; }, face);
      await page.click("#authFace");
    };

    h.step("visitor: login dialog offers Face ID next to the PIN");
    await goto("/profile.html");
    await page.waitForSelector("#signin", { timeout: 15000 });
    await openLogin();
    h.eq((await page.textContent("#authPasskey")).trim(), "Mat Face ID aloggen", "«Mat Face ID aloggen» button");
    h.expect(!(await page.$("#authFace")), "no face button while no face is saved here");
    h.expect(Boolean(await page.$("#authPinHost .pin-box")), "PIN boxes still there");
    h.expect(/oder/.test(await page.textContent(".auth-or")), "«oder» divider");
    await h.shot("login-dialog");

    h.step("passkey: no passkey / cancelled → message, PIN form untouched");
    await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: false });
    await page.evaluate(() => {
      Object.defineProperty(navigator.credentials, "get", { configurable: true, value: async () => { throw new DOMException("cancelled", "NotAllowedError"); } });
    });
    await page.fill("#authIdentifier", ME_NAME);
    await page.click("#authPasskey");
    await waitMsg(/PIN/);
    h.expect(/Face ID ofgebrach/.test(await msg()), "cancel message in Luxembourgish");
    h.eq(await page.inputValue("#authIdentifier"), ME_NAME, "typed username kept");
    h.expect(await page.isVisible(".auth-modal.open"), "dialog stays open for the PIN");

    h.step("…and the normal PIN login still works right after");
    await typePin(PIN);
    await signedInName();
    const pinLogin = backend.callsTo("auth-pin").filter((c) => c.body?.action === "login").at(-1)?.body;
    h.eq(pinLogin, { action: "login", identifier: ME_NAME, pin: PIN }, "auth-pin login sent");
    await signOut();

    h.step("passkey: «Face ID aschalten» asks for the PIN first; a wrong PIN registers nothing");
    await page.evaluate(() => { delete navigator.credentials.get; });
    await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: true });
    await signInDirect();
    h.eq((await page.textContent("#pkAdd")).trim(), "Face ID aschalten", "profile: «Face ID aschalten»");
    h.eq((await page.textContent("#faceScan")).trim(), "Gesiicht scannen", "profile: «Gesiicht scannen»");
    await page.click("#pkAdd");
    await page.waitForSelector(".auth-modal.open #authCurrent", { timeout: 8000 });
    await page.fill("#authCurrent", WRONG_PIN);
    await page.click("#reauthGo");
    await waitMsg(/stëmmt net/);
    h.eq(faceCalls("reauth").at(-1)?.body, { action: "reauth", credential: WRONG_PIN }, "PIN checked on the server (auth-face reauth)");
    h.expect(!passkeyCalls.some((p) => p.includes("/registration/")), "wrong PIN: no passkey registration started");
    await h.shot("passkey-reauth-wrong");

    h.step("passkey: right PIN → «Elo Face ID aschalten» → registered and listed");
    await page.fill("#authCurrent", PIN);
    await page.click("#reauthGo");
    await page.waitForSelector("#passkeyGo", { timeout: 8000 });
    h.expect(!passkeyCalls.some((p) => p.includes("/registration/")), "nothing registered before the second tap");
    await page.click("#passkeyGo");
    await waitMsg(/Face ID ass un/, "quickMsg");
    h.expect(passkeyCalls.some((p) => p.endsWith("/registration/verify")), "registration verified with Supabase");
    const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
    h.eq(credentials.length, 1, "one passkey on the authenticator");
    await page.waitForSelector("#pkList [data-pk]", { timeout: 8000 });
    h.expect(/iPad/.test(await page.textContent("#pkList")) && /Läschen/.test(await page.textContent("#pkList")), "passkey listed with «Läschen»");

    h.step("… then «Mat Face ID aloggen» signs in");
    await signOut();
    await openLogin();
    await page.click("#authPasskey");
    await signedInName();
    h.expect(passkeyCalls.some((p) => p.endsWith("/authentication/verify")), "assertion verified with Supabase");
    h.expect(!(await page.isVisible(".auth-modal.open")), "dialog closed");

    h.step("face: enrolling asks for the PIN first; a wrong PIN saves nothing");
    await page.waitForSelector("#faceScan", { timeout: 15000 });
    await page.evaluate((face) => { window.__faceStub = { face }; }, myFace);
    await page.click("#faceScan");
    await page.waitForSelector(".auth-modal.open #authCurrent", { timeout: 8000 });
    h.expect(!(await page.$(".auth-modal.open .face-cam")), "no camera before the PIN");
    await page.fill("#authCurrent", WRONG_PIN);
    await page.click("#reauthGo");
    await waitMsg(/stëmmt net/);
    h.eq(faceCalls("enroll").length, 0, "wrong PIN: no enroll call");
    h.eq(await stored(), null, "wrong PIN: nothing saved here");

    h.step("face: right PIN → scan → saved here; the server re-checks the PIN at enrol");
    await page.fill("#authCurrent", PIN);
    await page.click("#reauthGo");
    await page.waitForSelector(".auth-modal.open .face-cam", { timeout: 8000 });
    await waitMsg(/Fäerdeg/);
    const saved = await stored();
    const enrollCall = faceCalls("enroll").at(-1)?.body;
    h.eq(saved?.v, 2, "store format v2");
    h.eq(saved?.accounts?.map((a) => [a.userId, a.username, a.deviceId, a.secret]), [[ME, ME_NAME, enrollCall && [...srv.devices.keys()][0], srv.devices.values().next().value?.secret]], "device key + name saved locally");
    h.eq(saved?.accounts?.[0]?.face?.length, 128, "face template saved locally");
    h.eq(Object.keys(enrollCall || {}).sort(), ["action", "credential", "name"], "enroll sends PIN + device name, no face data");
    h.eq(enrollCall?.credential, PIN, "enroll carries the PIN for the server check");
    await page.waitForSelector("#faceList [data-face]", { timeout: 8000 });
    h.expect(/Dësen Apparat/.test(await page.textContent("#faceList")), "device list marks this device");
    await page.$eval("#quickCard", (el) => el.scrollIntoView());
    await h.shot("profile-card");
    const firstSecret = saved.accounts[0].secret;
    const deviceId = saved.accounts[0].deviceId;

    h.step("face: login rotates the device key every time");
    await signOut();
    await faceLoginFromDialog();
    await waitMsg(/Moien/);
    await signedInName();
    const login1 = faceCalls("login").at(-1)?.body;
    h.eq(login1, { action: "login", deviceId, secret: firstSecret }, "auth-face login sends only the device key");
    const secret2 = (await stored())?.accounts?.[0]?.secret;
    h.expect(secret2 && secret2 !== firstSecret, "new device key saved after the login");
    h.eq(secret2, srv.devices.get(deviceId)?.secret, "saved key = the server's current key");
    await signOut();
    await faceLoginFromDialog();
    await waitMsg(/Moien/);
    await signedInName();
    h.eq(faceCalls("login").at(-1)?.body?.secret, secret2, "second login uses the rotated key");
    h.expect((await stored())?.accounts?.[0]?.secret !== secret2, "rotated again");

    h.step("face: a replayed old key revokes the device → clear message, PIN works");
    await signOut();
    await page.evaluate(([key, secret]) => {
      const store = JSON.parse(localStorage.getItem(key));
      store.accounts[0].secret = secret;   // what a copied-away old key looks like
      localStorage.setItem(key, JSON.stringify(store));
    }, [FACE_KEY, firstSecret]);
    await faceLoginFromDialog();
    await waitMsg(/Aus Sécherheet/);
    h.expect(!srv.devices.has(deviceId), "server deleted the device");
    h.eq((await stored())?.accounts?.length ?? 0, 0, "revoked face dropped here");
    await h.shot("face-revoked");
    await backToPinWorks("after a revoked device");

    h.step("face: a face saved by v1 asks for a new scan without calling the server");
    await page.evaluate(([key, entry]) => localStorage.setItem(key, JSON.stringify({ v: 1, accounts: [entry] })),
      [FACE_KEY, { userId: ME, username: ME_NAME, deviceId: OLD_DEVICE, secret: "A".repeat(43), face: myFace }]);
    await goto("/profile.html");
    await page.waitForSelector("#faceScan", { timeout: 15000 });
    await waitMsg(/méi sécher/, "quickMsg");
    h.eq((await page.textContent("#faceScan")).trim(), "Gesiicht nei scannen", "profile offers «Gesiicht nei scannen»");
    await signOut();
    const loginsBeforeV1 = faceCalls("login").length;
    await faceLoginFromDialog();
    await waitMsg(/méi sécher/);
    h.eq(faceCalls("login").length, loginsBeforeV1, "no server call for a v1 key");
    h.eq((await stored())?.accounts?.length ?? 0, 0, "v1 entry dropped");
    await backToPinWorks("after a v1 face");

    h.step("face: re-enrol, then someone else → not recognised, back to the PIN with the name kept");
    await page.waitForSelector("#faceScan", { timeout: 15000 });
    await page.evaluate((face) => { window.__faceStub = { face }; }, myFace);
    await page.click("#faceScan");
    await page.fill("#authCurrent", PIN);
    await page.click("#reauthGo");
    await waitMsg(/Fäerdeg/);
    await signOut();
    await openLogin();
    await page.fill("#authIdentifier", ME_NAME);
    await page.evaluate((face) => { window.__faceStub = { face }; }, otherFace);
    const loginsBefore = faceCalls("login").length;
    await page.click("#authFace");
    await waitMsg(/net erkannt/);
    h.eq(faceCalls("login").length, loginsBefore, "no server call without a match");
    h.expect(await page.isVisible("#faceRetry"), "«Nach eng Kéier» offered");
    await h.shot("face-nomatch");
    await page.click("#faceBack");
    await page.waitForSelector("#authPinHost .pin-box", { timeout: 5000 });
    h.eq(await page.inputValue("#authIdentifier"), ME_NAME, "username still filled in");

    h.step("face: camera blocked → clear message");
    await page.evaluate(() => { window.__faceStub = { error: "camera_denied" }; });
    await page.click("#authFace");
    await waitMsg(/Kamera ass blockéiert/);
    await page.click("#faceBack");

    h.step("face: unused for 60 days → expired message, PIN still there");
    srv.expireNext = true;
    await page.evaluate((face) => { window.__faceStub = { face }; }, myFace);
    await page.click("#authFace");
    await waitMsg(/60 Deeg/);
    h.eq((await stored())?.accounts?.length ?? 0, 0, "expired face dropped here");
    await backToPinWorks("after an expired face");

    h.step("profile: device list with «Läschen» and «All Gesiichter ofmellen»");
    await page.evaluate((face) => { window.__faceStub = { face }; }, myFace);
    await page.click("#faceScan");
    await page.fill("#authCurrent", PIN);
    await page.click("#reauthGo");
    await waitMsg(/Fäerdeg/);
    const otherDevice = srv.add("iPad · Safari");
    srv.add("Someone else's iPad", "22222222-2222-4222-8222-222222222222");
    await goto("/profile.html");
    await page.waitForSelector("#faceList [data-face]", { timeout: 15000 });
    h.eq(await page.$$eval("#faceList li", (rows) => rows.length), 2, "two own face devices listed (not other people's)");
    const deleteCallsBefore = backend.callsTo("face_device_delete").length;
    await page.click(`#faceList [data-face="${otherDevice}"]`);
    await waitMsg(/ofgemellt ✓/, "quickMsg");
    h.eq(backend.callsTo("face_device_delete").slice(deleteCallsBefore).map((c) => c.body), [{ p_id: otherDevice }], "delete sends only the device id (server checks the owner)");
    h.eq(await page.$$eval("#faceList li", (rows) => rows.length), 1, "one left");
    h.expect((await stored())?.accounts?.length === 1, "this device's face untouched");
    await page.click(`#pkList [data-pk="pk1"]`);
    await waitMsg(/Passkey geläscht/, "quickMsg");
    h.expect(passkeyCalls.includes("DELETE /auth/v1/passkeys/pk1"), "passkey deleted with Supabase");
    h.expect(!(await page.$("#pkList")), "passkey list gone");
    await page.click("#faceAllOff");
    await waitMsg(/All Gesiichter ofgemellt/, "quickMsg");
    h.eq(backend.callsTo("face_devices_forget_all").length, 1, "face_devices_forget_all called");
    h.eq((await stored())?.accounts?.length ?? 0, 0, "face dropped here too");
    h.expect(!(await page.$("#faceList")), "face list gone");
    h.expect(srv.devices.size === 1, "other people's devices untouched");
    h.expect(dialogs.length === 3 && dialogs.every((text) => /\?/.test(text)), "every delete asked first");

    h.step("admin: no face option on the profile, server refuses enrol and login, PIN works");
    srv.admin = true;
    await goto("/profile.html");
    await page.waitForSelector("#pkAdd", { timeout: 15000 });
    await waitMsg(/Admin-Konten/, "quickMsg");
    h.expect(!(await page.$("#faceScan")), "no «Gesiicht scannen» for admins");
    h.expect(Boolean(await page.$("#pkAdd")), "Face ID (passkey) still offered");
    const adminEnroll = await page.evaluate(async () => {
      const { data, error } = await window.__pbAuth.sb.functions.invoke("auth-face", { body: { action: "enroll", credential: "4821", name: "x" } });
      return { data, status: error?.context?.status, body: error ? await error.context.json() : null };
    });
    h.eq([adminEnroll.status, adminEnroll.body?.error], [403, "admin_forbidden"], "server refuses enrolling an admin");
    // a face saved before the account became admin
    const adminDevice = srv.add("iPad");
    await page.evaluate(([key, entry]) => localStorage.setItem(key, JSON.stringify({ v: 2, accounts: [entry] })),
      [FACE_KEY, { userId: ME, username: ME_NAME, deviceId: adminDevice, secret: srv.devices.get(adminDevice).secret, face: myFace }]);
    await signOut();
    await faceLoginFromDialog();
    await waitMsg(/Admin-Konten/);
    h.expect(!srv.devices.has(adminDevice), "admin device deleted by the server");
    h.eq((await stored())?.accounts?.length ?? 0, 0, "admin face dropped here");
    await backToPinWorks("admin refused");
    srv.admin = false;

    h.step("real matcher: picks the closest face, rejects far ones");
    const match = await page.evaluate(async ([mine, other]) => {
      const m = await import("/face-scan.js?v=real");
      const near = mine.map((v) => v + 0.02);   // ≈ 0.23 away
      return {
        near: m.matchFace(near, [{ id: "o", face: other }, { id: "me", face: mine }])?.candidate.id || null,
        far: m.matchFace(other, [{ id: "me", face: mine }]),
        threshold: m.MATCH_DISTANCE,
      };
    }, [myFace, otherFace]);
    h.eq(match, { near: "me", far: null, threshold: 0.45 }, "matchFace: near → me, far → null");

    h.step("face-api is self-hosted: same-origin files, no CDN");
    const hosted = await page.evaluate(async () => {
      const urls = ["/assets/face/1.7.15/face-api.esm.js", "/assets/face/1.7.15/model/tiny_face_detector_model-weights_manifest.json",
        "/assets/face/1.7.15/model/face_landmark_68_tiny_model.bin", "/assets/face/1.7.15/model/face_recognition_model.bin"];
      return Promise.all(urls.map(async (url) => (await fetch(url, { method: "HEAD" })).ok));
    });
    h.eq(hosted, [true, true, true, true], "face-api + models served by the site");
    const source = await page.evaluate(async () => (await fetch("/face-scan.js?v=real")).text());
    h.expect(!/jsdelivr|unpkg|esm\.sh/.test(source) && /assets\/face\/1\.7\.15\//.test(source), "face-scan.js loads from assets/face/1.7.15/");

    h.step("no English, no console errors, no sideways scroll on a phone");
    await signInDirect();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.$eval("#quickCard", (el) => el.scrollIntoView());
    h.expect(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "375 px profile: no horizontal scroll");
    await signOut();
    await openLogin();
    h.expect(!ENGLISH.test(await page.evaluate(() => document.body.innerText)), "no English UI text");
    h.expect(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "375 px: no horizontal scroll");
    await h.shot("phone");
    h.eq(errors, [], "no console errors");
  },
};

/* The harness keeps a signed-in session in this exact shape; reuse it. */
async function sessionJson() {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: ME, role: "authenticated", exp: now + 86400, aud: "authenticated" })).toString("base64url");
  return JSON.stringify({ access_token: `e30.${payload}.sig`, refresh_token: "refresh-mock", token_type: "bearer", expires_in: 86400, expires_at: now + 86400,
    user: { id: ME, aud: "authenticated", role: "authenticated", email: "tester@example.test", user_metadata: { username: ME_NAME }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" } });
}

runIfMain(import.meta.url, flow);
