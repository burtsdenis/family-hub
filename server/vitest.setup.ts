import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// env.ts читает DATA_DIR при импорте — подсовываем одноразовый каталог,
// чтобы тесты никогда не касались настоящей базы в ~/.family-hub
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'family-hub-test-'));
