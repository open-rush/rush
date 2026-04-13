import { UpdateMemberRoleRequest } from '@lux/contracts';
import { DrizzleMembershipDb, ProjectMemberService } from '@lux/control-plane';
import { getDbClient } from '@lux/db';

import { apiError, apiSuccess, getProjectRole, requireAuth } from '@/lib/api-utils';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  let currentUserId: string;
  try {
    currentUserId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id, userId: targetUserId } = await params;

  const role = await getProjectRole(id, currentUserId);
  if (role !== 'owner') {
    return apiError(403, 'FORBIDDEN', 'Only owner can change member roles');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  const parsed = UpdateMemberRoleRequest.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_ERROR', parsed.error.issues[0].message);
  }

  const db = getDbClient();
  const memberService = new ProjectMemberService(new DrizzleMembershipDb(db));

  try {
    const updated = await memberService.updateRole(id, targetUserId, parsed.data.role);
    return apiSuccess(updated);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('last owner')) {
      return apiError(409, 'CONFLICT', msg);
    }
    return apiError(404, 'NOT_FOUND', msg);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  let currentUserId: string;
  try {
    currentUserId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id, userId: targetUserId } = await params;

  const role = await getProjectRole(id, currentUserId);
  if (role !== 'owner') {
    return apiError(403, 'FORBIDDEN', 'Only owner can remove members');
  }

  const db = getDbClient();
  const memberService = new ProjectMemberService(new DrizzleMembershipDb(db));

  try {
    await memberService.removeMember(id, targetUserId);
    return apiSuccess({ removed: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('last owner')) {
      return apiError(409, 'CONFLICT', msg);
    }
    return apiError(404, 'NOT_FOUND', msg);
  }
}
