import { type DbClient, vaultEntries } from '@lux/db';
import { and, count, eq, isNull, or, sql } from 'drizzle-orm';

import type { VaultEntry, VaultScope, VaultStorage } from './vault-service.js';

type VaultRow = typeof vaultEntries.$inferSelect;

function mapRow(row: VaultRow): VaultEntry {
  return {
    id: row.id,
    scope: row.scope as VaultScope,
    projectId: row.projectId,
    ownerId: row.ownerId,
    name: row.name,
    credentialType: row.credentialType,
    keyVersion: row.keyVersion,
    injectionTarget: row.injectionTarget,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function scopeFilter(scope: VaultScope, projectId?: string | null) {
  if (scope === 'platform') {
    return and(eq(vaultEntries.scope, 'platform'), isNull(vaultEntries.projectId));
  }
  return and(eq(vaultEntries.scope, 'project'), eq(vaultEntries.projectId, projectId!));
}

export class DrizzleVaultDb implements VaultStorage {
  constructor(private db: DbClient) {}

  async upsert(entry: {
    scope: VaultScope;
    projectId: string | null;
    ownerId: string | null;
    name: string;
    credentialType: string;
    encryptedValue: string;
    keyVersion: number;
    injectionTarget: string | null;
  }): Promise<VaultEntry> {
    const [row] = await this.db
      .insert(vaultEntries)
      .values({
        scope: entry.scope,
        projectId: entry.projectId,
        ownerId: entry.ownerId,
        name: entry.name,
        credentialType: entry.credentialType,
        encryptedValue: entry.encryptedValue,
        keyVersion: entry.keyVersion,
        injectionTarget: entry.injectionTarget,
      })
      .onConflictDoUpdate({
        target: [vaultEntries.scope, vaultEntries.projectId, vaultEntries.name],
        set: {
          encryptedValue: entry.encryptedValue,
          keyVersion: entry.keyVersion,
          credentialType: entry.credentialType,
          injectionTarget: entry.injectionTarget,
          ownerId: entry.ownerId,
          updatedAt: new Date(),
        },
        setWhere: sql`true`,
      })
      .returning();
    return mapRow(row);
  }

  async findByName(
    scope: VaultScope,
    name: string,
    projectId?: string | null,
  ): Promise<{ entry: VaultEntry; encryptedValue: string } | null> {
    const [row] = await this.db
      .select()
      .from(vaultEntries)
      .where(and(scopeFilter(scope, projectId), eq(vaultEntries.name, name)))
      .limit(1);
    if (!row) return null;
    return { entry: mapRow(row), encryptedValue: row.encryptedValue };
  }

  async listByScope(scope: VaultScope, projectId?: string | null): Promise<VaultEntry[]> {
    const rows = await this.db
      .select()
      .from(vaultEntries)
      .where(scopeFilter(scope, projectId))
      .orderBy(vaultEntries.name);
    return rows.map(mapRow);
  }

  async remove(scope: VaultScope, name: string, projectId?: string | null): Promise<boolean> {
    const rows = await this.db
      .delete(vaultEntries)
      .where(and(scopeFilter(scope, projectId), eq(vaultEntries.name, name)))
      .returning();
    return rows.length > 0;
  }

  async countByScope(scope: VaultScope, projectId?: string | null): Promise<number> {
    const [result] = await this.db
      .select({ value: count() })
      .from(vaultEntries)
      .where(scopeFilter(scope, projectId));
    return result?.value ?? 0;
  }

  async findAllForInjection(
    projectId: string,
  ): Promise<
    Array<{
      name: string;
      encryptedValue: string;
      scope: VaultScope;
      injectionTarget: string | null;
    }>
  > {
    const rows = await this.db
      .select({
        name: vaultEntries.name,
        encryptedValue: vaultEntries.encryptedValue,
        scope: vaultEntries.scope,
        injectionTarget: vaultEntries.injectionTarget,
      })
      .from(vaultEntries)
      .where(
        or(
          and(eq(vaultEntries.scope, 'platform'), isNull(vaultEntries.projectId)),
          and(eq(vaultEntries.scope, 'project'), eq(vaultEntries.projectId, projectId)),
        ),
      );
    return rows.map((r) => ({ ...r, scope: r.scope as VaultScope }));
  }
}
