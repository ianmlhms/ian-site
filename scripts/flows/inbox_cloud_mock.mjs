/* A mocked Cloudflare inbox Worker for the inbox flows: just the endpoints and
 * WebSocket events inbox.js uses, with made-up data. Installed on a Playwright
 * context by interception, so nothing leaves the machine. The page is pointed
 * at it with  inbox.html?cloud=<CLOUD_ORIGIN>  (loopback only).
 *
 *   const mock = createCloudMock();
 *   await mock.install(context);
 *   mock.push({ t: "message", op: "insert", row })   // server -> page
 *   mock.calls                                       // every HTTP request seen
 *   mock.connections                                 // WebSocket upgrades seen */

export const CLOUD_ORIGIN = "http://127.0.0.1:47831";
const MEDIA_PREFIX = "/v1/media/";
const MESSAGE_PAGE_MAX = 500;
const BIG_CHAT_ID = 3;
const BIG_CHAT_MESSAGES = 305;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, range",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-expose-headers": "*",
};

const ago = (ms) => new Date(Date.now() - ms).toISOString();
const signed = (path) => `${CLOUD_ORIGIN}${MEDIA_PREFIX}${path}?exp=1&sig=mock`;

function seedChats() {
  return [
    { id: 1, service: "whatsapp", remote_id: "mock-1", title: "Test Chat Alpha", is_group: false,
      avatar_path: "avatars/alpha.png", avatar_url: signed("avatars/alpha.png"), last_at: ago(5 * MINUTE_MS),
      last_preview: "Hallo vum Mock", last_sender: "Alpha", unread: true, muted: false, pinned: false },
    { id: 2, service: "imessage", remote_id: "mock-2", title: "Beta Gruppe", is_group: true,
      avatar_path: null, avatar_url: null, last_at: ago(60 * MINUTE_MS),
      last_preview: "Bis muer", last_sender: "Beta", unread: false, muted: false, pinned: false },
    { id: BIG_CHAT_ID, service: "whatsapp", remote_id: "mock-3", title: "Gamma Archiv", is_group: false,
      avatar_path: null, avatar_url: null, last_at: ago(3 * DAY_MS),
      last_preview: "Nummer 305", last_sender: "Gamma", unread: false, muted: false, pinned: false },
  ];
}

function message(id, chatId, body, minutesAgo, extra = {}) {
  return { id, chat_id: chatId, service: "whatsapp", remote_id: `mock-m-${id}`, sender_remote_id: "x",
    is_from_me: false, body, kind: "text", sent_at: ago(minutesAgo * MINUTE_MS), media_path: null,
    thumb_path: null, thumb_url: null, media_url: null, media_state: "none", reply_to_remote_id: null,
    reply_preview: null, reactions: {}, edited_at: null, delivered_at: null, read_at: null, ...extra };
}

function seedMessages() {
  const bigChat = Array.from({ length: BIG_CHAT_MESSAGES }, (_, index) =>
    message(1000 + index, BIG_CHAT_ID, `Nummer ${index + 1}`, BIG_CHAT_MESSAGES - index + 5000));
  return new Map([
    [1, [
      message(11, 1, "Moien, ass alles gutt?", 30),
      message(12, 1, "Jo, alles gutt hei.", 28, { is_from_me: true }),
      message(13, 1, "", 20, { kind: "image", media_state: "none", thumb_path: "thumbs/foto-1.png", thumb_url: signed("thumbs/foto-1.png") }),
      message(14, 1, "Hallo vum Mock", 5),
    ]],
    [2, [message(21, 2, "Bis muer", 60, { service: "imessage" })]],
    [BIG_CHAT_ID, bigChat],
  ]);
}

