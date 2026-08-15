import { migrateProject } from '../core/migrate.js';
import { toast } from '../ui/dom.js';

const WRITE_DELAY_MS = 800;

let database = null;
let projects = new Map();
let pendingUpserts = new Map();
let pendingDeletes = new Set();
let writeTimer = null;
let flushPromise = null;
let unloading = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cachedRecord(project, thumb, updatedAt) {
  return {
    project: migrateProject(clone(project)),
    thumb: thumb || null,
    updatedAt,
  };
}

function rowToRecord(row) {
  const timestamp = Date.parse(row.updated_at);
  return cachedRecord(row.data, row.thumb, Number.isFinite(timestamp) ? timestamp : Date.now());
}

function toRow(record) {
  const project = record.project;
  return {
    house_id: project.id,
    name: project.name,
    style: project.style,
    variant_count: project.variants.length,
    thumb: record.thumb,
    data: clone(project),
  };
}

function scheduleFlush() {
  clearTimeout(writeTimer);
  if (unloading) {
    void flushPending();
    return;
  }
  writeTimer = setTimeout(() => void flushPending(), WRITE_DELAY_MS);
}

function reportWriteError(action, error) {
  console.error(`house save ${action}`, error);
  toast('Speichern fehlgeschlagen. Deine letzte Änderung ist noch nicht in der Cloud.');
}

function restoreUpserts(entries) {
  const retry = entries.filter(([id]) => !pendingDeletes.has(id) && !pendingUpserts.has(id));
  pendingUpserts = new Map([...retry, ...pendingUpserts]);
}

function restoreDeletes(ids) {
  const retry = ids.filter((id) => !pendingUpserts.has(id));
  pendingDeletes = new Set([...pendingDeletes, ...retry]);
}

async function writeUpserts(entries) {
  if (!entries.length) return;
  try {
    const { error } = await database
      .from('house_saves')
      .upsert(entries.map(([, record]) => toRow(record)), {
        onConflict: 'user_id,house_id',
        defaultToNull: false,
      });
    if (error) throw error;
  } catch (error) {
    restoreUpserts(entries);
    reportWriteError('upsert', error);
  }
}

async function writeDeletes(ids) {
  if (!ids.length) return;
  try {
    const { error } = await database.from('house_saves').delete().in('house_id', ids);
    if (error) throw error;
  } catch (error) {
    restoreDeletes(ids);
    reportWriteError('delete', error);
  }
}

async function runFlush() {
  clearTimeout(writeTimer);
  writeTimer = null;
  const upserts = [...pendingUpserts];
  const deletes = [...pendingDeletes];
  pendingUpserts = new Map();
  pendingDeletes = new Set();
  await Promise.all([writeUpserts(upserts), writeDeletes(deletes)]);
}

async function flushPending() {
  if (!database || (!pendingUpserts.size && !pendingDeletes.size)) return;
  if (flushPromise) {
    await flushPromise;
    return flushPending();
  }
  flushPromise = runFlush();
  try {
    await flushPromise;
  } finally {
    flushPromise = null;
  }
}

export async function hydrate(client) {
  const { data, error } = await client
    .from('house_saves')
    .select('house_id,name,style,variant_count,thumb,data,updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  database = client;
  projects = new Map((data || []).map((row) => [row.house_id, rowToRecord(row)]));
  pendingUpserts = new Map();
  pendingDeletes = new Set();
}

export const supabaseAdapter = {
  list() {
    return [...projects.values()]
      .map(({ project, thumb, updatedAt }) => ({
        id: project.id,
        name: project.name,
        style: project.style,
        updatedAt,
        thumb,
        variantCount: project.variants.length,
      }))
      .sort((first, second) => second.updatedAt - first.updatedAt);
  },

  load(id) {
    const record = projects.get(id);
    return record ? migrateProject(clone(record.project)) : null;
  },

  save(project, thumb) {
    const previous = projects.get(project.id);
    const nextProject = migrateProject({ ...clone(project), lastOpenedAt: Date.now() });
    const record = cachedRecord(nextProject, thumb || previous?.thumb, Date.now());
    projects = new Map(projects).set(nextProject.id, record);
    pendingDeletes = new Set([...pendingDeletes].filter((id) => id !== nextProject.id));
    pendingUpserts = new Map(pendingUpserts).set(nextProject.id, record);
    scheduleFlush();
  },

  remove(id) {
    const nextProjects = new Map(projects);
    nextProjects.delete(id);
    projects = nextProjects;
    const nextUpserts = new Map(pendingUpserts);
    nextUpserts.delete(id);
    pendingUpserts = nextUpserts;
    pendingDeletes = new Set(pendingDeletes).add(id);
    scheduleFlush();
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
    const encoder = new TextEncoder();
    const bytes = [...projects.values()].reduce(
      (total, record) => total + encoder.encode(JSON.stringify(record.project)).byteLength,
      0,
    );
    return { bytes, limit: 0, pct: 0 };
  },
};

// Two listeners, because neither alone is enough.
//
// main.js registers its own `beforeunload` that calls saveNow(). This module is
// imported earlier in the graph, so OUR beforeunload runs FIRST and sets
// `unloading` — which makes the save that main.js is about to do flush straight
// away instead of waiting out the 800 ms debounce.
//
// But a fetch started during beforeunload is routinely cancelled by the browser,
// so that alone would still lose the last edit. `visibilitychange -> hidden`
// fires before unload on tab close, app switch and back-navigation, and the
// browser keeps the page alive long enough for the request to land. That is the
// one that actually saves the work; beforeunload is the backstop.
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void flushPending();
});

window.addEventListener('beforeunload', () => {
  unloading = true;
  void flushPending();
});
