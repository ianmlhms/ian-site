/* Flow — Inbox on the Cloudflare Worker (mocked): chat list, opening a chat,
 * sending + live status over the WebSocket, a live message, attachment upload,
 * "load older", search, mail list/thread/reply, reconnect + token refresh, and
 * the ?backend=supabase switch (the old path must not touch the mock). */
import { CLOUD_ORIGIN, createCloudMock } from "./inbox_cloud_mock.mjs";
import { runIfMain } from "./lib.mjs";

const INBOX_URL = `/inbox.html?cloud=${encodeURIComponent(CLOUD_ORIGIN)}`;
const PAGE_SIZE = 300;
const RECONNECT_WAIT_MS = 8000;
const LIVE_TEXT = "Live Noriicht vum Mock";
const SENT_TEXT = "Test Schécken";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const mock = createCloudMock();
const legacyChat = {
  id: 9, service: "imessage", remote_id: "legacy-9", title: "Legacy Chat", is_group: false,
  last_at: new Date().toISOString(), last_preview: "alt Pfad", last_sender: "x", unread: false, muted: false, pinned: false,
};

export const flow = {
  name: "inbox-cloud",
  backend: {
    tables: {
      bridge_chats: () => [legacyChat],
      bridge_accounts: () => [],
      bridge_mail_accounts: () => [],
      bridge_mail_messages: () => [],
    },
  },
  async run(h) {
    const { page, context } = h;
    await h.signIn();
    await mock.install(context);

    const texts = (selector) => page.$$eval(selector, (nodes) => nodes.map((node) => node.textContent.trim()));
    const count = (selector) => page.$$eval(selector, (nodes) => nodes.length);
    const waitForCount = async (selector, expected, timeout = 8000) => {
      await page.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length === n, [selector, expected], { timeout });
    };
    const messageCalls = (path) => mock.callsTo("GET", path).length;

    h.step("open the inbox (default backend = cloud, pointed at the mock)");
    await h.goto(INBOX_URL);
    await page.waitForSelector("#chatList .chat-row");
    h.eq(await texts("#chatList .chat-title"), ["Test Chat Alpha", "Beta Gruppe", "Gamma Archiv"], "chat list from GET /v1/chats");
    h.expect(await page.$eval("#chatList .chat-row", (row) => row.classList.contains("unread")), "unread chat is marked");
    h.expect(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(mock.calls[0]?.authorization || ""), "requests carry the Supabase JWT as Bearer");
    await page.waitForFunction(() => document.querySelector("#connectionStrip")?.textContent.includes("verbonnen"));
    const strip = await page.textContent("#connectionStrip");
    h.expect(!strip.includes("· al"), "connected bridge is not shown as stale despite an old last_seen_at");
    h.eq(mock.callsTo("POST", "/v1/media-sign").length, 0, "no media-sign round trip needed for avatars (URL from the row)");
    h.expect(mock.connections === 1, "exactly one WebSocket opened");
    h.expect(h.backend.calls.filter((c) => c.kind === "table" && c.name.startsWith("bridge_")).length === 0, "no Supabase bridge_* table calls");
    await h.shot("list");

    h.step("open chat 1: messages, thumbnail, marked read");
    await page.click('#chatList [data-chat-id="1"]');
    await waitForCount("#messages .message", 4);
    h.expect((await texts("#messages .message-body")).includes("Moien, ass alles gutt?"), "messages rendered");
    await page.waitForSelector("#messages img.message-media");
    h.eq(await page.$eval("#messages img.message-media", (img) => img.getAttribute("src")),
      `${CLOUD_ORIGIN}/v1/media/thumbs/foto-1.png?exp=1&sig=mock`, "thumbnail uses the row's thumb_url");
    h.eq(mock.callsTo("POST", "/v1/media-sign").length, 0, "still no media-sign call (URL cache)");
    await page.waitForFunction(() => !document.querySelector('#chatList [data-chat-id="1"]').closest("li").classList.contains("unread"));
    const patch = mock.callsTo("PATCH", "/v1/chats/1");
    h.eq(patch.map((c) => c.body), [{ unread: false }], "PATCH /v1/chats/1 {unread:false} once");
    await h.shot("chat");

    h.step("a pushed message and a pushed chat update appear live");
    mock.push({ t: "message", op: "insert", row: {
      id: 15, chat_id: 1, service: "whatsapp", remote_id: "mock-m-15", is_from_me: false, body: LIVE_TEXT, kind: "text",
      sent_at: new Date().toISOString(), media_path: null, thumb_path: null, thumb_url: null, media_url: null,
      media_state: "none", reactions: {} } });
    await page.waitForFunction((text) => document.querySelector("#messages")?.textContent.includes(text), LIVE_TEXT);
    h.expect(true, "live message shown in the open chat");
    mock.push({ t: "chat", row: { ...mock.state.chats[1], last_preview: "Neie Preview", unread: true, last_at: new Date().toISOString() } });
    await page.waitForFunction(() => document.querySelector("#chatList")?.textContent.includes("Neie Preview"));
    h.expect(await page.$eval('#chatList [data-chat-id="2"]', (b) => b.closest("li").classList.contains("unread")), "pushed chat update re-sorts and marks unread");

    h.step("send a text: queued, then status pushed over the WebSocket");
    await page.fill("#messageInput", SENT_TEXT);
    await page.click("#sendButton");
    await page.waitForFunction((text) => document.querySelector("#messages")?.textContent.includes(text), SENT_TEXT);
    await page.waitForSelector(".pending-state");
    const outboxCall = mock.callsTo("POST", "/v1/outbox")[0];
    h.eq(outboxCall?.body, { chat_id: 1, body: SENT_TEXT, media_path: null }, "POST /v1/outbox body");
    h.expect(/gëtt geschéckt/.test(await page.textContent(".pending-state")), "pending bubble shows 'gëtt geschéckt'");
    mock.push({ t: "outbox", row: { id: 1, chat_id: 1, service: "whatsapp", body: SENT_TEXT, media_path: null, status: "sent", error: null, sent_remote_id: "mock-m-16" } });
    await page.waitForFunction(() => document.querySelector(".pending-state")?.textContent.trim() === "geschéckt");
    h.expect(true, "pushed outbox status 'sent' updates the bubble");
    mock.push({ t: "message", op: "insert", row: {
      id: 16, chat_id: 1, service: "whatsapp", remote_id: "mock-m-16", is_from_me: true, body: SENT_TEXT, kind: "text",
      sent_at: new Date().toISOString(), media_path: null, thumb_path: null, thumb_url: null, media_url: null,
      media_state: "none", reactions: {} } });
    await page.waitForFunction(() => !document.querySelector(".pending-state"));
    h.eq((await texts("#messages .message-body")).filter((t) => t === SENT_TEXT).length, 1, "pending bubble replaced by the real message");

    h.step("attachment: upload fails to queue -> uploaded file is deleted; then a good send");
    const attachButton = await page.isVisible("#attachButton");
    h.expect(attachButton, "attach button visible for a WhatsApp chat");
    mock.failNext("POST", "/v1/outbox");
    await page.setInputFiles("#attachmentInput", { name: "Foto Test.png", mimeType: "image/png", buffer: PNG });
    await page.click("#sendButton");
    await page.waitForFunction(() => document.querySelector("#notice")?.className.includes("error"));
    const firstPut = mock.calls.find((c) => c.method === "PUT");
    h.expect(/^\/v1\/media\/outbox\/[0-9a-f-]{36}\/Foto_Test\.png$/.test(firstPut?.path || ""), `PUT ${firstPut?.path}`);
    h.eq(firstPut?.contentType, "image/png", "upload keeps the file's Content-Type");
    h.eq(mock.callsTo("DELETE", firstPut.path).length, 1, "failed queueing deletes the uploaded file");
    h.eq(mock.state.uploads.size, 0, "mock holds no leftover upload");
    await page.setInputFiles("#attachmentInput", { name: "Foto Zwee.png", mimeType: "image/png", buffer: PNG });
    await page.click("#sendButton");
    await page.waitForFunction(() => document.querySelector(".pending-state") && document.body.textContent.includes("Foto Zwee.png"));
    const goodOutbox = mock.callsTo("POST", "/v1/outbox").at(-1);
    const secondPut = mock.calls.filter((c) => c.method === "PUT").at(-1);
    h.eq(goodOutbox.body.media_path, secondPut.path.replace("/v1/media/", ""), "outbox references the uploaded path");
    h.eq(mock.state.uploads.size, 1, "the good upload stays");

    h.step("load older: 300 newest first, then the rest");
    await page.click('#chatList [data-chat-id="3"]');
    await waitForCount("#messages article.message", PAGE_SIZE);
    h.eq(mock.callsTo("GET", "/v1/chats/3/messages")[0]?.query, { limit: String(PAGE_SIZE) }, "first page asks limit=300");
    await page.evaluate(() => { document.querySelector("#messages").scrollTop = 0; });
    await h.shot("load-older");
    await page.click("#messages .load-older");
    await waitForCount("#messages article.message", 305);
    h.expect(await count("#messages .load-older") === 0, "button gone when no older page is left");
    h.expect(Boolean(mock.callsTo("GET", "/v1/chats/3/messages")[1]?.query.before), "second request carries the next_before cursor");

    h.step("search messages");
    await page.fill("#searchInput", "Moien");
    await page.waitForSelector("#chatList .search-result");
    h.eq(mock.callsTo("GET", "/v1/search/messages").at(-1)?.query, { q: "Moien" }, "GET /v1/search/messages?q=Moien");
    await page.click("#chatList .search-result button");
    await page.waitForSelector("#messages .message.highlight, #messages .message");
    await page.fill("#searchInput", "");

    h.step("mail: list (no bodies), thread, attachment chip, reply, live mail");
    await page.click('[data-mode="mail"]');
    await waitForCount("#chatList .mail-row", 3);
    h.expect(mock.callsTo("GET", "/v1/mail/messages")[0]?.query.limit === "300", "mail list asks limit=300");
    await page.click("#chatList .mail-row >> nth=0");
    await page.waitForFunction(() => document.querySelector("#messages")?.textContent.includes("Dëst ass de Mail-Text"));
    h.expect(mock.callsTo("GET", "/v1/mail/messages").some((c) => c.query.thread_key === "thread-a"), "thread fetched with thread_key");
    await page.waitForFunction(() => document.querySelector("#messages")?.textContent.includes("offer-test.pdf"));
    h.expect(true, "attachment chip from GET .../attachments");
    await page.click("#messages .media-chip.available");
    h.eq(mock.callsTo("POST", "/v1/media-sign").length, 0, "mail body URL comes from the row, not media-sign");
    await page.click("#chatList .mail-row >> nth=1");
    await page.waitForFunction(() => document.querySelector("#messages")?.textContent.includes("Mail ouni Thread"));
    h.expect(mock.callsTo("GET", "/v1/mail/messages/102").length === 1, "mail without thread_key loads via GET /v1/mail/messages/:id");
    await page.fill("#messageInput", "Merci fir d'Mail");
    await page.click("#sendButton");
    await page.waitForFunction(() => document.querySelector("#notice")?.textContent.includes("Äntwert an d'Waardschlaang"));
    const reply = mock.callsTo("POST", "/v1/mail/outbox")[0]?.body;
    h.eq([reply?.account_id, reply?.to_addrs, reply?.subject, reply?.body], [1, ["noah@example.test"], "Re: Eenzel Mail ouni Thread", "Merci fir d'Mail"], "POST /v1/mail/outbox payload");
    mock.push({ t: "mail_outbox", row: { id: 1, account_id: 1, status: "sent", error: null } });
    await page.waitForFunction(() => document.querySelector("#notice")?.textContent.includes("Mail geschéckt"));
    h.expect(true, "mail_outbox 'sent' shows the success notice");
    const liveMail = { ...mock.state.mail.mails[1], id: 104, uid: "4", thread_key: "thread-d", subject: "Live Mail", from_name: "Lia Live",
      sent_at: new Date().toISOString(), snippet: "Frësch" };
    delete liveMail.body_text;
    mock.push({ t: "mail", op: "insert", row: liveMail });
    await waitForCount("#chatList .mail-row", 4);
    h.expect((await texts("#chatList .mail-subject"))[0] === "Live Mail", "pushed mail inserted at the top");
    await page.fill("#searchInput", "Offer");
    await page.waitForFunction(() => document.querySelectorAll("#chatList .mail-row").length === 1);
    h.eq(mock.callsTo("GET", "/v1/search/mail").at(-1)?.query, { q: "Offer" }, "GET /v1/search/mail?q=Offer");
    await page.fill("#searchInput", "");
    await page.click('[data-mode="chats"]');

    h.step("resync and presence events reload");
    let mark = mock.markCalls();
    mock.push({ t: "resync" });
    await h.pause(800);
    h.expect(mock.callsSince(mark).some((c) => c.path === "/v1/chats"), "resync reloads the chat list");
    mark = mock.markCalls();
    mock.push({ t: "presence", bridges: ["whatsapp"], changed: "whatsapp", online: true });
    await h.pause(800);
    h.expect(mock.callsSince(mark).some((c) => c.path === "/v1/accounts"), "presence refreshes accounts");
    mock.push({ t: "account", row: { service: "whatsapp", status: "offline", last_seen_at: new Date().toISOString(), qr_payload: null, error: null } });
    await page.waitForFunction(() => /offline/.test(document.querySelector("#connectionStrip").textContent));
    h.eq(await count("#connectionStrip .account-state"), 2, "an account event updates one account, not both");

    h.step("server drops the socket: client reconnects and reloads the lists");
    mock.state.chats.push({ id: 4, service: "imessage", remote_id: "mock-4", title: "Delta Nei", is_group: false, avatar_path: null,
      avatar_url: null, last_at: new Date().toISOString(), last_preview: "wärend dem Ausfall", last_sender: "D", unread: false, muted: false, pinned: false });
    const connectionsBefore = mock.connections;
    mark = mock.markCalls();
    mock.dropSockets();
    await page.waitForFunction(() => document.querySelector("#notice")?.textContent.includes("ënnerbrach"));
    h.expect(true, "outage notice shown");
    const start = Date.now();
    while (mock.connections === connectionsBefore && Date.now() - start < RECONNECT_WAIT_MS) await h.pause(200);
    h.eq(mock.connections, connectionsBefore + 1, "client opened a new WebSocket");
    await waitForCount("#chatList .chat-row", 4);
    h.expect((await texts("#chatList .chat-title")).includes("Delta Nei"), "reload after reconnect shows the chat added during the outage");
    h.expect(mock.callsSince(mark).some((c) => c.path === "/v1/chats/1/messages"), "the open chat's messages were reloaded too");

    h.step("a refreshed login token reopens the socket");
    const connectionsMid = mock.connections;
    await h.pause(1100);
    await page.evaluate(async () => { const { client } = await import("/auth.js"); await (await client()).auth.refreshSession(); });
    const wait = Date.now();
    while (mock.connections === connectionsMid && Date.now() - wait < RECONNECT_WAIT_MS) await h.pause(200);
    h.eq(mock.connections, connectionsMid + 1, "new token -> new WebSocket");
    mock.push({ t: "chat", row: { ...mock.state.chats[0], last_preview: "Nom Token-Wiessel" } });
    await page.waitForFunction(() => document.querySelector("#chatList")?.textContent.includes("Nom Token-Wiessel"));
    h.expect(true, "events still arrive on the new socket");

    h.step("?backend=supabase uses the old path and never calls the mock");
    await h.pause(1000);
    mark = mock.markCalls();
    const socketsBefore = mock.connections;
    await h.goto("/inbox.html?backend=supabase");
    await page.waitForFunction(() => document.querySelector("#chatList")?.textContent.includes("Legacy Chat"));
    h.expect(true, "chat list comes from the Supabase bridge_chats mock");
    h.expect(h.backend.callsTo("bridge_chats").length >= 1, "bridge_chats queried");
    await h.pause(500);
    h.eq(mock.callsSince(mark).map((c) => `${c.method} ${c.path}`), [], "no HTTP call reached the mock");
    h.eq(mock.connections, socketsBefore, "no WebSocket opened to the mock");

    h.step("the choice is remembered; ?backend=cloud flips back");
    await h.goto("/inbox.html");
    await page.waitForFunction(() => document.querySelector("#chatList")?.textContent.includes("Legacy Chat"));
    h.expect(true, "plain URL keeps the stored supabase choice");
    await h.goto(`${INBOX_URL}&backend=cloud`);
    await page.waitForSelector("#chatList .chat-row");
    h.expect((await texts("#chatList .chat-title")).includes("Test Chat Alpha"), "cloud again");
  },
};

runIfMain(import.meta.url, flow);
