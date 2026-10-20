// Data layer backed by the Cloudflare inbox Worker. Same function names and
// argument order as inbox-data.js / inbox-mail-data.js (the first argument is
// still the Supabase client: it only supplies the login token), so inbox.js
// can use either one. Built by createCloudData() so the Worker URL is injected
// by inbox-backend.js instead of living in module state.
import { buildOutboxPath, isAttachmentSizeAllowed } from "./inbox-attach.js?v=1";
import { buildMailReply } from "./inbox-mail-reply.js?v=1";
import { accessToken, createCloudHttp, guarded } from "./inbox-cloud-http.js?v=1";
import { createRealtime, websocketUrl } from "./inbox-cloud-socket.js?v=1";

const MESSAGE_PAGE = 300;
const MAIL_LIST_LIMIT = 300;
const THREAD_LIMIT = 50;
const OUTBOX_UPLOAD_PREFIX = "/v1/media/";
const DEFAULT_CONTENT_TYPE = "application/octet-stream";

// Rows carry ready-made signed URLs next to their storage paths.
const URL_FIELDS = Object.freeze([
  ["avatar_path", "avatar_url"],
  ["thumb_path", "thumb_url"],
  ["media_path", "media_url"],
  ["body_html_path", "body_html_url"],
  ["storage_path", "url"],
]);

// Cloud accounts are keyed by service; inbox.js merges rows by id.
const withAccountId = (account) => Object.freeze({ id: account.service, ...account });

function encodePath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}

// Realtime frame type -> handler call. `t` is what the Worker sends.
const BRIDGE_FRAMES = Object.freeze({
  message: (frame, handlers) => (frame.op === "insert"
    ? handlers.onMessageInsert(frame.row)
    : handlers.onMessageUpdate(frame.row)),
  chat: (frame, handlers) => handlers.onChatUpdate(frame.row),
  outbox: (frame, handlers) => handlers.onOutboxUpdate(frame.row),
  account: (frame, handlers) => handlers.onAccountUpdate(withAccountId(frame.row)),
  presence: (frame, handlers) => handlers.onPresence?.(frame),
  resync: (_frame, handlers) => handlers.onResync?.(),
});

const MAIL_FRAMES = Object.freeze({
  mail: (frame, handlers) => (frame.op === "insert"
    ? handlers.onMailInsert(frame.row)
    : handlers.onMailUpdate(frame.row)),
  mail_outbox: (frame, handlers) => handlers.onMailOutboxUpdate(frame.row),
  mail_account: (frame, handlers) => handlers.onMailAccountUpdate(frame.row),
});

export function dispatchFrame(table, frame, handlers) {
  const route = table[frame?.t ?? frame?.event];
  if (route) route(frame, handlers);
}

