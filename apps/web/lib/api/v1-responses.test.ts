/**
 * Unit tests for the v1 response helpers. Small but essential:
 * the helpers are used by every task-8/9 route, so any drift silently
 * breaks every endpoint's contract.
 */
import { describe, expect, it } from 'vitest';

import { v1Error, v1Paginated, v1Success, v1ValidationError } from './v1-responses';

describe('v1Success', () => {
  it('returns 200 by default with { data } envelope', async () => {
    const res = v1Success({ id: 'x' });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: { id: 'x' } });
  });

  it('honours explicit status (e.g. 201)', async () => {
    const res = v1Success({ id: 'x' }, 201);
    expect(res.status).toBe(201);
  });
});

describe('v1Paginated', () => {
  it('returns 200 with { data, nextCursor }', async () => {
    const res = v1Paginated([1, 2, 3], 'cur');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ data: [1, 2, 3], nextCursor: 'cur' });
  });

  it('null nextCursor stays null (not omitted)', async () => {
    const res = v1Paginated([], null);
    await expect(res.json()).resolves.toEqual({ data: [], nextCursor: null });
  });
});

describe('v1Error', () => {
  it('maps error codes to the standard HTTP status', async () => {
    const pairs: Array<[Parameters<typeof v1Error>[0], number]> = [
      ['UNAUTHORIZED', 401],
      ['FORBIDDEN', 403],
      ['NOT_FOUND', 404],
      ['VALIDATION_ERROR', 400],
      ['VERSION_CONFLICT', 409],
      ['IDEMPOTENCY_CONFLICT', 409],
      ['RATE_LIMITED', 429],
      ['INTERNAL', 500],
    ];
    for (const [code, status] of pairs) {
      const res = v1Error(code, 'msg');
      expect(res.status).toBe(status);
    }
  });

  it('embeds hint + issues in the error envelope', async () => {
    const res = v1Error('VALIDATION_ERROR', 'bad', {
      hint: 'try again',
      issues: [{ path: ['body', 'name'], message: 'required' }],
    });
    await expect(res.json()).resolves.toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'bad',
        hint: 'try again',
        issues: [{ path: ['body', 'name'], message: 'required' }],
      },
    });
  });
});

describe('v1ValidationError', () => {
  it('attaches all issues and uses first issue message as summary', async () => {
    const fakeZodError = {
      issues: [
        { path: ['a'], message: 'first' },
        { path: ['b', 1], message: 'second' },
      ],
    };
    const res = v1ValidationError(fakeZodError, 'Input invalid');
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; message: string; issues: Array<{ path: unknown[]; message: string }> };
    };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Input invalid: first');
    expect(body.error.issues).toHaveLength(2);
  });

  it('works with empty issues array', async () => {
    const res = v1ValidationError({ issues: [] }, 'Bad request');
    const body = (await res.json()) as { error: { message: string; issues: unknown[] } };
    expect(body.error.message).toBe('Bad request');
    expect(body.error.issues).toEqual([]);
  });
});
