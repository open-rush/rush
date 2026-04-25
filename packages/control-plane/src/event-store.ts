import { randomUUID } from 'node:crypto';
import type { RunEvent } from '@open-rush/contracts';

export interface EventStoreEvent {
  runId: string;
  eventType: string;
  payload: unknown;
  seq: number;
  schemaVersion?: string;
}

export interface InsertResult {
  inserted: boolean;
  event: RunEvent;
}

export interface GapDetectionResult {
  hasGaps: boolean;
  missingSeqs: number[];
  lastSeq: number;
}

/**
 * Event payload minus a caller-assigned seq. Used by {@link EventStore.appendAssignSeq}.
 *
 * Single-writer protocol (see `.claude/plans/managed-agents-p0-p1.md` §7.3
 * and `specs/managed-agents-api.md` §事件写入单写者模型): the EventStore is
 * the sole authority over `seq`. Agent-worker does not write `run_events`
 * directly; control-worker consumes the SSE① UIMessageChunk stream and
 * forwards each chunk to `appendAssignSeq`, which allocates the next seq
 * atomically.
 */
export type EventStoreEventWithoutSeq = Omit<EventStoreEvent, 'seq'>;

export interface EventStore {
  /**
   * Append an event at a caller-specified seq.
   *
   * Legacy path retained for the existing pre-v1 consumer that tracks seq
   * with an in-process counter (RunOrchestrator.consumeStream when
   * `OPENRUSH_V1_EVENTS_ENABLED` is false).
   */
  append(event: EventStoreEvent): Promise<InsertResult>;

  /**
   * Append an event and let the store assign the next seq atomically.
   *
   * This is the authoritative entry point for the v1 single-writer event
   * protocol. All producers — SSE① bridge consumer, state-machine hooks,
   * recovery paths, control-worker-injected `data-openrush-*` extension
   * events — must funnel through here to preserve per-run monotonic
   * ordering and the `(run_id, seq)` unique contract.
   */
  appendAssignSeq(event: EventStoreEventWithoutSeq): Promise<InsertResult>;

  getEvents(runId: string, afterSeq?: number): Promise<RunEvent[]>;
  getLastSeq(runId: string): Promise<number>;
  detectGaps(runId: string): Promise<GapDetectionResult>;
}

export class InMemoryEventStore implements EventStore {
  private events = new Map<string, RunEvent[]>();
  /**
   * Per-run write-lock chain. Each call to {@link appendAssignSeq} chains onto
   * the previous promise, serializing concurrent writers for a given run.
   * Matches the `pg_advisory_xact_lock(hashtext(run_id::text))` semantics in
   * the Drizzle implementation (different runs are independent).
   */
  private writeLocks = new Map<string, Promise<unknown>>();

  async append(event: EventStoreEvent): Promise<InsertResult> {
    if (!Number.isInteger(event.seq) || event.seq < 0) {
      throw new Error(`Invalid seq: must be a non-negative integer, got ${event.seq}`);
    }

    const runEvents = this.events.get(event.runId) ?? [];

    const existing = runEvents.find((e) => e.runId === event.runId && e.seq === event.seq);
    if (existing) {
      return { inserted: false, event: clone(existing) };
    }

    const runEvent: RunEvent = {
      id: randomUUID(),
      runId: event.runId,
      eventType: event.eventType,
      payload: structuredClone(event.payload) ?? null,
      seq: event.seq,
      schemaVersion: event.schemaVersion ?? '1',
      createdAt: new Date(),
    };

    runEvents.push(runEvent);
    runEvents.sort((a, b) => a.seq - b.seq);
    this.events.set(event.runId, runEvents);

    return { inserted: true, event: clone(runEvent) };
  }

  async appendAssignSeq(event: EventStoreEventWithoutSeq): Promise<InsertResult> {
    const chain = this.writeLocks.get(event.runId) ?? Promise.resolve();
    const next = chain.then(() => this.doAssignSeq(event));
    // Keep the chain alive even on error so subsequent writers still serialize.
    this.writeLocks.set(
      event.runId,
      next.catch(() => undefined)
    );
    return next;
  }

  private async doAssignSeq(event: EventStoreEventWithoutSeq): Promise<InsertResult> {
    const runEvents = this.events.get(event.runId) ?? [];
    // seq numbering matches the Drizzle impl: first event is 1, not 0.
    const maxSeq = runEvents.reduce((m, e) => (e.seq > m ? e.seq : m), 0);
    const nextSeq = maxSeq + 1;

    const runEvent: RunEvent = {
      id: randomUUID(),
      runId: event.runId,
      eventType: event.eventType,
      payload: structuredClone(event.payload) ?? null,
      seq: nextSeq,
      schemaVersion: event.schemaVersion ?? '1',
      createdAt: new Date(),
    };

    runEvents.push(runEvent);
    runEvents.sort((a, b) => a.seq - b.seq);
    this.events.set(event.runId, runEvents);

    return { inserted: true, event: clone(runEvent) };
  }

  async getEvents(runId: string, afterSeq = -1): Promise<RunEvent[]> {
    const runEvents = this.events.get(runId) ?? [];
    return runEvents.filter((e) => e.seq > afterSeq).map(clone);
  }

  async getLastSeq(runId: string): Promise<number> {
    const runEvents = this.events.get(runId) ?? [];
    if (runEvents.length === 0) return -1;
    return runEvents[runEvents.length - 1].seq;
  }

  async detectGaps(runId: string): Promise<GapDetectionResult> {
    const runEvents = this.events.get(runId) ?? [];
    if (runEvents.length === 0) {
      return { hasGaps: false, missingSeqs: [], lastSeq: -1 };
    }

    const seqs = runEvents.map((e) => e.seq).sort((a, b) => a - b);
    const firstSeq = seqs[0];
    const lastSeq = seqs[seqs.length - 1];
    const missingSeqs: number[] = [];

    // Scan from the first observed seq. The legacy path (pre-v1 flag)
    // numbers from 0; `appendAssignSeq` numbers from 1. We intentionally
    // treat either origin as valid — a run-scoped gap is "seq skipped
    // between two observed events", not "seq lower than the first event".
    const seqSet = new Set(seqs);
    for (let i = firstSeq; i <= lastSeq; i++) {
      if (!seqSet.has(i)) {
        missingSeqs.push(i);
      }
    }

    return {
      hasGaps: missingSeqs.length > 0,
      missingSeqs,
      lastSeq,
    };
  }

  clear(): void {
    this.events.clear();
  }
}

function clone(event: RunEvent): RunEvent {
  return {
    ...event,
    payload: structuredClone(event.payload),
    createdAt: new Date(event.createdAt),
  };
}
