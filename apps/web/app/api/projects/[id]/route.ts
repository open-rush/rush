import { UpdateProjectRequest } from '@lux/contracts';
import { DrizzleProjectDb, ProjectService } from '@lux/control-plane';
import { getDbClient } from '@lux/db';

import {
  apiError,
  apiSuccess,
  getProjectRole,
  requireAuth,
  verifyProjectAccess,
} from '@/lib/api-utils';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id } = await params;
  const db = getDbClient();
  const projectService = new ProjectService(new DrizzleProjectDb(db));

  const project = await projectService.getById(id);
  if (!project) {
    return apiError(404, 'NOT_FOUND', 'Project not found');
  }

  const hasAccess = await verifyProjectAccess(id, userId);
  if (!hasAccess) {
    return apiError(403, 'FORBIDDEN', 'No access to this project');
  }

  return apiSuccess(project);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id } = await params;

  const role = await getProjectRole(id, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return apiError(403, 'FORBIDDEN', 'Only owner or admin can update project');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  const parsed = UpdateProjectRequest.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_ERROR', parsed.error.issues[0].message);
  }

  const db = getDbClient();
  const projectService = new ProjectService(new DrizzleProjectDb(db));

  try {
    const updated = await projectService.update(id, parsed.data);
    return apiSuccess(updated);
  } catch (err) {
    return apiError(404, 'NOT_FOUND', err instanceof Error ? err.message : 'Project not found');
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id } = await params;

  const role = await getProjectRole(id, userId);
  if (role !== 'owner') {
    return apiError(403, 'FORBIDDEN', 'Only owner can delete project');
  }

  const db = getDbClient();
  const projectService = new ProjectService(new DrizzleProjectDb(db));

  try {
    await projectService.softDelete(id);
    return apiSuccess({ deleted: true });
  } catch (err) {
    return apiError(404, 'NOT_FOUND', err instanceof Error ? err.message : 'Project not found');
  }
}
