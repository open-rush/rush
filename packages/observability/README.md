# @lux/observability

Structured logging and request context propagation for Lux's 3-layer architecture.

## What it Does

- **Structured JSON logging** via pino with automatic sensitive field redaction
- **Request ID** generation, validation, and extraction from HTTP headers
- **AsyncLocalStorage context** propagation — requestId + domain IDs (runId, agentId, sandboxId) flow through async call chains automatically
- **Framework middleware** for Next.js Route Handlers and Hono

## Usage

```typescript
import { createLogger, withRequestContext, getRequestContext } from '@lux/observability';

// Create a logger — JSON in production, pretty in development
const logger = createLogger({ service: 'control-worker' });

// Logs automatically include requestId when inside a context
withRequestContext({ requestId: 'req-123', service: 'control-worker', runId: 'run-456' }, () => {
  logger.info('processing run'); // → { requestId: "req-123", runId: "run-456", msg: "processing run", ... }
});
```

### Next.js Route Handler

```typescript
import { withNextRouteContext } from '@lux/observability';

export const GET = withNextRouteContext('web', async (request) => {
  // requestId is automatically extracted from x-request-id header or generated
  // Response includes x-request-id header
  return Response.json({ ok: true });
});
```

### Hono Middleware

```typescript
import { createHonoMiddleware } from '@lux/observability/hono';

app.use('*', createHonoMiddleware('agent-worker'));
```

### pg-boss Context Propagation

```typescript
// Producer (web → control-worker)
import { getRequestContext } from '@lux/observability';
const ctx = getRequestContext();
pgBoss.send('run:execute', { runId, __ctx: { requestId: ctx?.requestId } });

// Consumer (control-worker)
import { withRequestContext, extractOrGenerateRequestId } from '@lux/observability';
pgBoss.work('run:execute', async (job) => {
  const requestId = extractOrGenerateRequestId(job.data.__ctx?.requestId);
  await withRequestContext({ requestId, service: 'control-worker' }, async () => {
    // all logs carry the original requestId
  });
});
```

## Request ID Flow

```
Browser → [x-request-id header] → Web (Next.js Route Handler)
  → [pg-boss job.data.__ctx.requestId] → Control Worker
  → [x-request-id header] → Agent Worker (Hono)
```

## Redaction

Sensitive fields are automatically redacted in logs: `authorization`, `cookie`, `token`, `password`, `apiKey`, `secret`, `credentials` (including nested paths like `*.token`).

## Dependencies

- `pino` — JSON logger
- `pino-pretty` (dev) — pretty-print for development
- `hono` (optional peer) — only needed for `@lux/observability/hono`
