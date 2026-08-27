const MESSAGE_LIMIT = 500;
const SEARCH_LIMIT = 100;
const SIGNED_URL_SECONDS = 60 * 60;

function bridgeError(message, error) {
  const detail = error?.message ? ` (${error.message})` : "";
  return new Error(message + detail);
}

export async function fetchChats(supabase) {
  const { data, error } = await supabase
    .from("bridge_chats")
    .select("id,service,remote_id,title,is_group,last_at,last_preview,last_sender,unread,muted,pinned")
    .order("last_at", { ascending: false, nullsFirst: false });
  if (error) throw bridgeError("D'Chatlëscht konnt net geluede ginn.", error);
  return data || [];
}

export async function fetchAccounts(supabase) {
  const { data, error } = await supabase
    .from("bridge_accounts")
    .select("id,service,status,last_seen_at,qr_payload,error")
    .order("service");
  if (error) throw bridgeError("D'Verbindunge konnten net geluede ginn.", error);
  return data || [];
}

export async function fetchMessages(supabase, chatId) {
  const { data, error } = await supabase
    .from("bridge_messages")
    .select("id,chat_id,service,remote_id,sender_remote_id,is_from_me,body,kind,sent_at,media_path,thumb_path,media_state,reply_to_remote_id,reply_preview,reactions,edited_at,delivered_at,read_at")
    .eq("chat_id", chatId)
    .order("sent_at", { ascending: true })
    .limit(MESSAGE_LIMIT);
  if (error) throw bridgeError("D'Noriichte konnten net geluede ginn.", error);
  return data || [];
}

function ilikePattern(term) {
  const escaped = term.replace(/[\\%_]/g, (character) => `\\${character}`);
  return `%${escaped}%`;
}

export async function searchMessages(supabase, term) {
  const { data, error } = await supabase
    .from("bridge_messages")
    .select("id,chat_id,service,remote_id,body,sent_at,is_from_me")
    .ilike("body", ilikePattern(term))
    .order("sent_at", { ascending: false })
    .limit(SEARCH_LIMIT);
  if (error) throw bridgeError("D'Sich konnt net ausgeféiert ginn.", error);
  return data || [];
}

export async function queueOutbox(supabase, chat, body) {
  const row = Object.freeze({ chat_id: chat.id, service: chat.service, body });
  const { data, error } = await supabase
    .from("bridge_outbox")
    .insert(row)
    .select("id,chat_id,service,body,status,error,sent_remote_id,created_at")
    .single();
  if (error) throw bridgeError("D'Noriicht konnt net an d'Waardschlaang gesat ginn.", error);
  return data;
}

export async function queueMediaRequest(supabase, messageId) {
  const { data, error } = await supabase
    .from("bridge_media_requests")
    .insert({ message_id: messageId, status: "queued" })
    .select("id,message_id,status")
    .single();
  if (error) throw bridgeError("D'Media konnt net ugefrot ginn.", error);
  return data;
}

export async function createMediaUrl(supabase, path) {
  const { data, error } = await supabase.storage
    .from("bridge-media")
    .createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) {
    throw bridgeError("D'Media konnt net geluede ginn.", error);
  }
  return data.signedUrl;
}

export function subscribeToBridge(supabase, userId, handlers) {
  return supabase.channel(`bridge-inbox-${userId}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "bridge_messages" },
      ({ new: message }) => handlers.onMessageInsert(message))
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "bridge_messages" },
      ({ new: message }) => handlers.onMessageUpdate(message))
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "bridge_chats" },
      ({ new: chat }) => handlers.onChatUpdate(chat))
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "bridge_outbox" },
      ({ new: outbox }) => handlers.onOutboxUpdate(outbox))
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "bridge_accounts" },
      ({ new: account }) => handlers.onAccountUpdate(account))
    .subscribe((status) => handlers.onStatus(status));
}
