/* Flow 2 — Messenger: add a person to an existing group with the ＋ button. */
import { ME, ME_NAME, PEOPLE, profilesTable, runIfMain } from "./lib.mjs";

const GROUP_ID = 88;
const members = [{ user_id: ME, username: ME_NAME, joined_at: "2026-10-01T08:00:00Z" },
  { user_id: PEOPLE[1].id, username: PEOPLE[1].username, joined_at: "2026-10-01T08:00:00Z" }];

export const flow = {
  name: "messenger-add-member",
  backend: {
    rpc: {
      has_pin: () => true,
      is_view_restricted: () => false,
      my_chats: () => [{ id: GROUP_ID, display: "Spillgrupp", is_dm: false, invite_code: "xyz789", unread: 0 }],
      add_group_member: (args) => {
        const person = PEOPLE.find((p) => p.id === args.p_user_id);
        if (person) members.push({ user_id: person.id, username: person.username, joined_at: "2026-10-05T10:00:00Z" });
        return "ok";
      },
    },
    tables: {
      profiles: profilesTable,
      group_members: () => members,
    },
    functions: { "auth-pin": () => ({ hasPin: true, isLegacy: false }) },
  },
  async run(h) {
    const { page } = h;
    await h.signIn();
    h.step("open the messenger and the existing group");
    await h.goto("/messenger.html");
    await page.waitForSelector(".grp-open");
    await page.click(".grp-open");
    await page.waitForSelector("#addPeopleBtn");
    await h.pause();

    h.step("tap ＋ (add people)");
    h.expect((await page.textContent("#addPeopleBtn")).trim().length > 0, "the ＋ button has a visible label");
    await page.click("#addPeopleBtn");
    await page.waitForSelector("#ppSearch");
    h.expect(await page.$eval("#ppGo", (b) => b.disabled), "confirm button is disabled until someone is picked");
    await h.pause(400);

    h.step("search «emm» — Emmi is already in the group, so only Emma and Lemmy show");
    await page.click("#ppSearch");
    await page.keyboard.type("emm", { delay: 120 });
    await page.waitForSelector(".ps-drop.open .ps-item");
    const names = await page.$$eval(".ps-drop.open .ps-item", (els) => els.map((e) => e.textContent.trim()));
    h.expect(names.length === 2 && /Emma/.test(names[0]) && /Lemmy/.test(names[1]) && !names.some((n) => /Emmi/.test(n)),
      `members are hidden from the suggestions (got ${names.join(" | ")})`);
    await h.pause();
    await page.click(".ps-drop.open .ps-item >> nth=0");
    await h.pause(400);
    h.eq(await page.$$eval(".pp-chip", (els) => els.map((e) => e.firstChild.textContent.trim())), ["Emma"], "one chip: Emma");
    h.expect(!(await page.$eval("#ppGo", (b) => b.disabled)), "confirm button is enabled");
    await h.shot("picker");

    h.step("confirm");
    await page.click("#ppGo");
    await page.waitForSelector("#ppGo", { state: "detached" });
    await h.pause();
    const adds = h.backend.callsTo("add_group_member").map((c) => [c.body.p_group_id, c.body.p_user_id]);
    h.eq(adds, [[GROUP_ID, PEOPLE[0].id]], "add_group_member called for Emma in the open group");

    h.step("open the member list — Emma is there now");
    await page.click("#membersBtn");
    await page.waitForFunction(() => /Emma/.test(document.querySelector("#memberPanel .mp-list")?.textContent || ""));
    const list = await page.textContent("#memberPanel .mp-list");
    h.expect(/Emma/.test(list) && /Emmi/.test(list), "member list shows Emma and Emmi");
    await h.shot("members");
  },
};

runIfMain(import.meta.url, flow);
