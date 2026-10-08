/* Flow 9 — Account check popup + account merge + leaderboard link:
 * a signed-in user whose profile was never checked sees the one-time card (username + class);
 * Escape means "later" (no stamp); "Änneren" saves the class and stamps it; the profile's
 * merge button walks search -> PIN -> pick the other name -> merge_accounts; the Arcade
 * header links to the leaderboard. Phone width (390 px) must never scroll sideways. */
import { ME_NAME, PEOPLE, profilesTable, runIfMain } from "./lib.mjs";

const TICKET = "22222222-2222-4222-8222-222222222222";
const GOOD_PIN = "1234";
const PHONE = { width: 390, height: 844 };
const TABLET = { width: 820, height: 1180 };
const OTHER = PEOPLE[1]; // Emmi

let checkedAt = null;

function profileRows({ url, method, body }) {
  const select = url.searchParams.get("select") || "";
  if (method === "GET" && select.includes("account_checked_at")) {
    return [{ username: ME_NAME, class: "4C6", account_checked_at: checkedAt }];
  }
  return profilesTable({ url, method, body });
}

function authPin(body) {
  if (body?.action !== "login") return { hasPin: true, isLegacy: false };
  const right = body.identifier === OTHER.username && body.pin === GOOD_PIN;
  return right ? { hashed_token: "hash-mock" } : { error: "invalid_credentials" };
}

const cardOverflow = (page) => page.evaluate(() => {
  const card = document.querySelector(".acct-card");
  const doc = document.documentElement;
  return {
    page: doc.scrollWidth > window.innerWidth + 1,
    card: card ? card.scrollWidth > card.clientWidth + 1 : false,
  };
});