function seedMail() {
  const base = { account_id: 1, folder: "INBOX", rfc_message_id: null, in_reply_to: null, cc_addrs: [],
    body_html_path: null, body_html_url: null, has_attachments: false, is_read: false, is_flagged: false,
    is_from_me: false, is_bulk: false, remote_id: null };
  const mails = [
    { ...base, id: 101, uid: "9007199254740993", thread_key: "thread-a", rfc_message_id: "<a1@example.test>",
      subject: "Offer vum Test", from_name: "Mara Muster", from_addr: "mara@example.test", to_addrs: ["ich@example.test"],
      sent_at: ago(10 * MINUTE_MS), snippet: "Hei ass d'Offer.", has_attachments: true,
      body_html_path: "mail/101.html", body_html_url: signed("mail/101.html") },
    { ...base, id: 102, uid: "2", thread_key: null, rfc_message_id: "<b1@example.test>", subject: "Eenzel Mail ouni Thread",
      from_name: "Noah Nummer", from_addr: "noah@example.test", to_addrs: ["ich@example.test"],
      sent_at: ago(2 * 60 * MINUTE_MS), snippet: "Kuerz Nodeel." },
    { ...base, id: 103, uid: "3", thread_key: "thread-c", subject: "Newsletter Test", from_name: "Shop", from_addr: "news@example.test",
      to_addrs: ["ich@example.test"], sent_at: ago(5 * 60 * MINUTE_MS), snippet: "Rabatt fir dech.", is_bulk: true },
  ];
  const bodies = new Map([[101, "Dëst ass de Mail-Text vun der Offer."], [102, "Mail ouni Thread, Text hei."], [103, "Newsletter-Text."]]);
  const attachments = new Map([[101, [{ id: 1, message_id: 101, part_index: 0, filename: "offer-test.pdf",
    mime_type: "application/pdf", size_bytes: 2048, storage_path: "mail/101-0.pdf", state: "ready", url: signed("mail/101-0.pdf") }]]]);
  return { mails, bodies, attachments };
}

function seedAccounts() {
  const oldSignal = ago(2 * DAY_MS);
  return [
    { service: "imessage", status: "connected", last_seen_at: oldSignal, qr_payload: null, error: null },
    { service: "whatsapp", status: "connected", last_seen_at: oldSignal, qr_payload: null, error: null },
  ];
}

