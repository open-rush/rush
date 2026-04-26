import { UpdateAgentRequest } from '@open-rush/contracts';
import { DrizzleAgentConfigStore } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';
import { createLogger } from '@open-rush/observability';

import {
  apiError,
  apiSuccess,
  getProjectRole,
  requireAuth,
  verifyProjectAccess,
} from '@/lib/api-utils';

const logger = createLogger({ service: 'web:agent-api' });

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = request.headers.get('x-request-id') || `agent-get-${Date.now()}`;

  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    logger.warn({ requestId }, '🚫 Auth failed');
    return res as Response;
  }

  const { id } = await params;
  logger.info({ requestId, userId, agentId: id }, '📨 GET agent request');

  const db = getDbClient();
  const store = new DrizzleAgentConfigStore(db);
  const agent = await store.getById(id);
  if (!agent?.projectId) {
    logger.warn({ requestId, agentId: id }, '⚠️ Agent not found');
    return apiError(404, 'NOT_FOUND', 'Agent not found');
  }

  const hasAccess = await verifyProjectAccess(agent.projectId, userId);
  if (!hasAccess) {
    logger.warn({ requestId, agentId: id, projectId: agent.projectId }, '🚫 Access denied');
    return apiError(403, 'FORBIDDEN', 'No access to this agent');
  }

  logger.info({ requestId, agentId: id, projectId: agent.projectId }, '✅ Agent retrieved');
  return apiSuccess(agent);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id } = await params;
  const db = getDbClient();
  const store = new DrizzleAgentConfigStore(db);
  const existing = await store.getById(id);
  if (!existing?.projectId) {
    return apiError(404, 'NOT_FOUND', 'Agent not found');
  }

  const role = await getProjectRole(existing.projectId, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return apiError(403, 'FORBIDDEN', 'Only owner or admin can update agents');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  const parsed = UpdateAgentRequest.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_ERROR', parsed.error.issues[0].message);
  }

  const updated = await store.update(id, parsed.data);
  if (!updated) {
    return apiError(404, 'NOT_FOUND', 'Agent not found');
  }

  return apiSuccess(updated);
}
