/**
 * `/api/v1/*` shared Response helpers.
 *
 * These wrap the v1 error envelope defined in `specs/managed-agents-api.md`
 * §错误码 + `@open-rush/contracts` v1.common (`ERROR_CODE_HTTP_STATUS`,
 * `errorBodySchema`). Kept deliberately small; the Zod schemas remain the
 * source of truth for response shapes.
 *
 * Unlike the legacy `apiSuccess` / `apiError` in `apps/web/lib/api-utils.ts`
 * (which wraps payloads as `{ success, data, code, error }`), v1 responses
 * follow the stable external contract:
 *
 *   - success:  `{ data: <payload> }`                 (HTTP 2xx)
 *   - failure:  `{ error: { code, message, hint?, issues? } }`  (HTTP 4xx/5xx)
 *
 * Consumers that need a *paginated* envelope emit `{ data: T[], nextCursor }`
 * directly via {@link v1Paginated}.
 */
import { v1 } from '@open-rush/contracts';

type ErrorCode = v1.ErrorCode;

/**
 * Minimal shape from Zod's `error.issues[number]`. Kept structural so we don't
 * need a direct `zod` dependency in apps/web — the schemas live in
 * `@open-rush/contracts` which re-exports Zod transitively.
 */
interface ZodIssueLike {
  path: Array<string | number>;
  message: string;
}
interface ZodErrorLike {
  issues: ZodIssueLike[];
}

/** 200/201 success with a single resource. */
export function v1Success<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status });
}

/** 200 paginated list. nextCursor is a string or null per contract. */
export function v1Paginated<T>(data: T[], nextCursor: string | null): Response {
  return Response.json({ data, nextCursor }, { status: 200 });
}

/**
 * Plain error envelope. The HTTP status is derived from `code` via
 * {@link ERROR_CODE_HTTP_STATUS}; callers generally should NOT override it
 * (kept as escape hatch for rare cases where the same code maps to a
 * different status — currently none, but reserved).
 */
export function v1Error(
  code: ErrorCode,
  message: string,
  options: {
    hint?: string;
    issues?: Array<{ path: Array<string | number>; message: string }>;
    status?: number;
  } = {}
): Response {
  const { hint, issues, status } = options;
  const body: {
    error: {
      code: ErrorCode;
      message: string;
      hint?: string;
      issues?: Array<{ path: Array<string | number>; message: string }>;
    };
  } = { error: { code, message } };
  if (hint !== undefined) body.error.hint = hint;
  if (issues !== undefined) body.error.issues = issues;
  return Response.json(body, { status: status ?? v1.ERROR_CODE_HTTP_STATUS[code] });
}

/**
 * Convenience: translate a Zod failure into a VALIDATION_ERROR response with
 * per-issue `path` + `message`. Reserves the first issue's message for the
 * top-level `message` field so clients with naive error rendering still see
 * a human-readable summary.
 */
export function v1ValidationError(error: ZodErrorLike, prefix = 'Validation failed'): Response {
  const issues = error.issues.map((i) => ({
    path: i.path,
    message: i.message,
  }));
  const summary = issues[0]?.message ? `${prefix}: ${issues[0].message}` : prefix;
  return v1Error('VALIDATION_ERROR', summary, { issues });
}
