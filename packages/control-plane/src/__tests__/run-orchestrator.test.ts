import type { CreateSandboxOptions, SandboxInfo, SandboxProvider } from '@open-rush/sandbox';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryEventStore } from '../event-store.js';
import { RunOrchestrator } from '../run/run-orchestrator.js';
import type { CreateRunInput, Run, RunDb } from '../run/run-service.js';
import { RunService } from '../run/run-service.js';
import type { RunStatus } from '../run/run-state-machine.js';

// ---------------------------------------------------------------------------
// Mock RunDb (in-memory)
// ---------------------------------------------------------------------------

class MockRunDb implements RunDb {
  private runs = new Map<string, Run>();

  async create(input: CreateRunInput): Promise<Run> {
    const run: Run = {
      id: `run-${Date.now()}`,
      agentId: input.agentId,
      taskId: input.taskId ?? null,
      conversationId: input.conversationId ?? null,
      parentRunId: input.parentRunId ?? null,
      status: 'queued',
      prompt: input.prompt,
      provider: input.provider ?? 'anthropic',
      connectionMode: input.connectionMode ?? 'sse',
      modelId: input.modelId ?? null,
      triggerSource: input.triggerSource ?? 'api',
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
    if (extra) {
      Object.assign(run, extra);
    }
    return { ...run };
  }

  async listByAgent(_agentId: string, _limit?: number): Promise<Run[]> {
    return [];
  }

  async findStuckRuns(_olderThanMs: number): Promise<Run[]> {
    return [];
  }

  /** Seed a run directly for testing */
  seed(run: Run): void {
    this.runs.set(run.id, { ...run });
  }
}

// ---------------------------------------------------------------------------
// Mock SandboxProvider
// ---------------------------------------------------------------------------

class MockSandboxProvider implements SandboxProvider {
  createCalls: CreateSandboxOptions[] = [];
  destroyCalls: string[] = [];
  shouldFailCreate = false;
  shouldFailHealthCheck = false;
  shouldFailGetEndpointUrl = false;

  async create(opts: CreateSandboxOptions): Promise<SandboxInfo> {
    this.createCalls.push(opts);
    if (this.shouldFailCreate) {
      throw new Error('Sandbox creation failed');
    }
    return {
      id: 'sbx-1',
      status: 'running',
      endpoint: 'http://localhost:8787',
      previewUrl: null,
      createdAt: new Date(),
    };
  }

  async destroy(id: string): Promise<void> {
    this.destroyCalls.push(id);
  }

  async getInfo(id: string): Promise<SandboxInfo | null> {
    return {
      id,
      status: 'running',
      endpoint: 'http://localhost:8787',
      previewUrl: null,
      createdAt: new Date(),
    };
  }

  async healthCheck(_id: string): Promise<boolean> {
    if (this.shouldFailHealthCheck) {
      return false;
    }
    return true;
  }

  async getEndpointUrl(_id: string, port: number): Promise<string | null> {
    if (this.shouldFailGetEndpointUrl) {
      return null;
    }
    return `http://localhost:${port}`;
  }