export const flow = {
  name: "account-check",
  backend: {
    tables: { profiles: profileRows },
    functions: { "auth-pin": authPin },
    rpc: {
      mark_account_checked: () => { checkedAt = new Date().toISOString(); return null; },
      set_class: () => null,
      set_username: (args) => args.p_name,
      issue_merge_ticket: () => TICKET,
      merge_accounts: () => ({ username: OTHER.username, moved: { "game_saves.user_id": 2 } }),
    },
  },
  async run(h) {
    const { page, backend } = h;
    checkedAt = null;
    await h.signIn();

    /* Asserts the open card fits a phone, then restores the tablet size. */
    const phoneFits = async (label) => {
      await page.setViewportSize(PHONE);
      await h.pause(250);
      const o = await cardOverflow(page);
      h.expect(!o.page && !o.card, `${label}: no horizontal scroll at 390 px (page ${o.page}, card ${o.card})`);
      await h.shot(`phone-${label}`);
      await page.setViewportSize(TABLET);
    };

    h.step("home page: the check card appears for a never-checked account");
    await h.goto("/index.html");
    await page.waitForSelector("#account-check .acct-card", { timeout: 20000 });
    const text = await page.innerText("#account-check .acct-card");
    h.expect(/Stëmmen deng Donnéeën nach\?/.test(text), "title is shown in Luxembourgish");
    h.expect(text.includes(ME_NAME), "current username is shown");
    h.expect(/4C6/.test(text), "current class is shown");
    h.expect(await page.isVisible('[data-act="merge"]'), "merge link is offered");
    h.expect(await page.evaluate(() => document.activeElement?.dataset.act === "yes"), "focus starts on the primary button");
    await h.shot("main");
    await phoneFits("main");

    h.step("Escape = later: closes without stamping");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#account-check", { state: "detached", timeout: 5000 });
    h.eq(backend.callsTo("mark_account_checked").length, 0, "Escape does not stamp the account");

    h.step("reload: change the class");
    await page.evaluate(() => sessionStorage.clear());
    await h.goto("/index.html");
    await page.waitForSelector("#account-check .acct-card", { timeout: 20000 });
    await page.click('[data-act="edit"]');
    await page.waitForSelector("#acctClass");
    h.eq(await page.inputValue("#acctName"), ME_NAME, "username input is prefilled");
    h.eq(await page.inputValue("#acctClass"), "4C6", "class input is prefilled");
    await page.fill("#acctClass", "5");
    await page.click('.acct-card button[type="submit"]');
    await h.pause(300);
    h.expect(/genau Klass/.test(await page.innerText("#acctMsg")), "a bare year is rejected inline");
    h.eq(backend.callsTo("set_class").length, 0, "nothing saved for an invalid class");
    await phoneFits("edit");
    await page.fill("#acctClass", "5c6");
    await page.click('.acct-card button[type="submit"]');
    await page.waitForSelector("#account-check", { state: "detached", timeout: 8000 });
    h.eq(backend.callsTo("set_class").map((c) => c.body), [{ p_class: "5C6" }], "set_class called with the normalised class");
    h.eq(backend.callsTo("set_username").length, 0, "set_username skipped (name unchanged)");
    h.eq(backend.callsTo("mark_account_checked").length, 1, "mark_account_checked called once");

    h.step("checked accounts are not asked again");
    await h.goto("/index.html");
    await h.pause(5500);
    h.expect(!(await page.$("#account-check")), "no card after the account was checked");

    h.step("profile: merge button -> search -> PIN -> keep the other name");
    await h.goto("/profile.html");
    await page.waitForSelector("#acctMerge", { timeout: 15000 });
    await page.click("#acctMerge");
    await page.waitForSelector("#acctSearch", { timeout: 8000 });
    await h.shot("merge-search");
    await page.fill("#acctSearch", "emm");
    await page.waitForSelector(".acct-hit", { timeout: 5000 });
    const names = await page.$$eval(".acct-hit__name", (els) => els.map((e) => e.textContent));
    h.eq(names, ["Emma", "Emmi", "Lemmy"], "search lists matching people (not me)");
    await phoneFits("search");
    await page.click('.acct-hit:has-text("Emmi") [data-act="pick"]');
    await page.waitForSelector("#acctSecret");
    h.expect(/Emmi/.test(await page.innerText("#acctTitle")), "PIN step names the picked account");
    h.eq(await page.getAttribute("#acctSecret", "type"), "password", "secret input is a password field");

    await page.fill("#acctSecret", "9999");
    await page.click('.acct-card button[type="submit"]');
    await page.waitForFunction(() => /Falsche PIN/.test(document.getElementById("acctMsg")?.textContent || ""), null, { timeout: 5000 });
    h.eq(backend.callsTo("issue_merge_ticket").length, 0, "no ticket after a wrong PIN");
    await phoneFits("prove");

    await page.fill("#acctSecret", GOOD_PIN);
    await page.click('.acct-card button[type="submit"]');
    await page.waitForSelector('input[name="keep"]', { timeout: 8000 });
    h.eq(backend.callsTo("issue_merge_ticket").length, 1, "ticket issued as the other account");
    const logins = backend.callsTo("auth-pin").filter((c) => c.body?.action === "login").map((c) => c.body);
    h.eq(logins.at(-1), { action: "login", identifier: OTHER.username, pin: GOOD_PIN }, "auth-pin login sent with the picked name + PIN");
    h.expect(await page.isChecked('input[value="mine"]'), "keeps my name by default");
    h.expect(/rückgängeg|réckgängeg/.test(await page.innerText(".acct-warn")), "irreversible warning shown");
    await phoneFits("pick");

    await page.check('input[value="other"]');
    await page.click('[data-act="confirm"]');
    await page.waitForSelector(".acct-done", { timeout: 8000 });
    h.eq(backend.callsTo("merge_accounts").map((c) => c.body), [{ p_ticket: TICKET, p_username_from: "other" }], "merge_accounts called with the ticket and 'other'");
    h.expect(/Fäerdeg/.test(await page.innerText(".acct-done")), "success message shown");
    await page.waitForEvent("load", { timeout: 8000 });
    h.expect(backend.callsTo("mark_account_checked").length >= 2, "account stamped again after the merge");

    h.step("Arcade header links to the leaderboard");
    await h.goto("/pixelbreak.html");
    await page.waitForSelector('header .header-right a[href="leaderboard.html"]', { timeout: 10000 });
    for (const [label, size] of [["tablet", TABLET], ["phone", PHONE]]) {
      await page.setViewportSize(size);
      await h.pause(300);
      h.expect(await page.isVisible('header .header-right a[href="leaderboard.html"]'), `leaderboard link visible (${label})`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      h.expect(!overflow, `Arcade header does not scroll sideways (${label})`);
      await h.shot(`arcade-${label}`);
    }
  },
};

runIfMain(import.meta.url, flow);
