import { describe, expect, it, vi } from 'vitest';
import { RateLimiter } from '../rate-limiter.js';

describe('RateLimiter', () => {
  it('allows requests within limit', () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 10 });
    for (let i = 0; i < 10; i++) {
      expect(limiter.tryAcquire()).toBe(true);
    }
  });

  it('blocks when limit reached', () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 3 });
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('allows after window expires', () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ maxRequestsPerMinute: 1 });
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
    vi.advanceTimersByTime(61_000);
    expect(limiter.tryAcquire()).toBe(true);
    vi.useRealTimers();
  });

  it('getRemaining returns correct count', () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 5 });
    expect(limiter.getRemaining()).toBe(5);
    limiter.tryAcquire();
    limiter.tryAcquire();
    expect(limiter.getRemaining()).toBe(3);
  });

  it('getRetryAfterMs returns positive when limited', () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ maxRequestsPerMinute: 1 });
    limiter.tryAcquire();
    limiter.tryAcquire();
    const retryAfter = limiter.getRetryAfterMs();
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60_000);
    vi.useRealTimers();
  });

  it('reset clears all timestamps', () => {
    const limiter = new RateLimiter({ maxRequestsPerMinute: 1 });
    limiter.tryAcquire();
    expect(limiter.tryAcquire()).toBe(false);
    limiter.reset();
    expect(limiter.tryAcquire()).toBe(true);
  });
});
