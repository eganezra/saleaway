import { describe, expect, it } from 'vitest';
import { isAuthorized } from '../src/auth';

const request = (authorization?: string) =>
  new Request('https://pipeline.example/admin/run', {
    method: 'POST',
    headers: authorization === undefined ? {} : { Authorization: authorization },
  });

const TOKEN = 'a'.repeat(64);

describe('isAuthorized', () => {
  it('accepts the exact token', () => {
    expect(isAuthorized(request(`Bearer ${TOKEN}`), TOKEN)).toBe(true);
  });

  it('rejects a wrong token of the same length', () => {
    expect(isAuthorized(request(`Bearer ${'a'.repeat(63)}b`), TOKEN)).toBe(false);
    expect(isAuthorized(request(`Bearer b${'a'.repeat(63)}`), TOKEN)).toBe(false);
  });

  it('rejects a token that is too short, too long, or empty', () => {
    expect(isAuthorized(request(`Bearer ${TOKEN.slice(1)}`), TOKEN)).toBe(false);
    expect(isAuthorized(request(`Bearer ${TOKEN}x`), TOKEN)).toBe(false);
    expect(isAuthorized(request('Bearer '), TOKEN)).toBe(false);
  });

  it('rejects a missing header or a scheme other than Bearer', () => {
    expect(isAuthorized(request(), TOKEN)).toBe(false);
    expect(isAuthorized(request(TOKEN), TOKEN)).toBe(false);
    expect(isAuthorized(request(`Basic ${TOKEN}`), TOKEN)).toBe(false);
    expect(isAuthorized(request(`bearer ${TOKEN}`), TOKEN)).toBe(false);
  });

  it('never matches when no token is configured, even for an empty header', () => {
    expect(isAuthorized(request('Bearer '), undefined)).toBe(false);
    expect(isAuthorized(request('Bearer '), '')).toBe(false);
    expect(isAuthorized(request(`Bearer ${TOKEN}`), undefined)).toBe(false);
  });

  it('looks at every character: a difference only in the last position is still rejected', () => {
    const almost = `${'a'.repeat(63)}z`;
    expect(isAuthorized(request(`Bearer ${almost}`), TOKEN)).toBe(false);
  });
});