  async exec(
    _id: string,
    _command: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return { stdout: '', stderr: '', exitCode: 0 };
  }
}

// ---------------------------------------------------------------------------
// SSE response helper
// ---------------------------------------------------------------------------

function mockSSEResponse(events: Array<{ type: string; [k: string]: unknown }>): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function mockSSEErrorResponse(status = 500): Response {
  return new Response('Internal Server Error', {
    status,
    statusText: 'Internal Server Error',
  });
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeQueuedRun(id: string, agentId = 'agent-1'): Run {
  return {
    id,
    agentId,
    taskId: null,
    conversationId: null,
    parentRunId: null,
    status: 'queued',
    prompt: 'test prompt',
    provider: 'anthropic',
    connectionMode: 'sse',
    modelId: null,
    triggerSource: 'api',
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
  };
}

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RunOrchestrator', () => {
  let runDb: MockRunDb;
  let runService: RunService;
  let sandboxProvider: MockSandboxProvider;
  let eventStore: InMemoryEventStore;
  let orchestrator: RunOrchestrator;

  beforeEach(() => {
    runDb = new MockRunDb();
    runService = new RunService(runDb);
    sandboxProvider = new MockSandboxProvider();
    eventStore = new InMemoryEventStore();
    orchestrator = new RunOrchestrator({
      runService,
      sandboxProvider,
      eventStore,
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('transitions through all states and persists events', async () => {
      const run = makeQueuedRun('run-1');
      runDb.seed(run);

      const sseEvents = [
        { type: 'text_delta', content: 'Hello' },
        { type: 'text_delta', content: ' World' },
        { type: 'done', reason: 'end_turn' },
      ];

      // Mock fetch for AgentBridge.sendPrompt
      fetchMock.mockResolvedValueOnce(mockSSEResponse(sseEvents));

      await orchestrator.execute('run-1', 'test prompt', 'agent-1');

      // Verify final run state
      const finalRun = await runDb.findById('run-1');
      expect(finalRun?.status).toBe('completed');
      expect(finalRun?.completedAt).toBeInstanceOf(Date);

      // Verify events were persisted
      const events = await eventStore.getEvents('run-1');
      expect(events).toHaveLength(3);
      expect(events[0].eventType).toBe('text_delta');
      expect(events[0].seq).toBe(0);
      expect(events[1].eventType).toBe('text_delta');
      expect(events[1].seq).toBe(1);
      expect(events[2].eventType).toBe('done');
      expect(events[2].seq).toBe(2);

      // Verify sandbox lifecycle
      expect(sandboxProvider.createCalls).toHaveLength(1);
      expect(sandboxProvider.createCalls[0].agentId).toBe('agent-1');
      expect(sandboxProvider.createCalls[0].ttlSeconds).toBe(3600);
      expect(sandboxProvider.destroyCalls).toHaveLength(1);
      expect(sandboxProvider.destroyCalls[0]).toBe('sbx-1');
    });

    it('calls agent bridge with correct URL and session', async () => {
      const run = makeQueuedRun('run-2');
      runDb.seed(run);

      fetchMock.mockResolvedValueOnce(mockSSEResponse([{ type: 'done', reason: 'end_turn' }]));

      await orchestrator.execute('run-2', 'hello', 'agent-1');

      // Verify fetch was called with the right URL
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:8787/prompt');
      expect(init.method).toBe('POST');

      const body = JSON.parse(init.body);
      expect(body.prompt).toBe('hello');
      expect(body.sessionId).toBe('run-2');
    });

    it('passes through startedAt when entering running state', async () => {
      const run = makeQueuedRun('run-3');
      runDb.seed(run);

      fetchMock.mockResolvedValueOnce(mockSSEResponse([{ type: 'done', reason: 'end_turn' }]));

      await orchestrator.execute('run-3', 'test', 'agent-1');

      const finalRun = await runDb.findById('run-3');
      expect(finalRun?.startedAt).toBeInstanceOf(Date);
    });
  });

  // -------------------------------------------------------------------------
  // Sandbox creation failure
  // -------------------------------------------------------------------------

  describe('sandbox creation failure', () => {
    it('transitions to failed when sandbox creation throws', async () => {
      const run = makeQueuedRun('run-fail-create');
      runDb.seed(run);

      sandboxProvider.shouldFailCreate = true;

      await orchestrator.execute('run-fail-create', 'test', 'agent-1');

      const finalRun = await runDb.findById('run-fail-create');
      expect(finalRun?.status).toBe('failed');
      expect(finalRun?.errorMessage).toBe('Sandbox creation failed');
    });

    it('does not attempt sandbox destroy when creation failed', async () => {
      const run = makeQueuedRun('run-no-destroy');
      runDb.seed(run);

      sandboxProvider.shouldFailCreate = true;

      await orchestrator.execute('run-no-destroy', 'test', 'agent-1');

      expect(sandboxProvider.destroyCalls).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Endpoint URL failure
  // -------------------------------------------------------------------------

  describe('endpoint URL failure', () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevDevAgent = process.env.DEV_AGENT_WORKER_URL;

    beforeEach(() => {
      // In dev/test, getDevAgentWorkerUrl() bypasses sandbox URL — force production so null endpoint fails.
      process.env.NODE_ENV = 'production';
      delete process.env.DEV_AGENT_WORKER_URL;
    });

    afterEach(() => {
      process.env.NODE_ENV = prevNodeEnv;
      if (prevDevAgent !== undefined) {
        process.env.DEV_AGENT_WORKER_URL = prevDevAgent;
      } else {
        delete process.env.DEV_AGENT_WORKER_URL;
      }
    });

    it('transitions to failed when endpoint URL is null', async () => {
      const run = makeQueuedRun('run-no-endpoint');
      runDb.seed(run);

      sandboxProvider.shouldFailGetEndpointUrl = true;

      await orchestrator.execute('run-no-endpoint', 'test', 'agent-1');

      const finalRun = await runDb.findById('run-no-endpoint');
      expect(finalRun?.status).toBe('failed');
      expect(finalRun?.errorMessage).toBe('Sandbox endpoint URL not available');
    });

    it('still destroys sandbox after endpoint failure', async () => {
      const run = makeQueuedRun('run-cleanup-endpoint');
      runDb.seed(run);

      sandboxProvider.shouldFailGetEndpointUrl = true;

      await orchestrator.execute('run-cleanup-endpoint', 'test', 'agent-1');

      expect(sandboxProvider.destroyCalls).toHaveLength(1);
      expect(sandboxProvider.destroyCalls[0]).toBe('sbx-1');
    });
  });

  // -------------------------------------------------------------------------
  // Stream error (agent-worker returns 500)
  // -------------------------------------------------------------------------

  describe('stream error', () => {
    it('transitions to failed when agent-worker returns 500', async () => {
      const run = makeQueuedRun('run-500');
      runDb.seed(run);

      fetchMock.mockResolvedValueOnce(mockSSEErrorResponse(500));

      await orchestrator.execute('run-500', 'test', 'agent-1');

      const finalRun = await runDb.findById('run-500');
      expect(finalRun?.status).toBe('failed');
      expect(finalRun?.errorMessage).toContain('Agent worker error: 500');
    });

    it('destroys sandbox after stream error', async () => {
      const run = makeQueuedRun('run-500-cleanup');
      runDb.seed(run);

      fetchMock.mockResolvedValueOnce(mockSSEErrorResponse(500));

      await orchestrator.execute('run-500-cleanup', 'test', 'agent-1');

      expect(sandboxProvider.destroyCalls).toHaveLength(1);
      expect(sandboxProvider.destroyCalls[0]).toBe('sbx-1');
    });
  });

  // -------------------------------------------------------------------------
  // Cleanup guarantees
  // -------------------------------------------------------------------------

  describe('cleanup', () => {
    it('destroys sandbox even when finalization fails', async () => {
      const run = makeQueuedRun('run-finalize-fail');
      runDb.seed(run);

      fetchMock.mockResolvedValueOnce(mockSSEResponse([{ type: 'done', reason: 'end_turn' }]));

      // Make the transition to 'finalizing_prepare' fail by corrupting the run status
      // after stream consumption. We simulate this by having the run status not match
      // what the state machine expects for the finalization path.
      // Instead, let's spy on runService.transition to throw on finalizing_prepare.
      const transitionSpy = vi.spyOn(runService, 'transition');

      // Let the first 3 transitions succeed (provisioning, preparing, running),
      // then fail on the 4th (finalizing_prepare)
      let callCount = 0;
      transitionSpy.mockImplementation(async (id, to, extra?) => {
        callCount++;
        if (callCount === 4) {
          throw new Error('Finalization transition failed');
        }
        // Call through to original implementation
        transitionSpy.mockRestore();
        const result = await runService.transition(id, to, extra);
        transitionSpy.mockImplementation(async (_id, _to, _extra?) => {
          callCount++;
          if (callCount === 4) {
            throw new Error('Finalization transition failed');
          }
          return runService.transition(_id, _to, _extra);
        });
        return result;
      });

      await orchestrator.execute('run-finalize-fail', 'test', 'agent-1');

      // Sandbox should still be destroyed regardless
      expect(sandboxProvider.destroyCalls).toHaveLength(1);
      expect(sandboxProvider.destroyCalls[0]).toBe('sbx-1');
    });

    it('sandbox.destroy is called exactly once on happy path', async () => {
      const run = makeQueuedRun('run-single-destroy');
      runDb.seed(run);

      fetchMock.mockResolvedValueOnce(mockSSEResponse([{ type: 'done', reason: 'end_turn' }]));

      await orchestrator.execute('run-single-destroy', 'test', 'agent-1');

      expect(sandboxProvider.destroyCalls).toHaveLength(1);
    });

    it('handles sandbox.destroy failure gracefully', async () => {
      const run = makeQueuedRun('run-destroy-fail');
      runDb.seed(run);

      fetchMock.mockResolvedValueOnce(mockSSEResponse([{ type: 'done', reason: 'end_turn' }]));

      // Make destroy reject
      vi.spyOn(sandboxProvider, 'destroy').mockRejectedValue(new Error('Destroy failed'));

      // Should not throw despite destroy failure
      await orchestrator.execute('run-destroy-fail', 'test', 'agent-1');

      const finalRun = await runDb.findById('run-destroy-fail');
      expect(finalRun?.status).toBe('completed');
    });
  });

  // -------------------------------------------------------------------------
  // SSE stream parsing
  // -------------------------------------------------------------------------

  describe('SSE stream parsing', () => {
    it('skips [DONE] sentinel in SSE stream', async () => {
      const run = makeQueuedRun('run-done-sentinel');
      runDb.seed(run);

      // [DONE] sentinel should be ignored, only real JSON events counted.
      // Include a 'done' typed event to trigger incremental save flush.
      const body =
        `data: ${JSON.stringify({ type: 'text_delta', content: 'hi' })}\n\n` +
        'data: [DONE]\n\n' +
        `data: ${JSON.stringify({ type: 'done', reason: 'end_turn' })}\n\n`;
      fetchMock.mockResolvedValueOnce(
        new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      );

      await orchestrator.execute('run-done-sentinel', 'test', 'agent-1');

      const events = await eventStore.getEvents('run-done-sentinel');
      // 2 real events: text_delta + done. The [DONE] sentinel was skipped.
      expect(events).toHaveLength(2);
      expect(events[0].eventType).toBe('text_delta');
      expect(events[1].eventType).toBe('done');
    });

    it('skips malformed JSON in SSE stream', async () => {
      const run = makeQueuedRun('run-malformed');
      runDb.seed(run);

      const body =
        `data: ${JSON.stringify({ type: 'text_delta', content: 'ok' })}\n\n` +
        'data: {not valid json}\n\n' +
        `data: ${JSON.stringify({ type: 'done', reason: 'end_turn' })}\n\n`;

      fetchMock.mockResolvedValueOnce(
        new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      );

      await orchestrator.execute('run-malformed', 'test', 'agent-1');

      const events = await eventStore.getEvents('run-malformed');
      // Only 2 valid events (malformed one skipped)
      expect(events).toHaveLength(2);
      expect(events[0].seq).toBe(0);
      expect(events[1].seq).toBe(1);
    });

    it('handles empty stream body', async () => {
      const run = makeQueuedRun('run-empty-stream');
      runDb.seed(run);

      fetchMock.mockResolvedValueOnce(
        new Response('', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        })
      );

      await orchestrator.execute('run-empty-stream', 'test', 'agent-1');

      const events = await eventStore.getEvents('run-empty-stream');
      expect(events).toHaveLength(0);

      // Should still complete successfully
      const finalRun = await runDb.findById('run-empty-stream');
      expect(finalRun?.status).toBe('completed');
    });
  });

  // -------------------------------------------------------------------------
  // v1 event protocol feature flag (task-10)
  //
  // When `OPENRUSH_V1_EVENTS_ENABLED=true`:
  // - seq is assigned by EventStore.appendAssignSeq (server-side)
  // - `data-openrush-run-started` and `data-openrush-run-done` are injected
  //   around the worker stream
  // When off (default): legacy in-process counter; no extension events.
  // -------------------------------------------------------------------------

  describe('v1 events flag: OPENRUSH_V1_EVENTS_ENABLED', () => {
    const prev = process.env.OPENRUSH_V1_EVENTS_ENABLED;
    afterEach(() => {
      if (prev !== undefined) {
        process.env.OPENRUSH_V1_EVENTS_ENABLED = prev;
      } else {
        delete process.env.OPENRUSH_V1_EVENTS_ENABLED;
      }
    });

    it('default (flag off) uses legacy counter seq=0,1,2 and emits no openrush-* events', async () => {
      delete process.env.OPENRUSH_V1_EVENTS_ENABLED;
      const run = makeQueuedRun('run-flag-off');
      run.agentDefinitionVersion = 3;
      runDb.seed(run);

      fetchMock.mockResolvedValueOnce(
        mockSSEResponse([
          { type: 'text-delta', delta: 'hi' },
          { type: 'finish', reason: 'stop' },
        ])
      );

      await orchestrator.execute('run-flag-off', 'p', 'agent-1');

      const events = await eventStore.getEvents('run-flag-off');
      const seqs = events.map((e) => e.seq);
      // Legacy counter (0-based), no injected openrush-* events.
      expect(seqs).toEqual([0, 1]);
      expect(events.map((e) => e.eventType)).toEqual(['text-delta', 'finish']);
    });

    it('when flag is "true" assigns seq via EventStore starting at 1 and emits run-started/run-done', async () => {
      process.env.OPENRUSH_V1_EVENTS_ENABLED = 'true';
      const run = makeQueuedRun('run-flag-on');
      run.agentDefinitionVersion = 7;
      runDb.seed(run);

      fetchMock.mockResolvedValueOnce(
        mockSSEResponse([
          { type: 'text-start', id: 'm1' },
          { type: 'text-delta', id: 'm1', delta: 'ok' },
          { type: 'text-end', id: 'm1' },
          { type: 'finish', reason: 'stop' },
        ])
      );

      await orchestrator.execute('run-flag-on', 'p', 'agent-1');

      const events = await eventStore.getEvents('run-flag-on');
      const types = events.map((e) => e.eventType);
      const seqs = events.map((e) => e.seq);

      // Layout: [run-started, ...worker chunks, run-done]
      expect(types[0]).toBe('data-openrush-run-started');
      expect(types[types.length - 1]).toBe('data-openrush-run-done');
      expect(types).toContain('text-start');
      expect(types).toContain('text-delta');
      expect(types).toContain('finish');

      // seqs are monotonically increasing, starting at 1, with no gaps.
      expect(seqs[0]).toBe(1);
      for (let i = 1; i < seqs.length; i++) {
        expect(seqs[i]).toBe(seqs[i - 1] + 1);
      }

      // Verify the run-started payload carries definitionVersion from runDb.
      const runStarted = events.find((e) => e.eventType === 'data-openrush-run-started');
      expect(runStarted).toBeDefined();
      const startedPayload = runStarted?.payload as {
        type: string;
        data: { runId: string; agentId: string; definitionVersion: number };
      };
      expect(startedPayload.type).toBe('data-openrush-run-started');
      expect(startedPayload.data.runId).toBe('run-flag-on');
      expect(startedPayload.data.agentId).toBe('agent-1');
      expect(startedPayload.data.definitionVersion).toBe(7);

      // Verify the run-done payload carries status=success on success path.
      const runDone = events.find((e) => e.eventType === 'data-openrush-run-done');
      expect(runDone).toBeDefined();
      const donePayload = runDone?.payload as {
        type: string;
        data: { status: string };
      };
      expect(donePayload.type).toBe('data-openrush-run-done');
      expect(donePayload.data.status).toBe('success');
    });

    it('when flag is "true" but run has no agentDefinitionVersion, skips BOTH run-started and run-done (no orphan done)', async () => {
      // Invariant: `run-done` must never appear without a matching
      // `run-started`. When `definitionVersion` is null the extension
      // chunks are both suppressed, keeping the invariant symmetric.
      process.env.OPENRUSH_V1_EVENTS_ENABLED = 'true';
      const run = makeQueuedRun('run-flag-on-no-ver');
      run.agentDefinitionVersion = null;
      runDb.seed(run);

      fetchMock.mockResolvedValueOnce(mockSSEResponse([{ type: 'finish', reason: 'stop' }]));

      await orchestrator.execute('run-flag-on-no-ver', 'p', 'agent-1');

      const events = await eventStore.getEvents('run-flag-on-no-ver');
      const types = events.map((e) => e.eventType);
      expect(types).not.toContain('data-openrush-run-started');
      expect(types).not.toContain('data-openrush-run-done');
    });

    it('when flag is "true" and worker returns a network failure, emits run-done with status=failed', async () => {
      process.env.OPENRUSH_V1_EVENTS_ENABLED = 'true';
      const run = makeQueuedRun('run-flag-on-fail');
      run.agentDefinitionVersion = 2;
      runDb.seed(run);

      fetchMock.mockResolvedValueOnce(mockSSEErrorResponse(500));

      await orchestrator.execute('run-flag-on-fail', 'p', 'agent-1');

      const events = await eventStore.getEvents('run-flag-on-fail');
      const types = events.map((e) => e.eventType);
      // Started was emitted (run-started before the fetch call), so run-done
      // (status=failed) must also be emitted.
      expect(types).toContain('data-openrush-run-started');
      const runDone = events.find((e) => e.eventType === 'data-openrush-run-done');
      expect(runDone).toBeDefined();
      const donePayload = runDone?.payload as {
        type: string;
        data: { status: string; error?: string };
      };
      expect(donePayload.data.status).toBe('failed');
      expect(donePayload.data.error).toBeDefined();

      // Run is in failed state
      const final = await runDb.findById('run-flag-on-fail');
      expect(final?.status).toBe('failed');
    });

    it('emits run-done at most once even when finalize() throws after stream success', async () => {
      // If the stream completes successfully and `run-done(success)` has
      // been emitted, a subsequent `finalize()` exception must NOT produce
      // a second, contradictory `run-done(failed)` event.
      process.env.OPENRUSH_V1_EVENTS_ENABLED = 'true';
      const run = makeQueuedRun('run-done-once');
      run.agentDefinitionVersion = 4;
      runDb.seed(run);
      fetchMock.mockResolvedValueOnce(mockSSEResponse([{ type: 'finish', reason: 'stop' }]));

      // Force finalize() to throw by making updateStatus reject for any
      // finalizing_* target. We monkey-patch RunService.transition via
      // runDb.updateStatus to throw only when the target state is
      // `finalizing_prepare` (the first step of finalize()).
      const origUpdate = runDb.updateStatus.bind(runDb);
      runDb.updateStatus = async (id, status, extra) => {
        if (status === 'finalizing_prepare') {
          throw new Error('finalize boom');
        }
        return origUpdate(id, status, extra);
      };

      await orchestrator.execute('run-done-once', 'p', 'agent-1');

      const events = await eventStore.getEvents('run-done-once');
      const dones = events.filter((e) => e.eventType === 'data-openrush-run-done');
      expect(dones).toHaveLength(1);
      // Preserved the success status since that's what fired first.
      const donePayload = dones[0].payload as { data: { status: string } };
      expect(donePayload.data.status).toBe('success');
    });

    it('does not emit run-done when run-started was skipped (null definitionVersion)', async () => {
      // run-done must never precede run-started. When definitionVersion
      // is null the injector skips run-started, which must also suppress
      // the catch-branch run-done(failed) on a pre-stream failure.
      process.env.OPENRUSH_V1_EVENTS_ENABLED = 'true';
      const run = makeQueuedRun('run-no-version-fail');
      run.agentDefinitionVersion = null;
      runDb.seed(run);
      // Sandbox creation fails → we reach catch before the stream even
      // starts; since run-started was never emitted (and also would have
      // been skipped for null version), no run-done should appear.
      sandboxProvider.shouldFailCreate = true;

      await orchestrator.execute('run-no-version-fail', 'p', 'agent-1');

      const events = await eventStore.getEvents('run-no-version-fail');
      const types = events.map((e) => e.eventType);
      expect(types).not.toContain('data-openrush-run-started');
      expect(types).not.toContain('data-openrush-run-done');
      const final = await runDb.findById('run-no-version-fail');
      expect(final?.status).toBe('failed');
    });

    it('treats unset / non-lowercase-"true" values as off (strict equality)', async () => {
      // Strict check: only the lowercase literal 'true' activates v1.
      // Any other value — including case variants like 'TRUE' / 'True',
      // and non-boolean strings — is treated as OFF. This avoids the
      // "accidentally-on" class of bugs from tolerant boolean parsing.
      for (const v of ['false', '0', 'FALSE', 'TRUE', 'True', '1', 'yes', '']) {
        process.env.OPENRUSH_V1_EVENTS_ENABLED = v;
        const runId = `run-flag-val-${v || 'empty'}`;
        const run = makeQueuedRun(runId);
        run.agentDefinitionVersion = 1;
        runDb.seed(run);
        fetchMock.mockResolvedValueOnce(mockSSEResponse([{ type: 'finish', reason: 'stop' }]));
        await orchestrator.execute(runId, 'p', 'agent-1');
        const events = await eventStore.getEvents(runId);
        const types = events.map((e) => e.eventType);
        expect(types).not.toContain('data-openrush-run-started');
        expect(types).not.toContain('data-openrush-run-done');
      }
    });
  });
});
