import type { SandboxInfo, SandboxProvider } from '@open-rush/sandbox';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryEventStore } from '../event-store.js';
import type { Checkpoint, CheckpointDb, CheckpointStorage } from '../run/checkpoint-service.js';
import { CheckpointService } from '../run/checkpoint-service.js';
import { RunOrchestrator } from '../run/run-orchestrator.js';
import type { CreateRunInput, Run, RunDb } from '../run/run-service.js';
import { RunService } from '../run/run-service.js';
import type { RunStatus } from '../run/run-state-machine.js';
import { S3CheckpointStorage } from '../run/s3-checkpoint-storage.js';

// --- Mocks ---

class MockRunDb implements RunDb {
  private runs = new Map<string, Run>();
  async create(input: CreateRunInput): Promise<Run> {
    const run: Run = {
      id: `run-${Date.now()}`,
      agentId: input.agentId,
      taskId: input.taskId ?? null,
      conversationId: input.conversationId ?? null,
      parentRunId: null,
      status: 'queued',
      prompt: input.prompt,
      provider: 'anthropic',
      connectionMode: 'sse',
      modelId: null,
      triggerSource: 'api',
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
    const r = this.runs.get(id);
    return r ? { ...r } : null;
  }
  async updateStatus(id: string, status: RunStatus, extra?: Partial<Run>): Promise<Run | null> {
    const r = this.runs.get(id);
    if (!r) return null;
    r.status = status;
    r.updatedAt = new Date();
    if (extra) Object.assign(r, extra);
    return { ...r };
  }
  async listByAgent(): Promise<Run[]> {
    return [];
  }
  async findStuckRuns(): Promise<Run[]> {
    return [];
  }
  seed(run: Run): void {
    this.runs.set(run.id, { ...run });
  }
}

class MockSandboxProvider implements SandboxProvider {
  async create(): Promise<SandboxInfo> {
    return {
      id: 'sbx-1',
      status: 'running',
      endpoint: 'http://localhost:8787',
      previewUrl: null,
      createdAt: new Date(),
    };
  }
  async destroy(): Promise<void> {}
  async getInfo(): Promise<SandboxInfo | null> {
    return null;
  }
  async healthCheck(): Promise<boolean> {
    return true;
  }
  async getEndpointUrl(_id: string, port: number): Promise<string | null> {
    return `http://localhost:${port}`;
  }
  async exec(): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return { stdout: '', stderr: '', exitCode: 0 };
  }
}

class MockCheckpointDb implements CheckpointDb {
  private checkpoints = new Map<string, Checkpoint>();
  async create(runId: string): Promise<Checkpoint> {
    const cp: Checkpoint = {
      id: `cp-${Date.now()}`,
      runId,
      status: 'in_progress',
      messagesSnapshotRef: null,
      workspaceDeltaRef: null,
      lastEventSeq: null,
      degradedRecovery: false,
      createdAt: new Date(),
    };
    this.checkpoints.set(cp.id, cp);
    return { ...cp };
  }
  async update(id: string, updates: Partial<Checkpoint>): Promise<Checkpoint | null> {
    const cp = this.checkpoints.get(id);
    if (!cp) return null;
    Object.assign(cp, updates);
    return { ...cp };
  }
  async findLatest(runId: string): Promise<Checkpoint | null> {
    for (const cp of this.checkpoints.values()) {
      if (cp.runId === runId) return { ...cp };
    }
    return null;
  }
}

class MockS3Storage {
  uploads = new Map<string, Buffer>();
  async upload(key: string, body: Buffer): Promise<void> {
    this.uploads.set(key, body);
  }
  async download(key: string): Promise<Buffer> {
    const data = this.uploads.get(key);
    if (!data) throw new Error('Not found');
    return data;
  }
}

