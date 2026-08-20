import { beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type Harness } from '../test-harness.js';
import { id, now, runWithDb } from '../db/index.js';
import { createSession } from '../lib/auth.js';

/*
  The self-service boundary of PATCH /api/users/:id (#64): a member owns
  their name and colour, and nothing else — the same route on someone
  else's id must stay administrator-only. The harness's join() creates
  administrators, so the member here is inserted directly.
*/

let hub: Harness;
let adminId = '';
let memberId = '';
let memberCookie = '';

function joinMember(name: string): { userId: string; cookie: string } {
  return runWithDb(hub.db, () => {
    const userId = id();
    hub.db
      .prepare(
        `INSERT INTO users (id, email, name, role, password_hash, color, created_at)
         VALUES (?, ?, ?, 'member', 'x', '#C4842B', ?)`,
      )
      .run(userId, `${name}@hub.local`, name, now());
    return { userId, cookie: createSession(userId, `${name}-device`) };
  });
}

beforeAll(async () => {
  hub = await buildTestApp();
  adminId = hub.join('alice').userId;
  const member = joinMember('kate');
  memberId = member.userId;
  memberCookie = member.cookie;
});

describe('PATCH /api/users/:id self-service', () => {
  it('a member changes their own name and colour', async () => {
    const res = await hub.as(memberCookie, 'PATCH', `/api/users/${memberId}`, {
      name: 'Kate',
      color: '#6B8F5E',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ name: string; color: string }>()).toMatchObject({
      name: 'Kate',
      color: '#6B8F5E',
    });
  });

  it("a member cannot touch someone else's profile", async () => {
    const res = await hub.as(memberCookie, 'PATCH', `/api/users/${adminId}`, {
      name: 'Hacked',
    });
    expect(res.statusCode).toBe(403);
  });
});
