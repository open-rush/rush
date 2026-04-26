import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ArchiveCandidate, archiveAgentDefinition } from '../archive-agent';

type FetchMock = ReturnType<typeof vi.fn>;

function makeResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  const ok = init.ok ?? true;
  const status = init.status ?? (ok ? 200 : 500);
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe('archiveAgentDefinition', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('archives then rebinds to next non-archived candidate when still current', async () => {
    const PROJECT = 'p1';
    const ARCHIVED = 'a1';
    const NEXT = 'a2';

    const candidates: ArchiveCandidate[] = [
      { id: ARCHIVED, archivedAt: null },
      { id: NEXT, archivedAt: null },
      { id: 'a3', archivedAt: '2025-12-01T00:00:00Z' }, // previously archived; skip
    ];

    // 1. POST archive
    fetchMock.mockResolvedValueOnce(
      makeResponse({ data: { id: ARCHIVED, archivedAt: '2026-01-01T00:00:00Z' } })
    );
    // 2. GET current (after archive) → still points at archived
    fetchMock.mockResolvedValueOnce(makeResponse({ data: { binding: { agentId: ARCHIVED } } }));
    // 3. PUT rebind to NEXT
    fetchMock.mockResolvedValueOnce(makeResponse({ data: {} }));

    const result = await archiveAgentDefinition({
      projectId: PROJECT,
      agentId: ARCHIVED,
      candidates,
    });

    expect(result.archived.id).toBe(ARCHIVED);
    expect(result.rebound).toEqual({ nextAgentId: NEXT });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // archive first
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/agent-definitions/');
    expect(fetchMock.mock.calls[0][0]).toContain('/archive');
    // then GET current
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/projects/${PROJECT}/agent`);
    // then PUT rebind
    expect(fetchMock.mock.calls[2][0]).toBe(`/api/projects/${PROJECT}/agent`);
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'PUT' });
    const rebindBody = JSON.parse((fetchMock.mock.calls[2][1] as { body: string }).body);
    expect(rebindBody).toEqual({ agentId: NEXT });
  });

  it('does not rebind when the archived agent is no longer current (race)', async () => {
    const PROJECT = 'p1';
    const ARCHIVED = 'a1';
    const OTHER = 'a2';

    fetchMock.mockResolvedValueOnce(
      makeResponse({ data: { id: ARCHIVED, archivedAt: '2026-01-01T00:00:00Z' } })
    );
    // GET current after archive → a concurrent actor already set a different
    // current. We MUST NOT overwrite it.
    fetchMock.mockResolvedValueOnce(makeResponse({ data: { binding: { agentId: OTHER } } }));

    const result = await archiveAgentDefinition({
      projectId: PROJECT,
      agentId: ARCHIVED,
      candidates: [
        { id: ARCHIVED, archivedAt: null },
        { id: OTHER, archivedAt: null },
      ],
    });

    expect(result.archived.id).toBe(ARCHIVED);
    expect(result.rebound).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2); // no PUT
  });

  it('clears binding (agentId: null) when no non-archived replacement exists', async () => {
    const PROJECT = 'p1';
    const ARCHIVED = 'a1';

    fetchMock.mockResolvedValueOnce(
      makeResponse({ data: { id: ARCHIVED, archivedAt: '2026-01-01T00:00:00Z' } })
    );
    fetchMock.mockResolvedValueOnce(makeResponse({ data: { binding: { agentId: ARCHIVED } } }));
    fetchMock.mockResolvedValueOnce(makeResponse({ data: { currentAgent: null, binding: null } }));

    const result = await archiveAgentDefinition({
      projectId: PROJECT,
      agentId: ARCHIVED,
      candidates: [
        { id: ARCHIVED, archivedAt: null },
        { id: 'a3', archivedAt: '2025-12-01T00:00:00Z' },
      ],
    });

    expect(result.rebound).toEqual({ nextAgentId: null });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const rebindBody = JSON.parse((fetchMock.mock.calls[2][1] as { body: string }).body);
    expect(rebindBody).toEqual({ agentId: null });
  });

  it('throws when archive fails (no current-check attempted)', async () => {
    const PROJECT = 'p1';
    const ARCHIVED = 'a1';

    fetchMock.mockResolvedValueOnce(
      makeResponse(
        { error: { code: 'FORBIDDEN', message: 'Missing scope' } },
        { ok: false, status: 403 }
      )
    );

    await expect(
      archiveAgentDefinition({
        projectId: PROJECT,
        agentId: ARCHIVED,
        candidates: [
          { id: ARCHIVED, archivedAt: null },
          { id: 'a2', archivedAt: null },
        ],
      })
    ).rejects.toThrow('Missing scope');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws with descriptive message when rebind fails after archive', async () => {
    const PROJECT = 'p1';
    const ARCHIVED = 'a1';
    const NEXT = 'a2';

    fetchMock.mockResolvedValueOnce(
      makeResponse({ data: { id: ARCHIVED, archivedAt: '2026-01-01T00:00:00Z' } })
    );
    fetchMock.mockResolvedValueOnce(makeResponse({ data: { binding: { agentId: ARCHIVED } } }));
    fetchMock.mockResolvedValueOnce(
      makeResponse(
        { error: { code: 'FORBIDDEN', message: 'No permission' } },
        { ok: false, status: 403 }
      )
    );

    await expect(
      archiveAgentDefinition({
        projectId: PROJECT,
        agentId: ARCHIVED,
        candidates: [
          { id: ARCHIVED, archivedAt: null },
          { id: NEXT, archivedAt: null },
        ],
      })
    ).rejects.toThrow(/Archive succeeded but rebind failed/);
  });

  it('treats unreachable GET current as "not current" (conservative: no PUT)', async () => {
    const PROJECT = 'p1';
    const ARCHIVED = 'a1';

    fetchMock.mockResolvedValueOnce(
      makeResponse({ data: { id: ARCHIVED, archivedAt: '2026-01-01T00:00:00Z' } })
    );
    fetchMock.mockResolvedValueOnce(makeResponse({ error: 'boom' }, { ok: false, status: 500 }));

    const result = await archiveAgentDefinition({
      projectId: PROJECT,
      agentId: ARCHIVED,
      candidates: [
        { id: ARCHIVED, archivedAt: null },
        { id: 'a2', archivedAt: null },
      ],
    });

    // GET current returned !ok → fetchCurrentAgentId returns null → null !==
    // archived → skip rebind. Legacy safer than false rebinds.
    expect(result.rebound).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('filters candidates by archivedAt only (does not require status field)', async () => {
    const PROJECT = 'p1';
    const ARCHIVED = 'a1';
    const NEXT_WITHOUT_STATUS = 'a2';

    // Candidate list as returned by v1 GET /api/v1/agent-definitions —
    // no `status` field. pickReplacement must accept this shape.
    const candidates: ArchiveCandidate[] = [
      { id: ARCHIVED, archivedAt: null },
      { id: NEXT_WITHOUT_STATUS, archivedAt: null },
    ];

    fetchMock.mockResolvedValueOnce(
      makeResponse({ data: { id: ARCHIVED, archivedAt: '2026-01-01T00:00:00Z' } })
    );
    fetchMock.mockResolvedValueOnce(makeResponse({ data: { binding: { agentId: ARCHIVED } } }));
    fetchMock.mockResolvedValueOnce(makeResponse({ data: {} }));

    const result = await archiveAgentDefinition({
      projectId: PROJECT,
      agentId: ARCHIVED,
      candidates,
    });

    expect(result.rebound).toEqual({ nextAgentId: NEXT_WITHOUT_STATUS });
  });
});
