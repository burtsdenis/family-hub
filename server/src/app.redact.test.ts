import { describe, expect, it } from 'vitest';
import { redactUrl } from './app.js';

/*
  redactUrl is a security seam: it decides what secrets reach the log.
  Query values were always masked (invite tokens); the wishlist share
  token travels in the PATH, and before this test existed a rate-limited
  guest request wrote the live link into the log at warn level.
*/
describe('redactUrl', () => {
  it('masks the wishlist token path segment', () => {
    expect(redactUrl('/api/wishlist/AbC123xyz-_456')).toBe('/api/wishlist/…');
    expect(redactUrl('/api/wishlist/AbC123xyz/claim')).toBe('/api/wishlist/…/claim');
  });

  it('still masks query values and leaves plain paths alone', () => {
    expect(redactUrl('/api/auth/invite?token=SECRET')).toBe('/api/auth/invite?token=…');
    expect(redactUrl('/api/tasks')).toBe('/api/tasks');
  });
});
