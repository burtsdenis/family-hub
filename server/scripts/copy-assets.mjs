import { cpSync } from 'node:fs';

// tsc переносит только .ts — миграции копируем руками,
// иначе собранный сервер не найдёт схему.
cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true });
console.log('[build] миграции скопированы в dist');
