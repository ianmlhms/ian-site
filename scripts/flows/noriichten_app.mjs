/* Flow — "Noriichten", the chats-only home-screen app for the iPad
 * (inbox.html?app=noriichten, on the mocked Cloudflare Worker): install
 * metadata, no mail and no way off into the site, chats open side by side.
 *   FLOW_BROWSER=webkit python3 ~/Library/Caches/browser-slot.py node scripts/flows/noriichten_app.mjs */
import { CLOUD_ORIGIN, createCloudMock } from "./inbox_cloud_mock.mjs";
import { runIfMain } from "./lib.mjs";

const APP_URL = `/inbox.html?app=noriichten&cloud=${encodeURIComponent(CLOUD_ORIGIN)}`;
const IPAD_LANDSCAPE = { width: 1180, height: 820 };
const IPAD_PORTRAIT = { width: 820, height: 1180 };

const mock = createCloudMock();

export const flow = {
  name: "noriichten-app",
  viewport: IPAD_LANDSCAPE,
  touch: true,
  backend: { tables: { bridge_chats: () => [], bridge_accounts: () => [], bridge_mail_accounts: () => [], bridge_mail_messages: () => [] } },
  async run(h) {
    const { page, context } = h;
    await h.signIn();
    await mock.install(context);

    h.step("install metadata is the app's own");
    await h.goto(APP_URL);
    await page.waitForSelector("#chatList li");
    const meta = await page.evaluate(() => ({
      manifest: document.querySelector('link[rel="manifest"]').getAttribute("href"),
      icon: document.querySelector('link[rel="apple-touch-icon"]').getAttribute("href"),
      title: document.querySelector('meta[name="apple-mobile-web-app-title"]').content,
      docTitle: document.title,
      brand: document.getElementById("brandTitle").textContent,
    }));
    h.eq(meta.manifest, "noriichten.webmanifest", "manifest");
    h.eq(meta.icon, "assets/noriichten-180.png", "apple-touch-icon");
    h.eq(meta.title, "Noriichten", "home-screen title");
    h.eq(meta.docTitle, "Noriichten", "document title");
    h.eq(meta.brand, "Noriichten", "header title");
    const manifest = await (await page.request.get(h.origin + "/noriichten.webmanifest")).json();
    h.eq(manifest.start_url, "./inbox.html?app=noriichten", "manifest start_url");
    for (const icon of manifest.icons) {
      const res = await page.request.get(`${h.origin}/${icon.src}`);
      h.eq(res.status(), 200, `icon ${icon.src} is served`);
    }

    h.step("chats only: no mail switch, no mail strip, no link home");
    h.expect(!(await page.isVisible(".mode-switch")), "mode switch hidden");
    h.expect(!(await page.isVisible("#mailStrip")), "mail strip hidden");
    h.expect(!(await page.isVisible(".ui-header .home")), "'‹ Heem' link hidden");
    h.expect(await page.isVisible("#gtAcct"), "account button still there (sign out)");
    h.expect(await page.isVisible('[data-service-filter="whatsapp"]'), "WhatsApp filter visible");
    h.expect(await page.isVisible('[data-service-filter="imessage"]'), "iMessage filter visible");

    h.step("landscape iPad: list and chat side by side, no sideways scroll");
    await page.click('#chatList [data-chat-id="1"]');
    await page.waitForSelector("#messages .message");
    const layout = await page.evaluate(() => {
      const list = document.querySelector(".sidebar").getBoundingClientRect();
      const chat = document.querySelector(".chat-pane").getBoundingClientRect();
      return { listVisible: list.width > 0, chatLeft: chat.left, listRight: list.right,
        overflow: document.documentElement.scrollWidth - window.innerWidth };
    });
    h.expect(layout.listVisible && layout.chatLeft >= layout.listRight - 1, `side by side (${JSON.stringify(layout)})`);
    h.expect(layout.overflow <= 0, "no horizontal overflow");
    h.expect(await page.isVisible("#composer"), "composer shown");
    const metas = await page.$$eval("#messages .message-meta", (nodes) => nodes.map((node) => node.textContent.trim()));
    h.expect(metas.length > 0 && metas.every((text) => /^\d\d:\d\d/.test(text)), `24-hour times (${metas.slice(0, 3).join(", ")})`);
    const days = await page.$$eval("#messages .day-divider", (nodes) => nodes.map((node) => node.textContent.trim()));
    h.expect(days.length >= 1 && days.includes("Haut"), `day dividers (${days.join(" / ")})`);
    const listTimes = await page.$$eval("#chatList .chat-time, #chatList time", (nodes) => nodes.map((node) => node.textContent.trim()));
    h.expect(listTimes.every((text) => !/AM|PM|\//.test(text)), `chat list times (${listTimes.join(", ")})`);
    await h.shot("landscape");

    h.step("a reply quotes the message it answers");
    mock.push({ t: "message", op: "insert", row: {
      id: 90, chat_id: 1, service: "imessage", remote_id: "mock-reply-90", is_from_me: true, body: "Jo, gesinn",
      kind: "text", sent_at: new Date().toISOString(), media_path: null, thumb_path: null, thumb_url: null,
      media_url: null, media_state: "none", reply_to_remote_id: "mock-m-14", reactions: {} } });
    await page.waitForFunction(() => document.querySelector("#messages")?.textContent.includes("Jo, gesinn"));
    const quotes = await page.$$eval("#messages .reply-quote", (nodes) => nodes.map((node) => node.textContent.trim()));
    h.expect(quotes.includes("Hallo vum Mock"), `quote shows the original text (${quotes.join(" | ")})`);

    h.step("keyboard open: header and status strips make room for the chat");
    await page.evaluate(() => document.documentElement.classList.add("kbd-open"));
    h.expect(!(await page.isVisible(".ui-header")), "header hidden");
    h.expect(!(await page.isVisible("#connectionStrip")), "status strip hidden");
    const messagesHeight = await page.evaluate(() => document.getElementById("messages").getBoundingClientRect().height);
    h.expect(messagesHeight > 300, `messages keep room (${Math.round(messagesHeight)} px)`);
    await page.evaluate(() => document.documentElement.classList.remove("kbd-open"));

    h.step("portrait iPad still fits");
    await page.setViewportSize(IPAD_PORTRAIT);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    h.expect(overflow <= 0, "no horizontal overflow in portrait");
    h.expect(await page.isVisible("#messages .message"), "messages still visible");
    await h.shot("portrait");

    h.step("the normal inbox is unchanged");
    await h.goto(`/inbox.html?cloud=${encodeURIComponent(CLOUD_ORIGIN)}`);
    await page.waitForSelector("#chatList li");
    h.expect(await page.isVisible(".mode-switch"), "mode switch visible on inbox.html");
    h.eq(await page.getAttribute('link[rel="manifest"]', "href"), "inbox.webmanifest", "inbox keeps its manifest");
  },
};

runIfMain(import.meta.url, flow);
