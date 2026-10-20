// Picks the inbox data backend at startup.
//   cloud    -> Cloudflare Worker (inbox-cloud-data.js), the default
//   supabase -> the old bridge_* tables (inbox-data.js + inbox-mail-data.js)
// ROLLBACK: change DEFAULT_BACKEND below to BACKEND_SUPABASE (one line).
// Per browser: ?backend=supabase or ?backend=cloud in the URL is remembered.
// Tests: ?cloud=<url> points the cloud backend at a local mock (loopback hosts
// only, because the login token is sent to that URL); ?cloud= (empty) forgets it.

export const BACKEND_SUPABASE = "supabase";
export const BACKEND_CLOUD = "cloud";
export const DEFAULT_BACKEND = BACKEND_CLOUD;
export const CLOUD_BASE_URL = "https://ianlu-inbox.ianlu.workers.dev";

const STORAGE_BACKEND = "inbox.backend";
const STORAGE_CLOUD_URL = "inbox.cloudUrl";
const BACKENDS = Object.freeze([BACKEND_SUPABASE, BACKEND_CLOUD]);
const LOOPBACK_HOSTS = Object.freeze(["127.0.0.1", "localhost", "[::1]"]);

// What the Supabase layer lacks. Chats there are not paged and never marked read.
const SUPABASE_EXTRAS = Object.freeze({
  fetchOlderMessages: async () => [],
  hasOlderMessages: () => false,
  markChatRead: async () => null,
});

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStored(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStored(storage, key, value) {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the choice just lasts for this page.
  }
}

export function isAllowedCloudUrl(text) {
  let url;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  if (url.origin === CLOUD_BASE_URL) return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname);
}

export function chooseBackend(search, storage) {
  const requested = new URLSearchParams(search).get("backend");
  if (BACKENDS.includes(requested)) {
    writeStored(storage, STORAGE_BACKEND, requested);
    return requested;
  }
  const stored = readStored(storage, STORAGE_BACKEND);
  return BACKENDS.includes(stored) ? stored : DEFAULT_BACKEND;
}

export function chooseCloudUrl(search, storage) {
  const requested = new URLSearchParams(search).get("cloud");
  if (requested === "") writeStored(storage, STORAGE_CLOUD_URL, null);
  else if (requested !== null && isAllowedCloudUrl(requested)) {
    writeStored(storage, STORAGE_CLOUD_URL, new URL(requested).origin);
  } else if (requested !== null) {
    console.warn("Inbox: ?cloud= ignored (only loopback test servers are accepted)");
  }
  const stored = readStored(storage, STORAGE_CLOUD_URL);
  return stored && isAllowedCloudUrl(stored) ? stored : CLOUD_BASE_URL;
}

async function loadSupabaseBackend() {
  const [chats, mail] = await Promise.all([
    import("./inbox-data.js?v=4"),
    import("./inbox-mail-data.js?v=2"),
  ]);
  return Object.freeze({
    ...SUPABASE_EXTRAS,
    ...chats,
    ...mail,
    name: BACKEND_SUPABASE,
    // Stale last_seen_at is the bridge's only liveness signal here.
    hasLivePresence: false,
    unsubscribe: (supabase, channel) => supabase.removeChannel(channel),
  });
}

async function loadCloudBackend(baseUrl) {
  const { createCloudData } = await import("./inbox-cloud-data.js?v=1");
  return Object.freeze({
    ...createCloudData({ baseUrl }),
    name: BACKEND_CLOUD,
    // The Worker pushes presence and forces status to offline itself.
    hasLivePresence: true,
  });
}

export async function loadBackend({
  search = window.location.search,
  storage = browserStorage(),
} = {}) {
  const name = chooseBackend(search, storage);
  if (name === BACKEND_SUPABASE) return loadSupabaseBackend();
  return loadCloudBackend(chooseCloudUrl(search, storage));
}
