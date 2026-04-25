import { canTransition, isTerminal, type RunStatus } from './run-state-machine.js';

export interface Run {
  id: string;
  agentId: string;
  taskId: string | null;
  conversationId: string | null;
  parentRunId: string | null;
  status: RunStatus;
  prompt: string;
  provider: string;
  connectionMode: string;
  modelId: string | null;
  triggerSource: string;
  /**
   * AgentDefinition version snapshot this run is bound to (see
   * `specs/agent-definition-versioning.md`). Populated by RunService
   * (task-11) at creation time; nullable for legacy runs created before
   * the versioning migration (task-3) or before task-11 ships.
   *
   * Consumed by the v1 event protocol to emit
   * `data-openrush-run-started.definitionVersion`.
   */
  agentDefinitionVersion: number | null;
  activeStreamId: string | null;
  retryCount: number;
  maxRetries: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface CreateRunInput {
  agentId: string;
  prompt: string;
  taskId?: string | null;
  conversationId?: string | null;
  parentRunId?: string;
  provider?: string;
  connectionMode?: string;
  modelId?: string;
  triggerSource?: string;
}

export interface RunDb {
  create(input: CreateRunInput): Promise<Run>;
  findById(id: string): Promise<Run | null>;
  updateStatus(id: string, status: RunStatus, extra?: Partial<Run>): Promise<Run | null>;
  listByAgent(agentId: string, limit?: number): Promise<Run[]>;
  findStuckRuns(olderThanMs: number): Promise<Run[]>;
}

export class RunService {
  constructor(private db: RunDb) {}

  async createRun(input: CreateRunInput): Promise<Run> {
    return this.db.create(input);
  }

  async getById(id: string): Promise<Run | null> {
    return this.db.findById(id);
  }

  async transition(runId: string, to: RunStatus, extra?: Partial<Run>): Promise<Run> {
    const run = await this.db.findById(runId);
    if (!run) throw new Error('Run not found');

    if (!canTransition(run.status, to)) {
      throw new Error(`Invalid transition: ${run.status} → ${to}`);
    }

    const updates: Partial<Run> = { ...extra };
    if (to === 'running' && !run.startedAt) {
      updates.startedAt = new Date();
    }
    if (isTerminal(to)) {
      updates.completedAt = new Date();
    }
    if (to === 'failed' && extra?.errorMessage) {
      updates.errorMessage = extra.errorMessage;
    }

    const updated = await this.db.updateStatus(runId, to, updates);
    if (!updated) throw new Error('Run not found');
    return updated;
  }

  async setActiveStreamId(runId: string, streamId: string): Promise<void> {
    const run = await this.db.findById(runId);
    if (!run) throw new Error('Run not found');
    await this.db.updateStatus(runId, run.status as RunStatus, { activeStreamId: streamId });
  }

  async retry(runId: string): Promise<Run> {
    const run = await this.db.findById(runId);
    if (!run) throw new Error('Run not found');
    if (run.status !== 'failed') throw new Error('Can only retry failed runs');
    if (run.retryCount >= run.maxRetries) throw new Error('Max retries exceeded');

    return this.transition(runId, 'queued', {
      retryCount: run.retryCount + 1,
      errorMessage: null,
    });
  }

  async listByAgent(agentId: string, limit?: number): Promise<Run[]> {
    return this.db.listByAgent(agentId, limit);
  }

  async recoverStuckRuns(olderThanMs = 120_000): Promise<Run[]> {
    const stuck = await this.db.findStuckRuns(olderThanMs);
    const recovered: Run[] = [];

    for (const run of stuck) {
      if (run.status === 'worker_unreachable') {
        const updated = await this.transition(run.id, 'failed', {
          errorMessage: 'Worker unreachable timeout',
        });
        recovered.push(updated);
      }
    }

    return recovered;
  }
}
