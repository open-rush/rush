import { type DbClient, projectMembers, projects } from '@lux/db';
import { and, desc, eq, isNotNull, isNull, or } from 'drizzle-orm';

import type {
  CreateProjectInput,
  Project,
  ProjectDb,
  UpdateProjectInput,
} from './project-service.js';

type ProjectRow = typeof projects.$inferSelect;

function mapRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    sandboxProvider: row.sandboxProvider,
    defaultModel: row.defaultModel,
    defaultConnectionMode: row.defaultConnectionMode,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

export class DrizzleProjectDb implements ProjectDb {
  constructor(private db: DbClient) {}

  async create(input: CreateProjectInput): Promise<Project> {
    const [row] = await this.db
      .insert(projects)
      .values({
        name: input.name,
        description: input.description ?? null,
        sandboxProvider: input.sandboxProvider ?? 'opensandbox',
        defaultModel: input.defaultModel ?? null,
        defaultConnectionMode: input.defaultConnectionMode ?? 'anthropic',
        createdBy: input.createdBy,
      })
      .returning();
    return mapRow(row);
  }

  async findById(id: string): Promise<Project | null> {
    const [row] = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return row ? mapRow(row) : null;
  }

  async findByUser(userId: string, includeDeleted = false): Promise<Project[]> {
    // Query projects where user is a member OR creator (fallback for legacy projects)
    const accessCondition = or(eq(projectMembers.userId, userId), eq(projects.createdBy, userId));
    const conditions = [accessCondition];
    if (!includeDeleted) {
      conditions.push(isNull(projects.deletedAt));
    }
    const rows = await this.db
      .selectDistinctOn([projects.id], {
        id: projects.id,
        name: projects.name,
        description: projects.description,
        sandboxProvider: projects.sandboxProvider,
        defaultModel: projects.defaultModel,
        defaultConnectionMode: projects.defaultConnectionMode,
        createdBy: projects.createdBy,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        deletedAt: projects.deletedAt,
      })
      .from(projects)
      .leftJoin(projectMembers, eq(projects.id, projectMembers.projectId))
      .where(and(...conditions))
      .orderBy(projects.id, desc(projects.createdAt));
    return rows.map(mapRow);
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project | null> {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.sandboxProvider !== undefined) updates.sandboxProvider = input.sandboxProvider;
    if (input.defaultModel !== undefined) updates.defaultModel = input.defaultModel;
    if (input.defaultConnectionMode !== undefined)
      updates.defaultConnectionMode = input.defaultConnectionMode;

    const [row] = await this.db
      .update(projects)
      .set(updates)
      .where(eq(projects.id, id))
      .returning();
    return row ? mapRow(row) : null;
  }

  async softDelete(id: string): Promise<boolean> {
    const [row] = await this.db
      .update(projects)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
      .returning();
    return !!row;
  }

  async restore(id: string): Promise<boolean> {
    const [row] = await this.db
      .update(projects)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(and(eq(projects.id, id), isNotNull(projects.deletedAt)))
      .returning();
    return !!row;
  }

  async hardDelete(id: string): Promise<boolean> {
    const [row] = await this.db.delete(projects).where(eq(projects.id, id)).returning();
    return !!row;
  }

  async listDeleted(userId: string): Promise<Project[]> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.createdBy, userId), isNotNull(projects.deletedAt)))
      .orderBy(desc(projects.deletedAt));
    return rows.map(mapRow);
  }
}
