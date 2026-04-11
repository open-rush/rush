import { describe, expect, it } from 'vitest';
import { calculateDelay, classifyError, withRetry } from '../retry.js';

describe('classifyError', () => {
  it('classifies rate limit as retryable', () => {
    expect(classifyError(new Error('rate_limit_exceeded'))).toBe('retryable');
    expect(classifyError(new Error('429 Too Many Requests'))).toBe('retryable');
    expect(classifyError(new Error('rate limit exceeded'))).toBe('retryable');
  });

  it('classifies timeout as retryable', () => {
    expect(classifyError(new Error('request timeout'))).toBe('retryable');
    expect(classifyError(new Error('ECONNRESET'))).toBe('retryable');
  });

  it('classifies server errors as retryable', () => {
    expect(classifyError(new Error('502 Bad Gateway'))).toBe('retryable');
    expect(classifyError(new Error('503 Service Unavailable'))).toBe('retryable');
    expect(classifyError(new Error('overloaded'))).toBe('retryable');
  });

  it('classifies auth errors as fatal', () => {
    expect(classifyError(new Error('invalid api key'))).toBe('fatal');
    expect(classifyError(new Error('invalid_api_key'))).toBe('fatal');
    expect(classifyError(new Error('authentication failed'))).toBe('fatal');
    expect(classifyError(new Error('permission_denied'))).toBe('fatal');
  });

  it('classifies budget errors as budget_exceeded', () => {
    expect(classifyError(new Error('budget exceeded'))).toBe('budget_exceeded');
    expect(classifyError(new Error('token limit reached'))).toBe('budget_exceeded');
    expect(classifyError(new Error('cost limit exceeded'))).toBe('budget_exceeded');
  });

  it('classifies "rate limit exceeded" as retryable, not budget', () => {
    expect(classifyError(new Error('rate_limit exceeded'))).toBe('retryable');
  });

  it('classifies unknown errors as fatal', () => {
    expect(classifyError(new Error('something unexpected'))).toBe('fatal');
    expect(classifyError('not an error')).toBe('fatal');
  });
});

describe('calculateDelay', () => {
  it('increases exponentially', () => {
    const config = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 30000, jitterMs: 0 };
    expect(calculateDelay(0, config)).toBe(1000);
    expect(calculateDelay(1, config)).toBe(2000);
    expect(calculateDelay(2, config)).toBe(4000);
  });

  it('caps at maxDelay', () => {
    const config = { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 5000, jitterMs: 0 };
    expect(calculateDelay(10, config)).toBe(5000);
  });
});

describe('withRetry', () => {
  it('returns on first success', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries retryable errors', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('503 Service Unavailable');
        return 'ok';
      },
      { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50, jitterMs: 0 }
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('does not retry fatal errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('invalid api key');
        },
        { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50, jitterMs: 0 }
      )
    ).rejects.toThrow('invalid api key');
    expect(calls).toBe(1);
  });

  it('does not retry budget errors', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('budget exceeded');
        },
        { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50, jitterMs: 0 }
      )
    ).rejects.toThrow('budget exceeded');
    expect(calls).toBe(1);
  });

  it('throws after exhausting retries', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('503');
        },
        { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50, jitterMs: 0 }
      )
    ).rejects.toThrow('503');
    expect(calls).toBe(3);
  });
});
