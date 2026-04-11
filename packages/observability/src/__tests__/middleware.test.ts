import { describe, expect, it } from 'vitest';
import { getRequestContext } from '../context.js';
import { withNextRouteContext } from '../middleware/next.js';
import { REQUEST_ID_HEADER } from '../request-id.js';

describe('withNextRouteContext', () => {
  it('generates requestId when no header present', async () => {
    let capturedRequestId: string | undefined;

    const handler = withNextRouteContext('web', async (_request) => {
      capturedRequestId = getRequestContext()?.requestId;
      return new Response('ok');
    });

    const request = new Request('http://localhost/api/test');
    const response = await handler(request, {});

    expect(capturedRequestId).toMatch(/^req-\d+-[0-9a-f]{12}$/);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(capturedRequestId);
  });

  it('uses valid incoming requestId from header', async () => {
    let capturedRequestId: string | undefined;

    const handler = withNextRouteContext('web', async () => {
      capturedRequestId = getRequestContext()?.requestId;
      return new Response('ok');
    });

    const request = new Request('http://localhost/api/test', {
      headers: { [REQUEST_ID_HEADER]: 'custom-req-123' },
    });
    await handler(request, {});

    expect(capturedRequestId).toBe('custom-req-123');
  });

  it('rejects invalid requestId and generates new one', async () => {
    let capturedRequestId: string | undefined;

    const handler = withNextRouteContext('web', async () => {
      capturedRequestId = getRequestContext()?.requestId;
      return new Response('ok');
    });

    const request = new Request('http://localhost/api/test', {
      headers: { [REQUEST_ID_HEADER]: '<script>alert(1)</script>' },
    });
    await handler(request, {});

    expect(capturedRequestId).not.toBe('<script>alert(1)</script>');
    expect(capturedRequestId).toMatch(/^req-\d+-[0-9a-f]{12}$/);
  });

  it('sets service in context', async () => {
    let capturedService: string | undefined;

    const handler = withNextRouteContext('my-service', async () => {
      capturedService = getRequestContext()?.service;
      return new Response('ok');
    });

    const request = new Request('http://localhost/api/test');
    await handler(request, {});

    expect(capturedService).toBe('my-service');
  });

  it('isolates context between concurrent requests', async () => {
    const results: string[] = [];

    const handler = withNextRouteContext('web', async () => {
      await new Promise((r) => setTimeout(r, Math.random() * 20));
      const id = getRequestContext()?.requestId;
      if (id) results.push(id);
      return new Response('ok');
    });

    const requests = Array.from({ length: 10 }, (_, i) =>
      handler(
        new Request('http://localhost/api/test', {
          headers: { [REQUEST_ID_HEADER]: `req-concurrent-${i}` },
        }),
        {}
      )
    );

    await Promise.all(requests);
    expect(results).toHaveLength(10);
    const unique = new Set(results);
    expect(unique.size).toBe(10);
  });
});
