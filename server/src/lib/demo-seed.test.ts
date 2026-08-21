import { describe, expect, it } from 'vitest';
import { openDatabase, runWithDb } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { seedDemo } from './demo.js';

/*
  The demo seeder runs at sandbox-template build, which means a broken
  INSERT crashes the whole demo server at startup — and that is exactly
  how a missing NULL in a multi-row VALUES list was actually found. The
  seeder must be exercised where CI can see it, not on the live stand.
*/
describe('seedDemo', () => {
  it('seeds an empty database without crashing, profiles included', async () => {
    const db = openDatabase(':memory:');
    runWithDb(db, () => migrate());
    await runWithDb(db, () => seedDemo());

    const n = (q: string) => (db.prepare(q).get() as { n: number }).n;
    expect(n('SELECT count(*) AS n FROM users')).toBeGreaterThan(0);
    expect(n('SELECT count(*) AS n FROM profiles')).toBe(2);
    expect(n(`SELECT count(*) AS n FROM profile_entries WHERE kind = 'allergy'`)).toBe(1);
    expect(n('SELECT count(*) AS n FROM wishes')).toBe(4);
    // One wish arrives pre-claimed by a guest, to showcase the public link
    expect(n('SELECT count(*) AS n FROM wishes WHERE claimed_by_name IS NOT NULL')).toBe(1);
    // The derived birthday events carry the back-reference the routes use
    expect(n('SELECT count(*) AS n FROM events WHERE profile_user_id IS NOT NULL')).toBe(2);

    // Idempotence: a second run on a non-empty database is a no-op
    await runWithDb(db, () => seedDemo());
    expect(n('SELECT count(*) AS n FROM profiles')).toBe(2);
    db.close();
  });
});
