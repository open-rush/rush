import { beforeEach, describe, expect, it } from 'vitest';
import {
  computeIdempotencyHash,
  IdempotencyConflictError,
  scopeIdempotencyKey,
} from '../run/idempotency.js';
import {
  type CreateRunInput,
  type Run,
  RunAlreadyTerminalError,
  RunCannotCancelError,
  type RunDb,
  RunNotFoundError,
  RunService,
} from '../run/run-service.js';
import type { RunStatus } from '../run/run-state-machine.js';

// ---------------------------------------------------------------------------
// MockRunDb — in-memory backing with optional idempotency hooks
// ---------------------------------------------------------------------------

class MockRunDb implements RunDb {
  runs = new Map<string, Run>();
  createCalls = 0;
  txCalls = 0;
  /**
   * Toggle to exercise the `createWithIdempotencyTx` path (mirrors real
   * DrizzleRunDb). When false, RunService falls back to the plain
   * findLatest/create sequence — also covered separately.
   */
  supportsTx = true;

  async create(input: CreateRunInput): Promise<Run> {
    this.createCalls += 1;
    const run: Run = {
      id: `run-${this.runs.size + 1}`,
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
      agentDefinitionVersion: input.agentDefinitionVersion ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      idempotencyRequestHash: input.idempotencyRequestHash ?? null,
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

  async listByAgent(_agentId: string, _limit?: number): Promise<Run[]> {
    return [];
  }

  async findStuckRuns(_olderThanMs: number): Promise<Run[]> {
    return [];
  }

  async findLatestByIdempotencyKey(key: string, since: Date): Promise<Run | null> {
    const matches = [...this.runs.values()]
      .filter((r) => r.idempotencyKey === key && r.createdAt >= since)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches[0] ? { ...matches[0] } : null;
  }

  // Optional tx hook — the real DrizzleRunDb wraps this in a transaction +
  // advisory lock. Here we just preserve the same outward contract.
  createWithIdempotencyTx = async (
    input: CreateRunInput,
    lookup: { key: string; since: Date },
    onExisting: (existing: Run) => Run | Promise<Run>
  ): Promise<Run> => {
    this.txCalls += 1;
    const existing = await this.findLatestByIdempotencyKey(lookup.key, lookup.since);
    if (existing) {
      return await onExisting(existing);
    }
    return await this.create(input);
  };

  /** Seed a run directly (bypasses create counters). */
  seed(partial: Partial<Run> & { id: string; agentId: string; prompt: string }): Run {
    const run: Run = {
      taskId: null,
      conversationId: null,
      parentRunId: null,
      status: 'queued',
      provider: 'claude-code',
      connectionMode: 'anthropic',
      modelId: null,
      triggerSource: 'user',
      agentDefinitionVersion: null,
      idempotencyKey: null,
      idempotencyRequestHash: null,
      activeStreamId: null,
      retryCount: 0,
      maxRetries: 3,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      startedAt: null,
      completedAt: null,
      ...partial,
    };
    this.runs.set(run.id, run);
    return run;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RunService', () => {
  let db: MockRunDb;
  let service: RunService;

  beforeEach(() => {
    db = new MockRunDb();
    service = new RunService(db);
  });

  // -------------------------------------------------------------------
  // createRun (no idempotency) — preserves pre-task-11 contract
  // -------------------------------------------------------------------
  describe('createRun', () => {
    it('forwards agentDefinitionVersion to RunDb', async () => {
      const run = await service.createRun({
        agentId: 'a1',
        prompt: 'hi',
        agentDefinitionVersion: 5,
      });
      expect(run.agentDefinitionVersion).toBe(5);
      expect(db.createCalls).toBe(1);
    });

    it('leaves agentDefinitionVersion null when omitted', async () => {
      const run = await service.createRun({ agentId: 'a1', prompt: 'hi' });
      expect(run.agentDefinitionVersion).toBeNull();
    });

    it('inherits agentDefinitionVersion from parentRunId when omitted', async () => {
      const parent = db.seed({
        id: 'parent-1',
        agentId: 'a1',
        prompt: 'p',
        agentDefinitionVersion: 9,
      });
      const child = await service.createRun({
        agentId: 'a1',
        prompt: 'follow-up',
        parentRunId: parent.id,
      });
      expect(child.agentDefinitionVersion).toBe(9);
    });

    it('explicit agentDefinitionVersion beats parent inheritance', async () => {
      db.seed({
        id: 'parent-2',
        agentId: 'a1',
        prompt: 'p',
        agentDefinitionVersion: 9,
      });
      const child = await service.createRun({
        agentId: 'a1',
        prompt: 'forked',
        parentRunId: 'parent-2',
        agentDefinitionVersion: 11,
      });
      expect(child.agentDefinitionVersion).toBe(11);
    });

    it('stays null when the parent has no bound version (legacy row)', async () => {
      db.seed({
        id: 'parent-legacy',
        agentId: 'a1',
        prompt: 'p',
        agentDefinitionVersion: null,
      });
      const child = await service.createRun({
        agentId: 'a1',
        prompt: 'follow-up',
        parentRunId: 'parent-legacy',
      });
      expect(child.agentDefinitionVersion).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // createRunWithIdempotency
  // -------------------------------------------------------------------
  describe('createRunWithIdempotency', () => {
    it('plain create when idempotency is omitted', async () => {
      const run = await service.createRunWithIdempotency({
        agentId: 'a1',
        prompt: 'hi',
      });
      expect(run).toBeDefined();
      expect(db.createCalls).toBe(1);
      expect(db.txCalls).toBe(0);
    });

    it('routes through createWithIdempotencyTx when idempotency is provided', async () => {
      const hash = computeIdempotencyHash({ input: 'hi' });
      await service.createRunWithIdempotency(
        { agentId: 'a1', prompt: 'hi' },
        { key: 'k-1', requestHash: hash }
      );
      expect(db.txCalls).toBe(1);
    });

    it('replays the existing run on same key + same hash (no new insert)', async () => {
      const hash = computeIdempotencyHash({ input: 'hi' });
      const first = await service.createRunWithIdempotency(
        { agentId: 'a1', prompt: 'hi' },
        { key: 'k-1', requestHash: hash }
      );
      expect(db.createCalls).toBe(1);

      const second = await service.createRunWithIdempotency(
        { agentId: 'a1', prompt: 'hi' },
        { key: 'k-1', requestHash: hash }
      );
      expect(second.id).toBe(first.id);
      expect(db.createCalls).toBe(1); // no new insert
      expect(db.txCalls).toBe(2);
    });

    it('throws IdempotencyConflictError on same key + different hash', async () => {
      const hashA = computeIdempotencyHash({ input: 'hi' });
      const hashB = computeIdempotencyHash({ input: 'hey' });

      const first = await service.createRunWithIdempotency(
        { agentId: 'a1', prompt: 'hi' },
        { key: 'k-conflict', requestHash: hashA }
      );
      await expect(
        service.createRunWithIdempotency(
          { agentId: 'a1', prompt: 'hey' },
          { key: 'k-conflict', requestHash: hashB }
        )
      ).rejects.toMatchObject({
        code: 'IDEMPOTENCY_CONFLICT',
        existingRunId: first.id,
        existingRequestHash: hashA,
        incomingRequestHash: hashB,
      });

      // Conflict must not create a row
      expect(db.createCalls).toBe(1);
    });

    it('IdempotencyConflictError is distinguishable via instanceof', async () => {
      const hashA = computeIdempotencyHash({ a: 1 });
      const hashB = computeIdempotencyHash({ a: 2 });
      await service.createRunWithIdempotency(
        { agentId: 'a1', prompt: 'p1' },
        { key: 'k', requestHash: hashA }
      );
      await expect(
        service.createRunWithIdempotency(
          { agentId: 'a1', prompt: 'p2' },
          { key: 'k', requestHash: hashB }
        )
      ).rejects.toBeInstanceOf(IdempotencyConflictError);
    });

    it('treats a different key as independent (new run, not replay)', async () => {
      const hashA = computeIdempotencyHash({ a: 1 });
      const hashB = computeIdempotencyHash({ a: 2 });
      const first = await service.createRunWithIdempotency(
        { agentId: 'a1', prompt: 'p' },
        { key: 'k-A', requestHash: hashA }
      );
      const second = await service.createRunWithIdempotency(
        { agentId: 'a1', prompt: 'p' },
        { key: 'k-B', requestHash: hashB }
      );
      expect(first.id).not.toBe(second.id);
      expect(db.createCalls).toBe(2);
    });

    it('ignores in-window flag for expired keys (window boundary)', async () => {
      // Seed an "old" run with the same key, outside the 24h window.
      const hash = computeIdempotencyHash({ p: 1 });
      const OLD = new Date(Date.now() - 25 * 60 * 60 * 1000);
      db.seed({
        id: 'old-run',
        agentId: 'a1',
        prompt: 'p',
        createdAt: OLD,
        // Keys are scoped inside RunService — seed stores the already-
        // scoped form so the `findLatestByIdempotencyKey` lookup matches.
        idempotencyKey: scopeIdempotencyKey('a1', 'k-stale'),
        idempotencyRequestHash: hash,
      });

      const fresh = await service.createRunWithIdempotency(
        { agentId: 'a1', prompt: 'p' },
        { key: 'k-stale', requestHash: hash }
      );
      expect(fresh.id).not.toBe('old-run');
      // Fresh insert happened — confirms expired keys don't replay.
      expect(db.createCalls).toBe(1);
    });

    it('honours caller-supplied nowMs / windowMs for deterministic tests', async () => {
      const hash = computeIdempotencyHash({ p: 1 });
      const baseline = new Date('2025-01-01T00:00:00Z');
      db.seed({
        id: 'baseline-run',
        agentId: 'a1',
        prompt: 'p',
        createdAt: baseline,
        idempotencyKey: scopeIdempotencyKey('a1', 'k'),
        idempotencyRequestHash: hash,
      });

      // now = baseline + 10 minutes, window = 1 hour → inside window → replay
      const replay = await service.createRunWithIdempotency(
        { agentId: 'a1', prompt: 'p' },
        {
          key: 'k',
          requestHash: hash,
          nowMs: baseline.getTime() + 10 * 60 * 1000,
          windowMs: 60 * 60 * 1000,
        }
      );
      expect(replay.id).toBe('baseline-run');

      // now = baseline + 2 hours, window = 1 hour → outside window → fresh
      const fresh = await service.createRunWithIdempotency(
        { agentId: 'a1', prompt: 'p' },
        {
          key: 'k',
          requestHash: hash,
          nowMs: baseline.getTime() + 2 * 60 * 60 * 1000,
          windowMs: 60 * 60 * 1000,
        }
      );
      expect(fresh.id).not.toBe('baseline-run');
    });

    it('falls back to findLatest+create path when tx hook is absent', async () => {
      // Simulate a minimal RunDb without createWithIdempotencyTx — the
      // service still enforces idempotency (best-effort, no concurrency
      // guarantee).
      const fallbackDb: RunDb = {
        create: db.create.bind(db),
        findById: db.findById.bind(db),
        updateStatus: db.updateStatus.bind(db),
        listByAgent: db.listByAgent.bind(db),
        findStuckRuns: db.findStuckRuns.bind(db),
        findLatestByIdempotencyKey: db.findLatestByIdempotencyKey.bind(db),
      };
      const svc = new RunService(fallbackDb);
      const hash = computeIdempotencyHash({ p: 1 });
      const a = await svc.createRunWithIdempotency(
        { agentId: 'a1', prompt: 'p' },
        { key: 'k', requestHash: hash }
      );
      const b = await svc.createRunWithIdempotency(
        { agentId: 'a1', prompt: 'p' },
        { key: 'k', requestHash: hash }
      );
      expect(b.id).toBe(a.id);
    });

    it('persists the agent-scoped idempotencyKey + idempotencyRequestHash on fresh insert', async () => {
      const hash = computeIdempotencyHash({ x: 1 });
      const run = await service.createRunWithIdempotency(
        { agentId: 'a1', prompt: 'p' },
        { key: 'k-persist', requestHash: hash }
      );
      // Keys are stored pre-scoped so the task-3 partial index stays the
      // sole lookup path and cross-agent replay is impossible.
      expect(run.idempotencyKey).toBe(scopeIdempotencyKey('a1', 'k-persist'));
      expect(run.idempotencyRequestHash).toBe(hash);
    });

    it('isolates replays across different agents (scope leak guard)', async () => {
      // Same raw key + same hash, different agents → must not replay.
      const hash = computeIdempotencyHash({ x: 1 });
      const a = await service.createRunWithIdempotency(
        { agentId: 'agent-a', prompt: 'p' },
        { key: 'shared-key', requestHash: hash }
      );
      const b = await service.createRunWithIdempotency(
        { agentId: 'agent-b', prompt: 'p' },
        { key: 'shared-key', requestHash: hash }
      );
      expect(a.id).not.toBe(b.id);
      expect(a.agentId).toBe('agent-a');
      expect(b.agentId).toBe('agent-b');
      expect(db.createCalls).toBe(2);
    });
  });

  // -------------------------------------------------------------------
  // cancelRun
  // -------------------------------------------------------------------
  describe('cancelRun', () => {
    it('throws RunNotFoundError for missing runId', async () => {
      await expect(service.cancelRun('nope')).rejects.toBeInstanceOf(RunNotFoundError);
    });

    // Every non-terminal state listed in `CANCELLABLE_STATES` must
    // transition to `failed` with the cancel marker. If the state
    // machine drops a `→ failed` edge, this table will surface it.
    it.each([
      ['queued'],
      ['provisioning'],
      ['preparing'],
      ['running'],
      ['worker_unreachable'],
      ['finalizing_prepare'],
      ['finalizing_uploading'],
      ['finalizing_verifying'],
      ['finalizing_metadata_commit'],
      ['finalizing_timeout'],
      ['finalizing_manual_intervention'],
    ])('transitions from %s → failed with cancelled marker', async (from) => {
      const run = db.seed({
        id: `r-${from}`,
        agentId: 'a1',
        prompt: 'p',
        status: from as RunStatus,
      });
      const result = await service.cancelRun(run.id);
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBe(RunService.CANCELLED_MESSAGE);
      expect(result.completedAt).toBeInstanceOf(Date);
    });

    it.each([
      ['completed'],
      ['failed'],
      ['finalized'],
    ])('throws RunAlreadyTerminalError for %s', async (st) => {
      const run = db.seed({
        id: `r-term-${st}`,
        agentId: 'a1',
        prompt: 'p',
        status: st as RunStatus,
      });
      const err = await service.cancelRun(run.id).catch((e) => e);
      expect(err).toBeInstanceOf(RunAlreadyTerminalError);
      expect((err as RunAlreadyTerminalError).status).toBe(st);
    });

    it('throws RunCannotCancelError from finalizing_retryable_failed (no direct → failed)', async () => {
      const run = db.seed({
        id: 'r-retryable',
        agentId: 'a1',
        prompt: 'p',
        status: 'finalizing_retryable_failed',
      });
      const err = await service.cancelRun(run.id).catch((e) => e);
      expect(err).toBeInstanceOf(RunCannotCancelError);
      expect((err as RunCannotCancelError).status).toBe('finalizing_retryable_failed');
    });

    it('exposes CANCELLED_MESSAGE as a stable contract string', () => {
      expect(RunService.CANCELLED_MESSAGE).toBe('cancelled by user');
    });
  });

  // -------------------------------------------------------------------
  // State-machine sync check
  //
  // Every status in `CANCELLABLE_STATES` must have a direct `→ failed`
  // edge in `run-state-machine.ts`. This tests the invariant so future
  // state-machine edits that drop a `→ failed` edge surface here rather
  // than as a runtime 500.
  // -------------------------------------------------------------------
  describe('state machine consistency', () => {
    it('every cancellable state has a direct failed-edge', async () => {
      const { canTransition, isTerminal } = await import('../run/run-state-machine.js');
      const { RunStatus } = await import('@open-rush/contracts');
      const allStatuses = RunStatus.options as RunStatus[];
      const knownTerminal: RunStatus[] = ['completed', 'failed', 'finalized'];

      for (const s of allStatuses) {
        if (knownTerminal.includes(s)) continue;
        if (s === 'finalizing_retryable_failed') {
          // Deliberately excluded — must stay non-cancellable.
          expect(canTransition(s, 'failed')).toBe(false);
          continue;
        }
        // All other non-terminals must reach `failed` directly.
        expect(
          canTransition(s, 'failed'),
          `expected '${s}' to have a direct → failed edge (isTerminal=${isTerminal(s)})`
        ).toBe(true);
      }
    });
  });
});
