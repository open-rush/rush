/**
 * Tests for POST/GET /api/v1/agent-definitions.
 *
 * The route orchestrates auth + Zod validation + access control, then delegates
 * persistence to `AgentDefinitionService`. We mock:
 * - `@/lib/auth/unified-auth` — returns whatever AuthContext the test wants
 * - `@/lib/api-utils` — `verifyProjectAccess` returns boolean
 * - `@open-rush/control-plane` — the service class + domain errors
 * - `@open-rush/db` — `getDbClient` sentinel + table stubs
 *
 * Each test asserts the exact v1 envelope (`{ data: ... }` or `{ error: ... }`)
 * and the mapped HTTP status.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockAuthenticate,
  mockHasScope,
  mockVerifyProjectAccess,
  mockCreate,
  mockList,
  FakeArchivedErr,
  FakeNotFoundErr,
} = vi.hoisted(() => {
  class ArchivedErr extends Error {
    readonly agentId: string;
    readonly archivedAt = new Date('2024-01-01T00:00:00.000Z');
    constructor(agentId: string) {
      super('archived');
      this.name = 'AgentDefinitionArchivedError';
      this.agentId = agentId;
    }
  }
  class NotFoundErr extends Error {
    readonly agentId: string;
    constructor(agentId: string) {
      super('not found');
      this.name = 'AgentDefinitionNotFoundError';
      this.agentId = agentId;
    }
  }
  return {
    mockAuthenticate: vi.fn(),
    mockHasScope: vi.fn(),
    mockVerifyProjectAccess: vi.fn(),
    mockCreate: vi.fn(),
    mockList: vi.fn(),
    FakeArchivedErr: ArchivedErr,
    FakeNotFoundErr: NotFoundErr,
  };
});

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: (req: Request) => mockAuthenticate(req),
  hasScope: (ctx: unknown, scope: string) => mockHasScope(ctx, scope),
}));

// Mock api-utils WITHOUT importActual — the real module pulls in `@/auth` →
// next-auth, which breaks under vitest's ESM resolver. We only need
// verifyProjectAccess here; the rest is unused.
vi.mock('@/lib/api-utils', () => ({
  verifyProjectAccess: (projectId: string, userId: string) =>
    mockVerifyProjectAccess(projectId, userId),
}));

vi.mock('@open-rush/control-plane', () => ({
  AgentDefinitionService: class {
    create = mockCreate;
    list = mockList;
  },
  AgentDefinitionArchivedError: FakeArchivedErr,
  AgentDefinitionNotFoundError: FakeNotFoundErr,
  AgentDefinitionVersionConflictError: class extends Error {
    readonly agentId: string;
    readonly expected: number;
    readonly actual: number;
    constructor(agentId: string, expected: number, actual: number) {
      super('conflict');
      this.name = 'AgentDefinitionVersionConflictError';
      this.agentId = agentId;
      this.expected = expected;
      this.actual = actual;
    }
  },
  AgentDefinitionVersionNotFoundError: class extends Error {
    readonly agentId: string;
    readonly version: number;
    constructor(agentId: string, version: number) {
      super('no version');
      this.name = 'AgentDefinitionVersionNotFoundError';
      this.agentId = agentId;
      this.version = version;
    }
  },
  EmptyAgentDefinitionPatchError: class extends Error {
    constructor() {
      super('empty');
      this.name = 'EmptyAgentDefinitionPatchError';
    }
  },
  InvalidAgentDefinitionInputError: class extends Error {
    readonly field: string;
    readonly value: unknown;
    constructor(field: string, value: unknown, reason: string) {
      super(`${field}=${String(value)}: ${reason}`);
      this.name = 'InvalidAgentDefinitionInputError';
      this.field = field;
      this.value = value;
    }
  },
}));

vi.mock('@open-rush/db', () => ({
  getDbClient: () => ({
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  }),
  projectMembers: { projectId: 'pm.pid', userId: 'pm.uid' },
  projects: { id: 'p.id', createdBy: 'p.cb', deletedAt: 'p.deletedAt' },
}));

vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ type: 'and', parts }),
  eq: (c: unknown, v: unknown) => ({ type: 'eq', c, v }),
  isNull: (c: unknown) => ({ type: 'isNull', c }),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: session user with wildcard scope.
  mockAuthenticate.mockResolvedValue({
    userId: 'user-1',
    scopes: ['*'],
    authType: 'session',
  });
  mockHasScope.mockReturnValue(true);
  mockVerifyProjectAccess.mockResolvedValue(true);
});

function validCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    projectId: '00000000-0000-0000-0000-000000000001',
    name: 'A',
    providerType: 'claude-code',
    allowedTools: [],
    skills: [],
    mcpServers: [],
    maxSteps: 10,
    deliveryMode: 'chat',
    ...overrides,
  };
}

function jsonReq(
  method: string,
  body?: unknown,
  url = 'https://t/api/v1/agent-definitions'
): Request {
  const init: RequestInit = {
    method,
    headers: { 'content-type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(url, init);
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

describe('POST /api/v1/agent-definitions', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await POST(jsonReq('POST', validCreateBody()));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('403 when scope agent-definitions:write missing', async () => {
    mockHasScope.mockReturnValue(false);
    const res = await POST(jsonReq('POST', validCreateBody()));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(mockHasScope).toHaveBeenCalledWith(expect.anything(), 'agent-definitions:write');
  });

  it('400 for invalid JSON', async () => {
    const req = new Request('https://t/api/v1/agent-definitions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 when schema validation fails', async () => {
    const res = await POST(jsonReq('POST', { projectId: 'not-a-uuid' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; issues?: unknown[] } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.error.issues)).toBe(true);
  });

  it('403 when caller has no access to the target project', async () => {
    mockVerifyProjectAccess.mockResolvedValue(false);
    const res = await POST(jsonReq('POST', validCreateBody()));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('201 with data on success; ISO dates on the wire', async () => {
    const created = {
      id: '00000000-0000-0000-0000-000000000aaa',
      projectId: '00000000-0000-0000-0000-000000000001',
      name: 'A',
      description: null,
      icon: null,
      providerType: 'claude-code',
      model: null,
      systemPrompt: null,
      appendSystemPrompt: null,
      allowedTools: [],
      skills: [],
      mcpServers: [],
      maxSteps: 10,
      deliveryMode: 'chat',
      config: null,
      currentVersion: 1,
      archivedAt: null,
      createdAt: new Date('2024-01-02T03:04:05.000Z'),
      updatedAt: new Date('2024-01-02T03:04:05.000Z'),
    };
    mockCreate.mockResolvedValue(created);
    const res = await POST(jsonReq('POST', validCreateBody()));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { createdAt: string; updatedAt: string } };
    expect(body.data.createdAt).toBe('2024-01-02T03:04:05.000Z');
    expect(body.data.updatedAt).toBe('2024-01-02T03:04:05.000Z');
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: 'user-1', name: 'A' })
    );
  });

  it('rethrows unknown errors (surfaces 500 in the Next.js runtime)', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    await expect(POST(jsonReq('POST', validCreateBody()))).rejects.toThrow('boom');
  });
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe('GET /api/v1/agent-definitions', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await GET(jsonReq('GET'));
    expect(res.status).toBe(401);
  });

  it('403 when scope agent-definitions:read missing', async () => {
    mockHasScope.mockReturnValue(false);
    const res = await GET(jsonReq('GET'));
    expect(res.status).toBe(403);
    expect(mockHasScope).toHaveBeenCalledWith(expect.anything(), 'agent-definitions:read');
  });

  it('400 when query validation fails', async () => {
    const res = await GET(
      jsonReq('GET', undefined, 'https://t/api/v1/agent-definitions?limit=abc')
    );
    expect(res.status).toBe(400);
  });

  it('403 when projectId filter is set but caller has no access', async () => {
    mockVerifyProjectAccess.mockResolvedValue(false);
    const res = await GET(
      jsonReq(
        'GET',
        undefined,
        'https://t/api/v1/agent-definitions?projectId=00000000-0000-0000-0000-000000000001'
      )
    );
    expect(res.status).toBe(403);
  });

  it('returns paginated envelope with ISO dates', async () => {
    mockList.mockResolvedValue({
      items: [
        {
          id: '00000000-0000-0000-0000-000000000aaa',
          projectId: '00000000-0000-0000-0000-000000000001',
          name: 'A',
          description: null,
          icon: null,
          providerType: 'claude-code',
          model: null,
          systemPrompt: null,
          appendSystemPrompt: null,
          allowedTools: [],
          skills: [],
          mcpServers: [],
          maxSteps: 10,
          deliveryMode: 'chat',
          config: null,
          currentVersion: 1,
          archivedAt: null,
          createdAt: new Date('2024-03-04T05:06:07.000Z'),
          updatedAt: new Date('2024-03-04T05:06:07.000Z'),
        },
      ],
      nextCursor: 'opaquecursor==',
    });
    const res = await GET(
      jsonReq(
        'GET',
        undefined,
        'https://t/api/v1/agent-definitions?projectId=00000000-0000-0000-0000-000000000001'
      )
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ createdAt: string }>;
      nextCursor: string | null;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].createdAt).toBe('2024-03-04T05:06:07.000Z');
    expect(body.nextCursor).toBe('opaquecursor==');
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: '00000000-0000-0000-0000-000000000001',
        includeArchived: false,
      })
    );
  });
});
