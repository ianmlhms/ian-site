// Re-auth for auth-face: the signed-in player types their PIN (or, on an old
// account, the password) again before a face device is created or a passkey is
// registered, so a minute on someone's unlocked iPad is not enough to plant a
// permanent way back in. Same rules as auth-pin's "change PIN" proof:
// wrong answers count towards the PIN lockout, a locked PIN refuses.
import { isLocked, loginPinValid } from "../auth-pin/logic.ts";
import {
  accountFromUser,
  AuthUser,
  failAccount,
  isLegacy,
  passwordSession,
  pinRecord,
  resetAccount,
  verifyPin,
} from "../auth-pin/service.ts";

export type ReauthResult = "ok" | "wrong" | "locked" | "unavailable";

export async function reauthenticate(
  user: AuthUser,
  credential: string,
): Promise<ReauthResult> {
  const account = accountFromUser(user);
  if (!account) return "unavailable";
  if (!credential) return "wrong";
  const record = await pinRecord(user.id);
  if (record === undefined) return "unavailable";
  if (record && isLocked(record)) return "locked";
  let valid = false;
  if (record && loginPinValid(credential)) {
    valid = await verifyPin(user.id, credential);
  }
  // The password only counts for accounts that still have one the player knows:
  // old (pre-PIN) accounts, or an account that never set a PIN.
  if (!valid && (!record || await isLegacy(account))) {
    valid = Boolean(await passwordSession(account, credential));
  }
  if (record) {
    if (valid) await resetAccount(user.id);
    else await failAccount(user.id);
  }
  return valid ? "ok" : "wrong";
}
