// Builds the outbox row for a reply. Shared by both inbox backends so the
// recipient and subject rules cannot drift apart.
function replySubject(subject) {
  const clean = (subject || "").trim();
  if (!clean) return "Re:";
  return /^re\s*:/i.test(clean) ? clean : `Re: ${clean}`;
}

export function buildMailReply(message, body) {
  const recipient = message.is_from_me
    ? (message.to_addrs || [])[0]
    : message.from_addr;
  if (!recipient) throw new Error("Keng Adress fir ze äntweren.");
  return Object.freeze({
    account_id: message.account_id,
    to_addrs: [recipient],
    subject: replySubject(message.subject),
    body,
    in_reply_to: message.rfc_message_id || null,
    reply_refs: message.rfc_message_id ? [message.rfc_message_id] : [],
  });
}
