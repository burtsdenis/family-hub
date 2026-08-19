import type { FastifyInstance, InjectOptions } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { openDatabase, runWithDb, id, now } from '../db/index.js';
import { migrate } from '../db/migrate.js';
import { SESSION_COOKIE, createSession } from '../lib/auth.js';

/*
  The privacy promise, as a test.

  "Private" here is enforced by the server, per owner, with no exception
  for the administrator — it is the thing the README tells strangers on
  the internet, and the single most likely place to introduce a serious
  bug: a new route that takes an :id and forgets its visibility guard
  looks exactly like a correct one.

  Until buildApp existed there was no way to check it. Now the app can be
  built against an in-memory database and driven through inject(), with
  no socket and no fixtures beyond two users.

  The shape of every case is the same: Alice creates something private,
  Bob asks for it by id, and the answer must be 404 — not 200, and not
  403 either, which would confirm the thing exists.
*/

let app: FastifyInstance;
const db = openDatabase(':memory:');
let alice = '';
let bob = '';
let aliceCookie = '';
let bobCookie = '';

function member(name: string): string {
  const userId = id();
  db.prepare(
    `INSERT INTO users (id, email, name, role, password_hash, created_at)
     VALUES (?, ?, ?, 'admin', 'x', ?)`,
  ).run(userId, `${name}@hub.local`, name, now());
  return userId;
}

function as(cookie: string, method: InjectOptions['method'], url: string, payload?: unknown) {
  const options: InjectOptions = {
    method,
    url,
    headers: { cookie: `${SESSION_COOKIE}=${cookie}` },
  };
  if (payload !== undefined) options.payload = payload as InjectOptions['payload'];
  return app.inject(options);
}

beforeAll(async () => {
  app = await buildApp();

  // Bind every request to this database, exactly the way demo mode binds
  // one to a visitor's sandbox (see the onRequest hook in index.ts).
  // Wrapping the inject() call itself does not work: the request is
  // dispatched onto its own async chain, and the context does not follow.
  app.addHook('onRequest', (_req, _reply, done) => runWithDb(db, done));

  runWithDb(db, () => {
    migrate();
    alice = member('alice');
    bob = member('bob');
    // The administrator is deliberately included on both sides: the guard
    // has no role exception, and a test that only checked member-to-member
    // would miss exactly the backdoor the project promises not to have
    aliceCookie = createSession(alice, 'alice-device');
    bobCookie = createSession(bob, 'bob-device');
  });
});

describe('a private note', () => {
  let noteId = '';

  beforeAll(async () => {
    const created = await as(aliceCookie, 'POST', '/api/notes', {
      title: 'Alice only',
      body_md: 'surprise party budget',
      visibility: 'private',
    });
    noteId = created.json<{ id: string }>().id;
    expect(created.statusCode).toBe(201);
  });

  it('is hers to read', async () => {
    expect((await as(aliceCookie, 'GET', `/api/notes/${noteId}`)).statusCode).toBe(200);
  });

  it('is not in his list', async () => {
    const list = (await as(bobCookie, 'GET', '/api/notes')).json<{ title: string }[]>();
    expect(list.map((n) => n.title)).not.toContain('Alice only');
  });

  it('is not his to read, edit or delete', async () => {
    expect((await as(bobCookie, 'GET', `/api/notes/${noteId}`)).statusCode).toBe(404);
    expect((await as(bobCookie, 'PATCH', `/api/notes/${noteId}`, { title: 'x' })).statusCode).toBe(404);
    expect((await as(bobCookie, 'DELETE', `/api/notes/${noteId}`)).statusCode).toBe(404);
  });

  it('is not in his search results', async () => {
    const found = (await as(bobCookie, 'GET', '/api/search?q=surprise')).json<{
      results: unknown[];
    }>();
    expect(found.results).toEqual([]);
  });

  it('has no readable version history', async () => {
    expect((await as(bobCookie, 'GET', `/api/notes/${noteId}/versions`)).statusCode).toBe(404);
  });
});

describe('a personal money account', () => {
  let accountId = '';

  beforeAll(async () => {
    const created = await as(aliceCookie, 'POST', '/api/accounts', {
      name: 'Alice personal',
      currency: 'EUR',
      opening_balance: 42000,
      shared: false,
    });
    accountId = created.json<{ id: string }>().id;
    expect(created.statusCode).toBe(201);
  });

  it('is not in his list', async () => {
    const list = (await as(bobCookie, 'GET', '/api/accounts')).json<{ name: string }[]>();
    expect(list.map((a) => a.name)).not.toContain('Alice personal');
  });

  it('is not his to edit, reconcile or delete', async () => {
    expect((await as(bobCookie, 'PATCH', `/api/accounts/${accountId}`, { name: 'x' })).statusCode).toBe(404);
    expect(
      (await as(bobCookie, 'POST', `/api/accounts/${accountId}/reconcile`, {
        actual_balance: 1,
        checked_on: '2026-08-19',
      })).statusCode,
    ).toBe(404);
    // The one the sweep was written for: delete had no guard at all, so an
    // empty account anyone knew the id of could be removed by anyone
    expect((await as(bobCookie, 'DELETE', `/api/accounts/${accountId}`)).statusCode).toBe(404);
  });

  it('survives his attempt', async () => {
    const list = (await as(aliceCookie, 'GET', '/api/accounts')).json<{ name: string }[]>();
    expect(list.map((a) => a.name)).toContain('Alice personal');
  });
});

describe('a personal calendar', () => {
  let calendarId = '';

  beforeAll(async () => {
    const created = await as(aliceCookie, 'POST', '/api/calendars', {
      name: 'Alice personal',
      shared: false,
    });
    calendarId = created.json<{ id: string }>().id;
    expect(created.statusCode).toBe(201);
  });

  it('is not in his list', async () => {
    const list = (await as(bobCookie, 'GET', '/api/calendars')).json<{ name: string }[]>();
    expect(list.map((c) => c.name)).not.toContain('Alice personal');
  });

  it('is not his to edit or delete', async () => {
    expect((await as(bobCookie, 'PATCH', `/api/calendars/${calendarId}`, { name: 'x' })).statusCode).toBe(404);
    expect((await as(bobCookie, 'DELETE', `/api/calendars/${calendarId}`)).statusCode).toBe(404);
  });
});

describe('an unauthenticated caller', () => {
  it('gets nowhere near any of it', async () => {
    for (const url of ['/api/notes', '/api/accounts', '/api/calendars', '/api/tasks']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
    }
  });
});
