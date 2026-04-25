import {
  IDEMPOTENCY_WINDOW_MS,
  IdempotencyConflictError,
  scopeIdempotencyKey,
} from './idempotency.js';
import { canTransition, isTerminal, type RunStatus } from './run-state-machine.js';

/**
 * Non-terminal statuses for which user cancellation reaches `failed` via a
 * legal state-machine transition. Derived from `run-state-machine.ts` and
 * pinned here so `cancelRun` fails closed if the machine ever drops one of
 * these edges.
 *
 * Intentionally excludes:
 * - `finalized` — the commit succeeded; treated as already-terminal.
 * - `finalizing_retryable_failed` — only valid transitions are to
 *   `finalizing_uploading` (retry) or `finalizing_timeout`. Cancel from
 *   here is surfaced as {@link RunCannotCancelError} so the caller either
 *   waits out the retry or escalates.
 */
const CANCELLABLE_STATES = new Set<RunStatus>([
  'queued',
  'provisioning',
  'preparing',
  'running',
  'worker_unreachable',
  'finalizing_prepare',
  'finalizing_uploading',
  'finalizing_verifying',
  'finalizing_metadata_commit',
  'finalizing_timeout',
  'finalizing_manual_intervention',
]);

/**
 * Statuses that behave like terminal states from a user-cancel perspective,
 * in addition to the true terminals (`completed`, `failed`). `finalized`
 * is post-commit and will transition to `completed` shortly; cancelling it
 * is a no-op contract: we return the existing run with {@link
 * RunAlreadyTerminalError}.
 */
const CANCEL_ALREADY_TERMINAL = new Set<RunStatus>(['completed', 'failed', 'finalized']);

