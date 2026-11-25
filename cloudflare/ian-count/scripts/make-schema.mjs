// Regenerates src/schema.js from schema.sql (the Worker bundle cannot read files at run time).
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const sql = readFileSync(new URL('schema.sql', root), 'utf8');
writeFileSync(new URL('src/schema.js', root), `// Generated from ../schema.sql by \`node scripts/make-schema.mjs\`; test/store.test.mjs fails when the two differ.\nexport const SCHEMA = ${JSON.stringify(sql)};\n`);
