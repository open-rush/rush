/**
 * /api/v1/agent-definitions
 *  - POST  — create a new AgentDefinition (v1 snapshot)
 *  - GET   — cursor-paginated list, optionally filtered by projectId
 *
 * Auth: session OR service-token with scope `agent-definitions:read` (GET) /
 *       `agent-definitions:write` (POST). See specs/service-token-auth.md.
 *
 * Project access: write paths require the caller to be a member of the target
 * `projectId` (creator-fallback counts as membership). Read paths restrict to
 * the caller's accessible projects (single projectId if filter is supplied,
 * otherwise the union of project memberships + created-by fallback).
 */

import { v1 } from '@open-rush/contracts';
import { AgentDefinitionService } from '@open-rush/control-plane';
import { getDbClient, projectMembers, projects } from '@open-rush/db';
import { and, eq, isNull } from 'drizzle-orm';
import { v1Error, v1Paginated, v1Success, v1ValidationError } from '@/lib/api/v1-responses';
import { verifyProjectAccess } from '@/lib/api-utils';
import { authenticate, hasScope } from '@/lib/auth/unified-auth';

import { definitionToV1, mapAgentDefinitionError } from './helpers';

// -----------------------------------------------------------------------------
// POST /api/v1/agent-definitions
// -----------------------------------------------------------------------------

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return v1Error('UNAUTHORIZED', 'Authentication required');
  if (!hasScope(auth, 'agent-definitions:write')) {
    return v1Error('FORBIDDEN', 'Missing scope agent-definitions:write');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return v1Error('VALIDATION_ERROR', 'Invalid JSON body');
  }

  const parsed = v1.createAgentDefinitionRequestSchema.safeParse(body);
  if (!parsed.success) return v1ValidationError(parsed.error);

  if (!(await verifyProjectAccess(parsed.data.projectId, auth.userId))) {
    return v1Error('FORBIDDEN', 'No access to this project');
  }

  const db = getDbClient();
  const service = new AgentDefinitionService(db);
  try {
    const created = await service.create({
      projectId: parsed.data.projectId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      icon: parsed.data.icon ?? null,
      providerType: parsed.data.providerType,
      model: parsed.data.model ?? null,
      systemPrompt: parsed.data.systemPrompt ?? null,
      appendSystemPrompt: parsed.data.appendSystemPrompt ?? null,
      allowedTools: parsed.data.allowedTools,
      skills: parsed.data.skills,
      mcpServers: parsed.data.mcpServers,
      maxSteps: parsed.data.maxSteps,
      deliveryMode: parsed.data.deliveryMode,
      config: parsed.data.config ?? null,
      changeNote: parsed.data.changeNote ?? null,
      createdBy: auth.userId,
    });
    return v1Success(definitionToV1(created), 201);
  } catch (err) {
    const mapped = mapAgentDefinitionError(err);
    if (mapped) return mapped;
    throw err;
  }
}

// -----------------------------------------------------------------------------
// GET /api/v1/agent-definitions
// -----------------------------------------------------------------------------

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return v1Error('UNAUTHORIZED', 'Authentication required');
  if (!hasScope(auth, 'agent-definitions:read')) {
    return v1Error('FORBIDDEN', 'Missing scope agent-definitions:read');
  }

  const url = new URL(request.url);
  const parsed = v1.listAgentDefinitionsQuerySchema.safeParse({
    projectId: url.searchParams.get('projectId') ?? undefined,
    includeArchived: url.searchParams.get('includeArchived') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  });
  if (!parsed.success) return v1ValidationError(parsed.error);

  const db = getDbClient();

  let scope: { projectId?: string; projectIds?: string[] };
  if (parsed.data.projectId) {
    if (!(await verifyProjectAccess(parsed.data.projectId, auth.userId))) {
      return v1Error('FORBIDDEN', 'No access to this project');
    }
    scope = { projectId: parsed.data.projectId };
  } else {
    scope = { projectIds: await listAccessibleProjectIds(db, auth.userId) };
  }

  const service = new AgentDefinitionService(db);
  const { items, nextCursor } = await service.list({
    ...scope,
    includeArchived: parsed.data.includeArchived,
    limit: parsed.data.limit,
    cursor: parsed.data.cursor,
  });
  return v1Paginated(items.map(definitionToV1), nextCursor);
}

/**
 * Resolve the set of `project_id` values the caller can read. Covers both
 * membership rows and the creator fallback that `verifyProjectAccess` uses
 * for historically-created projects without a `project_members` row.
 *
 * Soft-deleted projects (`projects.deleted_at IS NOT NULL`) are excluded from
 * BOTH branches — this keeps the list endpoint aligned with the single-id
 * `verifyProjectAccess()` which treats soft-deleted projects as "not yours".
 * Without this filter, a caller remaining in `project_members` for a deleted
 * project would still see that project's agent definitions.
 */
async function listAccessibleProjectIds(
  db: ReturnType<typeof getDbClient>,
  userId: string
): Promise<string[]> {
  const [memberships, created] = await Promise.all([
    // Join `projects` so we can filter out soft-deleted ones. We pick the
    // projectId column off the projects side to make the filter explicit.
    db
      .select({ projectId: projects.id })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(and(eq(projectMembers.userId, userId), isNull(projects.deletedAt))),
    db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.createdBy, userId), isNull(projects.deletedAt))),
  ]);
  const ids = new Set<string>();
  for (const m of memberships) ids.add(m.projectId);
  for (const p of created) ids.add(p.id);
  return Array.from(ids);
}
