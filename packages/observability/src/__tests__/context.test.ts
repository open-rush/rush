import { describe, expect, it } from 'vitest';
import { getRequestContext, withRequestContext } from '../context.js';

describe('RequestContext', () => {
  it('stores and retrieves context within run scope', () => {
    const ctx = { requestId: 'req-test-123', service: 'web' };

    withRequestContext(ctx, () => {
      const retrieved = getRequestContext();
      expect(retrieved).toEqual(ctx);
    });
  });

  it('returns undefined outside of context', () => {
    expect(getRequestContext()).toBeUndefined();
  });

  it('isolates nested contexts', () => {
    const outer = { requestId: 'outer', service: 'web' };
    const inner = { requestId: 'inner', service: 'agent-worker' };

    withRequestContext(outer, () => {
      expect(getRequestContext()?.requestId).toBe('outer');

      withRequestContext(inner, () => {
        expect(getRequestContext()?.requestId).toBe('inner');
      });

      expect(getRequestContext()?.requestId).toBe('outer');
    });
  });

  it('supports optional domain IDs', () => {
    const ctx = {
      requestId: 'req-1',
      service: 'control-worker',
      runId: 'run-123',
      agentId: 'agent-456',
      sandboxId: 'sbx-789',
    };

    withRequestContext(ctx, () => {
      const retrieved = getRequestContext();
      expect(retrieved?.runId).toBe('run-123');
      expect(retrieved?.agentId).toBe('agent-456');
      expect(retrieved?.sandboxId).toBe('sbx-789');
    });
  });

  it('works with async functions', async () => {
    const ctx = { requestId: 'req-async', service: 'web' };

    await withRequestContext(ctx, async () => {
      await new Promise((r) => setTimeout(r, 10));
      expect(getRequestContext()?.requestId).toBe('req-async');
    });
  });
});
