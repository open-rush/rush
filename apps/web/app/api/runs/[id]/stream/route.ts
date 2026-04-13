import { DrizzleRunDb, isTerminal, RunService } from '@lux/control-plane';
import { agents, getDbClient, runEvents } from '@lux/db';
import { and, eq, gt } from 'drizzle-orm';

import { apiError, requireAuth, verifyProjectAccess } from '@/lib/api-utils';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id: runId } = await params;
  const lastEventId = request.headers.get('Last-Event-ID');
  const parsedSeq = lastEventId ? Number.parseInt(lastEventId, 10) : Number.NaN;
  // Non-numeric Last-Event-ID (e.g. client already received DONE) → return empty stream
  const streamAlreadyFinished = lastEventId !== null && Number.isNaN(parsedSeq);
  const afterSeq = Number.isNaN(parsedSeq) ? -1 : parsedSeq;

  // Look up the Run
  const db = getDbClient();
  const runDb = new DrizzleRunDb(db);
  const runService = new RunService(runDb);
  const run = await runService.getById(runId);

  if (!run) {
    return apiError(404, 'RUN_NOT_FOUND', `Run ${runId} not found`);
  }

  // Verify user has access to the run's project
  const [agent] = await db.select().from(agents).where(eq(agents.id, run.agentId)).limit(1);
  if (!agent) {
    return apiError(404, 'RUN_NOT_FOUND', `Run ${runId} not found`);
  }
  const hasAccess = await verifyProjectAccess(agent.projectId, userId);
  if (!hasAccess) {
    return apiError(403, 'FORBIDDEN', 'No access to this run');
  }

  // If client already received the full stream (non-numeric Last-Event-ID), return DONE only
  if (streamAlreadyFinished) {
    const encoder = new TextEncoder();
    const doneStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new Response(doneStream, {
      headers: sseHeaders(),
    });
  }

  const stream = buildEventStream(db, runService, runId, afterSeq, isTerminal(run.status));

  return new Response(stream, {
    headers: sseHeaders(),
  });
}

function sseHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

function buildEventStream(
  db: ReturnType<typeof getDbClient>,
  runService: RunService,
  runId: string,
  afterSeq: number,
  alreadyTerminal: boolean
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let currentSeq = afterSeq;
  let closed = alreadyTerminal;

  return new ReadableStream({
    async pull(controller) {
      try {
        // Fetch new events since currentSeq
        const events = await db
          .select()
          .from(runEvents)
          .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, currentSeq)))
          .orderBy(runEvents.seq);

        if (events.length > 0) {
          for (const event of events) {
            const data = JSON.stringify(event.payload);
            controller.enqueue(encoder.encode(`id: ${event.seq}\ndata: ${data}\n\n`));
            currentSeq = event.seq;
          }
        }

        // Check if run has reached terminal state
        if (!closed) {
          const run = await runService.getById(runId);
          if (run && isTerminal(run.status)) {
            closed = true;
          }
        }

        if (closed) {
          // All events sent, send DONE and close
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          return;
        }

        // Still in-progress: wait before polling again
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
