/* Remote commands use the actual 60s presence callback, without advancing the
 * rest of the site's/game's clocks. Supabase is entirely mocked. */
import { createClientCommandsMock, ME, runIfMain } from "./lib.mjs";

const commands = createClientCommandsMock({ repeat: true });
const ONLINE = [
  { user_id: ME, username: "tester", class: "4C6", page: "/pixelbreak.html?g=snake", online: true, last_seen: new Date().toISOString(), started_at: new Date().toISOString() },
  { user_id: "22222222-2222-4222-8222-222222222222", username: "Emma", class: "4C6", page: "/messenger.html", online: true, last_seen: new Date().toISOString(), started_at: new Date().toISOString() },
];

async function ready(h) {
  await h.page.waitForFunction(() => window.__ianCommands && window.__presenceTicks?.length);
  await h.pause(500);
}

async function tick(h) {
  const response = h.page.waitForResponse((r) => r.url().includes("/rpc/client_commands_since"));
  await h.page.evaluate(() => window.__presenceTicks[0]());
  await response;
  await h.pause(150);
}

export const flow = {
  name: "client-commands",
  backend: { rpc: { ...commands.rpc, is_admin: () => true, admin_online: () => ONLINE, admin_groups: () => [] } },
  async run(h) {
    const { page, context, backend } = h;
    await h.signIn();
    await context.addInitScript(() => {
      localStorage.setItem("site_lang", "lb");
      window.__presenceTicks = [];
      const interval = window.setInterval.bind(window);
      window.setInterval = (callback, delay, ...args) => {
        if (delay === 60_000) window.__presenceTicks.push(() => callback(...args));
        return interval(callback, delay, ...args);
      };
    });

    h.step("baseline first; one presence timer; duplicate command handled once");
    await h.goto("/index.html");
    await ready(h);
    h.eq(backend.callsTo("client_commands_since")[0]?.body, { p_since: null }, "first request establishes baseline");
    h.eq(await page.evaluate(() => window.__presenceTicks.length), 1, "one 60s timer on the parent page");
    await page.evaluate(() => {
      window.__defaultReload = window.__ianCommands.reload;
      window.__reloadCount = 0;
      window.__ianCommands.reload = () => { window.__reloadCount++; return true; };
    });
    const first = commands.add("reload");
    await tick(h);
    await tick(h);
    h.eq(await page.evaluate(() => window.__reloadCount), 1, "redelivered ID is executed once per page");
    h.eq(backend.callsTo("client_commands_since").at(-1).body.p_since, first.created_at, "cursor advances to the handled command");

    h.step("command waits while the focused text field has text");
    await page.evaluate(() => {
      const field = document.createElement("textarea");
      field.id = "commandDraft";
      field.value = "unfinished message";
      document.body.appendChild(field);
      field.focus();
    });
    commands.add("reload");
    await tick(h);
    h.eq(await page.evaluate(() => window.__reloadCount), 1, "draft blocks execution");
    await page.fill("#commandDraft", "");
    await tick(h);
    h.eq(await page.evaluate(() => window.__reloadCount), 2, "empty field allows the deferred command");
    await tick(h);
    h.eq(await page.evaluate(() => window.__reloadCount), 2, "deferred command is also deduplicated");

    h.step("real reload shows literal reason, navigates once, then starts a new baseline");
    await page.evaluate(() => { window.__ianCommands.reload = window.__defaultReload; });
    // Only deliver new commands on the new page; IDs are intentionally per-page.
    const reloadCommands = createClientCommandsMock();
    backend.rpc.client_commands_since = reloadCommands.rpc.client_commands_since;
    reloadCommands.add("reload", null, "<b>Update</b>");
    let reloads = 0;
    const countReload = (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame() && new URL(request.url()).pathname === "/index.html") reloads++;
    };
    page.on("request", countReload);
    const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded" });
    await tick(h);
    await page.waitForSelector(".client-command-toast");
    h.eq(await page.textContent(".client-command-toast"), "🔄 ian.lu gëtt aktualiséiert… <b>Update</b>", "reload toast escapes the reason");
    h.eq(await page.locator(".client-command-toast b").count(), 0, "reason cannot inject markup");
    await navigation;
    await ready(h);
    await tick(h);
    h.eq(reloads, 1, "actual reload navigated exactly once");
    h.eq(backend.callsTo("client_commands_since").at(-2).body.p_since, null, "reloaded page establishes a fresh baseline");
    page.off("request", countReload);

    h.step("close matching game: flush progress and score, stop iframe, return home");
    const arcadeCommands = createClientCommandsMock({ repeat: true });
    backend.rpc.client_commands_since = arcadeCommands.rpc.client_commands_since;
    await h.goto("/pixelbreak.html?g=snake");
    await ready(h);
    await page.waitForFunction(() => window.PB?.current?.id === "snake" && document.getElementById("gf")?.contentDocument?.body?.children.length);
    await page.evaluate(() => {
      document.getElementById("gf").contentWindow.eval("parent.postMessage({__pbSave:1,data:{remoteTest:42}},'*');parent.postMessage({__pb:1,score:321},'*')");
    });
    await page.waitForFunction(() => localStorage.getItem("pb_save_snake")?.includes("remoteTest"));
    arcadeCommands.add("close_game", "solitaire");
    await tick(h);
    h.eq(await page.evaluate(() => window.PB.current?.id), "snake", "mismatched game ID leaves game running");
    const savesBefore = backend.callsTo("game_saves").filter((call) => call.method === "POST").length;
    arcadeCommands.add("close_game", "snake", "Däi Kaddo ass do — maach d'Spill nees op 🎁");
    await tick(h);
    await page.waitForFunction(() => window.PB.current === null && !document.body.classList.contains("game-open"));
    const saves = backend.callsTo("game_saves").filter((call) => call.method === "POST");
    h.expect(saves.length > savesBefore, "remote close immediately upserts progress");
    h.expect(saves.some((call) => call.body.game_id === "snake" && call.body.data.remoteTest === 42 && call.query.includes("on_conflict=user_id%2Cgame_id")), "save upsert carries latest game state and conflict key");
    h.expect(backend.callsTo("scores").some((call) => call.method === "POST" && call.body.game_id === "snake" && call.body.score === 321), "score is upserted too");
    h.eq(new URL(page.url()).search, "", "URL returns to arcade home");
    h.eq(await page.getAttribute("#gf", "srcdoc"), "", "game iframe is cleared");
    h.eq(await page.textContent(".client-command-toast"), "Spill zougemaach Däi Kaddo ass do — maach d'Spill nees op 🎁", "close toast shows reason");
    await tick(h);
    h.eq(await page.locator(".client-command-toast").count(), 1, "duplicate close does not show a second toast");

    h.step("admin actions: exact arguments, confirms, light/dark at 390px");
    backend.rpc.client_commands_since = createClientCommandsMock().rpc.client_commands_since;
    await page.setViewportSize({ width: 390, height: 844 });
    const accept = (dialog) => dialog.accept();
    page.on("dialog", accept);
    for (const mode of ["light", "dark"]) {
      await page.evaluate((value) => localStorage.setItem("site_theme", JSON.stringify({ mode: value })), mode);
      await h.goto("/admin.html");
      await page.click("#tabOnline");
      await page.waitForSelector(".online-row");
      h.eq(await page.locator('[data-client-command="reload"]').count(), 2, "every row has Reload");
      h.eq(await page.locator('[data-client-command="close_game"]').count(), 1, "only arcade game row has Close game");
      for (const [selector, args] of [
        [`[data-user="${ME}"][data-client-command="reload"]`, { p_action: "reload", p_user: ME, p_game: null }],
        [`[data-user="${ME}"][data-client-command="close_game"]`, { p_action: "close_game", p_user: ME, p_game: "snake" }],
        ["#reloadAll", { p_action: "reload", p_user: null, p_game: null }],
      ]) {
        await page.click(selector);
        await page.waitForFunction(() => document.getElementById("commandStatus").textContent && !document.getElementById("reloadAll").disabled);
        h.eq(backend.callsTo("issue_client_command").at(-1).body, { ...args, p_reason: null, p_minutes: 60 }, `${mode}: command RPC arguments`);
      }
      h.expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${mode}: no overflow at 390px`);
      await h.shot(`admin-${mode}`);
    }
    page.off("dialog", accept);
    page.once("dialog", (dialog) => dialog.dismiss());
    const issued = backend.callsTo("issue_client_command").length;
    await page.click("#reloadAll");
    h.eq(backend.callsTo("issue_client_command").length, issued, "cancelled confirmation issues no command");
    backend.rpc.issue_client_command = () => ({ error: { message: "mock failure" } });
    page.once("dialog", accept);
    await page.click("#reloadAll");
    await page.waitForFunction(() => /konnt net/.test(document.getElementById("commandStatus").textContent));
    h.expect(await page.isEnabled("#reloadAll"), "RPC failure shows friendly error and releases buttons");
  },
};

runIfMain(import.meta.url, flow);
