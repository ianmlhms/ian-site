/* The two placeholder states every fetching showcase needs.
 *
 * They were copied into each module, which meant a retry button could quietly
 * differ between cards. One definition, used by all of them. */
import { UI } from "./copy.js?v=1";

const SKELETON_ROWS = 3;

export function loadingState(rows = SKELETON_ROWS) {
  const skeleton = document.createElement("div");
  skeleton.className = "dskel";
  for (let index = 0; index < rows; index += 1) {
    const row = document.createElement("div");
    row.className = "dskel-row";
    skeleton.append(row);
  }
  return skeleton;
}

/* `retryTarget` lands on the button as data-retry, so one card can host two
 * independent things that can fail (the route planner and the line search) and
 * still tell their retry buttons apart. */
export function failedState(retryTarget = "plan") {
  const failure = document.createElement("p");
  failure.className = "dfail";
  failure.append(document.createTextNode(UI.failed));
  const button = document.createElement("button");
  button.className = "dbtn";
  button.type = "button";
  button.dataset.retry = retryTarget;
  button.textContent = UI.retry;
  failure.append(button);
  return failure;
}

export function mutedLine(text) {
  const line = document.createElement("p");
  line.className = "dmuted";
  line.textContent = text;
  return line;
}
