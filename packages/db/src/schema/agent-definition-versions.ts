import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { agents } from './agents.js';
import { users } from './users.js';

/**
 * AgentDefinition version history. Each PATCH to an agent (AgentDefinition) inserts
 * a new row here with a full snapshot of the definition state at that version.
 *
 * See specs/agent-definition-versioning.md §数据模型.
 *
 * - `version` is monotonically increasing per `agent_id`, starting at 1.
 * - `snapshot` holds the full definition payload for that version (excluding
 *   metadata/runtime columns, see migration + spec for the exact exclusion list).
 * - `change_note` is an optional commit-message-like free-form description.
 * - Unique (agent_id, version) prevents duplicate version numbers.
 * - Cascade-delete: rows are removed when the owning agent row is removed.
 */
export const agentDefinitionVersions = pgTable(
  'agent_definition_versions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    changeNote: text('change_note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    unique('agent_definition_versions_agent_version_uniq').on(t.agentId, t.version),
    // DESC index to serve "latest N versions" list queries (see spec §数据模型).
    // The UNIQUE constraint above provides an ASC btree; this dedicated DESC
    // ordering is what GET /agent-definitions/:id/versions will rely on.
    index('agent_definition_versions_agent_idx').on(t.agentId, sql`${t.version} DESC`),
  ]
);