export function createCloudMock() {
  const state = {
    accounts: seedAccounts(),
    chats: seedChats(),
    messages: seedMessages(),
    mail: seedMail(),
    mailAccounts: [{ id: 1, label: "Test Mail", address: "ich@example.test", provider: "other", aliases: [],
      enabled: true, status: "online", last_seen_at: ago(MINUTE_MS), error: null }],
    outbox: [],
    mailOutbox: [],
    uploads: new Map(),
    nextOutboxId: 1,
  };
  const calls = [];
  const sockets = [];
  const failures = new Set();
  let connections = 0;

  const withoutBody = (mail) => ({ ...mail });
  const withBody = (mail) => ({ ...mail, body_text: state.mail.bodies.get(mail.id) ?? null });
  const sorted = (rows) => [...rows].sort((a, b) => b.sent_at.localeCompare(a.sent_at));

  function messagePage(chatId, query) {
    const all = [...(state.messages.get(chatId) || [])].sort((a, b) => a.sent_at.localeCompare(b.sent_at));
    const limit = Math.min(Number(query.get("limit")) || 200, MESSAGE_PAGE_MAX);
    const before = query.get("before");
    const end = before ? Number(before.split("~")[1]) : all.length;
    const upTo = all.slice(0, Math.min(end, all.length));
    const page = upTo.slice(-limit);
    const start = upTo.length - page.length;
    return { messages: page, next_before: start > 0 ? `${page[0].sent_at}~${start}` : null };
  }

  function handleGet(path, query) {
    const messagesMatch = path.match(/^\/v1\/chats\/(\d+)\/messages$/);
    if (messagesMatch) return messagePage(Number(messagesMatch[1]), query);
    if (path === "/v1/chats") return state.chats;
    if (path === "/v1/accounts") return state.accounts;
    if (path === "/v1/mail/accounts") return state.mailAccounts;
    if (path === "/v1/mail/messages") {
      const key = query.get("thread_key");
      if (key) return state.mail.mails.filter((m) => m.thread_key === key).map(withBody);
      return sorted(state.mail.mails).map(withoutBody);
    }
    const mailMatch = path.match(/^\/v1\/mail\/messages\/(\d+)(\/attachments)?$/);
    if (mailMatch) {
      const id = Number(mailMatch[1]);
      if (mailMatch[2]) return state.mail.attachments.get(id) || [];
      return withBody(state.mail.mails.find((m) => m.id === id));
    }
    if (path === "/v1/search/messages") {
      const term = (query.get("q") || "").toLowerCase();
      return [...state.messages.values()].flat().filter((m) => (m.body || "").toLowerCase().includes(term))
        .slice(0, 100).map(({ id, chat_id, service, remote_id, body, sent_at, is_from_me }) =>
          ({ id, chat_id, service, remote_id, body, sent_at, is_from_me }));
    }
    if (path === "/v1/search/mail") {
      const term = (query.get("q") || "").toLowerCase();
      return state.mail.mails.filter((m) => `${m.subject} ${m.snippet}`.toLowerCase().includes(term)).map(withoutBody);
    }
    return undefined;
  }

  function handleWrite(method, path, body, request) {
    if (method === "PATCH" && /^\/v1\/chats\/\d+$/.test(path)) {
      const chat = state.chats.find((c) => c.id === Number(path.split("/")[3]));
      Object.assign(chat, body);
      return chat;
    }
    if (method === "POST" && path === "/v1/outbox") {
      const row = { id: state.nextOutboxId++, chat_id: body.chat_id, service: "whatsapp", body: body.body,
        media_path: body.media_path, status: "queued", error: null, sent_remote_id: null, created_at: ago(0) };
      state.outbox.push(row);
      return { ...row, bridge_online: true };
    }
    if (method === "POST" && path === "/v1/mail/outbox") {
      const row = { id: state.mailOutbox.length + 1, ...body, status: "queued", error: null };
      state.mailOutbox.push(row);
      return { ...row, bridge_online: true };
    }
    if (method === "POST" && path === "/v1/media-requests") return { id: 1, message_id: body.message_id, status: "queued" };
    if (method === "POST" && path === "/v1/media-sign") {
      return { urls: Object.fromEntries((body.paths || []).map((p) => [p, signed(p)])) };
    }
    if (path.startsWith(MEDIA_PREFIX + "outbox/")) {
      const key = decodeURIComponent(path.slice(MEDIA_PREFIX.length));
      if (method === "PUT") {
        state.uploads.set(key, { type: request.headers()["content-type"], size: request.postDataBuffer()?.length ?? 0 });
        return { ok: true };
      }
      if (method === "DELETE") {
        state.uploads.delete(key);
        return { ok: true };
      }
    }
    return undefined;
  }

  async function handle(route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (method === "GET" && url.pathname.startsWith(MEDIA_PREFIX)) {
      return route.fulfill({ status: 200, contentType: "image/png", headers: CORS, body: PNG_1X1 });
    }
    const raw = request.postData();
    let body = null;
    try { body = raw && request.headers()["content-type"] === "application/json" ? JSON.parse(raw) : null; } catch { body = null; }
    const call = { method, path: url.pathname, query: Object.fromEntries(url.searchParams), body,
      authorization: request.headers().authorization || "", contentType: request.headers()["content-type"] || "" };
    calls.push(call);
    const failKey = `${method} ${url.pathname}`;
    if (failures.delete(failKey)) {
      return route.fulfill({ status: 500, contentType: "application/json", headers: CORS, body: JSON.stringify({ error: "mock failure", code: "internal" }) });
    }
    const result = method === "GET" ? handleGet(url.pathname, url.searchParams) : handleWrite(method, url.pathname, body, request);
    if (result === undefined) {
      return route.fulfill({ status: 404, contentType: "application/json", headers: CORS, body: JSON.stringify({ error: "not found", code: "not_found" }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(result) });
  }

  async function install(context) {
    await context.route(`${CLOUD_ORIGIN}/**`, handle);
    await context.routeWebSocket(`${CLOUD_ORIGIN.replace("http", "ws")}/v1/ws`, (ws) => {
      connections += 1;
      sockets.push(ws);
      ws.onMessage((frame) => { if (frame === "ping") ws.send("pong"); });
      ws.onClose(() => { const index = sockets.indexOf(ws); if (index >= 0) sockets.splice(index, 1); });
      ws.send(JSON.stringify({ t: "hello", role: "client", bridges: ["imessage", "whatsapp", "mail"] }));
    });
  }

  return {
    state,
    calls,
    install,
    callsTo: (method, path) => calls.filter((c) => c.method === method && c.path === path),
    get connections() { return connections; },
    get openSockets() { return sockets.length; },
    push: (frame) => sockets.forEach((ws) => ws.send(JSON.stringify(frame))),
    dropSockets: () => [...sockets].forEach((ws) => ws.close()),
    failNext: (method, path) => failures.add(`${method} ${path}`),
    markCalls: () => calls.length,
    callsSince: (mark) => calls.slice(mark),
  };
}
