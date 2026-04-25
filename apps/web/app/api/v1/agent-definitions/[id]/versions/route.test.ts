/**
 * Tests for GET /api/v1/agent-definitions/:id/versions.
 *
 * Exercises pagination cursor translation (contract's opaque string cursor ↔
 * the service's numeric cursorVersion) and the same scope/membership guards
 * as siblings.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAuthenticate,
  mockHasScope,
  mockVerifyProjectAccess,
  mockGet,
  mockListVersions,
  FakeNotFoundErr,
} = vi.hoisted(() => {
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
    mockGet: vi.fn(),
    mockListVersions: vi.fn(),
    FakeNotFoundErr: NotFoundErr,
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
    listVersions = mockListVersions;
  },
  AgentDefinitionArchivedError: class extends Error {},
  AgentDefinitionNotFoundError: FakeNotFoundErr,
  AgentDefinitionVersionConflictError: class extends Error {},
  AgentDefinitionVersionNotFoundError: class extends Error {},
  EmptyAgentDefinitionPatchError: class extends Error {},
  InvalidAgentDefinitionInputError: class extends Error {},
}));

vi.mock('@open-rush/db', () => ({
  getDbClient: () => ({ __fake: true }),
}));

import { GET } from './route';

const AGENT_ID = '00000000-0000-0000-0000-0000000000aa';
const PROJECT_ID = '00000000-0000-0000-0000-000000000001';

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req(url = `https://t/api/v1/agent-definitions/${AGENT_ID}/versions`) {
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticate.mockResolvedValue({ userId: 'user-1', scopes: ['*'], authType: 'session' });
  mockHasScope.mockReturnValue(true);
  mockVerifyProjectAccess.mockResolvedValue(true);
  mockGet.mockResolvedValue({
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
    currentVersion: 3,
    archivedAt: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  });
});

describe('GET /api/v1/agent-definitions/:id/versions', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await GET(req(), params(AGENT_ID));
    expect(res.status).toBe(401);
  });

  it('403 without read scope', async () => {
    mockHasScope.mockReturnValue(false);
    const res = await GET(req(), params(AGENT_ID));
    expect(res.status).toBe(403);
  });

  it('400 when id is malformed', async () => {
    const res = await GET(req(), params('not-a-uuid'));
    expect(res.status).toBe(400);
  });

  it('404 when definition is missing', async () => {
    mockGet.mockRejectedValue(new FakeNotFoundErr(AGENT_ID));
    const res = await GET(req(), params(AGENT_ID));
    expect(res.status).toBe(404);
  });

  it('403 when owning project is not visible', async () => {
    mockVerifyProjectAccess.mockResolvedValue(false);
    const res = await GET(req(), params(AGENT_ID));
    expect(res.status).toBe(403);
  });

  it('returns descending versions with ISO createdAt and nextCursor as string', async () => {
    mockListVersions.mockResolvedValue({
      items: [
        {
          version: 3,
          changeNote: 'v3',
          createdBy: 'user-1',
          createdAt: new Date('2024-03-03T00:00:00.000Z'),
        },
        {
          version: 2,
          changeNote: null,
          createdBy: null,
          createdAt: new Date('2024-02-02T00:00:00.000Z'),
        },
      ],
      nextCursor: 2,
    });
    const res = await GET(req(), params(AGENT_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ version: number; createdAt: string }>;
      nextCursor: string | null;
    };
    expect(body.data.map((v) => v.version)).toEqual([3, 2]);
    expect(body.data[0].createdAt).toBe('2024-03-03T00:00:00.000Z');
    expect(body.nextCursor).toBe('2');
  });

  it('passes numeric cursor through to service.listVersions', async () => {
    mockListVersions.mockResolvedValue({ items: [], nextCursor: null });
    await GET(
      req(`https://t/api/v1/agent-definitions/${AGENT_ID}/versions?cursor=5&limit=10`),
      params(AGENT_ID)
    );
    expect(mockListVersions).toHaveBeenCalledWith(
      AGENT_ID,
      expect.objectContaining({ cursorVersion: 5, limit: 10 })
    );
  });

  it('400 for invalid cursor values (non-numeric, zero, negative, fractional, "1abc")', async () => {
    mockListVersions.mockResolvedValue({ items: [], nextCursor: null });
    for (const bad of ['abc', '1abc', '-1', '0', '1.5']) {
      const res = await GET(
        req(
          `https://t/api/v1/agent-definitions/${AGENT_ID}/versions?cursor=${encodeURIComponent(bad)}`
        ),
        params(AGENT_ID)
      );
      expect(res.status).toBe(400);
    }
  });

  it('400 when cursor is not a number (legacy param name for clarity)', async () => {
    mockListVersions.mockResolvedValue({ items: [], nextCursor: null });
    const res = await GET(
      req(`https://t/api/v1/agent-definitions/${AGENT_ID}/versions?cursor=abc`),
      params(AGENT_ID)
    );
    expect(res.status).toBe(400);
  });

  it('null nextCursor stays null in envelope (not the literal "null")', async () => {
    mockListVersions.mockResolvedValue({ items: [], nextCursor: null });
    const res = await GET(req(), params(AGENT_ID));
    const body = (await res.json()) as { nextCursor: string | null };
    expect(body.nextCursor).toBeNull();
  });
});