function makeQueuedRun(id: string): Run {
  return {
    id,
    agentId: 'agent-1',
    taskId: null,
    conversationId: null,
    parentRunId: null,
    status: 'queued',
    prompt: 'test',
    provider: 'anthropic',
    connectionMode: 'sse',
    modelId: null,
    triggerSource: 'api',
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
}

function mockSSEResponse(events: Array<Record<string, unknown>>): Response {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

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

// --- Tests ---

describe('Finalization with CheckpointService', () => {
  it('creates checkpoint during finalization', async () => {
    const runDb = new MockRunDb();
    const eventStore = new InMemoryEventStore();
    const s3 = new MockS3Storage();
    const checkpointDb = new MockCheckpointDb();
    const checkpointService = new CheckpointService(checkpointDb, new S3CheckpointStorage(s3));

    const orchestrator = new RunOrchestrator({
      runService: new RunService(runDb),
      sandboxProvider: new MockSandboxProvider(),
      eventStore,
      checkpointService,
    });

    const run = makeQueuedRun('run-fin-1');
    runDb.seed(run);
    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { type: 'text-delta', content: 'Hello' },
        { type: 'finish', reason: 'end_turn' },
      ])
    );

    await orchestrator.execute('run-fin-1', 'test', 'agent-1');

    const finalRun = await runDb.findById('run-fin-1');
    expect(finalRun?.status).toBe('completed');

    // Checkpoint should have been created
    const cp = await checkpointDb.findLatest('run-fin-1');
    expect(cp).not.toBeNull();
    expect(cp?.status).toBe('completed');
    expect(cp?.messagesSnapshotRef).toBeTruthy();
    expect(cp?.lastEventSeq).toBe(1); // 2 events, last seq = 1

    // S3 should have the snapshot
    expect(s3.uploads.size).toBe(1);
    const [, data] = [...s3.uploads.entries()][0];
    const parsed = JSON.parse(data.toString());
    expect(parsed).toHaveLength(2);
  });

  it('completes even if checkpoint fails', async () => {
    const runDb = new MockRunDb();
    const eventStore = new InMemoryEventStore();
    const failingStorage: CheckpointStorage = {
      uploadSnapshot: () => Promise.reject(new Error('S3 down')),
      downloadSnapshot: () => Promise.reject(new Error('S3 down')),
    };
    const checkpointService = new CheckpointService(new MockCheckpointDb(), failingStorage);

    const orchestrator = new RunOrchestrator({
      runService: new RunService(runDb),
      sandboxProvider: new MockSandboxProvider(),
      eventStore,
      checkpointService,
    });

    const run = makeQueuedRun('run-fin-fail');
    runDb.seed(run);
    fetchMock.mockResolvedValueOnce(mockSSEResponse([{ type: 'finish', reason: 'end_turn' }]));

    await orchestrator.execute('run-fin-fail', 'test', 'agent-1');

    const finalRun = await runDb.findById('run-fin-fail');
    expect(finalRun?.status).toBe('completed');
  });

  it('works without checkpointService (backward compat)', async () => {
    const runDb = new MockRunDb();
    const eventStore = new InMemoryEventStore();

    const orchestrator = new RunOrchestrator({
      runService: new RunService(runDb),
      sandboxProvider: new MockSandboxProvider(),
      eventStore,
      // No checkpointService
    });

    const run = makeQueuedRun('run-no-cp');
    runDb.seed(run);
    fetchMock.mockResolvedValueOnce(mockSSEResponse([{ type: 'finish', reason: 'end_turn' }]));

    await orchestrator.execute('run-no-cp', 'test', 'agent-1');

    const finalRun = await runDb.findById('run-no-cp');
    expect(finalRun?.status).toBe('completed');
  });
});

describe('S3CheckpointStorage', () => {
  it('uploads and downloads snapshot', async () => {
    const s3 = new MockS3Storage();
    const storage = new S3CheckpointStorage(s3);

    const data = Buffer.from('{"events":[]}');
    const ref = await storage.uploadSnapshot('run-1', data);
    expect(ref).toContain('checkpoints/run-1/');

    const downloaded = await storage.downloadSnapshot(ref);
    expect(downloaded.toString()).toBe('{"events":[]}');
  });
});
