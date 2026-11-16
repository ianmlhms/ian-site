import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  checkError,
  credentialFrom,
  DEVICE_NAME_MAX,
  deviceName,
  deviceProof,
  hashSecret,
  isKartUser,
  newSecret,
  normalizeAction,
  sameDigest,
} from "./logic.ts";

const ID = "3f2b8c1e-9a4d-4e2f-8b6a-1c2d3e4f5a6b";

Deno.test("actions", () => {
  assertEquals(normalizeAction("login"), "login");
  assertEquals(normalizeAction("enroll"), "enroll");
  assertEquals(normalizeAction("reauth"), "reauth");
  assertEquals(normalizeAction("forget"), "forget");
  assertEquals(normalizeAction("admin"), "");
  assertEquals(normalizeAction(undefined), "");
});

Deno.test("new secrets have the accepted shape and differ", () => {
  const first = newSecret();
  const second = newSecret();
  assert(first !== second);
  assert(deviceProof({ deviceId: ID, secret: first }));
});

Deno.test("device proof rejects malformed input", () => {
  const secret = newSecret();
  assertEquals(deviceProof({ deviceId: "x", secret }), null);
  assertEquals(deviceProof({ deviceId: ID, secret: "short" }), null);
  assertEquals(deviceProof({ deviceId: ID, secret: 5 }), null);
  assertEquals(deviceProof({}), null);
  assertEquals(
    deviceProof({ deviceId: ID.toUpperCase(), secret })?.deviceId,
    ID,
  );
});

Deno.test("hash is stable and compared in full", async () => {
  const secret = newSecret();
  const first = await hashSecret(secret);
  assertEquals(first, await hashSecret(secret));
  assert(/^[0-9a-f]{64}$/.test(first));
  assert(sameDigest(first, first));
  assert(!sameDigest(first, await hashSecret(newSecret())));
  assert(!sameDigest(first, first.slice(1)));
});

Deno.test("check results map to browser error codes", () => {
  assertEquals(checkError("unknown"), "invalid_login");
  assertEquals(checkError("replayed"), "device_revoked");
  assertEquals(checkError("expired"), "expired");
  assertEquals(checkError("reenroll"), "reenroll");
  assertEquals(checkError("admin"), "admin_forbidden");
  assertEquals(checkError("toString"), "invalid_login");
  assertEquals(checkError(undefined), "invalid_login");
});

Deno.test("credential is a trimmed string or empty", () => {
  assertEquals(credentialFrom({ credential: " 4821 " }), "4821");
  assertEquals(credentialFrom({ credential: 4821 }), "");
  assertEquals(credentialFrom({}), "");
  assertEquals(credentialFrom({ credential: "x".repeat(2000) }).length, 1024);
});

Deno.test("device names are short and harmless", () => {
  assertEquals(deviceName("iPad · Safari"), "iPad · Safari");
  assertEquals(deviceName("<img src=x>\n\tiPad"), "img src=x iPad");
  assertEquals(deviceName("   "), "Apparat");
  assertEquals(deviceName(42), "Apparat");
  assertEquals(deviceName("a".repeat(100)).length, DEVICE_NAME_MAX);
});

Deno.test("kart accounts are recognised", () => {
  assert(isKartUser({ user_metadata: { account_kind: "kart" } }));
  assert(!isKartUser({ user_metadata: {} }));
  assert(!isKartUser(null));
});
