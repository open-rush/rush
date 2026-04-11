import type { Context, MiddlewareHandler } from 'hono';
import { type RequestContext, withRequestContext } from '../context.js';
import { extractOrGenerateRequestId, REQUEST_ID_HEADER } from '../request-id.js';

export function createHonoMiddleware(service: string): MiddlewareHandler {
  return async (c: Context, next) => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const requestId = extractOrGenerateRequestId(incoming);

    const ctx: RequestContext = { requestId, service };

    c.set('requestId', requestId);
    c.header(REQUEST_ID_HEADER, requestId);

    await withRequestContext(ctx, next);
  };
}
