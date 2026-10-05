/* Flow 3 — Friends: search «emm» → tap Emma → the friend request goes out. */
import { PEOPLE, profilesTable, runIfMain } from "./lib.mjs";

let sent = [];

export const flow = {
  name: "friends-add",
  backend: {
    rpc: {
      has_pin: () => true,
      is_view_restricted: () => false,
      add_friend: (args) => { sent = [{ id: 9, username: args.p_username, avatar: "🙂" }]; return "requested"; },
      sent_requests: () => sent,
    },
    tables: { profiles: profilesTable },
    functions: { "auth-pin": () => ({ hasPin: true, isLegacy: false }) },
  },
  async run(h) {
    const { page } = h;
    sent = [];
    await h.signIn();
    h.step("open Friends (signed in, mocked backend)");
    await h.goto("/friends.html");
    await page.waitForSelector("#addInput", { state: "visible" });
    await h.pause();

    h.step("type «emm» in the add field");
    await page.click("#addInput");
    await page.keyboard.type("emm", { delay: 120 });
    await page.waitForSelector(".ps-drop.open .ps-item");
    const names = await page.$$eval(".ps-drop.open .ps-item", (els) => els.map((e) => e.textContent.trim()));
    h.expect(names.length >= 2 && /Emma/.test(names[0]) && /Emmi/.test(names[1]), `suggestions list Emma and Emmi first (got ${names.join(" | ")})`);
    await h.shot("suggestions");
    await h.pause();

    h.step("tap Emma");
    await page.click(".ps-drop.open .ps-item >> nth=0");
    await page.waitForFunction(() => document.querySelector("#addMsg")?.classList.contains("ok"));
    await h.pause();

    const calls = h.backend.callsTo("add_friend");
    h.eq(calls.length, 1, "add_friend called once");
    h.eq(calls[0]?.body?.p_username, PEOPLE[0].username, "request goes to Emma");
    const msg = await page.textContent("#addMsg");
    h.expect(msg.includes(PEOPLE[0].username), `confirmation names Emma (got «${msg.trim()}»)`);
    h.eq(await page.inputValue("#addInput"), "", "the add field is cleared");

    h.step("Requests tab lists the sent request");
    await page.click("#tab-requests");
    await page.waitForFunction(() => /Emma/.test(document.querySelector("#sent")?.textContent || ""));
    h.expect(true, "«Requests you sent» shows Emma");
    await h.shot("requests");
  },
};

runIfMain(import.meta.url, flow);