export interface Run {
  id: string;
  agentId: string;
  taskId: string | null;
  conversationId: string | null;
  parentRunId: string | null;
  status: RunStatus;
  prompt: string;
  provider: string;
  connectionMode: string;
  modelId: string | null;
  triggerSource: string;
  /**
   * AgentDefinition version snapshot this run is bound to (see
   * `specs/agent-definition-versioning.md`). Populated by RunService at
   * creation — `createRun` inherits from `parentRunId` when omitted, and
   * the v1 API route (task-13) resolves from `tasks.definition_version`
   * / `agents.current_version` upstream of the service call. Nullable for
   * legacy runs created before task-3 / task-11.
   *
   * Consumed by the v1 event protocol to emit
   * `data-openrush-run-started.definitionVersion`.
   */
  agentDefinitionVersion: number | null;
  /**
   * Agent-scoped Idempotency-Key persisted for `POST /api/v1/agents/:id/runs`
   * (task-11). Stored as `agent:<agentId>|<key>` via
   * `scopeIdempotencyKey` so cross-agent collisions are impossible; null
   * for runs without an Idempotency-Key.
   */
  idempotencyKey: string | null;
  /**
   * SHA-256 hex of canonical-JSON(request body). Used alongside
   * {@link idempotencyKey} to decide replay vs. conflict inside the 24h
   * window. Never returned to external callers — exposed here so internal
   * callers / logs can correlate replays.
   */
  idempotencyRequestHash: string | null;
  activeStreamId: string | null;
  retryCount: number;
  maxRetries: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface CreateRunInput {
  agentId: string;
  prompt: string;
  taskId?: string | null;
  conversationId?: string | null;
  parentRunId?: string;
  provider?: string;
  connectionMode?: string;
  modelId?: string;
  triggerSource?: string;
  /**
   * AgentDefinition version to bind this run to (see
   * `specs/agent-definition-versioning.md` §Run 派生).
   *
   * Callers — typically the `/api/v1/agents/:id/runs` route handler
   * (task-13) — should resolve from `tasks.definition_version` and only
   * fall back to `agents.current_version` for runs that have no
   * task_id. Follow-up runs (with `parentRunId`) inherit the parent's
   * version automatically when this field is omitted.
   *
   * Accepted null to keep legacy/recovery tooling writable; new API-
   * layer creations must always pass a positive integer.
   */
  agentDefinitionVersion?: number | null;
  /**
   * Pre-computed idempotency columns. Routed here by
   * {@link RunService.createRunWithIdempotency}; direct callers of
   * {@link RunService.createRun} normally omit these.
   */
  idempotencyKey?: string | null;
  idempotencyRequestHash?: string | null;
}

export interface RunDb {
  create(input: CreateRunInput): Promise<Run>;
  findById(id: string): Promise<Run | null>;
  updateStatus(id: string, status: RunStatus, extra?: Partial<Run>): Promise<Run | null>;
  listByAgent(agentId: string, limit?: number): Promise<Run[]>;
  findStuckRuns(olderThanMs: number): Promise<Run[]>;
  /**
   * Idempotency lookup for the 24h sliding window. Returns the most
   * recent run with the given key created at or after `since`, or null.
   *
   * Implementations must order by `createdAt DESC` so a replay inside
   * the window wins over any older entry with the same key.
   *
   * Defaults to a no-op in mocks that don't need idempotency coverage;
   * `RunService.createRunWithIdempotency` assumes the real impl backs it.
   */
  findLatestByIdempotencyKey?(key: string, since: Date): Promise<Run | null>;
  /**
   * Implementation hook for `createRunWithIdempotency`: executes the
   * lookup + conditional insert inside a single advisory-locked
   * transaction. Mocks without this hook fall back to the
   * `findLatestByIdempotencyKey`-then-`create` sequence implemented by
   * `RunService.createRunWithIdempotency` — adequate for unit tests
   * that do not exercise concurrency.
   */
  createWithIdempotencyTx?(
    input: CreateRunInput,
    lookup: { key: string; since: Date },
    onExisting: (existing: Run) => Run | Promise<Run>
  ): Promise<Run>;
}

/**
 * Indicates a `cancelRun` call against a run that is already in a
 * terminal state. The service treats cancellation as idempotent — the
 * API layer (task-13) decides whether to surface this via 200 (with the
 * existing terminal state) or a specific error envelope; the v0.1 spec
 * (see `specs/managed-agents-api.md` §E2E 3.5) asks for 200 + the run's
 * post-state shape with `status=cancelled`.
 */
export class RunAlreadyTerminalError extends Error {
  readonly code = 'RUN_ALREADY_TERMINAL' as const;
  readonly status: RunStatus;
  constructor(runId: string, status: RunStatus) {
    super(`Run ${runId} is already in terminal state '${status}'`);
    this.name = 'RunAlreadyTerminalError';
    this.status = status;
  }
}

/**
 * `cancelRun` was called for a runId that doesn't exist.
 */
export class RunNotFoundError extends Error {
  readonly code = 'RUN_NOT_FOUND' as const;
  constructor(runId: string) {
    super(`Run ${runId} not found`);
    this.name = 'RunNotFoundError';
  }
}

/**
 * `cancelRun` was called in a state where no legal transition to `failed`
 * exists — currently only `finalizing_retryable_failed`. API layer (task-13)
 * maps this to HTTP 409 with a "try again in a moment" hint.
 */
export class RunCannotCancelError extends Error {
  readonly code = 'RUN_CANNOT_CANCEL' as const;
  readonly status: RunStatus;
  constructor(runId: string, status: RunStatus) {
    super(`Run ${runId} cannot be cancelled from status '${status}'`);
    this.name = 'RunCannotCancelError';
    this.status = status;
  }
}

export class RunService {
  constructor(private db: RunDb) {}

  /**
   * Create a run **without** idempotency semantics. Preserves the pre-
   * task-11 signature so internal callers (recovery, tests) are
   * untouched. For the `/api/v1/agents/:id/runs` path, use
   * {@link createRunWithIdempotency} instead so the 24h replay window
   * is enforced.
   *
   * Version binding (see `specs/agent-definition-versioning.md` §Run 派生):
   * - Explicit `agentDefinitionVersion` is forwarded as-is.
   * - When omitted AND `parentRunId` is set, the parent's version is
   *   inherited so follow-up runs freeze the same AgentDefinition
   *   snapshot as the original chain.
   * - When neither is available the service leaves the column null;
   *   the caller (API route handler in task-13) is responsible for
   *   resolving from `tasks.definition_version` / `agents.current_version`
   *   beforehand.
   */
  async createRun(input: CreateRunInput): Promise<Run> {
    const resolved = await this.resolveCreateInput(input);
    return this.db.create(resolved);
  }

  /**
   * Derive the effective {@link CreateRunInput} before hitting `RunDb`:
   * when the caller omits `agentDefinitionVersion` but supplies
   * `parentRunId`, inherit the parent's version. Kept private because
   * API callers are expected to pre-resolve from `tasks.definition_version`.
   */
  private async resolveCreateInput(input: CreateRunInput): Promise<CreateRunInput> {
    if (input.agentDefinitionVersion != null) return input;
    if (!input.parentRunId) return input;

    const parent = await this.db.findById(input.parentRunId);
    if (!parent?.agentDefinitionVersion) {
      // Parent has no version (legacy / pre-task-11 row) — leave null so
      // a downstream defensive check can decide what to do. Do not error:
      // recovery paths still need to create runs without a version.
      return input;
    }
    return { ...input, agentDefinitionVersion: parent.agentDefinitionVersion };
  }

