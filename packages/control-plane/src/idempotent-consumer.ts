import type { RunEvent } from '@lux/contracts';
import type { EventStore, EventStoreEvent } from './event-store.js';

export interface ConsumeResult {
  accepted: boolean;
  duplicate: boolean;
  event: RunEvent;
  gapDetected: boolean;
  missingSeqs: number[];
}

export class IdempotentConsumer {
  constructor(private store: EventStore) {}

  async consume(event: EventStoreEvent): Promise<ConsumeResult> {
    const { inserted, event: stored } = await this.store.append(event);

    const gaps = await this.store.detectGaps(event.runId);

    return {
      accepted: inserted,
      duplicate: !inserted,
      event: stored,
      gapDetected: gaps.hasGaps,
      missingSeqs: gaps.missingSeqs,
    };
  }

  async getEventsSince(runId: string, afterSeq: number): Promise<RunEvent[]> {
    return this.store.getEvents(runId, afterSeq);
  }

  async getLastSeq(runId: string): Promise<number> {
    return this.store.getLastSeq(runId);
  }
}
