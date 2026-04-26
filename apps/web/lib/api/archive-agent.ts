/**
 * archiveAgentDefinition — archive an AgentDefinition via v1, then (always)
 * reconcile the project's current agent binding.
 *
 * Background: legacy `DELETE /api/agents/:id` archived the definition AND
 * rebinds `projects.currentAgentId` in one server-side transaction. v1
 * `POST /api/v1/agent-definitions/:id/archive` only sets `archivedAt` — the
 * project binding is intentionally out of scope. This helper restores the
 * UX by archiving via v1 and then reconciling the binding client-side.
 *
 * Reconciliation logic (runs AFTER archive; a stale `currentBefore` read
 * before archive would race with concurrent binding changes):
 * 1. Re-fetch `GET /api/projects/:projectId/agent` — authoritative snapshot
 *    after archive. If current binding ≠ the archived id, do nothing.
 * 2. If the archived definition IS still the current binding, pick the
 *    first non-archived candidate (filtered by `archivedAt` from the
 *    caller-supplied list — the only authoritative "is archived" signal
 *    from v1 `GET /api/v1/agent-definitions`). If one exists, PUT it.
 * 3. If no replacement exists, PUT `agentId: null` so the binding is
 *    cleared (matches legacy which set `isCurrent=false`). The PUT route
 *    accepts null to clear — see `SetCurrentProjectAgentRequest`.
 *
 * Partial failure: if archive succeeds but rebind fails, the caller sees a
 * "rebind failed" error but archive has already committed. The UI should
 * refresh the list (the archived row will disappear) and guide the user to
 * "Set Current" manually on a remaining definition.
 */

export interface ArchiveCandidate {
  id: string;
  /**
   * Authoritative "is archived" signal from v1. Filter by this. Do NOT
   * filter by legacy `status` — v1 doesn't return that field.
   */
  archivedAt?: string | Date | null;
}

export interface ArchiveAgentOptions {
  projectId: string;
  agentId: string;
  /**
   * Snapshot of the project's definitions from the caller's list fetch.
   * Used to pick a replacement. The archived agent will be filtered out.
   */
  candidates: ArchiveCandidate[];
}

export interface ArchiveAgentResult {
  archived: { id: string; archivedAt: string };
  /**
   * `null` → no rebind needed (the archived agent was not the current
   *          binding, after re-check).
   * `{ nextAgentId: string }` → binding rebound to a replacement.
   * `{ nextAgentId: null }` → binding cleared (no replacement candidate).
   */
  rebound: { nextAgentId: string | null } | null;
}

function pickReplacement(candidates: ArchiveCandidate[], archivedId: string): string | null {
  for (const c of candidates) {
    if (c.id === archivedId) continue;
    if (c.archivedAt) continue;
    return c.id;
  }
  return null;
}

async function fetchCurrentAgentId(projectId: string): Promise<string | null> {
  const res = await fetch(`/api/projects/${projectId}/agent`);
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as {
    data?: {
      currentAgent?: { id?: string } | null;
      binding?: { agentId?: string } | null;
    };
  } | null;
  return json?.data?.binding?.agentId ?? json?.data?.currentAgent?.id ?? null;
}

async function putCurrentAgent(projectId: string, agentId: string | null): Promise<Response> {
  return fetch(`/api/projects/${projectId}/agent`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId }),
  });
}

export async function archiveAgentDefinition(
  options: ArchiveAgentOptions
): Promise<ArchiveAgentResult> {
  const { projectId, agentId, candidates } = options;

  // 1. Archive via v1
  const archiveRes = await fetch(
    `/api/v1/agent-definitions/${encodeURIComponent(agentId)}/archive`,
    { method: 'POST' }
  );
  const archiveJson = (await archiveRes.json().catch(() => null)) as {
    data?: { id: string; archivedAt: string };
    error?: { message?: string };
  } | null;
  if (!archiveRes.ok || !archiveJson?.data) {
    const msg = archiveJson?.error?.message ?? `HTTP ${archiveRes.status}`;
    throw new Error(msg);
  }

  // 2. Re-fetch current binding AFTER archive (post-archive snapshot closes
  //    the window where a concurrent set-current could mislead us).
  const currentAfter = await fetchCurrentAgentId(projectId).catch(() => null);

  // 3. If the archived definition is not the current binding (either never
  //    was, or a concurrent actor already rebound), we're done.
  if (currentAfter !== agentId) {
    return { archived: archiveJson.data, rebound: null };
  }

  // 4. Pick a replacement and PUT it. If none, PUT null to clear binding.
  const nextAgentId = pickReplacement(candidates, agentId);
  const rebindRes = await putCurrentAgent(projectId, nextAgentId);
  if (!rebindRes.ok) {
    const rebindJson = (await rebindRes.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    const msg = rebindJson?.error?.message ?? `HTTP ${rebindRes.status}`;
    throw new Error(`Archive succeeded but rebind failed: ${msg}`);
  }
  return {
    archived: archiveJson.data,
    rebound: { nextAgentId },
  };
}