  /**
   * Create a run with optional Idempotency-Key replay handling.
   *
   * Behaviour (see `specs/managed-agents-api.md` §幂等性):
   * - When `idempotency` is omitted → plain `createRun(input)`.
   * - When present → enter the idempotency transaction:
   *     · lookup the latest run with the same key created ≥24h ago
   *     · same hash  → return the existing run (idempotent replay)
   *     · diff hash  → throw {@link IdempotencyConflictError}
   *     · no match   → insert a fresh run with `(key, hash)` persisted
   *
   * The TOCTOU race between lookup and insert is closed inside
   * `RunDb.createWithIdempotencyTx` via `pg_advisory_xact_lock`. Mock
   * DBs without that hook fall back to a best-effort lookup-then-create
   * sequence (adequate for unit tests that don't exercise concurrency).
   *
   * @param input Base create input; the method overlays
   *              `idempotencyKey` / `idempotencyRequestHash` before calling
   *              into {@link RunDb}.
   * @param idempotency Optional `{ key, requestHash, nowMs?, windowMs? }`.
   *                    `nowMs` exists purely so tests can pin the window;
   *                    `windowMs` defaults to 24h.
   */
  async createRunWithIdempotency(
    input: CreateRunInput,
    idempotency?: {
      key: string;
      requestHash: string;
      nowMs?: number;
      windowMs?: number;
    }
  ): Promise<Run> {
    // Always resolve parent-version inheritance first, regardless of
    // idempotency — the resulting row must carry the inherited version
    // on a fresh insert. Replays already have their own stored version.
    const resolvedInput = await this.resolveCreateInput(input);

    if (!idempotency) {
      return this.db.create(resolvedInput);
    }

    const { key, requestHash } = idempotency;
    const nowMs = idempotency.nowMs ?? Date.now();
    const windowMs = idempotency.windowMs ?? IDEMPOTENCY_WINDOW_MS;
    const since = new Date(nowMs - windowMs);

    // Scope idempotency lookups + persistence to `(agentId, key)` to
    // prevent cross-agent replay. Two different agents sharing the same
    // client-generated key must not collide — Stripe/Anthropic-style
    // credential-scoped idempotency. Persisting the scoped key in
    // `runs.idempotency_key` keeps the task-3 partial index usable and
    // makes lookups naturally agent-local.
    const scopedKey = scopeIdempotencyKey(resolvedInput.agentId, key);

    const fullInput: CreateRunInput = {
      ...resolvedInput,
      idempotencyKey: scopedKey,
      idempotencyRequestHash: requestHash,
    };

    if (this.db.createWithIdempotencyTx) {
      return this.db.createWithIdempotencyTx(fullInput, { key: scopedKey, since }, (existing) => {
        if (existing.agentId !== fullInput.agentId) {
          // Should never happen — DrizzleRunDb filters by key which is
          // already agent-scoped — but keep the guard so drift in the
          // adapter (e.g. accidental scope removal) still fails closed.
          throw new Error(
            `idempotency replay scope violation: existing.agentId ${existing.agentId} !== request.agentId ${fullInput.agentId}`
          );
        }
        if (existing.idempotencyRequestHash === requestHash) {
          return existing;
        }
        throw this.buildConflict(key, existing.id, existing.idempotencyRequestHash, requestHash);
      });
    }

    // Best-effort fallback for mock RunDbs: lookup then create.
    if (this.db.findLatestByIdempotencyKey) {
      const existing = await this.db.findLatestByIdempotencyKey(scopedKey, since);
      if (existing) {
        if (existing.agentId !== fullInput.agentId) {
          throw new Error(
            `idempotency replay scope violation: existing.agentId ${existing.agentId} !== request.agentId ${fullInput.agentId}`
          );
        }
        if (existing.idempotencyRequestHash === requestHash) {
          return existing;
        }
        throw this.buildConflict(key, existing.id, existing.idempotencyRequestHash, requestHash);
      }
    }

    return this.db.create(fullInput);
  }

  private buildConflict(
    key: string,
    existingRunId: string,
    existingRequestHash: string | null,
    incomingRequestHash: string
  ): IdempotencyConflictError {
    return new IdempotencyConflictError({
      idempotencyKey: key,
      existingRunId,
      existingRequestHash: existingRequestHash ?? '',
      incomingRequestHash,
    });
  }

