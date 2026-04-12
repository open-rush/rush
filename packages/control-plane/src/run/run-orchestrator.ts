import type { CreateSandboxOptions, SandboxProvider } from '@rush/sandbox';

import type { EventStore } from '../event-store.js';
import { AgentBridge } from './agent-bridge.js';
import type { CheckpointService } from './checkpoint-service.js';
import type { RunService } from './run-service.js';
import {
  createErrorHandler,
  createIncrementalSave,
  createStreamLogger,
  StreamPipeline,
} from './stream-middleware.js';

export interface RunOrchestratorDeps {
  runService: RunService;
  sandboxProvider: SandboxProvider;
  eventStore: EventStore;
  checkpointService?: CheckpointService;
}

export class RunOrchestrator {
  constructor(private deps: RunOrchestratorDeps) {}

  async execute(runId: string, prompt: string, agentId: string): Promise<void> {
    let sandboxId: string | null = null;

    try {
      // 1. queued → provisioning
      await this.deps.runService.transition(runId, 'provisioning');

      const sandboxOptions: CreateSandboxOptions = {
        agentId,
        ttlSeconds: 3600,
      };
      const sandbox = await this.deps.sandboxProvider.create(sandboxOptions);
      sandboxId = sandbox.id;

      // 2. provisioning → preparing
      await this.deps.runService.transition(runId, 'preparing');
      await this.deps.sandboxProvider.healthCheck(sandboxId);

      // 3. preparing → running
      const endpointUrl = await this.deps.sandboxProvider.getEndpointUrl(sandboxId, 8787);
      if (!endpointUrl) {
        throw new Error('Sandbox endpoint URL not available');
      }

      const agentBridge = new AgentBridge({ agentWorkerUrl: endpointUrl });
      await this.deps.runService.transition(runId, 'running');
      const { streamId, response } = await agentBridge.sendPrompt(prompt, { sessionId: runId });

      // Set activeStreamId on the Run so SSE② can correlate
      await this.deps.runService.setActiveStreamId(runId, streamId);

      // 4. Consume SSE① stream and persist events to DB
      await this.consumeStream(runId, response);

      // 5. Finalization
      await this.finalize(runId);
    } catch (error) {
      try {
        await this.deps.runService.transition(runId, 'failed', {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Best-effort
      }
    } finally {
      if (sandboxId) {
        this.deps.sandboxProvider.destroy(sandboxId).catch(() => {});
      }
    }
  }

  private async finalize(runId: string): Promise<void> {
    await this.deps.runService.transition(runId, 'finalizing_prepare');

    // Create checkpoint (snapshot events for recovery)
    if (this.deps.checkpointService) {
      try {
        const events = await this.deps.eventStore.getEvents(runId);
        const lastSeq = await this.deps.eventStore.getLastSeq(runId);
        const snapshot = Buffer.from(JSON.stringify(events));
        await this.deps.checkpointService.createCheckpoint(runId, snapshot, lastSeq);
      } catch (err) {
        console.error('[finalize] Checkpoint creation failed (non-fatal):', err);
      }
    }

    await this.deps.runService.transition(runId, 'finalizing_uploading');
    // TODO: Upload workspace artifacts to S3

    await this.deps.runService.transition(runId, 'finalizing_verifying');
    // TODO: Verify artifact checksums

    await this.deps.runService.transition(runId, 'finalizing_metadata_commit');
    // TODO: Create PR if applicable

    await this.deps.runService.transition(runId, 'finalized');
    await this.deps.runService.transition(runId, 'completed');
  }

  private async consumeStream(runId: string, response: Response): Promise<void> {
    const pipeline = new StreamPipeline();

    pipeline.use(
      createIncrementalSave(async (event) => {
        await this.deps.eventStore.append({
          runId,
          eventType: event.type,
          payload: event.data,
          seq: event.seq,
        });
      }, 1)
    );

    pipeline.use(
      createErrorHandler((err, event) => {
        console.error('Stream error:', err, event);
      })
    );

    pipeline.use(
      createStreamLogger((msg, data) => {
        console.log(msg, data);
      })
    );

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let seq = 0;
    let buffer = '';

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const json = line.slice(6);
        if (json === '[DONE]') continue;

        try {
          const data = JSON.parse(json);
          const event = { type: data.type, data, seq: seq++, timestamp: Date.now() };
          await pipeline.process(event);
        } catch {
          /* skip malformed */
        }
      }
    }
  }
}
