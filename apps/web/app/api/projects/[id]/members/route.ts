import { AddMemberRequest } from '@lux/contracts';
import { DrizzleMembershipDb, ProjectMemberService } from '@lux/control-plane';
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

  const hasAccess = await verifyProjectAccess(id, userId);
  if (!hasAccess) {
    return apiError(403, 'FORBIDDEN', 'No access to this project');
  }

  const db = getDbClient();
  const memberService = new ProjectMemberService(new DrizzleMembershipDb(db));
  const members = await memberService.listMembers(id);

  return apiSuccess(members);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id } = await params;

  const role = await getProjectRole(id, userId);
  if (!role || (role !== 'owner' && role !== 'admin')) {
    return apiError(403, 'FORBIDDEN', 'Only owner or admin can add members');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  const parsed = AddMemberRequest.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_ERROR', parsed.error.issues[0].message);
  }

  const db = getDbClient();
  const memberService = new ProjectMemberService(new DrizzleMembershipDb(db));

  try {
    const member = await memberService.addMember(id, parsed.data.userId, parsed.data.role);
    return apiSuccess(member, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('duplicate') || msg.includes('unique')) {
      return apiError(409, 'CONFLICT', 'Member already exists');
    }
    return apiError(400, 'VALIDATION_ERROR', msg);
  }
}
