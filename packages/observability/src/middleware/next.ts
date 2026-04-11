import { type RequestContext, withRequestContext } from '../context.js';
import { extractOrGenerateRequestId, REQUEST_ID_HEADER } from '../request-id.js';

type NextRouteHandler = (
  request: Request,
  context: Record<string, unknown>
) => Response | Promise<Response>;

export function withNextRouteContext(service: string, handler: NextRouteHandler): NextRouteHandler {
  return async (request, routeContext) => {
    const incoming = request.headers.get(REQUEST_ID_HEADER);
    const requestId = extractOrGenerateRequestId(incoming);

    const ctx: RequestContext = { requestId, service };

    const original = await withRequestContext(ctx, () => handler(request, routeContext));

    const response = new Response(original.body, original);
    response.headers.set(REQUEST_ID_HEADER, requestId);

    return response;
  };
}
