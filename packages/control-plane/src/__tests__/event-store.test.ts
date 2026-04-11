import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '../event-store.js';

describe('InMemoryEventStore', () => {
  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  describe('append', () => {
    it('inserts a new event', async () => {
      const result = await store.append({
        runId: 'run-1',
        eventType: 'text_delta',
        payload: { delta: 'hello' },
        seq: 0,
      });

      expect(result.inserted).toBe(true);
      expect(result.event.runId).toBe('run-1');
      expect(result.event.seq).toBe(0);
      expect(result.event.id).toBeDefined();
    });

    it('deduplicates on (runId, seq)', async () => {
      await store.append({ runId: 'run-1', eventType: 'a', payload: null, seq: 0 });
      const result = await store.append({ runId: 'run-1', eventType: 'b', payload: null, seq: 0 });

      expect(result.inserted).toBe(false);
      expect(result.event.eventType).toBe('a');
    });

    it('allows same seq for different runs', async () => {
      const r1 = await store.append({ runId: 'run-1', eventType: 'a', payload: null, seq: 0 });
      const r2 = await store.append({ runId: 'run-2', eventType: 'b', payload: null, seq: 0 });

      expect(r1.inserted).toBe(true);
      expect(r2.inserted).toBe(true);
    });

    it('rejects negative seq', async () => {
      await expect(
        store.append({ runId: 'run-1', eventType: 'a', payload: null, seq: -1 })
      ).rejects.toThrow('Invalid seq');
    });

    it('rejects non-integer seq', async () => {
      await expect(
        store.append({ runId: 'run-1', eventType: 'a', payload: null, seq: 1.5 })
      ).rejects.toThrow('Invalid seq');
    });

    it('rejects NaN seq', async () => {
      await expect(
        store.append({ runId: 'run-1', eventType: 'a', payload: null, seq: Number.NaN })
      ).rejects.toThrow('Invalid seq');
    });

    it('stores events in seq order', async () => {
      await store.append({ runId: 'run-1', eventType: 'c', payload: null, seq: 2 });
      await store.append({ runId: 'run-1', eventType: 'a', payload: null, seq: 0 });
      await store.append({ runId: 'run-1', eventType: 'b', payload: null, seq: 1 });

      const events = await store.getEvents('run-1');
      expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
    });
  });

  describe('getEvents', () => {
    it('returns all events for a run', async () => {
      await store.append({ runId: 'run-1', eventType: 'a', payload: null, seq: 0 });
      await store.append({ runId: 'run-1', eventType: 'b', payload: null, seq: 1 });

      const events = await store.getEvents('run-1');
      expect(events).toHaveLength(2);
    });

    it('filters by afterSeq', async () => {
      await store.append({ runId: 'run-1', eventType: 'a', payload: null, seq: 0 });
      await store.append({ runId: 'run-1', eventType: 'b', payload: null, seq: 1 });
      await store.append({ runId: 'run-1', eventType: 'c', payload: null, seq: 2 });

      const events = await store.getEvents('run-1', 0);
      expect(events).toHaveLength(2);
      expect(events[0].seq).toBe(1);
    });

    it('returns empty array for unknown run', async () => {
      const events = await store.getEvents('nonexistent');
      expect(events).toEqual([]);
    });
  });

  describe('getLastSeq', () => {
    it('returns -1 for empty run', async () => {
      expect(await store.getLastSeq('run-1')).toBe(-1);
    });

    it('returns highest seq', async () => {
      await store.append({ runId: 'run-1', eventType: 'a', payload: null, seq: 0 });
      await store.append({ runId: 'run-1', eventType: 'b', payload: null, seq: 5 });
      await store.append({ runId: 'run-1', eventType: 'c', payload: null, seq: 3 });

      expect(await store.getLastSeq('run-1')).toBe(5);
    });
  });

  describe('detectGaps', () => {
    it('reports no gaps for empty run', async () => {
      const result = await store.detectGaps('run-1');
      expect(result.hasGaps).toBe(false);
      expect(result.missingSeqs).toEqual([]);
      expect(result.lastSeq).toBe(-1);
    });

    it('reports no gaps for contiguous sequence', async () => {
      await store.append({ runId: 'run-1', eventType: 'a', payload: null, seq: 0 });
      await store.append({ runId: 'run-1', eventType: 'b', payload: null, seq: 1 });
      await store.append({ runId: 'run-1', eventType: 'c', payload: null, seq: 2 });

      const result = await store.detectGaps('run-1');
      expect(result.hasGaps).toBe(false);
      expect(result.missingSeqs).toEqual([]);
      expect(result.lastSeq).toBe(2);
    });

    it('detects gaps in sequence', async () => {
      await store.append({ runId: 'run-1', eventType: 'a', payload: null, seq: 0 });
      await store.append({ runId: 'run-1', eventType: 'c', payload: null, seq: 3 });
      await store.append({ runId: 'run-1', eventType: 'e', payload: null, seq: 5 });

      const result = await store.detectGaps('run-1');
      expect(result.hasGaps).toBe(true);
      expect(result.missingSeqs).toEqual([1, 2, 4]);
      expect(result.lastSeq).toBe(5);
    });

    it('returns defensive copies — external mutation does not affect store', async () => {
      const payload = { key: 'original' };
      await store.append({ runId: 'run-1', eventType: 'a', payload, seq: 0 });

      payload.key = 'mutated-input';

      const events = await store.getEvents('run-1');
      expect((events[0].payload as { key: string }).key).toBe('original');

      events[0].eventType = 'tampered';
      const fresh = await store.getEvents('run-1');
      expect(fresh[0].eventType).toBe('a');
    });

    it('detects gap at start', async () => {
      await store.append({ runId: 'run-1', eventType: 'b', payload: null, seq: 2 });

      const result = await store.detectGaps('run-1');
      expect(result.hasGaps).toBe(true);
      expect(result.missingSeqs).toEqual([0, 1]);
    });
  });
});
