import { DrizzleVaultDb, VaultService, createCryptoService } from '@lux/control-plane';
import { getDbClient } from '@lux/db';

import { apiError, apiSuccess, getProjectRole, requireAuth, verifyProjectAccess } from '@/lib/api-utils';

function getVaultService() {
  const masterKey = process.env.VAULT_MASTER_KEY;
  if (!masterKey) throw new Error('VAULT_MASTER_KEY is not configured');
  const db = getDbClient();
  return new VaultService(createCryptoService(masterKey), new DrizzleVaultDb(db));
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id: projectId } = await params;
  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) return apiError(403, 'FORBIDDEN', 'No access to this project');

  const vault = getVaultService();
  const entries = await vault.list('project', projectId);
  return apiSuccess(entries);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id: projectId } = await params;
  const role = await getProjectRole(projectId, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return apiError(403, 'FORBIDDEN', 'Only owner or admin can manage credentials');
  }

  let body: { name?: string; value?: string; injectionTarget?: string };
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  if (!body.name || typeof body.name !== 'string') {
    return apiError(400, 'VALIDATION_ERROR', 'name is required');
  }
  if (!body.value || typeof body.value !== 'string') {
    return apiError(400, 'VALIDATION_ERROR', 'value is required');
  }

  const vault = getVaultService();
  const entry = await vault.store('project', body.name, body.value, {
    projectId,
    ownerId: userId,
    injectionTarget: body.injectionTarget,
  });

  return apiSuccess(entry, 201);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id: projectId } = await params;
  const role = await getProjectRole(projectId, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return apiError(403, 'FORBIDDEN', 'Only owner or admin can manage credentials');
  }

  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  if (!name) return apiError(400, 'VALIDATION_ERROR', 'name query param is required');

  const vault = getVaultService();
  const removed = await vault.remove('project', name, projectId);
  if (!removed) return apiError(404, 'NOT_FOUND', 'Credential not found');
  return apiSuccess({ deleted: true });
}
