// HTTP plumbing for the Cloudflare inbox Worker: bearer token from the
// Supabase session (login still lives there), JSON in/out, readable errors.

const NOT_SIGNED_IN = "Du bass net ageloggt.";

export class CloudHttpError extends Error {
  constructor(status, code, detail) {
    super(`HTTP ${status}${code ? ` ${code}` : ""}: ${detail}`);
    this.name = "CloudHttpError";
    this.status = status;
    this.code = code;
  }
}

// Friendly message for the UI; the technical cause only goes to the console.
export function cloudError(message, cause) {
  console.error(message, cause);
  return new Error(message);
}

export async function guarded(message, work) {
  try {
    return await work();
  } catch (error) {
    throw cloudError(message, error);
  }
}

export async function accessToken(supabase) {
  const { data, error } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) throw error || new Error(NOT_SIGNED_IN);
  return token;
}

async function failureOf(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // The body was not JSON; the status code is all we have.
  }
  return new CloudHttpError(response.status, payload?.code || "", payload?.error || response.statusText);
}

function withQuery(path, query) {
  const params = new URLSearchParams(
    Object.entries(query || {}).filter(([, value]) => value !== undefined && value !== null),
  );
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

export function createCloudHttp({ baseUrl, fetchFn }) {
  const root = baseUrl.replace(/\/+$/, "");

  // options: { query, json } or { body, contentType } for a raw upload.
  async function send(supabase, method, path, options = {}) {
    const headers = { authorization: `Bearer ${await accessToken(supabase)}` };
    let body;
    if (options.json !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options.body !== undefined) {
      headers["content-type"] = options.contentType;
      body = options.body;
    }
    const response = await fetchFn(root + withQuery(path, options.query), { method, headers, body });
    if (!response.ok) throw await failureOf(response);
    return response.status === 204 ? null : response.json();
  }

  return Object.freeze({
    root,
    get: (supabase, path, query) => send(supabase, "GET", path, { query }),
    post: (supabase, path, json) => send(supabase, "POST", path, { json }),
    patch: (supabase, path, json) => send(supabase, "PATCH", path, { json }),
    put: (supabase, path, body, contentType) => send(supabase, "PUT", path, { body, contentType }),
    remove: (supabase, path) => send(supabase, "DELETE", path),
  });
}
