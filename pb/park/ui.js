import { RULES, PHASE, STAFF, RIDES, UNLOCKS, MILESTONES } from "/pb/park/data.js";
import { KINDS } from "/pb/park/build.js";

const CATEGORIES = [["path", "Paths"], ["ride", "Rides"], ["stall", "Stalls"],
  ["facility", "Facilities"], ["scenery", "Scenery"]];
const moneyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money = value => moneyFormat.format(Number.isFinite(value) ? value : 0);
const titleCase = value => value.charAt(0).toUpperCase() + value.slice(1);
const byId = id => document.getElementById(id);

function write(id, value) {
  const element = byId(id);
  if (element && element.textContent !== String(value)) element.textContent = value;
}

function numberField(action, key, value, max, label) {
  return `<form class="number-row" data-command="${action}" data-key="${key}">
    <label><span>${label}</span><input aria-label="${label}" type="number" inputmode="numeric"
      min="0" max="${max}" step="1" required value="${value}"></label>
    <button type="submit">Set</button></form>`;
}

export class ParkUI {
  constructor(callbacks) {
    this.callbacks = callbacks;
    this.panel = null;
    this.category = "ride";
    this.selectedId = null;
    this.tool = null;
    this.isWalkMode = false;
    this.toastTimer = null;
    this.root = byId("shell");
    this.root.addEventListener("click", event => this.click(event));
    this.root.addEventListener("submit", event => this.submit(event));
    this.root.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      if (this.isWalkMode) {
        this.callbacks.exitWalk();
        return;
      }
      this.closePanel();
      this.callbacks.cancel();
    });
    byId("maintenance").addEventListener("change", event => {
      this.callbacks.command("maintenance", event.target.checked);
    });
  }

  click(event) {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.panel) { this.openPanel(button.dataset.panel); return; }
    if (button.dataset.category) {
      this.category = button.dataset.category;
      this.renderBuild();
      return;
    }
    if (button.dataset.tool) {
      this.callbacks.setTool(button.dataset.tool);
      this.closePanel();
      return;
    }
    const action = button.dataset.action;
    if (action === "close") this.closePanel();
    else if (action === "repair") this.callbacks.command("repair", this.selectedId);
    else if (action === "demolish") {
      if (this.callbacks.command("remove", this.selectedId)) {
        this.selectedId = null;
        this.closePanel();
        this.callbacks.cancel();
      }
    } else if (action === "staff") {
      const role = button.dataset.role;
      if (!Object.hasOwn(STAFF, role)) return;
      this.callbacks.command("staff", role, this.state.saved.s[STAFF[role].index] + Number(button.dataset.delta));
    } else if (action && typeof this.callbacks[action] === "function") this.callbacks[action]();
  }

  submit(event) {
    const form = event.target;
    if (!form.matches("form[data-command]")) return;
    event.preventDefault();
    const input = form.querySelector("input");
    const value = input.value.trim() === "" ? NaN : Number(input.value);
    if (!Number.isInteger(value) || value < 0 || value > RULES.maxPrice) {
      this.notify("Command refused: invalid-price");
      return;
    }
    const action = form.dataset.command;
    const ok = action === "ticket" ? this.callbacks.command(action, value)
      : this.callbacks.command(action, form.dataset.key, value);
    if (ok) input.blur();
  }

  openPanel(name) {
    if (this.isWalkMode) return;
    if (!["build", "manage", "objectives", "inspect", "help"].includes(name)) return;
    this.panel = name;
    byId("panel").hidden = false;
    for (const section of document.querySelectorAll("[data-section]")) section.hidden = section.dataset.section !== name;
    write("panelTitle", { build: "Build your park", manage: "Park operations", objectives: "The road to tycoon",
      inspect: "Attraction", help: "Welcome, park maker" }[name]);
    if (name === "build") this.renderBuild();
    if (name === "manage") this.renderManagement();
    if (name === "objectives") this.renderObjectives();
    this.update(this.state);
  }

  closePanel() {
    byId("panel").hidden = true;
    this.panel = null;
  }

  renderBuild() {
    byId("categories").innerHTML = CATEGORIES.map(([id, label]) =>
      `<button data-category="${id}" aria-pressed="${this.category === id}">${label}</button>`).join("");
    const paths = [{ id: "path", name: "Garden path", cost: RULES.pathCost, detail: "Connect to the entrance" },
      { id: "erase-path", name: "Remove path", cost: 0, detail: "Keep your attractions connected" },
      { id: "land", name: "Expand land", cost: RULES.landCost, detail: "One adjacent 10 × 10 parcel" }];
    const options = this.category === "path" ? paths : KINDS.filter(kind =>
      kind.type === this.category && this.state.saved.u & (1 << kind.unlock));
    byId("catalog").innerHTML = options.map(kind => `<button class="build-card ${this.category}"
      data-tool="${kind.id}"><strong>${kind.name}</strong><b>${money(kind.cost)}</b>
      <small>${kind.detail ?? `${kind.footprint.join(" × ")} tiles · ${money(kind.upkeep)}/hour`}</small></button>`).join("");
    const next = UNLOCKS.find(tier => !(this.state.saved.u & (1 << tier.id)));
    write("unlockHint", next ? `More attractions unlock at ${next.name}. See Objectives for progress.` : "All attractions unlocked. Make something wonderful.");
    this.buildUnlocks = this.state.saved.u;
  }

  renderManagement() {
    byId("ticketControl").innerHTML = numberField("ticket", "", this.state.saved.p, RULES.maxPrice, "Admission price ($)");
    byId("ridePrices").innerHTML = RIDES.filter(kind => this.state.saved.u & (1 << kind.unlock))
      .map(kind => numberField("price", kind.id, this.state.saved.rp[RIDES.indexOf(kind)], RULES.maxPrice, `${kind.name} ($)`)).join("");
    byId("staffControls").innerHTML = Object.entries(STAFF).map(([role, details]) =>
      `<div class="staff-row"><div><strong>${titleCase(role)}</strong><small>${money(details.wage)}/hour each</small></div>
      <button data-action="staff" data-role="${role}" data-delta="-1" aria-label="Dismiss one ${role}">−</button>
      <b id="staff-${role}">0</b><button data-action="staff" data-role="${role}" data-delta="1"
      aria-label="Hire one ${role}">+</button></div>`).join("");
    this.manageUnlocks = this.state.saved.u;
  }

  inspect(id) {
    const object = this.state.derived.objects[id];
    if (!object) return;
    this.selectedId = id;
    this.openPanel("inspect");
    const kind = KINDS[object.k];
    byId("objectPrice").innerHTML = kind.type === "ride"
      ? numberField("price", kind.id, this.state.saved.rp[object.k], RULES.maxPrice, "Price for this ride type ($)")
      : `<p>${kind.salePrice !== undefined ? `Service price: ${money(kind.salePrice)}` : "No admission charge"}</p>`;
    this.updateInspector();
  }

  updateInspector() {
    const object = this.state.derived.objects[this.selectedId];
    if (!object) { this.closePanel(); return; }
    const kind = KINDS[object.k];
    const reachable = this.state.derived.network.entrances[object.id]?.reachable;
    write("panelTitle", kind.name);
    write("objectStatus", object.b ? `BROKEN · ${object.b} repair work remaining` : kind.need
      ? reachable ? "Open · connected to entrance" : "No access · connect a path beside the white entrance marker" : "Placed in your park");
    byId("objectStatus").classList.toggle("danger-text", Boolean(object.b) || Boolean(kind.need && !reachable));
    write("objectHealth", `${object.h}%`);
    write("objectVisits", this.state.derived.stats.visitsByObject[object.id] ?? 0);
    write("objectIncome", money(this.state.derived.stats.incomeByObject[object.id] ?? 0));
    write("objectUpkeep", `${money(kind.upkeep)}/hour`);
    write("objectQueue", this.state.derived.guests.filter(guest => guest.target === object.id + 1 && guest.phase === PHASE.QUEUE).length);
    write("demolishButton", `Demolish · refund ${money(Math.floor(kind.cost * RULES.refundFraction))}`);
    byId("repairButton").hidden = kind.type !== "ride" || !object.b;
    write("repairButton", `Repair now · ${money(RULES.repairCost)}`);
  }

  renderObjectives() {
    byId("milestones").innerHTML = MILESTONES.map((goal, index) =>
      `<article class="objective"><div><strong>${goal.name}</strong><b id="goalState-${index}"></b></div>
      <p id="goalProgress-${index}"></p><small>Reward ${money(goal.cash)}</small></article>`).join("");
    byId("tiers").innerHTML = UNLOCKS.map((tier, index) => `<article class="objective">
      <div><strong>${tier.name}</strong><b id="tierState-${index}"></b></div><p id="tierProgress-${index}"></p></article>`).join("");
  }

  progress(goal) {
    const { saved, derived } = this.state;
    const lines = [];
    if (goal.guests) lines.push(`${Math.min(saved.a, goal.guests)}/${goal.guests} total admissions`);
    if (goal.value) lines.push(`${money(derived.parkValue)} / ${money(goal.value)} value`);
    if (goal.rating) lines.push(`${derived.rating}/${goal.rating} rating`);
    return lines.join(" · ") || "Your park starts here.";
  }

  updateObjectives() {
    MILESTONES.forEach((goal, index) => {
      const complete = Boolean(this.state.saved.z & (1 << index));
      write(`goalState-${index}`, complete ? "Achieved" : "In progress");
      write(`goalProgress-${index}`, complete ? "Reward received" : this.progress(goal));
    });
    UNLOCKS.forEach((tier, index) => {
      const unlocked = Boolean(this.state.saved.u & (1 << tier.id));
      write(`tierState-${index}`, unlocked ? "Unlocked" : "Locked");
      write(`tierProgress-${index}`, unlocked ? "Attractions available in Build" : this.progress(tier));
    });
  }

  setTool(tool, rotation) {
    this.tool = tool;
    const kind = KINDS.find(entry => entry.id === tool);
    byId("buildBar").hidden = !tool;
    byId("rotateButton").hidden = !kind;
    write("toolName", kind?.name ?? { path: "Garden path", "erase-path": "Remove path", land: "Expand land" }[tool] ?? "Inspect");
    write("rotateButton", `Rotate ${rotation * 90}°`);
    write("placementReason", "Tap a tile to preview. Drag to pan.");
    byId("confirmButton").disabled = true;
    write("confirmButton", tool === "erase-path" ? "Remove" : tool === "land" ? "Buy land" : "Build here");
  }

  showPreview(preview, anchored) {
    const hasTile = Boolean(preview);
    byId("confirmButton").disabled = !hasTile || !anchored;
    const kind = KINDS.find(entry => entry.id === this.tool);
    write("placementReason", !hasTile ? "Tap a tile to preview. Drag to pan." : !preview.ok
      ? `Cannot build: ${preview.reason}` : `${preview.x}, ${preview.y} · ${kind?.need ? "White dot = entrance; add a path beside it. " : ""}${anchored ? "Ready to confirm." : "Tap to select."}`);
    byId("placementReason").classList.toggle("danger-text", hasTile && !preview.ok);
  }

  notify(message) {
    clearTimeout(this.toastTimer);
    write("notice", message);
    byId("notice").hidden = false;
    this.toastTimer = setTimeout(() => { byId("notice").hidden = true; }, 4500);
  }

  update(state) {
    if (!state) return;
    this.state = state;
    const { saved, derived } = state;
    write("cash", money(saved.c));
    write("rating", `${derived.rating}/100`);
    write("guests", derived.guestCount);
    write("parkValue", money(derived.parkValue));
    write("day", Math.floor(derived.day) + 1);
    write("profit", money(derived.profitPerDay));
    byId("profit").classList.toggle("danger-text", derived.profitPerDay < 0);
    byId("bankrupt").hidden = !derived.bankrupt;
    if (this.panel === "build" && this.buildUnlocks !== saved.u) this.renderBuild();
    if (this.panel === "inspect") this.updateInspector();
    if (this.panel === "objectives") this.updateObjectives();
    if (this.panel !== "manage" && this.panel !== "inspect") return;
    if (this.panel === "manage") {
      if (this.manageUnlocks !== saved.u) this.renderManagement();
      for (const [role, details] of Object.entries(STAFF)) write(`staff-${role}`, saved.s[details.index]);
      byId("maintenance").checked = saved.m;
      write("parkHealth", `${Math.round(derived.happiness)}% happiness · ${Math.round(derived.cleanliness)}% cleanliness · ${Math.round(derived.queueTime)}s average queue`);
    }
    for (const form of document.querySelectorAll("form[data-command]")) {
      const input = form.querySelector("input");
      if (document.activeElement === input) continue;
      const index = RIDES.findIndex(kind => kind.id === form.dataset.key);
      input.value = form.dataset.command === "ticket" ? saved.p : saved.rp[index];
    }
  }

  setClock(speed, paused) {
    write("speedButton", `${speed}×`);
    write("pauseButton", paused ? "Resume" : "Pause");
    byId("pauseButton").setAttribute("aria-pressed", String(paused));
  }

  setWalk(isActive) {
    this.isWalkMode = isActive;
    this.root.dataset.walk = String(isActive);
    write("walkButton", isActive ? "Exit walk" : "Walk");
    byId("walkButton").setAttribute("aria-pressed", String(isActive));
    byId("walkControls").hidden = !isActive;
    for (const button of document.querySelectorAll("button[data-panel]")) button.disabled = isActive;
    const centerButton = document.querySelector('button[data-action="home"]');
    if (centerButton) centerButton.disabled = isActive;
  }
}
