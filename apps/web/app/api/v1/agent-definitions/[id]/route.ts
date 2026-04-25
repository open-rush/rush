/**
 * /api/v1/agent-definitions/:id
 *   - GET   — current definition; ?version=N returns the historical snapshot
 *   - PATCH — If-Match required; bumps to a new immutable version
 *
 * Auth: same scope model as the parent collection (`agent-definitions:read`
 * for GET, `agent-definitions:write` for PATCH).
 *
 * Project-membership check runs AFTER loading the row (we need to know its
 * `projectId` to verify access), which also conveniently bypasses 404 probing
 * of ids the caller has no right to ask about — we return 403 on "exists but
 * not yours" instead of leaking a 404 contrast.
 */

import { v1 } from '@open-rush/contracts';
import { AgentDefinitionService } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';
import { v1Error, v1Success, v1ValidationError } from '@/lib/api/v1-responses';
import { verifyProjectAccess } from '@/lib/api-utils';
import { authenticate, hasScope } from '@/lib/auth/unified-auth';

import { definitionToV1, mapAgentDefinitionError } from '../helpers';

// -----------------------------------------------------------------------------
// GET /api/v1/agent-definitions/:id  (?version=N optional)
// -----------------------------------------------------------------------------

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
  const queryParsed = v1.getAgentDefinitionQuerySchema.safeParse({
    version: url.searchParams.get('version') ?? undefined,
  });
  if (!queryParsed.success) return v1ValidationError(queryParsed.error);

  const db = getDbClient();
  const service = new AgentDefinitionService(db);
  try {
    // Load current first so we know the owning projectId.
    const current = await service.get(paramsParsed.data.id);
    if (!(await verifyProjectAccess(current.projectId, auth.userId))) {
      return v1Error('FORBIDDEN', 'No access to this project');
    }
    if (queryParsed.data.version !== undefined) {
      const snap = await service.getByVersion(paramsParsed.data.id, queryParsed.data.version);
      return v1Success(definitionToV1(snap));
    }
    return v1Success(definitionToV1(current));
  } catch (err) {
    const mapped = mapAgentDefinitionError(err);
    if (mapped) return mapped;
    throw err;
  }
}

// -----------------------------------------------------------------------------
// PATCH /api/v1/agent-definitions/:id   (If-Match header required)
// -----------------------------------------------------------------------------

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (!auth) return v1Error('UNAUTHORIZED', 'Authentication required');
  if (!hasScope(auth, 'agent-definitions:write')) {
    return v1Error('FORBIDDEN', 'Missing scope agent-definitions:write');
  }

  const { id } = await params;
  const paramsParsed = v1.getAgentDefinitionParamsSchema.safeParse({ id });
  if (!paramsParsed.success) return v1ValidationError(paramsParsed.error);

  // If-Match is REQUIRED — absence is a VALIDATION error, not a conflict.
  const ifMatchHeader = request.headers.get('if-match') ?? request.headers.get('If-Match');
  if (!ifMatchHeader) {
    return v1Error('VALIDATION_ERROR', 'If-Match header is required for PATCH');
  }
  const ifMatchParsed = v1.ifMatchHeaderSchema.safeParse(ifMatchHeader);
  if (!ifMatchParsed.success) return v1ValidationError(ifMatchParsed.error);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return v1Error('VALIDATION_ERROR', 'Invalid JSON body');
  }
  const bodyParsed = v1.patchAgentDefinitionRequestSchema.safeParse(body);
  if (!bodyParsed.success) return v1ValidationError(bodyParsed.error);

  const db = getDbClient();
  const service = new AgentDefinitionService(db);
  try {
    // Verify access before attempting the patch (cheaper + doesn't grab the
    // row lock unnecessarily).
    const current = await service.get(paramsParsed.data.id);
    if (!(await verifyProjectAccess(current.projectId, auth.userId))) {
      return v1Error('FORBIDDEN', 'No access to this project');
    }

    const updated = await service.patch(paramsParsed.data.id, {
      ifMatchVersion: ifMatchParsed.data,
      name: bodyParsed.data.name,
      description: bodyParsed.data.description,
      icon: bodyParsed.data.icon,
      providerType: bodyParsed.data.providerType,
      model: bodyParsed.data.model,
      systemPrompt: bodyParsed.data.systemPrompt,
      appendSystemPrompt: bodyParsed.data.appendSystemPrompt,
      allowedTools: bodyParsed.data.allowedTools,
      skills: bodyParsed.data.skills,
      mcpServers: bodyParsed.data.mcpServers,
      maxSteps: bodyParsed.data.maxSteps,
      deliveryMode: bodyParsed.data.deliveryMode,
      config: bodyParsed.data.config,
      changeNote: bodyParsed.data.changeNote ?? null,
      updatedBy: auth.userId,
    });
    return v1Success(definitionToV1(updated));
  } catch (err) {
    const mapped = mapAgentDefinitionError(err);
    if (mapped) return mapped;
    throw err;
  }
}
