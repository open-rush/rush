/**
 * Run Lifecycle Integration Tests
 *
 * Tests the complete run lifecycle through real service chains:
 * RunService + RunStateMachine — only the DB layer is in-memory.
 *
 * Covers:
 * 1. Happy path: queued → ... → completed
 * 2. Failure + retry cycle
 * 3. Worker unreachable recovery
 * 4. Finalization retry/timeout escalation
 * 5. Max retry guard
 * 6. recoverStuckRuns cron behavior
 * 7. Timestamp management (startedAt, completedAt)
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { CreateRunInput, Run, RunDb } from '../run/run-service.js';
import { RunService } from '../run/run-service.js';
import type { RunStatus } from '../run/run-state-machine.js';

// ---------------------------------------------------------------------------
// In-Memory RunDb
// ---------------------------------------------------------------------------

class InMemoryRunDb implements RunDb {
  private runs = new Map<string, Run>();
  private nextId = 1;

  async create(input: CreateRunInput): Promise<Run> {
    const run: Run = {
      id: `run-${this.nextId++}`,
      agentId: input.agentId,
      taskId: input.taskId ?? null,
      conversationId: input.conversationId ?? null,
      parentRunId: input.parentRunId ?? null,
      status: 'queued',
      prompt: input.prompt,
      provider: input.provider ?? 'claude-code',
      connectionMode: input.connectionMode ?? 'anthropic',
      modelId: input.modelId ?? null,
      triggerSource: input.triggerSource ?? 'user',
      agentDefinitionVersion: null,
      activeStreamId: null,
      retryCount: 0,
      maxRetries: 3,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      startedAt: null,
      completedAt: null,
    };
    this.runs.set(run.id, run);
    return { ...run };
  }

  async findById(id: string): Promise<Run | null> {
    const run = this.runs.get(id);
    return run ? { ...run } : null;
  }

  async updateStatus(id: string, status: RunStatus, extra?: Partial<Run>): Promise<Run | null> {
    const run = this.runs.get(id);
    if (!run) return null;
    run.status = status;
    run.updatedAt = new Date();
    if (extra) Object.assign(run, extra);
    return { ...run };
  }

  async listByAgent(agentId: string, limit = 50): Promise<Run[]> {
    return [...this.runs.values()]
      .filter((r) => r.agentId === agentId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async findStuckRuns(olderThanMs: number): Promise<Run[]> {
    const threshold = Date.now() - olderThanMs;
    return [...this.runs.values()].filter(
      (r) => r.status !== 'completed' && r.status !== 'failed' && r.updatedAt.getTime() < threshold
    );
  }

  /** Direct seed for testing */
  seed(run: Run): void {
    this.runs.set(run.id, { ...run });
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Run Lifecycle Flow', () => {
  let db: InMemoryRunDb;
  let service: RunService;

  beforeEach(() => {
    db = new InMemoryRunDb();
    service = new RunService(db);
  });

  // -----------------------------------------------------------------------
  // 1. Happy path: queued → completed
  // -----------------------------------------------------------------------

  describe('happy path: queued → completed', () => {
    it('walks through all 10 states in order', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'Build a web app' });

      const transitions: RunStatus[] = [
        'provisioning',
        'preparing',
        'running',
        'finalizing_prepare',
        'finalizing_uploading',
        'finalizing_verifying',
        'finalizing_metadata_commit',
        'finalized',
        'completed',
      ];

      const statusHistory: RunStatus[] = [run.status as RunStatus];

      for (const to of transitions) {
        const updated = await service.transition(run.id, to);
        statusHistory.push(updated.status as RunStatus);
      }

      expect(statusHistory).toEqual([
        'queued',
        'provisioning',
        'preparing',
        'running',
        'finalizing_prepare',
        'finalizing_uploading',
        'finalizing_verifying',
        'finalizing_metadata_commit',
        'finalized',
        'completed',
      ]);
    });

    it('sets startedAt when entering running state', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'test' });
      expect(run.startedAt).toBeNull();

      await service.transition(run.id, 'provisioning');
      await service.transition(run.id, 'preparing');
      const running = await service.transition(run.id, 'running');

      expect(running.startedAt).toBeInstanceOf(Date);
    });

    it('sets completedAt when reaching completed', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'test' });

      const steps: RunStatus[] = [
        'provisioning',
        'preparing',
        'running',
        'finalizing_prepare',
        'finalizing_uploading',
        'finalizing_verifying',
        'finalizing_metadata_commit',
        'finalized',
        'completed',
      ];

      let result: Run = run;
      for (const s of steps) {
        result = await service.transition(run.id, s);
      }

      expect(result.completedAt).toBeInstanceOf(Date);
    });

    it('sets completedAt when transitioning to failed', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'test' });
      await service.transition(run.id, 'provisioning');

      const failed = await service.transition(run.id, 'failed', {
        errorMessage: 'Something went wrong',
      });

      expect(failed.completedAt).toBeInstanceOf(Date);
      expect(failed.errorMessage).toBe('Something went wrong');
    });

    it('does not overwrite startedAt on re-entry to running via retry', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'test' });

      await service.transition(run.id, 'provisioning');
      await service.transition(run.id, 'preparing');
      const firstRunning = await service.transition(run.id, 'running');
      const firstStartedAt = firstRunning.startedAt;

      // Fail and retry
      await service.transition(run.id, 'failed');
      const retried = await service.retry(run.id);
      expect(retried.status).toBe('queued');

      // Walk back to running
      await service.transition(run.id, 'provisioning');
      await service.transition(run.id, 'preparing');
      const secondRunning = await service.transition(run.id, 'running');

      // startedAt should NOT be overwritten because the run already has one
      expect(secondRunning.startedAt).toEqual(firstStartedAt);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Failure + retry cycle
  // -----------------------------------------------------------------------

  describe('failure + retry cycle', () => {
    it('retries a failed run back to queued with incremented retryCount', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'test' });
      expect(run.retryCount).toBe(0);

      await service.transition(run.id, 'provisioning');
      await service.transition(run.id, 'failed', { errorMessage: 'timeout' });

      const retried = await service.retry(run.id);
      expect(retried.status).toBe('queued');
      expect(retried.retryCount).toBe(1);
      expect(retried.errorMessage).toBeNull();
    });

    it('supports multiple retry cycles', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'test' });

      for (let i = 0; i < 3; i++) {
        // Each retry cycle: queued → provisioning → failed → retry
        await service.transition(run.id, 'provisioning');
        await service.transition(run.id, 'failed');
        const retried = await service.retry(run.id);
        expect(retried.retryCount).toBe(i + 1);
      }
    });

    it('throws when retrying a non-failed run', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'test' });

      await expect(service.retry(run.id)).rejects.toThrow('Can only retry failed runs');
    });

    it('throws when max retries exceeded', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'test' });

      // Use all 3 retries
      for (let i = 0; i < 3; i++) {
        await service.transition(run.id, 'provisioning');
        await service.transition(run.id, 'failed');
        await service.retry(run.id);
      }

      // 4th retry should fail
      await service.transition(run.id, 'provisioning');
      await service.transition(run.id, 'failed');
      await expect(service.retry(run.id)).rejects.toThrow('Max retries exceeded');
    });

    it('complete retry cycle: fail → retry → succeed', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'retry test' });

      // First attempt fails
      await service.transition(run.id, 'provisioning');
      await service.transition(run.id, 'preparing');
      await service.transition(run.id, 'running');
      await service.transition(run.id, 'failed', { errorMessage: 'network error' });

      // Retry
      await service.retry(run.id);

      // Second attempt succeeds
      const fullPath: RunStatus[] = [
        'provisioning',
        'preparing',
        'running',
        'finalizing_prepare',
        'finalizing_uploading',
        'finalizing_verifying',
        'finalizing_metadata_commit',
        'finalized',
        'completed',
      ];

      for (const s of fullPath) {
        await service.transition(run.id, s);
      }

      const final = await service.getById(run.id);
      expect(final?.status).toBe('completed');
      expect(final?.retryCount).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Worker unreachable recovery
  // -----------------------------------------------------------------------

  describe('worker unreachable', () => {
    it('recovers from worker_unreachable back to running', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'test' });

      await service.transition(run.id, 'provisioning');
      await service.transition(run.id, 'preparing');
      await service.transition(run.id, 'running');
      await service.transition(run.id, 'worker_unreachable');

      // Recover
      const recovered = await service.transition(run.id, 'running');
      expect(recovered.status).toBe('running');
    });

    it('fails from worker_unreachable when recovery not possible', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'test' });

      await service.transition(run.id, 'provisioning');
      await service.transition(run.id, 'preparing');
      await service.transition(run.id, 'running');
      await service.transition(run.id, 'worker_unreachable');

      const failed = await service.transition(run.id, 'failed', {
        errorMessage: 'Worker unreachable timeout',
      });
      expect(failed.status).toBe('failed');
      expect(failed.errorMessage).toBe('Worker unreachable timeout');
    });
  });

  // -----------------------------------------------------------------------
  // 4. Finalization retry/timeout escalation
  // -----------------------------------------------------------------------

  describe('finalization retry + timeout escalation', () => {
    async function advanceToFinalizing(runId: string): Promise<void> {
      await service.transition(runId, 'provisioning');
      await service.transition(runId, 'preparing');
      await service.transition(runId, 'running');
      await service.transition(runId, 'finalizing_prepare');
      await service.transition(runId, 'finalizing_uploading');
    }

    it('retries from finalizing_retryable_failed back to uploading', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'test' });
      await advanceToFinalizing(run.id);

      // Fail during upload
      await service.transition(run.id, 'finalizing_retryable_failed');

      // Retry
      const retried = await service.transition(run.id, 'finalizing_uploading');
      expect(retried.status).toBe('finalizing_uploading');
    });

    it('escalates to timeout after retryable failure', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'test' });
      await advanceToFinalizing(run.id);

      await service.transition(run.id, 'finalizing_retryable_failed');
      const timeout = await service.transition(run.id, 'finalizing_timeout');
      expect(timeout.status).toBe('finalizing_timeout');
    });

    it('full escalation: retryable_failed → timeout → manual_intervention → failed', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'test' });
      await advanceToFinalizing(run.id);

      await service.transition(run.id, 'finalizing_retryable_failed');
      await service.transition(run.id, 'finalizing_timeout');
      await service.transition(run.id, 'finalizing_manual_intervention');
      const failed = await service.transition(run.id, 'failed');

      expect(failed.status).toBe('failed');
    });

    it('rejects skipping finalization steps', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'test' });
      await advanceToFinalizing(run.id);

      // Can't jump from uploading to finalized
      await expect(service.transition(run.id, 'finalized')).rejects.toThrow('Invalid transition');

      // Can't jump from uploading to completed
      await expect(service.transition(run.id, 'completed')).rejects.toThrow('Invalid transition');
    });
  });

  // -----------------------------------------------------------------------
  // 5. Invalid transitions
  // -----------------------------------------------------------------------

  describe('invalid transitions', () => {
    it('rejects backward transition from running to queued', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'test' });
      await service.transition(run.id, 'provisioning');
      await service.transition(run.id, 'preparing');
      await service.transition(run.id, 'running');

      await expect(service.transition(run.id, 'queued')).rejects.toThrow('Invalid transition');
    });

    it('rejects transition from completed (terminal)', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'test' });
      const steps: RunStatus[] = [
        'provisioning',
        'preparing',
        'running',
        'finalizing_prepare',
        'finalizing_uploading',
        'finalizing_verifying',
        'finalizing_metadata_commit',
        'finalized',
        'completed',
      ];
      for (const s of steps) await service.transition(run.id, s);

      await expect(service.transition(run.id, 'queued')).rejects.toThrow('Invalid transition');
      await expect(service.transition(run.id, 'failed')).rejects.toThrow('Invalid transition');
    });

    it('rejects transition for non-existent run', async () => {
      await expect(service.transition('nonexistent', 'provisioning')).rejects.toThrow(
        'Run not found'
      );
    });
  });

  // -----------------------------------------------------------------------
  // 6. recoverStuckRuns
  // -----------------------------------------------------------------------

  describe('recoverStuckRuns', () => {
    function makeOldRun(id: string, status: RunStatus, minutesAgo: number): Run {
      const d = new Date(Date.now() - minutesAgo * 60_000);
      return {
        id,
        agentId: 'agent-1',
        taskId: null,
        conversationId: null,
        parentRunId: null,
        status,
        prompt: 'test',
        provider: 'claude-code',
        connectionMode: 'anthropic',
        modelId: null,
        triggerSource: 'user',
        agentDefinitionVersion: null,
        activeStreamId: null,
        retryCount: 0,
        maxRetries: 3,
        errorMessage: null,
        createdAt: d,
        updatedAt: d,
        startedAt: null,
        completedAt: null,
      };
    }

    it('recovers worker_unreachable runs older than threshold', async () => {
      db.seed(makeOldRun('stuck-1', 'worker_unreachable', 5));

      const recovered = await service.recoverStuckRuns(120_000);

      expect(recovered).toHaveLength(1);
      expect(recovered[0].id).toBe('stuck-1');
      expect(recovered[0].status).toBe('failed');
      expect(recovered[0].errorMessage).toBe('Worker unreachable timeout');
    });

    it('ignores worker_unreachable runs newer than threshold', async () => {
      // Create a "stuck" run that was updated 1 minute ago (below 2-min threshold)
      db.seed(makeOldRun('recent-1', 'worker_unreachable', 1));

      const recovered = await service.recoverStuckRuns(120_000);
      expect(recovered).toHaveLength(0);
    });

    it('ignores completed/failed runs', async () => {
      db.seed(makeOldRun('completed-1', 'completed', 10));
      db.seed(makeOldRun('failed-1', 'failed', 10));

      const recovered = await service.recoverStuckRuns(120_000);
      expect(recovered).toHaveLength(0);
    });

    it('only transitions worker_unreachable (not running or provisioning)', async () => {
      // "running" runs that are old are found by findStuckRuns but
      // recoverStuckRuns only acts on worker_unreachable
      db.seed(makeOldRun('running-old', 'running', 10));
      db.seed(makeOldRun('stuck-wu', 'worker_unreachable', 10));

      const recovered = await service.recoverStuckRuns(120_000);
      expect(recovered).toHaveLength(1);
      expect(recovered[0].id).toBe('stuck-wu');

      // The running one should not have been touched
      const runningRun = await db.findById('running-old');
      expect(runningRun?.status).toBe('running');
    });
  });

  // -----------------------------------------------------------------------
  // 7. Service CRUD
  // -----------------------------------------------------------------------

  describe('service CRUD', () => {
    it('creates run with defaults', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'Hello' });

      expect(run.status).toBe('queued');
      expect(run.prompt).toBe('Hello');
      expect(run.agentId).toBe('agent-1');
      expect(run.retryCount).toBe(0);
      expect(run.maxRetries).toBe(3);
      expect(run.startedAt).toBeNull();
      expect(run.completedAt).toBeNull();
    });

    it('getById returns null for missing run', async () => {
      const run = await service.getById('nonexistent');
      expect(run).toBeNull();
    });

    it('listByAgent returns runs for agent', async () => {
      await service.createRun({ agentId: 'agent-1', prompt: 'Run 1' });
      await service.createRun({ agentId: 'agent-1', prompt: 'Run 2' });
      await service.createRun({ agentId: 'agent-2', prompt: 'Run 3' });

      const agent1Runs = await service.listByAgent('agent-1');
      expect(agent1Runs).toHaveLength(2);
      expect(agent1Runs.every((r) => r.agentId === 'agent-1')).toBe(true);
    });

    it('setActiveStreamId updates stream reference', async () => {
      const run = await service.createRun({ agentId: 'agent-1', prompt: 'test' });
      expect(run.activeStreamId).toBeNull();

      await service.setActiveStreamId(run.id, 'stream-abc');

      const updated = await service.getById(run.id);
      expect(updated?.activeStreamId).toBe('stream-abc');
    });

    it('setActiveStreamId throws for non-existent run', async () => {
      await expect(service.setActiveStreamId('missing', 'stream-1')).rejects.toThrow(
        'Run not found'
      );
    });
  });
});
