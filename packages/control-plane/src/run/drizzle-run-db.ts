import { type DbClient, runs } from '@open-rush/db';
import { and, desc, eq, lt, notInArray } from 'drizzle-orm';

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

export class DrizzleRunDb implements RunDb {
  constructor(private db: DbClient) {}

  async create(input: CreateRunInput): Promise<Run> {
    const [row] = await this.db
      .insert(runs)
      .values({
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
      })
      .returning();
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
}
