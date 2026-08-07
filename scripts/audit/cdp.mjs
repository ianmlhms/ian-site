/* Minimal Chrome DevTools Protocol client — no npm, Node's built-in WebSocket.
 *
 * Enough of CDP to open a tab at a chosen viewport, load a page and run a
 * function in it. Deliberately tiny: the site has no build step and no
 * node_modules, so pulling in Puppeteer for a lint script would be the only
 * dependency in the repo. */
import { spawn } from "node:child_process";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const LAUNCH_TIMEOUT_MS = 15000;
const COMMAND_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 120;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForEndpoint(port) {
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch { /* not listening yet */ }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Chrome did not open a debugging port on ${port} within ${LAUNCH_TIMEOUT_MS}ms`);
}

/** Launch headless Chrome and return a connected client. */
export async function launchChrome(port, profileDir) {
  const child = spawn(CHROME, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
    "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    "--hide-scrollbars", "--force-device-scale-factor=1",
  ], { stdio: "ignore" });
  child.unref();
  const endpoint = await waitForEndpoint(port);
  const client = await connect(endpoint);
  client.kill = () => child.kill();
  return client;
}

function connect(endpoint) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    const pending = new Map();
    const listeners = new Map();
    let nextId = 0;

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
        else entry.resolve(message.result);
        return;
      }
      const key = `${message.sessionId || ""}:${message.method}`;
      (listeners.get(key) || []).forEach((fn) => fn(message.params));
    });
    socket.addEventListener("error", () => reject(new Error("CDP socket error")));
    socket.addEventListener("open", () => resolve({
      send(method, params = {}, sessionId) {
        const id = (nextId += 1);
        socket.send(JSON.stringify({ id, method, params, sessionId }));
        return new Promise((res, rej) => {
          const timer = setTimeout(() => {
            pending.delete(id);
            rej(new Error(`${method} timed out after ${COMMAND_TIMEOUT_MS}ms`));
          }, COMMAND_TIMEOUT_MS);
          pending.set(id, { resolve: res, reject: rej, timer, method });
        });
      },
      once(method, sessionId) {
        const key = `${sessionId || ""}:${method}`;
        return new Promise((res) => {
          const list = listeners.get(key) || [];
          const fn = (params) => {
            listeners.set(key, (listeners.get(key) || []).filter((entry) => entry !== fn));
            res(params);
          };
          listeners.set(key, [...list, fn]);
        });
      },
      close() { socket.close(); },
    }));
  });
}

/** Open a tab at a fixed viewport, load `url`, and return its session id. */
export async function openPage(client, url, width, height) {
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  await client.send("Page.enable", {}, sessionId);
  await client.send("Runtime.enable", {}, sessionId);
  await client.send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile: width < 500,
  }, sessionId);
  const loaded = client.once("Page.loadEventFired", sessionId);
  await client.send("Page.navigate", { url }, sessionId);
  await Promise.race([loaded, sleep(COMMAND_TIMEOUT_MS)]);
  return { targetId, sessionId };
}

/** Run `fn` (a self-contained function) inside the page and return its result. */
export async function evaluate(client, sessionId, fn, argument) {
  const expression = `(${fn.toString()})(${JSON.stringify(argument ?? null)})`;
  const result = await client.send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || "page script threw");
  }
  return result.result.value;
}

export async function closePage(client, targetId) {
  await client.send("Target.closeTarget", { targetId }).catch(() => {});
}

export { sleep };
