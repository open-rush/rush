/**
 * POST /api/v1/agent-definitions/:id/archive
 *
 * Sets `archived_at = now()` on the AgentDefinition. Idempotent — archiving
 * an already-archived row returns the existing archived_at without bumping
 * a version (archival is metadata, not a definition change).
 *
 * Auth: `agent-definitions:write`. Project membership required.
 */

import { v1 } from '@open-rush/contracts';
import { AgentDefinitionService } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';
import { v1Error, v1Success, v1ValidationError } from '@/lib/api/v1-responses';
import { verifyProjectAccess } from '@/lib/api-utils';
import { authenticate, hasScope } from '@/lib/auth/unified-auth';

import { mapAgentDefinitionError } from '../../helpers';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (!auth) return v1Error('UNAUTHORIZED', 'Authentication required');
  if (!hasScope(auth, 'agent-definitions:write')) {
    return v1Error('FORBIDDEN', 'Missing scope agent-definitions:write');
  }

  const { id } = await params;
  const paramsParsed = v1.getAgentDefinitionParamsSchema.safeParse({ id });
  if (!paramsParsed.success) return v1ValidationError(paramsParsed.error);

  const db = getDbClient();
  const service = new AgentDefinitionService(db);
  try {
    const current = await service.get(paramsParsed.data.id);
    if (!(await verifyProjectAccess(current.projectId, auth.userId))) {
      return v1Error('FORBIDDEN', 'No access to this project');
    }
    const archived = await service.archive(paramsParsed.data.id);
    // `archivedAt` is non-null after a successful archive (the service sets
    // it with `now()` when absent and preserves it on second-call). Assert
    // via `!` with a contract runtime check to make the invariant loud.
    if (!archived.archivedAt) {
      throw new Error('invariant: archive() must return a non-null archivedAt');
    }
    return v1Success({
      id: archived.id,
      archivedAt: archived.archivedAt.toISOString(),
    });
  } catch (err) {
    const mapped = mapAgentDefinitionError(err);
    if (mapped) return mapped;
    throw err;
  }
}
