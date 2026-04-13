import { randomUUID } from 'node:crypto';
import type { RunEvent } from '@lux/contracts';

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

export interface EventStore {
  append(event: EventStoreEvent): Promise<InsertResult>;
  getEvents(runId: string, afterSeq?: number): Promise<RunEvent[]>;
  getLastSeq(runId: string): Promise<number>;
  detectGaps(runId: string): Promise<GapDetectionResult>;
}

export class InMemoryEventStore implements EventStore {
  private events = new Map<string, RunEvent[]>();

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
    const lastSeq = seqs[seqs.length - 1];
    const missingSeqs: number[] = [];

    for (let i = 0; i <= lastSeq; i++) {
      if (!seqs.includes(i)) {
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
