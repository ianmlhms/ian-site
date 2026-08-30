/* Rows that open in place to reveal their detail.
 *
 * Used by both halves of the transit card — an itinerary opening into its stop
 * list, and a bus line opening into its route — so the keyboard handling and
 * the aria bookkeeping exist once rather than twice.
 *
 * A row opts in with data-expandable and holds a `[data-detail]` child. The
 * detail is built on FIRST open, from a builder registered in `builders`, so a
 * result list of sixty stops costs nothing until someone asks for it. */

export function toggleDetail(row, builders) {
  const detail = row.querySelector(":scope > [data-detail]");
  if (!detail) return;

  const entry = builders.get(row);
  if (!detail.dataset.built && entry) {
    detail.replaceChildren(entry.build());
    detail.dataset.built = "true";
    builders.delete(row);
  }

  const willOpen = detail.hidden;
  detail.hidden = !willOpen;
  row.setAttribute("aria-expanded", String(willOpen));
}

/* Returns a detach() — the guided tour unmounts these modules, and a listener
 * left on a detached container is the leak that outlives the card. */
export function attachExpandable(container, builders) {
  const onClick = (event) => {
    const row = event.target.closest("[data-expandable]");
    if (row && container.contains(row)) toggleDetail(row, builders);
  };

  const onKeyDown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("[data-expandable]");
    // Only the row itself — never a button that happens to sit inside it.
    if (!row || !container.contains(row) || event.target !== row) return;
    event.preventDefault();
    toggleDetail(row, builders);
  };

  container.addEventListener("click", onClick);
  container.addEventListener("keydown", onKeyDown);

  return {
    detach() {
      container.removeEventListener("click", onClick);
      container.removeEventListener("keydown", onKeyDown);
    },
  };
}

/* Marks a row as an expandable, keyboard-reachable control. */
export function makeExpandableRow() {
  const row = document.createElement("div");
  row.className = "drow expandable";
  row.dataset.expandable = "true";
  row.setAttribute("role", "button");
  row.setAttribute("tabindex", "0");
  row.setAttribute("aria-expanded", "false");

  const detail = document.createElement("div");
  detail.className = "drow-detail";
  detail.hidden = true;
  detail.dataset.detail = "true";
  return { row, detail };
}
