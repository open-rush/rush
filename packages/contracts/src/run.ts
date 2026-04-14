import { z } from 'zod';
import { ConnectionMode, RunStatus, TriggerSource } from './enums.js';

export const Run = z
  .object({
    id: z.string().uuid(),
    agentId: z.string().uuid(),
    taskId: z.string().uuid().nullable().default(null),
    conversationId: z.string().uuid().nullable().default(null),
    parentRunId: z.string().uuid().nullable().default(null),
    status: RunStatus.default('queued'),
    prompt: z.string().min(1),
    provider: z.string().default('claude-code'),
    connectionMode: ConnectionMode.default('anthropic'),
    modelId: z.string().nullable().default(null),
    triggerSource: TriggerSource.default('user'),
    activeStreamId: z.string().nullable().default(null),
    retryCount: z.number().int().nonnegative().default(0),
    maxRetries: z.number().int().positive().default(3),
    errorMessage: z.string().nullable().default(null),
    attachmentsJson: z.unknown().nullable().default(null),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
    startedAt: z.coerce.date().nullable().default(null),
    completedAt: z.coerce.date().nullable().default(null),
  })
  .refine((r) => r.retryCount <= r.maxRetries, {
    message: 'retryCount must be <= maxRetries',
  });
export type Run = z.infer<typeof Run>;

export const RunSpec = z.object({
  prompt: z.string().min(1),
  projectId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  agentId: z.string().uuid().optional(),
  connectionMode: ConnectionMode.optional(),
  model: z.string().optional(),
  triggerSource: TriggerSource.optional(),
});
export type RunSpec = z.infer<typeof RunSpec>;
