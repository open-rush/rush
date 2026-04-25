import type { RunEvent } from '@open-rush/contracts';
import { type DbClient, runEvents } from '@open-rush/db';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import type {
  EventStore,
  EventStoreEvent,
  EventStoreEventWithoutSeq,
  GapDetectionResult,
  InsertResult,
} from './event-store.js';

function clone(event: RunEvent): RunEvent {
  return {
    ...event,
    payload: structuredClone(event.payload),
    createdAt: new Date(event.createdAt),
  };
}

export class DrizzleEventStore implements EventStore {
  constructor(private db: DbClient) {}

  async append(event: EventStoreEvent): Promise<InsertResult> {
    if (!Number.isInteger(event.seq) || event.seq < 0) {
      throw new Error(`Invalid seq: must be a non-negative integer, got ${event.seq}`);
    }

    const [inserted] = await this.db
      .insert(runEvents)
      .values({
        runId: event.runId,
        eventType: event.eventType,
        payload: structuredClone(event.payload) ?? null,
        seq: event.seq,
        schemaVersion: event.schemaVersion ?? '1',
      })
      .onConflictDoNothing({
        target: [runEvents.runId, runEvents.seq],
      })
      .returning();

    if (inserted) {
      return {
        inserted: true,
        event: clone({
          ...inserted,
          createdAt: inserted.createdAt,
        }),
      };
    }

    const [existing] = await this.db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, event.runId), eq(runEvents.seq, event.seq)))
      .limit(1);

    if (!existing) {
      throw new Error(`Failed to read run event ${event.runId}:${event.seq} after conflict`);
    }

    return {
      inserted: false,
      event: clone(existing),
    };
  }

  /**
   * Atomic "assign next seq + insert" for the v1 single-writer event protocol.
   *
   * Implementation: runs in a transaction so the advisory lock releases at
   * commit/rollback. The lock is keyed on `hashtext(run_id::text)`, so
   * same-run writers serialize while different-run writers proceed in
   * parallel. Inside the lock a single `INSERT ... SELECT ...` computes
   * `COALESCE(MAX(seq), 0) + 1` and writes in one statement.
   *
   * Rationale (see `.claude/plans/managed-agents-p0-p1.md` §7.3):
   * - avoids `SELECT ... FOR UPDATE` round-trip
   * - avoids SERIALIZABLE isolation (no caller-side retry needed)
   * - advisory lock key is stable across connections / pools
   */
  async appendAssignSeq(event: EventStoreEventWithoutSeq): Promise<InsertResult> {
    const schemaVersion = event.schemaVersion ?? '1';
    const payload = structuredClone(event.payload) ?? null;

    return await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${event.runId}::text))`);

      const [inserted] = await tx
        .insert(runEvents)
        .values({
          runId: event.runId,
          eventType: event.eventType,
          payload,
          seq: sql<number>`(COALESCE((SELECT MAX(${runEvents.seq}) FROM ${runEvents} WHERE ${runEvents.runId} = ${event.runId}), 0) + 1)`,
          schemaVersion,
        })
        .returning();

      if (!inserted) {
        throw new Error(`appendAssignSeq failed for run ${event.runId}`);
      }

      return {
        inserted: true,
        event: clone({
          ...inserted,
          createdAt: inserted.createdAt,
        }),
      };
    });
  }

  async getEvents(runId: string, afterSeq = -1): Promise<RunEvent[]> {
    const rows = await this.db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, afterSeq)))
      .orderBy(runEvents.seq);

    return rows.map(clone);
  }

  async getLastSeq(runId: string): Promise<number> {
    const [last] = await this.db
      .select({ seq: runEvents.seq })
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(desc(runEvents.seq))
      .limit(1);

    return last?.seq ?? -1;
  }

  async detectGaps(runId: string): Promise<GapDetectionResult> {
    const events = await this.getEvents(runId);
    if (events.length === 0) {
      return { hasGaps: false, missingSeqs: [], lastSeq: -1 };
    }

    const seqs = events.map((event) => event.seq).sort((a, b) => a - b);
    const firstSeq = seqs[0];
    const lastSeq = seqs[seqs.length - 1];
    const missingSeqs: number[] = [];

    // Scan from the first observed seq (not fixed 0). Legacy path numbers
    // events from 0; appendAssignSeq numbers from 1. Treating either
    // origin as valid prevents false gap reports for v1 sequences.
    const seqSet = new Set(seqs);
    for (let i = firstSeq; i <= lastSeq; i += 1) {
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
}
