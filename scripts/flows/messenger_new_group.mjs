/* Flow 1 — Messenger: new group → pick two people via name search "emm" → create. */
import { ME, ME_NAME, PEOPLE, profilesTable, runIfMain } from "./lib.mjs";

const GROUP_NAME = "Klassegrupp 4C6";
const GROUP_ID = 77;
let created = false;

export const flow = {
  name: "messenger-new-group",
  backend: {
    rpc: {
      has_pin: () => true,
      is_view_restricted: () => false,
      my_chats: () => (created ? [{ id: GROUP_ID, display: GROUP_NAME, is_dm: false, invite_code: "abc123", unread: 0 }] : []),
      create_group: (args) => { created = true; return { id: GROUP_ID, name: args.p_name, invite_code: "abc123" }; },
      add_group_member: () => "ok",
    },
    tables: {
      profiles: profilesTable,
      group_members: () => [{ user_id: ME, username: ME_NAME, joined_at: "2026-10-01T08:00:00Z" }],
    },
    functions: { "auth-pin": () => ({ hasPin: true, isLegacy: false }) },
  },
  async run(h) {
    const { page } = h;
    created = false;
    await h.signIn();
    h.step("open the messenger (signed in, mocked backend)");
    await h.goto("/messenger.html");
    await page.waitForSelector("#newG", { state: "visible" });
    await h.pause();

    h.step("tap «new group», type a name");
    await page.click("#newG");
    await page.waitForSelector("#ppName");
    await page.fill("#ppName", GROUP_NAME);
    await h.pause(400);

    h.step("search «emm» → pick the first suggestion");
    await page.click("#ppSearch");
    await page.keyboard.type("emm", { delay: 120 });
    await page.waitForSelector(".ps-drop.open .ps-item");
    const first = await page.$$eval(".ps-drop.open .ps-item", (els) => els.map((e) => e.textContent.trim()));
    h.expect(first.some((t) => t.includes("Emma")) && first.some((t) => t.includes("Emmi")), `«emm» suggests Emma and Emmi (got ${first.join(" | ")})`);
    await h.pause();
    await page.click(".ps-drop.open .ps-item >> nth=0");
    await h.pause(400);

    h.step("search «emm» again → the picked person is gone, pick the next one");
    await page.keyboard.type("emm", { delay: 120 });
    await page.waitForSelector(".ps-drop.open .ps-item");
    const second = await page.$$eval(".ps-drop.open .ps-item", (els) => els.map((e) => e.textContent.trim()));
    h.expect(!second.some((t) => t.startsWith("🙂") || /^\W*Emma\b/.test(t)), `Emma is not suggested twice (got ${second.join(" | ")})`);
    await h.pause();
    await page.click(".ps-drop.open .ps-item >> nth=0");
    await h.pause(400);

    const chips = await page.$$eval(".pp-chip", (els) => els.map((e) => e.firstChild.textContent.trim()));
    h.eq(chips, ["Emma", "Emmi"], "two chips: Emma, Emmi");
    await h.shot("picker");

    h.step("create the group");
    await page.click("#ppGo");
    await page.waitForSelector("#ppGo", { state: "detached" });
    await page.waitForSelector(".grp-open");
    await h.pause();

    const create = h.backend.callsTo("create_group");
    h.eq(create.length, 1, "create_group called once");
    h.eq(create[0]?.body?.p_name, GROUP_NAME, "group created with the typed name");
    const adds = h.backend.callsTo("add_group_member").map((c) => [c.body.p_group_id, c.body.p_user_id]);
    h.eq(adds, [[GROUP_ID, PEOPLE[0].id], [GROUP_ID, PEOPLE[1].id]], "both people added to the new group");
    const listText = await page.textContent("#groupList");
    h.expect(listText.includes(GROUP_NAME), "new group appears in the chat list");
    const head = await page.textContent("#chatHead");
    h.expect(head.includes(GROUP_NAME), "new group is opened in the header");
    await h.shot("created");
  },
};

runIfMain(import.meta.url, flow);
