// Gives node:sqlite the small part of the Durable Object's `sql.exec` API that store.js uses.
import { DatabaseSync } from 'node:sqlite';

export function makeSql() {
  const db = new DatabaseSync(':memory:');
  return {
    db,
    exec(query, ...bindings) {
      if (!bindings.length && /;\s*\S/.test(query.trim())) { db.exec(query); return { toArray: () => [], rowsWritten: 0 }; }
      const statement = db.prepare(query);
      if (/^\s*(select|with)/i.test(query)) {
        const rows = statement.all(...bindings).map((row) => ({ ...row }));
        return { toArray: () => rows, rowsWritten: 0 };
      }
      const result = statement.run(...bindings);
      return { toArray: () => [], rowsWritten: Number(result.changes) };
    },
  };
}
