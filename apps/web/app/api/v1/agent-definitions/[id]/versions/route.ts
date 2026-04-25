/**
 * GET /api/v1/agent-definitions/:id/versions
 * Cursor-paginated version history (summary only, no snapshot payload).
 *
 * Auth: `agent-definitions:read`. Project access check runs against the
 * owning agent's `projectId`.
 */

import { v1 } from '@open-rush/contracts';
import { AgentDefinitionService } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';
import { v1Error, v1Paginated, v1ValidationError } from '@/lib/api/v1-responses';
import { verifyProjectAccess } from '@/lib/api-utils';
import { authenticate, hasScope } from '@/lib/auth/unified-auth';

import { mapAgentDefinitionError } from '../../helpers';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (!auth) return v1Error('UNAUTHORIZED', 'Authentication required');
  if (!hasScope(auth, 'agent-definitions:read')) {
    return v1Error('FORBIDDEN', 'Missing scope agent-definitions:read');
  }

  const { id } = await params;
  const paramsParsed = v1.getAgentDefinitionParamsSchema.safeParse({ id });
  if (!paramsParsed.success) return v1ValidationError(paramsParsed.error);

  const url = new URL(request.url);
  const queryParsed = v1.paginationQuerySchema.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  });
  if (!queryParsed.success) return v1ValidationError(queryParsed.error);

  const db = getDbClient();
  const service = new AgentDefinitionService(db);
  try {
    const current = await service.get(paramsParsed.data.id);
    if (!(await verifyProjectAccess(current.projectId, auth.userId))) {
      return v1Error('FORBIDDEN', 'No access to this project');
    }
    // Version cursors are strict positive integers. We reject
    // "1abc", "-1", "0", "1.5" etc (Number.parseInt is too permissive).
    let cursorVersion: number | undefined;
    if (queryParsed.data.cursor !== undefined) {
      if (!/^[1-9]\d*$/.test(queryParsed.data.cursor)) {
        return v1Error('VALIDATION_ERROR', 'cursor must be a positive integer version');
      }
      cursorVersion = Number.parseInt(queryParsed.data.cursor, 10);
    }
    const { items, nextCursor } = await service.listVersions(paramsParsed.data.id, {
      limit: queryParsed.data.limit,
      cursorVersion,
    });
    return v1Paginated(
      items.map((v) => ({
        version: v.version,
        changeNote: v.changeNote ?? null,
        createdBy: v.createdBy ?? null,
        createdAt: v.createdAt.toISOString(),
      })),
      nextCursor === null ? null : String(nextCursor)
    );
  } catch (err) {
    const mapped = mapAgentDefinitionError(err);
    if (mapped) return mapped;
    throw err;
  }
}