  async getById(id: string): Promise<Run | null> {
    return this.db.findById(id);
  }

  async transition(runId: string, to: RunStatus, extra?: Partial<Run>): Promise<Run> {
    const run = await this.db.findById(runId);
    if (!run) throw new Error('Run not found');

    if (!canTransition(run.status, to)) {
      throw new Error(`Invalid transition: ${run.status} → ${to}`);
    }

    const updates: Partial<Run> = { ...extra };
    if (to === 'running' && !run.startedAt) {
      updates.startedAt = new Date();
    }
    if (isTerminal(to)) {
      updates.completedAt = new Date();
    }
    if (to === 'failed' && extra?.errorMessage) {
      updates.errorMessage = extra.errorMessage;
    }

    const updated = await this.db.updateStatus(runId, to, updates);
    if (!updated) throw new Error('Run not found');
    return updated;
  }

  /**
   * Marker string persisted in `runs.error_message` when a run is
   * cancelled by user action. Stable contract — frontends and E2E tests
   * assert on this exact prefix.
   */
  static readonly CANCELLED_MESSAGE = 'cancelled by user';

  /**
   * User-initiated cancel. v0.1 doesn't have a dedicated `cancelled`
   * status in the state machine; cancel is modelled as a transition to
   * `failed` with `errorMessage = CANCELLED_MESSAGE`. The API layer
   * (task-13) maps this back to `status: 'cancelled'` in the response
   * envelope per `specs/managed-agents-api.md` §E2E 3.5.
   *
   * Status matrix:
   * - `completed` / `failed` / `finalized`
   *     → {@link RunAlreadyTerminalError}, caller returns the existing shape
   *       (friendly 200 with status=cancelled pass-through). `finalized`
   *       joins the terminals because the commit has landed — user-facing
   *       it is "done".
   * - every state in {@link CANCELLABLE_STATES} (queued / provisioning /
   *   preparing / running / worker_unreachable, plus every `finalizing_*`
   *   with a direct `→ failed` edge)
   *     → transition to `failed` with `errorMessage = CANCELLED_MESSAGE`
   * - `finalizing_retryable_failed` (only `→ finalizing_uploading` /
   *   `→ finalizing_timeout` edges in the state machine)
   *     → {@link RunCannotCancelError} — caller either waits out the
   *       retry or escalates.
   *
   * `CANCELLABLE_STATES` / `CANCEL_ALREADY_TERMINAL` are pinned against
   * the current state machine; a dedicated unit test verifies that every
   * `CANCELLABLE_STATES` entry still has a direct `→ failed` transition
   * in `run-state-machine.ts`, so future state-machine edits surface as
   * a test failure rather than a runtime 500.
   */
  async cancelRun(runId: string): Promise<Run> {
    const run = await this.db.findById(runId);
    if (!run) throw new RunNotFoundError(runId);
    if (CANCEL_ALREADY_TERMINAL.has(run.status)) {
      throw new RunAlreadyTerminalError(runId, run.status);
    }
    if (!CANCELLABLE_STATES.has(run.status) || !canTransition(run.status, 'failed')) {
      throw new RunCannotCancelError(runId, run.status);
    }
    return this.transition(runId, 'failed', { errorMessage: RunService.CANCELLED_MESSAGE });
  }

  async setActiveStreamId(runId: string, streamId: string): Promise<void> {
    const run = await this.db.findById(runId);
    if (!run) throw new Error('Run not found');
    await this.db.updateStatus(runId, run.status as RunStatus, { activeStreamId: streamId });
  }

  async retry(runId: string): Promise<Run> {
    const run = await this.db.findById(runId);
    if (!run) throw new Error('Run not found');
    if (run.status !== 'failed') throw new Error('Can only retry failed runs');
    if (run.retryCount >= run.maxRetries) throw new Error('Max retries exceeded');

    return this.transition(runId, 'queued', {
      retryCount: run.retryCount + 1,
      errorMessage: null,
    });
  }

  async listByAgent(agentId: string, limit?: number): Promise<Run[]> {
    return this.db.listByAgent(agentId, limit);
  }

  async recoverStuckRuns(olderThanMs = 120_000): Promise<Run[]> {
    const stuck = await this.db.findStuckRuns(olderThanMs);
    const recovered: Run[] = [];

    for (const run of stuck) {
      if (run.status === 'worker_unreachable') {
        const updated = await this.transition(run.id, 'failed', {
          errorMessage: 'Worker unreachable timeout',
        });
        recovered.push(updated);
      }
    }

    return recovered;
  }
}
