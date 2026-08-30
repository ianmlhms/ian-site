/* Line search — the second tool in the Bus & Zuch card.
 *
 * Type a line number, get its directions, open one to see every stop. It is the
 * same idea as the line search in bus.html, and it reads the same bundled index
 * that page does.
 *
 * It lives in its own module because it shares nothing with the route planner
 * except the card it sits in: different data source, different lifecycle, and
 * together they made one 600-line file. */
import { LINES_URL, LINE_RESULT_LIMIT } from "./content.js?v=1";
import { UI } from "./copy.js?v=1";
import { failedState, mutedLine } from "./states.js?v=1";
import { attachExpandable, makeExpandableRow } from "./expand.js?v=1";

const FETCH_TIMEOUT_MS = 9000;
const DEBOUNCE_MS = 160;

function directionRow(lineName, direction) {
  const { row, detail } = makeExpandableRow();

  const line = document.createElement("span");
  line.className = "dline";
  line.textContent = lineName;

  const heading = document.createElement("span");
  heading.className = "drow-title";
  heading.textContent = `${UI.lineDirection} ${direction?.h ?? ""}`;

  row.append(line, heading, detail);

  // Built only when the row is first opened — a line can carry sixty stops and
  // a search shows several lines at once.
  const build = () => {
    const stops = document.createElement("div");
    stops.className = "dlist";
    for (const stopName of Array.isArray(direction?.s) ? direction.s : []) {
      const stop = document.createElement("div");
      stop.className = "drow-sub";
      stop.textContent = stopName;
      stops.append(stop);
    }
    return stops;
  };

  return { row, build };
}

/* Prefix matches first, then substrings — typing "3" should offer line 3 before
 * line 213. */
function matchLines(payload, query) {
  const needle = query.toLocaleLowerCase();
  const names = Object.keys(payload);
  const prefix = names.filter((name) => name.toLocaleLowerCase().startsWith(needle));
  const substring = names.filter((name) => {
    const lower = name.toLocaleLowerCase();
    return !lower.startsWith(needle) && lower.includes(needle);
  });
  return [...prefix, ...substring].slice(0, LINE_RESULT_LIMIT);
}

export function mountLineSearch(host) {
  let destroyed = false;
  let data = null;
  let pending = null;
  let controller = null;
  let version = 0;
  let debounce = null;
  const builders = new WeakMap();

  const tool = document.createElement("section");
  tool.className = "dline-tool";
  const input = document.createElement("input");
  input.className = "dbtn dline-input";
  input.type = "search";
  input.placeholder = UI.lineSearch;
  input.setAttribute("aria-label", UI.lineSearch);
  const results = document.createElement("div");
  results.className = "dline-results";
  tool.append(input, results);
  host.append(tool);

  const expandable = attachExpandable(results, builders);

  /* The index is 776 KB raw. Fetching it at mount would put that on every
   * visitor who never touches the search, so it waits for the first keystroke
   * and is then kept for the life of the module. */
  const ensureLines = () => {
    if (data) return Promise.resolve(data);
    if (pending) return pending;

    const abort = new AbortController();
    controller = abort;
    const timeout = window.setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);

    pending = fetch(LINES_URL, { signal: abort.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (!payload || Array.isArray(payload) || typeof payload !== "object") {
          throw new TypeError("Invalid lines payload");
        }
        data = payload;
        return data;
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (controller === abort) controller = null;
        if (!data) pending = null;      // let a failed load be retried
      });

    return pending;
  };

  const render = (query, payload) => {
    const names = matchLines(payload, query);
    if (names.length === 0) {
      results.replaceChildren();       // no match is empty, not an error
      return;
    }

    const list = document.createElement("div");
    list.className = "dlist";
    for (const name of names) {
      const directions = Array.isArray(payload[name]) ? payload[name] : [];
      for (const direction of directions) {
        const entry = directionRow(name, direction);
        builders.set(entry.row, entry);
        list.append(entry.row);
      }
    }
    results.replaceChildren(list);
  };

  const search = (query, token) => {
    results.replaceChildren(mutedLine(UI.loading));
    void ensureLines()
      .then((payload) => {
        if (destroyed || token !== version) return;
        render(query, payload);
      })
      .catch(() => {
        if (destroyed || token !== version) return;
        results.replaceChildren(failedState("lines"));
      });
  };

  const onInput = () => {
    const query = input.value.trim();
    const token = ++version;
    if (debounce !== null) {
      window.clearTimeout(debounce);
      debounce = null;
    }
    if (!query) {
      results.replaceChildren();
      return;
    }

    // Start the big fetch on the first keystroke but debounce the RENDER, so
    // the download overlaps with the rest of the typing instead of following it.
    const lines = ensureLines();
    void lines.catch(() => {});
    results.replaceChildren(mutedLine(UI.loading));

    debounce = window.setTimeout(() => {
      debounce = null;
      void lines
        .then((payload) => {
          if (destroyed || token !== version) return;
          render(query, payload);
        })
        .catch(() => {
          if (destroyed || token !== version) return;
          results.replaceChildren(failedState("lines"));
        });
    }, DEBOUNCE_MS);
  };

  const onRetry = (event) => {
    const button = event.target.closest('[data-retry="lines"]');
    if (button && results.contains(button)) search(input.value.trim(), ++version);
  };

  input.addEventListener("input", onInput);
  results.addEventListener("click", onRetry);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      version += 1;
      controller?.abort();
      controller = null;
      if (debounce !== null) window.clearTimeout(debounce);
      debounce = null;
      input.removeEventListener("input", onInput);
      results.removeEventListener("click", onRetry);
      expandable.detach();
    },
  };
}
