import { type DbClient, runCheckpoints } from '@lux/db';
import { desc, eq } from 'drizzle-orm';

import type { Checkpoint, CheckpointDb } from './checkpoint-service.js';

type CheckpointRow = typeof runCheckpoints.$inferSelect;

function mapRow(row: CheckpointRow): Checkpoint {
  return {
    id: row.id,
    runId: row.runId!,
    status: row.status as Checkpoint['status'],
    messagesSnapshotRef: row.messagesSnapshotRef,
    workspaceDeltaRef: row.workspaceDeltaRef,
    lastEventSeq: row.lastEventSeq,
    degradedRecovery: row.degradedRecovery ?? false,
    createdAt: row.createdAt,
  };
}

export class DrizzleCheckpointDb implements CheckpointDb {
  constructor(private db: DbClient) {}

  async create(runId: string): Promise<Checkpoint> {
    const [row] = await this.db
      .insert(runCheckpoints)
      .values({ runId, status: 'in_progress' })
      .returning();
    return mapRow(row);
  }

  async update(id: string, updates: Partial<Checkpoint>): Promise<Checkpoint | null> {
    const values: Record<string, unknown> = {};
    if (updates.status !== undefined) values.status = updates.status;
    if (updates.messagesSnapshotRef !== undefined)
      values.messagesSnapshotRef = updates.messagesSnapshotRef;
    if (updates.workspaceDeltaRef !== undefined)
      values.workspaceDeltaRef = updates.workspaceDeltaRef;
    if (updates.lastEventSeq !== undefined) values.lastEventSeq = updates.lastEventSeq;
    if (updates.degradedRecovery !== undefined) values.degradedRecovery = updates.degradedRecovery;

    const [row] = await this.db
      .update(runCheckpoints)
      .set(values)
      .where(eq(runCheckpoints.id, id))
      .returning();
    return row ? mapRow(row) : null;
  }

  async findLatest(runId: string): Promise<Checkpoint | null> {
    const [row] = await this.db
      .select()
      .from(runCheckpoints)
      .where(eq(runCheckpoints.runId, runId))
      .orderBy(desc(runCheckpoints.createdAt))
      .limit(1);
    return row ? mapRow(row) : null;
  }
}
