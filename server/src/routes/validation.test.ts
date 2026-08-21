import { beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type Harness } from '../test-harness.js';

/*
  The validation net has two layers: authored messages on the fields
  people actually mistype, and a global zod error map underneath for
  everything else. The map exists because the client translates server
  strings by exact match — zod's own vocabulary ("Required", "Invalid")
  was never authored, so it reached a Russian interface in English (#86).

  These tests pin the seams: an authored message must not be swallowed
  by the map, and an unauthored failure must land on the one translated
  sentence rather than on whatever zod says this version.
*/

let hub: Harness;
let cookie: string;
let calendarId: string;

beforeAll(async () => {
  hub = await buildTestApp();
  ({ cookie } = hub.join('alex'));
  const calendars = await hub.as(cookie, 'GET', '/api/calendars');
  calendarId = calendars.json<{ id: string }[]>()[0]!.id;
});

describe('authored messages survive the error map', () => {
  it('empty task title answers with the authored sentence', async () => {
    const res = await hub.as(cookie, 'POST', '/api/tasks', {
      project_id: '00000000-0000-4000-8000-000000000001',
      title: '',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('The task needs a title');
  });

  it('malformed event date names the field shape, not "Invalid"', async () => {
    const res = await hub.as(cookie, 'POST', '/api/events', {
      calendar_id: calendarId,
      title: 'Dentist',
      starts_at: 'tomorrow',
      ends_at: '2026-08-21',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe(
      'Date must be YYYY-MM-DD or YYYY-MM-DDTHH:MM',
    );
  });
});

describe('unauthored failures land on the translated fallback', () => {
  it('a missing title key does not answer "Required"', async () => {
    const res = await hub.as(cookie, 'POST', '/api/tasks', {
      project_id: '00000000-0000-4000-8000-000000000001',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('Check the fields');
  });
});

describe('dynamic UPDATE columns stay inside the allowlist (#63)', () => {
  it('a task patch still updates and unknown keys change nothing', async () => {
    const created = await hub.as(cookie, 'POST', '/api/tasks', {
      project_id: '00000000-0000-4000-8000-000000000001',
      title: 'Water the plants',
    });
    const taskId = created.json<{ id: string }>().id;

    // Unknown keys are stripped by zod and, since the allowlist, could not
    // reach SQL even if they were not — the patch must succeed on the
    // known key and ignore the noise
    const res = await hub.as(cookie, 'PATCH', `/api/tasks/${taskId}`, {
      title: 'Water the plants twice',
      not_a_column: 'DROP TABLE tasks',
    });
    expect(res.statusCode).toBe(200);
    // The tasks PATCH answers { task, spawned } — spawned is for recurrence
    expect(res.json<{ task: { title: string } }>().task.title).toBe('Water the plants twice');
  });
});
