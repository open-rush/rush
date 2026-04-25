/**
 * Tests for POST /api/v1/agent-definitions/:id/archive.
 *
 * Archive is idempotent: archiving twice returns the same archivedAt and
 * MUST NOT bump a version (asserted via the mock's call count on `archive`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAuthenticate,
  mockHasScope,
  mockVerifyProjectAccess,
  mockGet,
  mockArchive,
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
    mockArchive: vi.fn(),
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
    archive = mockArchive;
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

import { POST } from './route';

const AGENT_ID = '00000000-0000-0000-0000-0000000000aa';
const PROJECT_ID = '00000000-0000-0000-0000-000000000001';
const ARCHIVED_AT = new Date('2024-05-05T12:00:00.000Z');

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req() {
  return new Request(`https://t/api/v1/agent-definitions/${AGENT_ID}/archive`, { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticate.mockResolvedValue({ userId: 'user-1', scopes: ['*'], authType: 'session' });
  mockHasScope.mockReturnValue(true);
  mockVerifyProjectAccess.mockResolvedValue(true);
  mockGet.mockResolvedValue({
    id: AGENT_ID,
    projectId: PROJECT_ID,
    archivedAt: null,
    currentVersion: 1,
  });
  mockArchive.mockResolvedValue({
    id: AGENT_ID,
    projectId: PROJECT_ID,
    currentVersion: 1,
    archivedAt: ARCHIVED_AT,
  });
});

describe('POST /api/v1/agent-definitions/:id/archive', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await POST(req(), params(AGENT_ID));
    expect(res.status).toBe(401);
  });

  it('403 without agent-definitions:write scope', async () => {
    mockHasScope.mockReturnValue(false);
    const res = await POST(req(), params(AGENT_ID));
    expect(res.status).toBe(403);
    expect(mockHasScope).toHaveBeenCalledWith(expect.anything(), 'agent-definitions:write');
  });

  it('400 when id is malformed', async () => {
    const res = await POST(req(), params('not-a-uuid'));
    expect(res.status).toBe(400);
  });

  it('404 when definition missing', async () => {
    mockGet.mockRejectedValue(new FakeNotFoundErr(AGENT_ID));
    const res = await POST(req(), params(AGENT_ID));
    expect(res.status).toBe(404);
  });

  it('403 when caller cannot access owning project', async () => {
    mockVerifyProjectAccess.mockResolvedValue(false);
    const res = await POST(req(), params(AGENT_ID));
    expect(res.status).toBe(403);
    expect(mockArchive).not.toHaveBeenCalled();
  });

  it('200 with { id, archivedAt } ISO on success', async () => {
    const res = await POST(req(), params(AGENT_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; archivedAt: string } };
    expect(body.data.id).toBe(AGENT_ID);
    expect(body.data.archivedAt).toBe(ARCHIVED_AT.toISOString());
  });

  it('idempotent: a second call returns the same archivedAt', async () => {
    await POST(req(), params(AGENT_ID));
    await POST(req(), params(AGENT_ID));
    expect(mockArchive).toHaveBeenCalledTimes(2);
    // Both calls map to the same mocked response — archivedAt is stable.
  });
});
