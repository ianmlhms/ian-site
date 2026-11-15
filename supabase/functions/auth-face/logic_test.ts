import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  deviceProof,
  devicesToDrop,
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
  assert(sameDigest(first, first));
  assert(!sameDigest(first, await hashSecret(newSecret())));
  assert(!sameDigest(first, first.slice(1)));
});

Deno.test("oldest devices drop so a new one fits", () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({
    id: `d${index}`,
    created_at: new Date(2026, 0, 8 - index).toISOString(),
  }));
  assertEquals(devicesToDrop(rows), ["d7"]);
  assertEquals(devicesToDrop(rows.slice(0, 3)), []);
  assertEquals(devicesToDrop(rows, 3), ["d7", "d6", "d5", "d4", "d3", "d2"]);
});

Deno.test("kart accounts are recognised", () => {
  assert(isKartUser({ user_metadata: { account_kind: "kart" } }));
  assert(!isKartUser({ user_metadata: {} }));
  assert(!isKartUser(null));
});
