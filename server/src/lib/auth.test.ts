import { describe, expect, it } from 'vitest';
import { id, now, openDatabase, runWithDb } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { consumeTotp, createSession, destroyOtherSessions, hashToken } from './auth.js';
import { base32Encode, hotp } from './totp.js';

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

describe('consumeTotp', () => {
  const SECRET = base32Encode(Buffer.from('12345678901234567890'));
  // A fixed clock: step 37037036 covers 1111111109 s, an RFC 6238 vector
  const NOW = 1111111109 * 1000;
  const STEP = Math.floor(1111111109 / 30);

  function withUser(fn: (userId: string) => void): void {
    const db = openDatabase(':memory:');
    runWithDb(db, () => {
      migrate();
      const userId = id();
      db.prepare(
        `INSERT INTO users (id, email, name, role, password_hash, totp_secret, totp_confirmed_at, created_at)
         VALUES (?, 'a@hub.local', 'A', 'admin', 'x', ?, ?, ?)`,
      ).run(userId, SECRET, now(), now());
      fn(userId);
    });
  }

  it('accepts a code once and refuses the replay', () => {
    withUser((userId) => {
      const code = hotp(SECRET, STEP);
      expect(consumeTotp(userId, SECRET, code, NOW)).toBe(true);
      // Same code, same step, still inside its window — this is the
      // second browser the vulnerability let in
      expect(consumeTotp(userId, SECRET, code, NOW)).toBe(false);
    });
  });

  it('still accepts the next code', () => {
    withUser((userId) => {
      expect(consumeTotp(userId, SECRET, hotp(SECRET, STEP), NOW)).toBe(true);
      expect(consumeTotp(userId, SECRET, hotp(SECRET, STEP + 1), NOW + 30_000)).toBe(true);
    });
  });

  it('refuses an earlier step once a later one is spent', () => {
    withUser((userId) => {
      // The drift window accepts step-1, so without the ceiling a spent
      // sign-in could be followed by the previous code
      expect(consumeTotp(userId, SECRET, hotp(SECRET, STEP), NOW)).toBe(true);
      expect(consumeTotp(userId, SECRET, hotp(SECRET, STEP - 1), NOW)).toBe(false);
    });
  });

  it('a wrong code changes nothing', () => {
    withUser((userId) => {
      expect(consumeTotp(userId, SECRET, '000000', NOW)).toBe(false);
      // The valid code is untouched by the failed attempt
      expect(consumeTotp(userId, SECRET, hotp(SECRET, STEP), NOW)).toBe(true);
    });
  });
});
