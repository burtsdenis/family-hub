import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// env.ts reads DATA_DIR at import time — slip in a throwaway directory
// so tests never touch the real database in ~/.family-hub
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'family-hub-test-'));
