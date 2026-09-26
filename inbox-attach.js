export const MAX_ATTACHMENT_BYTES = 64 * 1024 * 1024;

const MAX_FILE_NAME_LENGTH = 80;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function sanitiseNamePart(value) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_");
}

export function safeFileName(name) {
  const sanitised = sanitiseNamePart(String(name || "").trim());
  if (!sanitised || !/[A-Za-z0-9]/.test(sanitised)) return "file";
  if (sanitised.length <= MAX_FILE_NAME_LENGTH) return sanitised;

  const extensionAt = sanitised.lastIndexOf(".");
  const hasExtension = extensionAt > 0 && extensionAt < sanitised.length - 1;
  if (!hasExtension) return sanitised.slice(0, MAX_FILE_NAME_LENGTH);

  const extension = sanitised.slice(extensionAt);
  if (extension.length >= MAX_FILE_NAME_LENGTH) {
    return sanitised.slice(0, MAX_FILE_NAME_LENGTH);
  }
  return `${sanitised.slice(0, MAX_FILE_NAME_LENGTH - extension.length)}${extension}`;
}

export function buildOutboxPath(uuid, fileName) {
  const lowerUuid = String(uuid || "").toLowerCase();
  if (!UUID_V4_PATTERN.test(lowerUuid)) throw new Error("Ongëlteg Upload-ID.");
  return `outbox/${lowerUuid}/${safeFileName(fileName)}`;
}

export function isAttachmentSizeAllowed(size) {
  return Number.isFinite(size) && size >= 0 && size <= MAX_ATTACHMENT_BYTES;
}
