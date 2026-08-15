// Konkrete Persistenz-Implementierung über localStorage. Wird ausschließlich über
// adapter.js angesprochen, damit sie sich später 1:1 durch einen ApiAdapter ersetzen lässt.

import { migrateProject } from '../core/migrate.js';

const LIB_KEY = 'housePlannerLibrary_v1';
const PROJECT_PREFIX = 'housePlan_';

function readIndex() {
  try {
    return JSON.parse(localStorage.getItem(LIB_KEY)) || [];
  } catch {
    return [];
  }
}

function writeIndex(list) {
  localStorage.setItem(LIB_KEY, JSON.stringify(list));
}

function projectKey(id) {
  return PROJECT_PREFIX + id;
}

function updateIndexEntry(project, thumb) {
  const list = readIndex();
  const idx = list.findIndex((e) => e.id === project.id);
  const entry = {
    id: project.id,
    name: project.name,
    style: project.style,
    updatedAt: Date.now(),
    thumb: thumb || (idx >= 0 ? list[idx].thumb : null),
    variantCount: project.variants.length,
  };
  if (idx >= 0) list[idx] = entry;
  else list.push(entry);
  writeIndex(list);
}

export const localStorageAdapter = {
  list() {
    return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
  },

  load(id) {
    const raw = localStorage.getItem(projectKey(id));
    if (!raw) return null;
    try {
      return migrateProject(JSON.parse(raw));
    } catch {
      return null;
    }
  },

  save(project, thumb) {
    project.lastOpenedAt = Date.now();
    localStorage.setItem(projectKey(project.id), JSON.stringify(project));
    updateIndexEntry(project, thumb);
  },

  remove(id) {
    localStorage.removeItem(projectKey(id));
    writeIndex(readIndex().filter((e) => e.id !== id));
  },

  exportProjectJSON(project) {
    return JSON.stringify(project, null, 2);
  },

  importProjectJSON(text) {
    const raw = JSON.parse(text);
    const project = migrateProject(raw);
    // neue ID vergeben, damit ein Import nie ein bestehendes Projekt überschreibt
    project.id = project.id + '_import_' + Date.now().toString(36);
    return project;
  },

  usage() {
    let bytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key === LIB_KEY || key.startsWith(PROJECT_PREFIX))) {
        bytes += (localStorage.getItem(key) || '').length;
      }
    }
    const limit = 5 * 1024 * 1024; // ~5 MB, browserabhängig
    return { bytes, limit, pct: Math.min(100, Math.round((bytes / limit) * 100)) };
  },
};
