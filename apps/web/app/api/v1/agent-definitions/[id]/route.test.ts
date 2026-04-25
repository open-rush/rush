/**
 * Tests for GET/PATCH /api/v1/agent-definitions/:id.
 *
 * Same mocking strategy as the collection route test. In addition to the core
 * mocks we exercise:
 *   - GET with and without ?version=N
 *   - PATCH with If-Match (success + 409 conflict)
 *   - PATCH missing If-Match header → 400
 *   - archived → 400 on write
 *   - 403 when caller not a member of the owning project
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAuthenticate,
  mockHasScope,
  mockVerifyProjectAccess,
  mockGet,
  mockGetByVersion,
  mockPatch,
  FakeArchivedErr,
  FakeNotFoundErr,
  FakeVersionConflictErr,
  FakeVersionNotFoundErr,
  FakeEmptyPatchErr,
  FakeInvalidInputErr,
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
  class VersionConflictErr extends Error {
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
  }
  class VersionNotFoundErr extends Error {
    readonly agentId: string;
    readonly version: number;
    constructor(agentId: string, version: number) {
      super('no version');
      this.name = 'AgentDefinitionVersionNotFoundError';
      this.agentId = agentId;
      this.version = version;
    }
  }
  class EmptyPatchErr extends Error {
    constructor() {
      super('empty');
      this.name = 'EmptyAgentDefinitionPatchError';
    }
  }
  class InvalidInputErr extends Error {
    readonly field: string;
    readonly value: unknown;
    constructor(field: string, value: unknown, reason: string) {
      super(`${field}=${String(value)}: ${reason}`);
      this.name = 'InvalidAgentDefinitionInputError';
      this.field = field;
      this.value = value;
    }
  }
  return {
    mockAuthenticate: vi.fn(),
    mockHasScope: vi.fn(),
    mockVerifyProjectAccess: vi.fn(),
    mockGet: vi.fn(),
    mockGetByVersion: vi.fn(),
    mockPatch: vi.fn(),
    FakeArchivedErr: ArchivedErr,
    FakeNotFoundErr: NotFoundErr,
    FakeVersionConflictErr: VersionConflictErr,
    FakeVersionNotFoundErr: VersionNotFoundErr,
    FakeEmptyPatchErr: EmptyPatchErr,
    FakeInvalidInputErr: InvalidInputErr,
  };
});

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: (req: Request) => mockAuthenticate(req),
  hasScope: (ctx: unknown, scope: string) => mockHasScope(ctx, scope),
}));

vi.mock('@/lib/api-utils', () => ({
  verifyProjectAccess: (projectId: string, userId: string) =>
    mockVerifyProjectAccess(projectId, userId),
}));

vi.mock('@open-rush/control-plane', () => ({
  AgentDefinitionService: class {
    get = mockGet;
    getByVersion = mockGetByVersion;
    patch = mockPatch;
  },
  AgentDefinitionArchivedError: FakeArchivedErr,
  AgentDefinitionNotFoundError: FakeNotFoundErr,
  AgentDefinitionVersionConflictError: FakeVersionConflictErr,
  AgentDefinitionVersionNotFoundError: FakeVersionNotFoundErr,
  EmptyAgentDefinitionPatchError: FakeEmptyPatchErr,
  InvalidAgentDefinitionInputError: FakeInvalidInputErr,
}));

vi.mock('@open-rush/db', () => ({
  getDbClient: () => ({ __fake: true }),
}));

import { GET, PATCH } from './route';

const AGENT_ID = '00000000-0000-0000-0000-0000000000aa';
const PROJECT_ID = '00000000-0000-0000-0000-000000000001';

function makeDefinition(overrides: Record<string, unknown> = {}) {
  return {
    id: AGENT_ID,
    projectId: PROJECT_ID,
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
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function req(
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
  url = `https://t/api/v1/agent-definitions/${AGENT_ID}`
): Request {
  const init: RequestInit = { method, headers: { 'content-type': 'application/json', ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(url, init);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticate.mockResolvedValue({ userId: 'user-1', scopes: ['*'], authType: 'session' });
  mockHasScope.mockReturnValue(true);
  mockVerifyProjectAccess.mockResolvedValue(true);
  mockGet.mockResolvedValue(makeDefinition());
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe('GET /api/v1/agent-definitions/:id', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await GET(req('GET'), params(AGENT_ID));
    expect(res.status).toBe(401);
  });

  it('403 without agent-definitions:read scope', async () => {
    mockHasScope.mockReturnValue(false);
    const res = await GET(req('GET'), params(AGENT_ID));
    expect(res.status).toBe(403);
  });

  it('400 on malformed id', async () => {
    const res = await GET(req('GET'), params('not-a-uuid'));
    expect(res.status).toBe(400);
  });

  it('404 when underlying definition is missing', async () => {
    mockGet.mockRejectedValue(new FakeNotFoundErr(AGENT_ID));
    const res = await GET(req('GET'), params(AGENT_ID));
    expect(res.status).toBe(404);
  });

  it('403 when owning project is not visible to caller', async () => {
    mockVerifyProjectAccess.mockResolvedValue(false);
    const res = await GET(req('GET'), params(AGENT_ID));
    expect(res.status).toBe(403);
  });

  it('returns current definition as ISO-wrapped envelope', async () => {
    const res = await GET(req('GET'), params(AGENT_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; createdAt: string } };
    expect(body.data.id).toBe(AGENT_ID);
    expect(body.data.createdAt).toBe('2024-01-01T00:00:00.000Z');
    expect(mockGetByVersion).not.toHaveBeenCalled();
  });

  it('returns historical snapshot when ?version=N', async () => {
    mockGetByVersion.mockResolvedValue(makeDefinition({ name: 'Historical', currentVersion: 3 }));
    const res = await GET(
      req('GET', undefined, {}, `https://t/api/v1/agent-definitions/${AGENT_ID}?version=3`),
      params(AGENT_ID)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string; currentVersion: number } };
    expect(body.data.currentVersion).toBe(3);
    expect(body.data.name).toBe('Historical');
    expect(mockGetByVersion).toHaveBeenCalledWith(AGENT_ID, 3);
  });

  it('400 when ?version is not a positive integer', async () => {
    mockGetByVersion.mockRejectedValue(new FakeInvalidInputErr('version', 0, 'x'));
    const res = await GET(
      req('GET', undefined, {}, `https://t/api/v1/agent-definitions/${AGENT_ID}?version=0`),
      params(AGENT_ID)
    );
    expect(res.status).toBe(400);
  });

  it('404 when ?version=N is unknown', async () => {
    mockGetByVersion.mockRejectedValue(new FakeVersionNotFoundErr(AGENT_ID, 99));
    const res = await GET(
      req('GET', undefined, {}, `https://t/api/v1/agent-definitions/${AGENT_ID}?version=99`),
      params(AGENT_ID)
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/agent-definitions/:id', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await PATCH(req('PATCH', { name: 'new' }, { 'if-match': '1' }), params(AGENT_ID));
    expect(res.status).toBe(401);
  });

  it('403 without agent-definitions:write scope', async () => {
    mockHasScope.mockReturnValue(false);
    const res = await PATCH(req('PATCH', { name: 'new' }, { 'if-match': '1' }), params(AGENT_ID));
    expect(res.status).toBe(403);
    expect(mockHasScope).toHaveBeenCalledWith(expect.anything(), 'agent-definitions:write');
  });

  it('400 when If-Match header missing', async () => {
    const res = await PATCH(req('PATCH', { name: 'new' }), params(AGENT_ID));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/If-Match/);
  });

  it('400 when If-Match is not a positive integer', async () => {
    const res = await PATCH(req('PATCH', { name: 'new' }, { 'if-match': '-1' }), params(AGENT_ID));
    expect(res.status).toBe(400);
  });

  it('400 on invalid JSON body', async () => {
    const r = new Request(`https://t/api/v1/agent-definitions/${AGENT_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'if-match': '1' },
      body: 'not json',
    });
    const res = await PATCH(r, params(AGENT_ID));
    expect(res.status).toBe(400);
  });

  it('400 for empty patch body (Zod refine)', async () => {
    const res = await PATCH(req('PATCH', {}, { 'if-match': '1' }), params(AGENT_ID));
    expect(res.status).toBe(400);
  });

  it('403 when caller cannot access owning project', async () => {
    mockVerifyProjectAccess.mockResolvedValue(false);
    const res = await PATCH(req('PATCH', { name: 'new' }, { 'if-match': '1' }), params(AGENT_ID));
    expect(res.status).toBe(403);
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('404 when definition is gone', async () => {
    mockGet.mockRejectedValue(new FakeNotFoundErr(AGENT_ID));
    const res = await PATCH(req('PATCH', { name: 'new' }, { 'if-match': '1' }), params(AGENT_ID));
    expect(res.status).toBe(404);
  });

  it('409 on version conflict (hint includes current version)', async () => {
    mockPatch.mockRejectedValue(new FakeVersionConflictErr(AGENT_ID, 1, 5));
    const res = await PATCH(req('PATCH', { name: 'new' }, { 'if-match': '1' }), params(AGENT_ID));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; hint?: string } };
    expect(body.error.code).toBe('VERSION_CONFLICT');
    expect(body.error.hint).toMatch(/5/);
  });

  it('400 when archived', async () => {
    mockPatch.mockRejectedValue(new FakeArchivedErr(AGENT_ID));
    const res = await PATCH(req('PATCH', { name: 'new' }, { 'if-match': '1' }), params(AGENT_ID));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns bumped definition with ISO dates on success', async () => {
    mockPatch.mockResolvedValue(
      makeDefinition({
        name: 'renamed',
        currentVersion: 2,
        updatedAt: new Date('2024-02-02T00:00:00.000Z'),
      })
    );
    const res = await PATCH(
      req('PATCH', { name: 'renamed' }, { 'if-match': '1' }),
      params(AGENT_ID)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { currentVersion: number; updatedAt: string } };
    expect(body.data.currentVersion).toBe(2);
    expect(body.data.updatedAt).toBe('2024-02-02T00:00:00.000Z');
    expect(mockPatch).toHaveBeenCalledWith(
      AGENT_ID,
      expect.objectContaining({
        ifMatchVersion: 1,
        name: 'renamed',
        updatedBy: 'user-1',
      })
    );
  });
});
