// Zentraler Zustandscontainer: hält das aktive Projekt, benachrichtigt Listener,
// verwaltet Undo/Redo auf dem aktiven Entwurf. Kein DOM.

import { activeVariantOf, activeDesignOf } from './model.js';

const UNDO_LIMIT = 50;

export class Store {
  constructor() {
    this.project = null;
    this.ui = {
      view: 'library', // library | wizard | site | plan | furnish | facade | view3d | compare
      buildingId: null,
      floorId: null,
      selection: null, // { kind:'room'|'furniture'|'building'|'outdoor'|'shaft'|'opening', id }
      rightPanel: 'inspector', // 'inspector' | 'metrics'
    };
    this.listeners = new Set();
    this.undoStack = [];
    this.redoStack = [];
    this._suspendHistory = false;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(reason = 'change') {
    for (const fn of this.listeners) fn(reason, this);
  }

  setProject(project) {
    this.project = project;
    this.undoStack = [];
    this.redoStack = [];
    this.emit('project');
  }

  get design() {
    return this.project ? activeDesignOf(this.project) : null;
  }

  get variant() {
    return this.project ? activeVariantOf(this.project) : null;
  }

  // Ruft mutator(design) auf und markiert den Zustand als geändert.
  // pushHistory=true legt einen Undo-Punkt VOR der Änderung an.
  mutate(mutator, { pushHistory = true, reason = 'edit' } = {}) {
    if (!this.design) return;
    if (pushHistory && !this._suspendHistory) {
      this._pushUndo();
    }
    mutator(this.design);
    this.design.meta.updatedAt = Date.now();
    this.emit(reason);
  }

  _pushUndo() {
    this.undoStack.push(JSON.stringify(this.design));
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (!this.undoStack.length || !this.variant) return;
    const snapshot = this.undoStack.pop();
    this.redoStack.push(JSON.stringify(this.design));
    this._suspendHistory = true;
    this.variant.current = JSON.parse(snapshot);
    this._suspendHistory = false;
    this.emit('undo');
  }

  redo() {
    if (!this.redoStack.length || !this.variant) return;
    const snapshot = this.redoStack.pop();
    this.undoStack.push(JSON.stringify(this.design));
    this._suspendHistory = true;
    this.variant.current = JSON.parse(snapshot);
    this._suspendHistory = false;
    this.emit('redo');
  }

  setView(view, extra = {}) {
    this.ui = { ...this.ui, view, selection: null, ...extra };
    this.emit('view');
  }

  select(selection) {
    this.ui = { ...this.ui, selection };
    this.emit('selection');
  }

  clearSelection() {
    if (!this.ui.selection) return;
    this.ui = { ...this.ui, selection: null };
    this.emit('selection');
  }

  currentBuilding() {
    if (!this.design) return null;
    return this.design.buildings.find((b) => b.id === this.ui.buildingId) || this.design.buildings[0];
  }

  currentFloor() {
    const b = this.currentBuilding();
    if (!b) return null;
    return b.floors.find((f) => f.id === this.ui.floorId) || b.floors[0];
  }
}

export const store = new Store();
