import { CreateProjectRequest } from '@lux/contracts';
import { DrizzleProjectDb, ProjectService } from '@lux/control-plane';
import { getDbClient, projectMembers, projects } from '@lux/db';

import { apiError, apiSuccess, requireAuth } from '@/lib/api-utils';

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  const parsed = CreateProjectRequest.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_ERROR', parsed.error.issues[0].message);
  }

  const db = getDbClient();

  // Create project + add owner in a single transaction
  const project = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(projects)
      .values({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        sandboxProvider: parsed.data.sandboxProvider ?? 'opensandbox',
        defaultModel: parsed.data.defaultModel ?? null,
        defaultConnectionMode: parsed.data.defaultConnectionMode ?? 'anthropic',
        createdBy: userId,
      })
      .returning();

    await tx.insert(projectMembers).values({
      projectId: created.id,
      userId,
      role: 'owner',
    });

    return created;
  });

  return apiSuccess(project, 201);
}

export async function GET() {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const db = getDbClient();
  const projectService = new ProjectService(new DrizzleProjectDb(db));
  const allProjects = await projectService.listByUser(userId);

  return apiSuccess(allProjects);
}
