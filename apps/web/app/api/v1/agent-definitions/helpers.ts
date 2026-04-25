/**
 * Shared helpers for `/api/v1/agent-definitions/*` route files.
 *
 * - `definitionToV1` converts the service-layer `AgentDefinition` (which
 *   holds `Date` objects) into the contract shape that
 *   `agentDefinitionSchema.parse` accepts (ISO strings on datetime fields).
 * - `mapAgentDefinitionError` translates the service's domain error classes
 *   into a v1 error Response. Route handlers call it from a `catch`:
 *
 *     catch (err) {
 *       const mapped = mapAgentDefinitionError(err);
 *       if (mapped) return mapped;
 *       throw err;
 *     }
 */

import type { v1 } from '@open-rush/contracts';
import type { AgentDefinition as DomainAgentDefinition } from '@open-rush/control-plane';
import {
  AgentDefinitionArchivedError,
  AgentDefinitionNotFoundError,
  AgentDefinitionVersionConflictError,
  AgentDefinitionVersionNotFoundError,
  EmptyAgentDefinitionPatchError,
  InvalidAgentDefinitionInputError,
} from '@open-rush/control-plane';

import { v1Error } from '@/lib/api/v1-responses';

/**
 * Convert the service-layer `AgentDefinition` (native Dates) to the v1 wire
 * shape. Consumers should never push Date instances into the JSON response
 * because the contract's `agentDefinitionSchema` expects strict ISO strings.
 */
export function definitionToV1(d: DomainAgentDefinition): v1.AgentDefinition {
  return {
    id: d.id,
    projectId: d.projectId,
    name: d.name,
    description: d.description ?? null,
    icon: d.icon ?? null,
    providerType: d.providerType,
    model: d.model ?? null,
    systemPrompt: d.systemPrompt ?? null,
    appendSystemPrompt: d.appendSystemPrompt ?? null,
    allowedTools: d.allowedTools,
    skills: d.skills,
    mcpServers: d.mcpServers,
    maxSteps: d.maxSteps,
    deliveryMode: d.deliveryMode as v1.AgentDefinition['deliveryMode'],
    config: d.config ?? null,
    currentVersion: d.currentVersion,
    archivedAt: d.archivedAt ? d.archivedAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

/**
 * Translate a service-layer error into a v1 error Response. Returns `null`
 * when the error is NOT a known domain error — the caller should rethrow so
 * the top-level runtime produces a 500.
 */
export function mapAgentDefinitionError(err: unknown): Response | null {
  if (err instanceof AgentDefinitionNotFoundError) {
    return v1Error('NOT_FOUND', `AgentDefinition ${err.agentId} not found`);
  }
  if (err instanceof AgentDefinitionVersionNotFoundError) {
    return v1Error('NOT_FOUND', `AgentDefinition ${err.agentId} version ${err.version} not found`);
  }
  if (err instanceof AgentDefinitionVersionConflictError) {
    return v1Error(
      'VERSION_CONFLICT',
      `If-Match=${err.expected} does not match current version ${err.actual}`,
      { hint: `refetch the latest version and retry; current is ${err.actual}` }
    );
  }
  if (err instanceof AgentDefinitionArchivedError) {
    return v1Error(
      'VALIDATION_ERROR',
      `AgentDefinition ${err.agentId} is archived and cannot be modified`,
      { hint: `archived_at=${err.archivedAt.toISOString()}` }
    );
  }
  if (err instanceof EmptyAgentDefinitionPatchError) {
    return v1Error('VALIDATION_ERROR', 'PATCH must modify at least one editable field');
  }
  if (err instanceof InvalidAgentDefinitionInputError) {
    return v1Error('VALIDATION_ERROR', err.message);
  }
  return null;
}
