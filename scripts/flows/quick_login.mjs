/* Flow — Face ID (passkey) + "Mam Gesiicht aloggen" (Nov 2026).
 * Passkeys use Chromium's virtual WebAuthn authenticator (CDP) against mocked
 * /auth/v1/passkeys/* endpoints. The face scan's camera + ML part
 * (face-scan.js?v=1) is replaced by a stub that returns a chosen face template;
 * the real matcher (matchFace) is still used. Checks that every failure leaves
 * the normal PIN login working, which is the one thing that must never break. */
import { runIfMain, ME, ME_NAME } from "./lib.mjs";

const SESSION_KEY = "sb-lvksqmgfwkfbblfsozfk-auth-token";
const FACE_KEY = "ianlu-face-v1";
const DEVICE_ID = "3f2b8c1e-9a4d-4e2f-8b6a-1c2d3e4f5a6b";
const SECRET = "A".repeat(43);
const PIN = "4821";
const myFace = Array.from({ length: 128 }, (_, i) => Number((Math.sin(i) * 0.1).toFixed(5)));
const otherFace = myFace.map((v) => Number((v + 0.08).toFixed(5)));   // distance ≈ 0.9

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

const ENGLISH = /Sign in with|Face scan|Try again|Passkey failed/;

function b64url(text) {
  return Buffer.from(text).toString("base64url");
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

    /* ---------- mocks ---------- */
    let faceLoginStatus = 200;
    backend.functions["auth-face"] = (body) => {
      if (body?.action === "enroll") return { deviceId: DEVICE_ID, secret: SECRET };
      if (body?.action === "forget") return { ok: true };
      return { hashed_token: "face-hash" };
    };
    // auth-face login answers 401 on demand (a device key the server no longer knows)
    await context.route(/\/functions\/v1\/auth-face$/, async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      if (body.action === "login" && faceLoginStatus !== 200) {
        backend.calls.push({ kind: "function", name: "auth-face", body });
        return route.fulfill({ status: faceLoginStatus, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "invalid_login" }) });
      }
      return route.fallback();
    });
    await context.route(/face-scan\.js\?v=1$/, (route) =>
      route.fulfill({ contentType: "application/javascript", body: FACE_STUB }));
    const passkeyCalls = [];
    await context.route(/\/auth\/v1\/passkeys\//, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const rpId = new URL(page.url()).hostname;
      passkeyCalls.push(url.pathname);
      const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
      const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify(data) });
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
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
      if (url.pathname.endsWith("/registration/verify")) return json({ id: "pk1", created_at: new Date().toISOString() });
      if (url.pathname.endsWith("/authentication/verify")) {
        const now = Math.floor(Date.now() / 1000);
        const payload = b64url(JSON.stringify({ sub: ME, role: "authenticated", exp: now + 86400, aud: "authenticated" }));
        return json({ access_token: `e30.${payload}.sig`, refresh_token: "r", token_type: "bearer", expires_in: 86400, expires_at: now + 86400,
          user: { id: ME, aud: "authenticated", email: "tester@example.test", user_metadata: { username: ME_NAME }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" } });
      }
      return json([]);   // GET /passkeys/ (list)
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
    const openLogin = async () => {
      await page.click("#gtAcct");
      await page.waitForSelector(".auth-modal.open #authIdentifier", { timeout: 8000 });
    };
    const signedInName = () => page.waitForFunction((name) => document.getElementById("gtAcct")?.textContent === name, ME_NAME, { timeout: 8000 });
    const msg = () => page.textContent("#authMsg");

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
    await page.waitForFunction(() => /PIN/.test(document.getElementById("authMsg")?.textContent || ""), null, { timeout: 8000 });
    h.expect(/Face ID ofgebrach/.test(await msg()), "cancel message in Luxembourgish");
    h.eq(await page.inputValue("#authIdentifier"), ME_NAME, "typed username kept");
    h.expect(await page.isVisible(".auth-modal.open"), "dialog stays open for the PIN");

    h.step("…and the normal PIN login still works right after");
    const boxes = await page.$$("#authPinHost .pin-box");
    for (let i = 0; i < boxes.length; i += 1) await boxes[i].type(PIN[i]);
    await signedInName();
    const pinLogin = backend.callsTo("auth-pin").filter((c) => c.body?.action === "login").at(-1)?.body;
    h.eq(pinLogin, { action: "login", identifier: ME_NAME, pin: PIN }, "auth-pin login sent");
    await signOut();

    h.step("passkey: register on the profile (virtual authenticator) …");
    await page.evaluate(() => { delete navigator.credentials.get; });
    await cdp.send("WebAuthn.setUserVerified", { authenticatorId, isUserVerified: true });
    await page.evaluate(([key, session]) => localStorage.setItem(key, session), [SESSION_KEY, await sessionJson(page)]);
    await goto("/profile.html");
    await page.waitForSelector("#pkAdd", { timeout: 15000 });
    h.eq((await page.textContent("#pkAdd")).trim(), "Face ID aschalten", "profile: «Face ID aschalten»");
    h.eq((await page.textContent("#faceScan")).trim(), "Gesiicht scannen", "profile: «Gesiicht scannen»");
    await page.click("#pkAdd");
    await page.waitForFunction(() => /Face ID ass un/.test(document.getElementById("quickMsg")?.textContent || ""), null, { timeout: 8000 });
    h.expect(passkeyCalls.some((p) => p.endsWith("/registration/verify")), "registration verified with Supabase");
    const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
    h.eq(credentials.length, 1, "one passkey on the authenticator");

    h.step("… then «Mat Face ID aloggen» signs in");
    await signOut();
    await openLogin();
    await page.click("#authPasskey");
    await signedInName();
    h.expect(passkeyCalls.some((p) => p.endsWith("/authentication/verify")), "assertion verified with Supabase");
    h.expect(!(await page.isVisible(".auth-modal.open")), "dialog closed");

    h.step("face: scan on the profile saves it on this device only");
    await page.waitForSelector("#faceScan", { timeout: 15000 });
    await page.evaluate((face) => { window.__faceStub = { face }; }, myFace);
    await page.click("#faceScan");
    await page.waitForSelector(".auth-modal.open .face-cam", { timeout: 8000 });
    await page.waitForFunction(() => /Fäerdeg/.test(document.getElementById("authMsg")?.textContent || ""), null, { timeout: 8000 });
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), FACE_KEY);
    h.eq(saved?.accounts?.map((a) => [a.userId, a.username, a.deviceId, a.secret]), [[ME, ME_NAME, DEVICE_ID, SECRET]], "device key + name saved locally");
    h.eq(saved?.accounts?.[0]?.face?.length, 128, "face template saved locally");
    const enrollCall = backend.callsTo("auth-face").find((c) => c.body?.action === "enroll");
    h.eq(enrollCall?.body, { action: "enroll" }, "server only gets «enroll» (no face data)");
    await page.waitForSelector("#faceOff", { timeout: 8000 });
    h.expect(/Gesiicht ass op dësem Apparat/.test(await page.textContent("#quickMsg")), "profile says the face is saved here");
    await page.$eval("#quickCard", (el) => el.scrollIntoView());
    await h.shot("profile-card");

    h.step("face: login from the dialog");
    await signOut();
    await openLogin();
    h.eq((await page.textContent("#authFace")).trim(), "Mam Gesiicht aloggen", "«Mam Gesiicht aloggen» button");
    await page.evaluate((face) => { window.__faceStub = { face }; }, myFace);
    await page.click("#authFace");
    await page.waitForFunction(() => /Moien/.test(document.getElementById("authMsg")?.textContent || ""), null, { timeout: 8000 });
    await signedInName();
    const faceLogin = backend.callsTo("auth-face").filter((c) => c.body?.action === "login").at(-1)?.body;
    h.eq(faceLogin, { action: "login", deviceId: DEVICE_ID, secret: SECRET }, "auth-face login sends only the device key");

    h.step("face: someone else → not recognised, back to the PIN with the name kept");
    await signOut();
    await openLogin();
    await page.fill("#authIdentifier", ME_NAME);
    await page.evaluate((face) => { window.__faceStub = { face }; }, otherFace);
    const loginsBefore = backend.callsTo("auth-face").filter((c) => c.body?.action === "login").length;
    await page.click("#authFace");
    await page.waitForFunction(() => /net erkannt/.test(document.getElementById("authMsg")?.textContent || ""), null, { timeout: 8000 });
    h.eq(backend.callsTo("auth-face").filter((c) => c.body?.action === "login").length, loginsBefore, "no server call without a match");
    h.expect(await page.isVisible("#faceRetry"), "«Nach eng Kéier» offered");
    await h.shot("face-nomatch");
    await page.click("#faceBack");
    await page.waitForSelector("#authPinHost .pin-box", { timeout: 5000 });
    h.eq(await page.inputValue("#authIdentifier"), ME_NAME, "username still filled in");

    h.step("face: camera blocked → clear message");
    await page.evaluate(() => { window.__faceStub = { error: "camera_denied" }; });
    await page.click("#authFace");
    await page.waitForFunction(() => /Kamera ass blockéiert/.test(document.getElementById("authMsg")?.textContent || ""), null, { timeout: 8000 });
    await page.click("#faceBack");

    h.step("face: server no longer knows the key → face forgotten here, PIN still there");
    faceLoginStatus = 401;
    await page.evaluate((face) => { window.__faceStub = { face }; }, myFace);
    await page.click("#authFace");
    await page.waitForFunction(() => /net méi aktiv/.test(document.getElementById("authMsg")?.textContent || ""), null, { timeout: 8000 });
    const after = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), FACE_KEY);
    h.eq(after?.accounts?.length ?? 0, 0, "stale face entry dropped");
    await page.click("#faceBack");
    await page.waitForSelector("#authPinHost .pin-box", { timeout: 5000 });
    h.expect(!(await page.$("#authFace")), "face button gone once nothing is saved");
    faceLoginStatus = 200;

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

    h.step("no English, no console errors, no sideways scroll on a phone");
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForSelector(".auth-modal.open #authIdentifier", { timeout: 5000 });   // still open from the step above
    h.expect(!ENGLISH.test(await page.evaluate(() => document.body.innerText)), "no English UI text");
    h.expect(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), "375 px: no horizontal scroll");
    await h.shot("phone");
    h.eq(errors, [], "no console errors");
  },
};

/* The harness keeps a signed-in session in this exact shape; reuse it. */
async function sessionJson(page) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: ME, role: "authenticated", exp: now + 86400, aud: "authenticated" })).toString("base64url");
  return JSON.stringify({ access_token: `e30.${payload}.sig`, refresh_token: "refresh-mock", token_type: "bearer", expires_in: 86400, expires_at: now + 86400,
    user: { id: ME, aud: "authenticated", role: "authenticated", email: "tester@example.test", user_metadata: { username: ME_NAME }, app_metadata: {}, created_at: "2026-01-01T00:00:00Z" } });
}

runIfMain(import.meta.url, flow);
