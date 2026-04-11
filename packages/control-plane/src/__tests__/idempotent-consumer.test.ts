import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '../event-store.js';
import { IdempotentConsumer } from '../idempotent-consumer.js';

describe('IdempotentConsumer', () => {
  let store: InMemoryEventStore;
  let consumer: IdempotentConsumer;

  beforeEach(() => {
    store = new InMemoryEventStore();
    consumer = new IdempotentConsumer(store);
  });

  it('accepts new events', async () => {
    const result = await consumer.consume({
      runId: 'run-1',
      eventType: 'text_delta',
      payload: { delta: 'hello' },
      seq: 0,
    });

    expect(result.accepted).toBe(true);
    expect(result.duplicate).toBe(false);
  });

  it('rejects duplicate events', async () => {
    await consumer.consume({ runId: 'run-1', eventType: 'a', payload: null, seq: 0 });
    const result = await consumer.consume({
      runId: 'run-1',
      eventType: 'a',
      payload: null,
      seq: 0,
    });

    expect(result.accepted).toBe(false);
    expect(result.duplicate).toBe(true);
  });

  it('detects gaps after out-of-order delivery', async () => {
    await consumer.consume({ runId: 'run-1', eventType: 'a', payload: null, seq: 0 });
    const result = await consumer.consume({
      runId: 'run-1',
      eventType: 'c',
      payload: null,
      seq: 3,
    });

    expect(result.accepted).toBe(true);
    expect(result.gapDetected).toBe(true);
    expect(result.missingSeqs).toEqual([1, 2]);
  });

  it('fills gaps and reports no more gaps', async () => {
    await consumer.consume({ runId: 'run-1', eventType: 'a', payload: null, seq: 0 });
    await consumer.consume({ runId: 'run-1', eventType: 'c', payload: null, seq: 2 });

    const fill = await consumer.consume({ runId: 'run-1', eventType: 'b', payload: null, seq: 1 });
    expect(fill.accepted).toBe(true);
    expect(fill.gapDetected).toBe(false);
    expect(fill.missingSeqs).toEqual([]);
  });

  it('getEventsSince returns events after given seq', async () => {
    await consumer.consume({ runId: 'run-1', eventType: 'a', payload: null, seq: 0 });
    await consumer.consume({ runId: 'run-1', eventType: 'b', payload: null, seq: 1 });
    await consumer.consume({ runId: 'run-1', eventType: 'c', payload: null, seq: 2 });

    const events = await consumer.getEventsSince('run-1', 1);
    expect(events).toHaveLength(1);
    expect(events[0].seq).toBe(2);
  });

  it('getLastSeq tracks sequence correctly', async () => {
    expect(await consumer.getLastSeq('run-1')).toBe(-1);

    await consumer.consume({ runId: 'run-1', eventType: 'a', payload: null, seq: 0 });
    expect(await consumer.getLastSeq('run-1')).toBe(0);

    await consumer.consume({ runId: 'run-1', eventType: 'b', payload: null, seq: 5 });
    expect(await consumer.getLastSeq('run-1')).toBe(5);
  });

  describe('fault injection: duplicate delivery burst', () => {
    it('handles rapid duplicate delivery without data corruption', async () => {
      const promises = Array.from({ length: 10 }, () =>
        consumer.consume({ runId: 'run-1', eventType: 'a', payload: { n: 0 }, seq: 0 })
      );

      const results = await Promise.all(promises);
      const accepted = results.filter((r) => r.accepted);
      const duplicates = results.filter((r) => r.duplicate);

      expect(accepted).toHaveLength(1);
      expect(duplicates).toHaveLength(9);

      const events = await consumer.getEventsSince('run-1', -1);
      expect(events).toHaveLength(1);
    });
  });

  describe('fault injection: out-of-order delivery', () => {
    it('correctly reassembles reverse-order delivery', async () => {
      for (let i = 9; i >= 0; i--) {
        await consumer.consume({ runId: 'run-1', eventType: `event-${i}`, payload: null, seq: i });
      }

      const events = await consumer.getEventsSince('run-1', -1);
      expect(events).toHaveLength(10);
      expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });

  describe('fault injection: reconnect with replay', () => {
    it('deduplicates replayed events after reconnect', async () => {
      for (let i = 0; i < 5; i++) {
        await consumer.consume({ runId: 'run-1', eventType: `e-${i}`, payload: null, seq: i });
      }

      for (let i = 3; i < 8; i++) {
        await consumer.consume({ runId: 'run-1', eventType: `e-${i}`, payload: null, seq: i });
      }

      const events = await consumer.getEventsSince('run-1', -1);
      expect(events).toHaveLength(8);
      expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });
  });
});
