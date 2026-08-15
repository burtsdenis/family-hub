import { describe, expect, it } from 'vitest';
import { id, now, openDatabase, runWithDb } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { createSession, destroyOtherSessions, hashToken } from './auth.js';

describe('destroyOtherSessions', () => {
  it('keeps exactly the session making the request', () => {
    const db = openDatabase(':memory:');
    runWithDb(db, () => {
      migrate();
      const userId = id();
      db.prepare(
        `INSERT INTO users (id, email, name, role, password_hash, created_at)
         VALUES (?, 'a@hub.local', 'A', 'member', 'x', ?)`,
      ).run(userId, now());

      createSession(userId, 'phone');
      const current = createSession(userId, 'laptop');
      createSession(userId, 'tablet');

      const removed = destroyOtherSessions(userId, current);
      expect(removed).toBe(2);

      const rows = db
        .prepare('SELECT token_hash FROM sessions WHERE user_id = ?')
        .all(userId) as { token_hash: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]!.token_hash).toBe(hashToken(current));
    });
  });

  it('does not touch other users', () => {
    const db = openDatabase(':memory:');
    runWithDb(db, () => {
      migrate();
      const a = id();
      const b = id();
      db.prepare(
        `INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES
         (?, 'a@hub.local', 'A', 'member', 'x', ?), (?, 'b@hub.local', 'B', 'member', 'x', ?)`,
      ).run(a, now(), b, now());

      const mine = createSession(a, null as unknown as undefined);
      createSession(b, undefined);

      destroyOtherSessions(a, mine);
      const { n } = db
        .prepare('SELECT count(*) AS n FROM sessions WHERE user_id = ?')
        .get(b) as { n: number };
      expect(n).toBe(1);
    });
  });
});