export function createCloudData({
  baseUrl,
  fetchFn = (...args) => fetch(...args),
  createSocket,
}) {
  const http = createCloudHttp({ baseUrl, fetchFn });
  const realtime = createRealtime({
    wsUrl: websocketUrl(baseUrl),
    getToken: accessToken,
    createSocket,
  });
  const signedUrls = new Map();
  const olderCursors = new Map();

  function remember(row) {
    if (!row) return row;
    URL_FIELDS.forEach(([pathField, urlField]) => {
      if (row[pathField] && row[urlField]) signedUrls.set(row[pathField], row[urlField]);
    });
    return row;
  }

  function rememberAll(rows) {
    return (rows || []).map(remember);
  }

  async function signPath(supabase, path) {
    const cached = signedUrls.get(path);
    if (cached) return cached;
    const { urls } = await http.post(supabase, "/v1/media-sign", { paths: [path] });
    if (!urls?.[path]) throw new Error("The Worker returned no URL for " + path);
    signedUrls.set(path, urls[path]);
    return urls[path];
  }

  // ---- chats ------------------------------------------------------------

  const fetchChats = (supabase) => guarded("D'Chatlëscht konnt net geluede ginn.", async () =>
    rememberAll(await http.get(supabase, "/v1/chats")));

  const fetchAccounts = (supabase) => guarded("D'Verbindunge konnten net geluede ginn.", async () =>
    (await http.get(supabase, "/v1/accounts")).map(withAccountId));

  function loadMessagePage(supabase, chatId, before) {
    return guarded("D'Noriichte konnten net geluede ginn.", async () => {
      const page = await http.get(supabase, `/v1/chats/${encodeURIComponent(chatId)}/messages`, {
        limit: MESSAGE_PAGE,
        before,
      });
      olderCursors.set(chatId, page.next_before || null);
      return rememberAll(page.messages);
    });
  }

  const fetchMessages = (supabase, chatId) => loadMessagePage(supabase, chatId, null);

  const hasOlderMessages = (chatId) => Boolean(olderCursors.get(chatId));

  const fetchOlderMessages = async (supabase, chatId) => {
    const cursor = olderCursors.get(chatId);
    return cursor ? loadMessagePage(supabase, chatId, cursor) : [];
  };

  const markChatRead = (supabase, chat) =>
    guarded("De Chat konnt net als gelies markéiert ginn.", async () =>
      remember(await http.patch(supabase, `/v1/chats/${encodeURIComponent(chat.id)}`, { unread: false })));

  const searchMessages = (supabase, term) =>
    guarded("D'Sich konnt net ausgeféiert ginn.", () =>
      http.get(supabase, "/v1/search/messages", { q: term }));

  // ---- sending ------------------------------------------------------------

  const queueOutbox = (supabase, chat, body, mediaPath = null) =>
    guarded("D'Noriicht konnt net an d'Waardschlaang gesat ginn.", () =>
      http.post(supabase, "/v1/outbox", { chat_id: chat.id, body, media_path: mediaPath }));

  async function uploadOutboxFile(supabase, file) {
    if (!isAttachmentSizeAllowed(file?.size)) throw new Error("Ze grouss (max. 64 MB)");
    const path = buildOutboxPath(crypto.randomUUID(), file.name);
    await guarded("De Fichier konnt net eropgeluede ginn.", () =>
      http.put(supabase, OUTBOX_UPLOAD_PREFIX + encodePath(path), file, file.type || DEFAULT_CONTENT_TYPE));
    return path;
  }

  async function removeOutboxFile(supabase, path) {
    try {
      await http.remove(supabase, OUTBOX_UPLOAD_PREFIX + encodePath(path));
    } catch (error) {
      console.warn("Uploaded outbox file could not be removed:", error);
    }
  }

  const queueMediaRequest = (supabase, messageId) =>
    guarded("D'Media konnt net ugefrot ginn.", () =>
      http.post(supabase, "/v1/media-requests", { message_id: messageId }));

  const createMediaUrl = (supabase, path) =>
    guarded("D'Media konnt net geluede ginn.", () => signPath(supabase, path));

  // ---- mail ---------------------------------------------------------------

  const fetchMailAccounts = (supabase) =>
    guarded("D'Mail-Kontoen konnten net geluede ginn.", () => http.get(supabase, "/v1/mail/accounts"));

  const fetchMailMessages = (supabase) =>
    guarded("D'Mailen konnten net geluede ginn.", async () =>
      rememberAll(await http.get(supabase, "/v1/mail/messages", { limit: MAIL_LIST_LIMIT })));

  // The list has no body_text; the thread (or the single mail) does.
  function fetchMailThread(supabase, threadKey, mailId = null) {
    return guarded("De Mail-Verlaf konnt net geluede ginn.", async () => {
      if (threadKey) {
        return rememberAll(await http.get(supabase, "/v1/mail/messages", {
          thread_key: threadKey,
          limit: THREAD_LIMIT,
        }));
      }
      if (!mailId) return [];
      return [remember(await http.get(supabase, `/v1/mail/messages/${encodeURIComponent(mailId)}`))];
    });
  }

  const fetchMailAttachments = (supabase, messageId) =>
    guarded("D'Unhäng konnten net geluede ginn.", async () =>
      rememberAll(await http.get(supabase, `/v1/mail/messages/${encodeURIComponent(messageId)}/attachments`)));

  const searchMail = (supabase, term) =>
    guarded("D'Mail-Sich konnt net ausgeféiert ginn.", async () =>
      rememberAll(await http.get(supabase, "/v1/search/mail", { q: term })));

  async function queueMailReply(supabase, message, body) {
    const reply = buildMailReply(message, body);
    return guarded("D'Mail konnt net an d'Waardschlaang gesat ginn.", () =>
      http.post(supabase, "/v1/mail/outbox", reply));
  }

  const createMailBodyUrl = (supabase, path) =>
    guarded("De Mail-Inhalt konnt net geluede ginn.", () => signPath(supabase, path));

  // ---- realtime -------------------------------------------------------------

  function subscribeWith(table, supabase, handlers, extra = {}) {
    const close = realtime.subscribe(supabase, {
      onFrame: (frame) => {
        remember(frame.row);
        dispatchFrame(table, frame, handlers);
      },
      onStatus: handlers.onStatus,
      ...extra,
    });
    return Object.freeze({ close });
  }

  // Chat events also own the reload hooks (resync / reconnect); the mail
  // subscription only maps its own events, so nothing reloads twice.
  const subscribeToBridge = (supabase, _userId, handlers) =>
    subscribeWith(BRIDGE_FRAMES, supabase, handlers, { onReconnect: handlers.onReconnect });

  const subscribeToMail = (supabase, _userId, handlers) =>
    subscribeWith(MAIL_FRAMES, supabase, handlers);

  const unsubscribe = (_supabase, channel) => channel.close();

  return Object.freeze({
    createMailBodyUrl,
    createMediaUrl,
    fetchAccounts,
    fetchChats,
    fetchMailAccounts,
    fetchMailAttachments,
    fetchMailMessages,
    fetchMailThread,
    fetchMessages,
    fetchOlderMessages,
    hasOlderMessages,
    markChatRead,
    queueMailReply,
    queueMediaRequest,
    queueOutbox,
    removeOutboxFile,
    searchMail,
    searchMessages,
    subscribeToBridge,
    subscribeToMail,
    unsubscribe,
    uploadOutboxFile,
  });
}
