import {
  LOGIN_ERROR,
  isLocked,
  isPinLength,
  lockoutSeconds,
  loginPayload,
  loginPinValid,
  normalizeAction,
  normalizeIdentifier,
  sameErrorShape,
  uniformLoginError,
  validPin,
} from "./logic.ts";

function assert(
  condition: unknown,
  message = "assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(
  actual: unknown,
  expected: unknown,
): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left === right) return;
  throw new Error(`${left} !== ${right}`);
}

Deno.test("identifier normalization", () => {
  equal(
    normalizeIdentifier("  Ian_User  "),
    "ian_user",
  );
  equal(
    normalizeIdentifier(" IAN@EXAMPLE.COM "),
    "ian@example.com",
  );
  equal(normalizeIdentifier(null), "");
  equal(normalizeIdentifier(42), "");
});

Deno.test("identifier length is bounded", () => {
  const longIdentifier = "a".repeat(300);
  equal(normalizeIdentifier(longIdentifier).length, 254);
});

Deno.test("actions are allowlisted", () => {
  equal(normalizeAction("login"), "login");
  equal(normalizeAction("set"), "set");
  equal(normalizeAction("status"), "status");
  equal(normalizeAction("admin-reset"), "admin-reset");
  equal(normalizeAction("delete"), "");
});

Deno.test("PIN lengths are exact", () => {
  assert(isPinLength(4));
  assert(isPinLength(6));
  assert(!isPinLength(5));
  assert(!isPinLength("4"));
});

Deno.test("PIN validation is length + digits only", () => {
  assert(validPin("4826", 4));
  assert(validPin("482605", 6));
  assert(validPin("1234", 4));
  assert(validPin("000000", 6));
  assert(!validPin("4826", 6));
  assert(!validPin("48a6", 4));
});

Deno.test("login accepts any digit PIN", () => {
  assert(loginPinValid("1234"));
  assert(loginPinValid("123456"));
  assert(!loginPinValid("12345"));
  assert(!loginPinValid("12a4"));
  assert(!loginPinValid("1".repeat(1000)));
});

Deno.test("four-digit lockout escalates", () => {
  equal(lockoutSeconds(1, 4), 0);
  equal(lockoutSeconds(2, 4), 0);
  equal(lockoutSeconds(3, 4), 60);
  equal(lockoutSeconds(6, 4), 300);
  equal(lockoutSeconds(9, 4), 1800);
  equal(lockoutSeconds(12, 4), 1800);
});

Deno.test("six-digit lockout escalates", () => {
  equal(lockoutSeconds(4, 6), 0);
  equal(lockoutSeconds(5, 6), 60);
  equal(lockoutSeconds(10, 6), 300);
  equal(lockoutSeconds(15, 6), 1800);
});

Deno.test("lock timestamp is enforced", () => {
  const future = new Date(20_000).toISOString();
  const past = new Date(5_000).toISOString();
  const base = {
    pin_length: 4,
    failed_attempts: 3,
  };
  assert(isLocked({ ...base, locked_until: future }, 10_000));
  assert(!isLocked({ ...base, locked_until: past }, 10_000));
});

Deno.test("login payload is normalized", () => {
  equal(
    loginPayload({ identifier: " Ian ", pin: "4826" }),
    { identifier: "ian", pin: "4826" },
  );
  equal(loginPayload({ identifier: "" }), null);
});

Deno.test("unknown and wrong users share an error", () => {
  const noSuchUser = uniformLoginError();
  const wrongPin = uniformLoginError();
  assert(sameErrorShape(noSuchUser, wrongPin));
  equal(noSuchUser, LOGIN_ERROR);
  equal(Object.keys(noSuchUser), ["error"]);
});
