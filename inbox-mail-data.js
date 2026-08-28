const MAIL_LIST_LIMIT = 300;
const THREAD_LIMIT = 50;
const SEARCH_LIMIT = 100;
const SIGNED_URL_SECONDS = 60 * 60;

const MAIL_COLUMNS = "id,account_id,folder,uid,rfc_message_id,thread_key,in_reply_to," +
  "subject,from_name,from_addr,to_addrs,cc_addrs,sent_at,snippet,body_text," +
  "body_html_path,has_attachments,is_read,is_flagged,is_from_me,is_bulk";

function mailError(message, error) {
  const detail = error?.message ? ` (${error.message})` : "";
  return new Error(message + detail);
}

export async function fetchMailAccounts(supabase) {
  const { data, error } = await supabase
    .from("bridge_mail_accounts")
    .select("id,label,address,provider,aliases,enabled,status,last_seen_at,error")
    .order("id");
  if (error) throw mailError("D'Mail-Kontoen konnten net geluede ginn.", error);
  return data || [];
}

export async function fetchMailMessages(supabase) {
  const { data, error } = await supabase
    .from("bridge_mail_messages")
    .select(MAIL_COLUMNS)
    .order("sent_at", { ascending: false })
    .limit(MAIL_LIST_LIMIT);
  if (error) throw mailError("D'Mailen konnten net geluede ginn.", error);
  return data || [];
}

export async function fetchMailThread(supabase, threadKey) {
  if (!threadKey) return [];
  const { data, error } = await supabase
    .from("bridge_mail_messages")
    .select(MAIL_COLUMNS)
    .eq("thread_key", threadKey)
    .order("sent_at", { ascending: true })
    .limit(THREAD_LIMIT);
  if (error) throw mailError("De Mail-Verlaf konnt net geluede ginn.", error);
  return data || [];
}

export async function fetchMailAttachments(supabase, messageId) {
  const { data, error } = await supabase
    .from("bridge_mail_attachments")
    .select("id,message_id,part_index,filename,mime_type,size_bytes,storage_path,state")
    .eq("message_id", messageId)
    .order("part_index");
  if (error) throw mailError("D'Unhäng konnten net geluede ginn.", error);
  return data || [];
}

function ilikePattern(term) {
  const escaped = term.replace(/[\\%_]/g, (character) => `\\${character}`);
  return `%${escaped}%`;
}

export async function searchMail(supabase, term) {
  const pattern = ilikePattern(term);
  const { data, error } = await supabase
    .from("bridge_mail_messages")
    .select(MAIL_COLUMNS)
    .or(`subject.ilike.${pattern},from_addr.ilike.${pattern},from_name.ilike.${pattern},snippet.ilike.${pattern}`)
    .order("sent_at", { ascending: false })
    .limit(SEARCH_LIMIT);
  if (error) throw mailError("D'Mail-Sich konnt net ausgeféiert ginn.", error);
  return data || [];
}

function replySubject(subject) {
  const clean = (subject || "").trim();
  if (!clean) return "Re:";
  return /^re\s*:/i.test(clean) ? clean : `Re: ${clean}`;
}

export async function queueMailReply(supabase, message, body) {
  const recipient = message.is_from_me
    ? (message.to_addrs || [])[0]
    : message.from_addr;
  if (!recipient) throw new Error("Keng Adress fir ze äntweren.");
  const row = Object.freeze({
    account_id: message.account_id,
    to_addrs: [recipient],
    subject: replySubject(message.subject),
    body,
    in_reply_to: message.rfc_message_id || null,
    reply_refs: message.rfc_message_id ? [message.rfc_message_id] : [],
  });
  const { data, error } = await supabase
    .from("bridge_mail_outbox")
    .insert(row)
    .select("id,account_id,to_addrs,subject,body,status,error,created_at")
    .single();
  if (error) throw mailError("D'Mail konnt net an d'Waardschlaang gesat ginn.", error);
  return data;
}

export async function createMailBodyUrl(supabase, path) {
  const { data, error } = await supabase.storage
    .from("bridge-media")
    .createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) {
    throw mailError("De Mail-Inhalt konnt net geluede ginn.", error);
  }
  return data.signedUrl;
}

export function subscribeToMail(supabase, userId, handlers) {
  return supabase.channel(`bridge-mail-${userId}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "bridge_mail_messages" },
      ({ new: message }) => handlers.onMailInsert(message))
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "bridge_mail_messages" },
      ({ new: message }) => handlers.onMailUpdate(message))
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "bridge_mail_outbox" },
      ({ new: outbox }) => handlers.onMailOutboxUpdate(outbox))
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "bridge_mail_accounts" },
      ({ new: account }) => handlers.onMailAccountUpdate(account))
    .subscribe((status) => handlers.onStatus(status));
}
