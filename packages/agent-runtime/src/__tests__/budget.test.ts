import { describe, expect, it, vi } from 'vitest';
import { BudgetGuard } from '../budget.js';

describe('BudgetGuard', () => {
  it('allows when under all limits', () => {
    const guard = new BudgetGuard({ maxTokens: 1000, maxCostCents: 100 });
    guard.record(500, 50);
    const result = guard.check();
    expect(result.allowed).toBe(true);
  });

  it('blocks when token limit reached', () => {
    const guard = new BudgetGuard({ maxTokens: 1000 });
    guard.record(1000, 0);
    const result = guard.check();
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('token_limit');
  });

  it('blocks when cost limit reached', () => {
    const guard = new BudgetGuard({ maxCostCents: 100 });
    guard.record(0, 100);
    const result = guard.check();
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('cost_limit');
  });

  it('blocks when duration limit reached', () => {
    vi.useFakeTimers();
    const guard = new BudgetGuard({ maxDurationMs: 5000 });
    vi.advanceTimersByTime(6000);
    const result = guard.check();
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('duration_limit');
    vi.useRealTimers();
  });

  it('accumulates usage across multiple records', () => {
    const guard = new BudgetGuard({ maxTokens: 1000 });
    guard.record(300, 10);
    guard.record(400, 15);
    guard.record(300, 10);
    const result = guard.check();
    expect(result.allowed).toBe(false);
    expect(result.usage.tokens).toBe(1000);
    expect(result.usage.costCents).toBe(35);
  });

  it('allows with no limits configured', () => {
    const guard = new BudgetGuard({});
    guard.record(999999, 999999);
    expect(guard.check().allowed).toBe(true);
  });

  it('reset clears usage', () => {
    const guard = new BudgetGuard({ maxTokens: 100 });
    guard.record(200, 0);
    expect(guard.check().allowed).toBe(false);
    guard.reset();
    expect(guard.check().allowed).toBe(true);
    expect(guard.getUsage().tokens).toBe(0);
  });

  it('returns copy of usage (not reference)', () => {
    const guard = new BudgetGuard({});
    guard.record(100, 10);
    const u1 = guard.getUsage();
    guard.record(50, 5);
    const u2 = guard.getUsage();
    expect(u1.tokens).toBe(100);
    expect(u2.tokens).toBe(150);
  });
});
