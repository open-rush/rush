import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalJsonStringify,
  computeIdempotencyHash,
  IDEMPOTENCY_WINDOW_MS,
  IdempotencyConflictError,
  LOCK_NS_IDEMPOTENCY,
} from '../run/idempotency.js';

describe('canonicalJsonStringify', () => {
  it('serializes primitives the same as JSON.stringify', () => {
    expect(canonicalJsonStringify(null)).toBe('null');
    expect(canonicalJsonStringify(true)).toBe('true');
    expect(canonicalJsonStringify(false)).toBe('false');
    expect(canonicalJsonStringify(42)).toBe('42');
    expect(canonicalJsonStringify('hi')).toBe('"hi"');
    expect(canonicalJsonStringify('')).toBe('""');
  });

  it('sorts object keys so key order does not change the hash', () => {
    expect(canonicalJsonStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalJsonStringify({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
  });

  it('preserves array element order', () => {
    expect(canonicalJsonStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('recurses into nested objects and arrays with stable key order', () => {
    const a = canonicalJsonStringify({
      outer: { z: 1, a: { b: 2, a: 1 } },
      list: [{ k: 1 }, { k: 2 }],
    });
    const b = canonicalJsonStringify({
      list: [{ k: 1 }, { k: 2 }],
      outer: { a: { a: 1, b: 2 }, z: 1 },
    });
    expect(a).toBe(b);
    expect(a).toBe('{"list":[{"k":1},{"k":2}],"outer":{"a":{"a":1,"b":2},"z":1}}');
  });

  it('handles null values in objects', () => {
    expect(canonicalJsonStringify({ a: null, b: 1 })).toBe('{"a":null,"b":1}');
  });

  it('omits undefined / function / symbol values from objects', () => {
    const out = canonicalJsonStringify({
      a: 1,
      b: undefined,
      c: () => 1,
      d: Symbol('x'),
      e: 2,
    });
    expect(out).toBe('{"a":1,"e":2}');
  });

  it('converts undefined / function / symbol to null inside arrays', () => {
    // Mirrors JSON.stringify behaviour.
    const out = canonicalJsonStringify([1, undefined, () => 1, Symbol('x'), 2]);
    expect(out).toBe('[1,null,null,null,2]');
  });

  it('maps non-finite numbers to null (JSON.stringify parity)', () => {
    expect(canonicalJsonStringify(Number.NaN)).toBe('null');
    expect(canonicalJsonStringify(Number.POSITIVE_INFINITY)).toBe('null');
    expect(canonicalJsonStringify(Number.NEGATIVE_INFINITY)).toBe('null');
  });

  it('escapes string characters the same way as JSON.stringify', () => {
    // Control characters, quotes, backslashes, emoji.
    const s = 'a"b\\c\nde\u{1F600}';
    expect(canonicalJsonStringify(s)).toBe(JSON.stringify(s));
  });

  it('handles deeply nested structures without loss of ordering', () => {
    const out = canonicalJsonStringify({
      z: { y: { x: { w: [1, 2, 3], v: { u: 'x' } } } },
      a: 1,
    });
    expect(out).toBe('{"a":1,"z":{"y":{"x":{"v":{"u":"x"},"w":[1,2,3]}}}}');
  });

  it('top-level undefined returns empty string (documented edge case)', () => {
    expect(canonicalJsonStringify(undefined)).toBe('');
  });
});

describe('computeIdempotencyHash', () => {
  it('returns a 64-char lowercase hex string (SHA-256)', () => {
    const hash = computeIdempotencyHash({ a: 1 });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for key-order-equivalent objects', () => {
    const a = computeIdempotencyHash({ a: 1, b: 2 });
    const b = computeIdempotencyHash({ b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it('differs when payload differs', () => {
    const a = computeIdempotencyHash({ input: 'hello' });
    const b = computeIdempotencyHash({ input: 'Hello' });
    expect(a).not.toBe(b);
  });

  it('width matches runs.idempotency_request_hash varchar(64)', () => {
    // Documents the schema contract — if someone switches to SHA-512 the
    // column width mismatch would surface here first.
    expect(computeIdempotencyHash({}).length).toBe(64);
  });

  it('agrees with sha256(canonicalJsonStringify(body)) manually', () => {
    const body = { list: [3, 1, 2], nested: { b: 'y', a: 'x' } };
    const expected = createHash('sha256').update(canonicalJsonStringify(body)).digest('hex');
    expect(computeIdempotencyHash(body)).toBe(expected);
  });
});

describe('constants', () => {
  it('LOCK_NS_IDEMPOTENCY is a fixed 32-bit positive integer', () => {
    expect(Number.isInteger(LOCK_NS_IDEMPOTENCY)).toBe(true);
    expect(LOCK_NS_IDEMPOTENCY).toBeGreaterThan(0);
    expect(LOCK_NS_IDEMPOTENCY).toBeLessThan(2 ** 31);
  });

  it('IDEMPOTENCY_WINDOW_MS is 24 hours', () => {
    expect(IDEMPOTENCY_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('IdempotencyConflictError', () => {
  it('carries idempotency metadata without leaking request body', () => {
    const err = new IdempotencyConflictError({
      idempotencyKey: 'abc123',
      existingRunId: '00000000-0000-0000-0000-000000000000',
      existingRequestHash: 'a'.repeat(64),
      incomingRequestHash: 'b'.repeat(64),
    });
    expect(err.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(err.message).toContain('abc123');
    expect(err.existingRunId).toBe('00000000-0000-0000-0000-000000000000');
    expect(err.existingRequestHash).toBe('a'.repeat(64));
    expect(err.incomingRequestHash).toBe('b'.repeat(64));
    expect(err.name).toBe('IdempotencyConflictError');
  });

  it('is distinguishable via instanceof and .code', () => {
    const err = new IdempotencyConflictError({
      idempotencyKey: 'k',
      existingRunId: 'r',
      existingRequestHash: 'x',
      incomingRequestHash: 'y',
    });
    expect(err).toBeInstanceOf(IdempotencyConflictError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});
