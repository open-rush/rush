import { describe, expect, it } from 'vitest';
import { extractOrGenerateRequestId, generateRequestId, validateRequestId } from '../request-id.js';

describe('generateRequestId', () => {
  it('returns string matching req-{timestamp}-{hex} format', () => {
    const id = generateRequestId();
    expect(id).toMatch(/^req-\d+-[0-9a-f]{12}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRequestId()));
    expect(ids.size).toBe(100);
  });
});

describe('validateRequestId', () => {
  it('accepts valid request IDs', () => {
    expect(validateRequestId('req-1234-abcdef012345')).toBe('req-1234-abcdef012345');
    expect(validateRequestId('my-custom-id')).toBe('my-custom-id');
    expect(validateRequestId('trace.123:span-456')).toBe('trace.123:span-456');
  });

  it('rejects non-string values', () => {
    expect(validateRequestId(null)).toBeNull();
    expect(validateRequestId(undefined)).toBeNull();
    expect(validateRequestId(123)).toBeNull();
  });

  it('rejects empty string', () => {
    expect(validateRequestId('')).toBeNull();
  });

  it('rejects strings exceeding max length', () => {
    const long = 'a'.repeat(129);
    expect(validateRequestId(long)).toBeNull();
  });

  it('accepts string at max length', () => {
    const maxLen = 'a'.repeat(128);
    expect(validateRequestId(maxLen)).toBe(maxLen);
  });

  it('rejects strings with invalid characters', () => {
    expect(validateRequestId('req id with spaces')).toBeNull();
    expect(validateRequestId('req\nwith\nnewlines')).toBeNull();
    expect(validateRequestId('<script>alert(1)</script>')).toBeNull();
    expect(validateRequestId('req;drop table')).toBeNull();
  });
});

describe('extractOrGenerateRequestId', () => {
  it('uses valid incoming header value', () => {
    expect(extractOrGenerateRequestId('req-123-abc')).toBe('req-123-abc');
  });

  it('generates new ID for null/undefined', () => {
    const id1 = extractOrGenerateRequestId(null);
    expect(id1).toMatch(/^req-\d+-[0-9a-f]{12}$/);

    const id2 = extractOrGenerateRequestId(undefined);
    expect(id2).toMatch(/^req-\d+-[0-9a-f]{12}$/);
  });

  it('generates new ID for invalid header value', () => {
    const id = extractOrGenerateRequestId('<script>xss</script>');
    expect(id).toMatch(/^req-\d+-[0-9a-f]{12}$/);
  });
});
