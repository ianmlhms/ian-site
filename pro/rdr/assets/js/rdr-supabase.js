/**
 * rdr-supabase.js — a small fetch wrapper over Supabase's REST and auth
 * endpoints. Deliberately not the supabase-js SDK: this site has no build step
 * and no runtime dependencies.
 */
(() => {
  const config = window.RDR_CONFIG || {};
  const BASE_URL = String(config.supabaseUrl || "").replace(/\/+$/, "");
  const ANON_KEY = String(config.supabaseAnonKey || "");
  const SESSION_KEY = "rdr-admin-session";

  function isConfigured() {
    return BASE_URL.length > 0 && ANON_KEY.length > 0;
  }

  function readSession() {
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed.access_token === "string" ? parsed : null;
    } catch (error) {
      console.warn("Admin session could not be read.", error);
      return null;
    }
  }

  function writeSession(session) {
    try {
      if (session) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else window.sessionStorage.removeItem(SESSION_KEY);
    } catch (error) {
      console.warn("Admin session could not be stored.", error);
    }
  }

  function headers(extra = {}) {
    const session = readSession();
    return {
      apikey: ANON_KEY,
      Authorization: `Bearer ${session?.access_token || ANON_KEY}`,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  /** Surface what PostgREST actually said instead of a bare status code. */
  async function toError(response) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body.message || body.error_description || body.error || body.hint || "";
    } catch {
      detail = await response.text().catch(() => "");
    }
    const error = new Error(detail ? `${response.status}: ${detail}` : `Request failed with HTTP ${response.status}.`);
    error.status = response.status;
    return error;
  }

  async function request(pathname, { method = "GET", body, prefer, searchParams } = {}) {
    if (!isConfigured()) throw new Error("The database is not configured yet.");
    const url = new URL(`${BASE_URL}${pathname}`);
    if (searchParams) {
      Object.entries(searchParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      });
    }
    const response = await fetch(url, {
      method,
      headers: headers(prefer ? { Prefer: prefer } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw await toError(response);
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  const select = (table, searchParams) => request(`/rest/v1/${table}`, { searchParams });
  const insert = (table, rows) => request(`/rest/v1/${table}`, {
    method: "POST", body: rows, prefer: "return=representation",
  });
  const update = (table, searchParams, patch) => request(`/rest/v1/${table}`, {
    method: "PATCH", searchParams, body: patch, prefer: "return=representation",
  });
  const remove = (table, searchParams) => request(`/rest/v1/${table}`, { method: "DELETE", searchParams });
  const rpc = (name, args = {}) => request(`/rest/v1/rpc/${name}`, { method: "POST", body: args });

  async function signIn(email, password) {
    if (!isConfigured()) throw new Error("The database is not configured yet.");
    const response = await fetch(`${BASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) throw await toError(response);
    const session = await response.json();
    writeSession(session);
    return session;
  }

  function signOut() {
    writeSession(null);
  }

  window.RdrSupabase = Object.freeze({
    insert, isConfigured, readSession, remove, rpc, select, signIn, signOut, update,
  });
})();
