import { type DbClient, runs } from '@open-rush/db';
import { and, desc, eq, gte, lt, notInArray, sql } from 'drizzle-orm';

import { LOCK_NS_IDEMPOTENCY } from './idempotency.js';
import type { CreateRunInput, Run, RunDb } from './run-service.js';
import type { RunStatus } from './run-state-machine.js';

type RunRow = typeof runs.$inferSelect;

function mapRow(row: RunRow): Run {
  return {
    id: row.id,
    agentId: row.agentId,
    taskId: row.taskId,
    conversationId: row.conversationId,
    parentRunId: row.parentRunId,
    status: row.status as RunStatus,
    prompt: row.prompt,
    provider: row.provider,
    connectionMode: row.connectionMode,
    modelId: row.modelId,
    triggerSource: row.triggerSource,
    agentDefinitionVersion: row.agentDefinitionVersion,
    idempotencyKey: row.idempotencyKey,
    idempotencyRequestHash: row.idempotencyRequestHash,
    activeStreamId: row.activeStreamId,
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

function buildInsertValues(input: CreateRunInput): typeof runs.$inferInsert {
  return {
    agentId: input.agentId,
    taskId: input.taskId ?? null,
    conversationId: input.conversationId ?? null,
    prompt: input.prompt,
    parentRunId: input.parentRunId ?? null,
    provider: input.provider ?? 'claude-code',
    connectionMode: input.connectionMode ?? 'anthropic',
    modelId: input.modelId ?? null,
    triggerSource: input.triggerSource ?? 'user',
    status: 'queued',
    agentDefinitionVersion: input.agentDefinitionVersion ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
    idempotencyRequestHash: input.idempotencyRequestHash ?? null,
  };
}

export class DrizzleRunDb implements RunDb {
  constructor(private db: DbClient) {}

  async create(input: CreateRunInput): Promise<Run> {
    const [row] = await this.db.insert(runs).values(buildInsertValues(input)).returning();
    return mapRow(row);
  }

  async findById(id: string): Promise<Run | null> {
    const [row] = await this.db.select().from(runs).where(eq(runs.id, id)).limit(1);
    return row ? mapRow(row) : null;
  }

  async updateStatus(id: string, status: RunStatus, extra?: Partial<Run>): Promise<Run | null> {
    const updates: Record<string, unknown> = {
      status,
      updatedAt: new Date(),
    };

    if (extra?.startedAt) updates.startedAt = extra.startedAt;
    if (extra?.completedAt) updates.completedAt = extra.completedAt;
    if (extra?.errorMessage !== undefined) updates.errorMessage = extra.errorMessage;
    if (extra?.activeStreamId !== undefined) updates.activeStreamId = extra.activeStreamId;
    if (extra?.retryCount !== undefined) updates.retryCount = extra.retryCount;

    const [row] = await this.db.update(runs).set(updates).where(eq(runs.id, id)).returning();
    return row ? mapRow(row) : null;
  }

  async listByAgent(agentId: string, limit = 50): Promise<Run[]> {
    const rows = await this.db
      .select()
      .from(runs)
      .where(eq(runs.agentId, agentId))
      .orderBy(desc(runs.createdAt))
      .limit(limit);
    return rows.map(mapRow);
  }

  async findStuckRuns(olderThanMs: number): Promise<Run[]> {
    const threshold = new Date(Date.now() - olderThanMs);
    const terminalStatuses = ['completed', 'failed'];

    const rows = await this.db
      .select()
      .from(runs)
      .where(and(notInArray(runs.status, terminalStatuses), lt(runs.updatedAt, threshold)));
    return rows.map(mapRow);
  }

  /**
   * Idempotency lookup (see `specs/managed-agents-api.md` §幂等性 §实现).
   *
   * Uses the task-3 partial index `runs_idempotency_lookup_idx` on
   * `(idempotency_key, created_at DESC) WHERE idempotency_key IS NOT NULL`
   * so lookups stay cheap even without a UNIQUE constraint.
   */
  async findLatestByIdempotencyKey(key: string, since: Date): Promise<Run | null> {
    const [row] = await this.db
      .select()
      .from(runs)
      .where(and(eq(runs.idempotencyKey, key), gte(runs.createdAt, since)))
      .orderBy(desc(runs.createdAt))
      .limit(1);
    return row ? mapRow(row) : null;
  }

  /**
   * Transactional "lookup-or-insert" for POST /runs idempotency.
   *
   * Structure (mirrors the advisory-lock pattern from
   * `DrizzleEventStore.appendAssignSeq` and
   * `AgentDefinitionService.patch`):
   *
   *   BEGIN;
   *     SELECT pg_advisory_xact_lock(LOCK_NS_IDEMPOTENCY, hashtext(key));
   *     SELECT * FROM runs WHERE idempotency_key = $1 AND created_at >= $2
   *       ORDER BY created_at DESC LIMIT 1;
   *     -- if existing: `onExisting(existing)` returns the replay row OR throws
   *     -- else: INSERT fresh row
   *   COMMIT;
   *
   * The 2-arg advisory lock `pg_advisory_xact_lock(ns, key)` serializes
   * concurrent writers for the *same* idempotency key; different-key
   * traffic proceeds in parallel. The lock releases at commit/rollback,
   * so throwing from `onExisting` still releases it.
   *
   * `onExisting` is injected by the service layer so the conflict-vs-
   * replay decision + error construction stay outside the DB adapter.
   */
  async createWithIdempotencyTx(
    input: CreateRunInput,
    lookup: { key: string; since: Date },
    onExisting: (existing: Run) => Run | Promise<Run> | never
  ): Promise<Run> {
    return await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${LOCK_NS_IDEMPOTENCY}, hashtext(${lookup.key}))`
      );

      const [existingRow] = await tx
        .select()
        .from(runs)
        .where(and(eq(runs.idempotencyKey, lookup.key), gte(runs.createdAt, lookup.since)))
        .orderBy(desc(runs.createdAt))
        .limit(1);

      if (existingRow) {
        return await onExisting(mapRow(existingRow));
      }

      const [inserted] = await tx.insert(runs).values(buildInsertValues(input)).returning();
      return mapRow(inserted);
    });
  }
}
