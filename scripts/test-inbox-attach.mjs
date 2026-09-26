import assert from "node:assert/strict";
import {
  MAX_ATTACHMENT_BYTES,
  buildOutboxPath,
  isAttachmentSizeAllowed,
  safeFileName,
} from "../inbox-attach.js";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

assert.equal(safeFileName("Vakanz Foto 2026.jpg"), "Vakanz_Foto_2026.jpg");
assert.equal(safeFileName("déjà___vu!!.png"), "d_j_vu_.png");
assert.equal(safeFileName(""), "file");
assert.equal(safeFileName("?*"), "file");

const longName = `${"a".repeat(100)}.jpeg`;
assert.equal(safeFileName(longName).length, 80);
assert.ok(safeFileName(longName).endsWith(".jpeg"));

assert.equal(
  buildOutboxPath(UUID.toUpperCase(), "eng Foto.jpg"),
  `outbox/${UUID}/eng_Foto.jpg`,
);
assert.throws(() => buildOutboxPath("not-a-uuid", "file.pdf"), /Upload-ID/);

assert.equal(isAttachmentSizeAllowed(MAX_ATTACHMENT_BYTES), true);
assert.equal(isAttachmentSizeAllowed(MAX_ATTACHMENT_BYTES + 1), false);
assert.equal(isAttachmentSizeAllowed(-1), false);

console.log("inbox attachment helpers: ok");
