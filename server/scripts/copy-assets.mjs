import { cpSync } from 'node:fs';

// tsc only carries over .ts — migrations are copied by hand,
// otherwise the built server won't find the schema.
cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true });
console.log('[build] migrations copied to dist');
