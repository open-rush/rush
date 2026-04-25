/**
 * Idempotency helpers for `POST /api/v1/agents/:id/runs`.
 *
 * Contract (see `specs/managed-agents-api.md` §幂等性 and `task-11` plan):
 * - Request carries optional `Idempotency-Key` header (≤255 URL-safe chars).
 * - Within a 24h sliding window:
 *     · same key + same body hash → return the original run (no new insert)
 *     · same key + different body hash → 409 `IDEMPOTENCY_CONFLICT`
 *     · different key or expired window → fresh insert
 *
 * The TOCTOU race between "check existing row" and "insert new row" is
 * closed by a Postgres advisory lock keyed on the idempotency key itself:
 * concurrent requests with the same key serialize; different-key traffic
 * runs in parallel. This mirrors the pattern used elsewhere in the repo:
 *   - task-1: `pg_advisory_xact_lock + MAX(version)+1` for AgentDefinition PATCH
 *   - task-6: `pg_advisory_xact_lock(ns, djb2(userId)) + count+insert` for
 *     service-token cap
 *   - task-10: `pg_advisory_xact_lock(hashtext(runId))` for run_events seq
 *
 * Namespace constant stays in this file so every lock domain has a single
 * source of truth. The 2-arg form of `pg_advisory_xact_lock(ns, key)` is
 * deliberate — it avoids collision with the single-arg form used by
 * task-10 (`hashtext(runId)`).
 */

import { createHash } from 'node:crypto';

/**
 * Namespace for `POST /runs` idempotency advisory locks.
 *
 * Value picked to be distinct from other lock domains:
 * - task-10 seq allocation uses the 1-arg form (`pg_advisory_xact_lock(h)`)
 *   so no ns collision possible.
 * - task-6 service-token cap is in `@open-rush/web` (different schema layer)
 *   and uses its own ns; keeping a fresh constant here documents intent.
 *
 * Keep stable across deployments: changing this value effectively resets
 * all in-flight 24h idempotency windows. If we ever need rotation, do it
 * behind a migration window, not silently.
 */
export const LOCK_NS_IDEMPOTENCY = 0x1d_3110_c7; // "IDMP0C7" mnemonic

/**
 * 24-hour idempotency window. Reads as `now() - interval '24 hours'` inside
 * queries but we keep a JS-side constant for unit tests that slice time.
 */
export const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Produce a canonical JSON string for an arbitrary JSON value.
 *
 * Semantics (deterministic and stable across Node versions):
 * - object keys sorted lexicographically before serialization (so
 *   `{a:1,b:2}` and `{b:2,a:1}` hash identically)
 * - arrays preserved in order
 * - primitives (string, number, boolean, null) serialized as `JSON.stringify`
 * - `undefined`, functions, symbols are omitted from objects and
 *   converted to `null` inside arrays (matches `JSON.stringify` behaviour)
 * - NaN / Infinity → `null` (same as JSON.stringify)
 * - Top-level `undefined` → empty string (edge case — caller should
 *   wrap in an object; documented for completeness)
 *
 * Non-goals:
 * - Does **not** canonicalize number formatting (1 vs 1.0 — we rely on
 *   numbers coming from JSON.parse'd request bodies so they are already
 *   normalized).
 * - Does **not** handle cyclic references — will throw like JSON.stringify.
 */
export function canonicalJsonStringify(value: unknown): string {
  return stableStringify(value);
}

function stableStringify(value: unknown): string {
  // Match JSON.stringify behaviour for special cases.
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return JSON.stringify(value);
  if (t === 'number') {
    if (!Number.isFinite(value as number)) return 'null';
    return JSON.stringify(value);
  }
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'undefined' || t === 'function' || t === 'symbol') {
    // Top-level only: JSON.stringify returns undefined. We return empty
    // string so callers that feed it into a hash get an unambiguous value.
    return '';
  }
  if (Array.isArray(value)) {
    const parts = value.map((v) => {
      const serialized = stableStringify(v);
      // Arrays: undefined / function / symbol become null (JSON.stringify
      // does the same).
      return serialized === '' ? 'null' : serialized;
    });
    return `[${parts.join(',')}]`;
  }
  // Plain object — sort keys.
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const serialized = stableStringify(obj[k]);
    // Objects: skip undefined / function / symbol keys (matches
    // JSON.stringify).
    if (serialized === '') continue;
    parts.push(`${JSON.stringify(k)}:${serialized}`);
  }
  return `{${parts.join(',')}}`;
}

/**
 * SHA-256 hex digest of the canonical JSON of `body`.
 *
 * 64-char lowercase hex — matches the `varchar(64)` width of
 * `runs.idempotency_request_hash` set in task-3 migration.
 */
export function computeIdempotencyHash(body: unknown): string {
  const canonical = canonicalJsonStringify(body);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Scope a client-supplied Idempotency-Key to an agent.
 *
 * `POST /api/v1/agents/:id/runs` is scoped per-agent: two different
 * agents may both accept a header like `Idempotency-Key: 2025-01-01-foo`
 * without colliding. Persisting an agent-qualified key in
 * `runs.idempotency_key` keeps the existing partial index usable while
 * avoiding cross-agent replay.
 *
 * Format: `agent:<agentId>|<key>`. The column is `varchar(255)` so a
 * 36-char UUID prefix plus the separator plus the caller key keeps us
 * well under the limit for any sensible 128-char caller key.
 */
export function scopeIdempotencyKey(agentId: string, key: string): string {
  return `agent:${agentId}|${key}`;
}

/**
 * Raised by `RunService.createRunWithIdempotency` when a request reuses an
 * in-window `Idempotency-Key` with a **different** body hash. API layer
 * (task-13) maps this to HTTP 409 / `IDEMPOTENCY_CONFLICT`.
 *
 * Carries both hashes so logs can help debug replay attacks or buggy
 * clients — neither hash leaks request body content.
 */
export class IdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT' as const;
  readonly existingRunId: string;
  readonly existingRequestHash: string;
  readonly incomingRequestHash: string;

  constructor(args: {
    idempotencyKey: string;
    existingRunId: string;
    existingRequestHash: string;
    incomingRequestHash: string;
  }) {
    super(`Idempotency-Key '${args.idempotencyKey}' already used with a different request body`);
    this.name = 'IdempotencyConflictError';
    this.existingRunId = args.existingRunId;
    this.existingRequestHash = args.existingRequestHash;
    this.incomingRequestHash = args.incomingRequestHash;
  }
}
