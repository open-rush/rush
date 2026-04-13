# Security Baseline — STRIDE Threat Model

Lux is a self-hosted AI agent platform. This document maps threats using the STRIDE framework and establishes the security baseline for all phases.

## System Boundaries

```
Internet → [Reverse Proxy] → apps/web (Next.js)
                                  │
                                  ├─ pg-boss queue → apps/control-worker
                                  │                      │
                                  │                      └─ HTTP/SSE → apps/agent-worker (in sandbox)
                                  │
                                  ├─ PostgreSQL
                                  └─ Redis
```

**Trust boundaries:**
1. Internet ↔ Web (untrusted input)
2. Web ↔ Control Worker (internal, trusted via pg-boss)
3. Control Worker ↔ Agent Worker (partially trusted, sandbox-isolated)
4. Agent Worker ↔ AI Model (external API)

## STRIDE Analysis

### S — Spoofing (Identity)

| Threat | Risk | Mitigation | Phase | Residual Risk |
|--------|------|------------|-------|---------------|
| Unauthenticated API access | HIGH | NextAuth.js v5 session validation on all Control API routes | M1 | Session fixation if secure cookie flags misconfigured |
| Forged x-request-id | LOW | Validate format + length, reject invalid (packages/observability) | M0 ✅ | None — requestId is correlation only, not auth |
| Spoofed pg-boss jobs | MEDIUM | pg-boss uses shared DB — compromised web layer with DB credentials can inject jobs. Mitigate with job payload schema validation in control-worker + separate DB roles (M4) | M1 | Shared DB credentials between web and control-worker until role separation |
| Impersonation via shared sandbox | MEDIUM | One sandbox per agent, no shared filesystem | M1 | If sandbox provider has escape vulnerability |

### T — Tampering

| Threat | Risk | Mitigation | Phase | Residual Risk |
|--------|------|------------|-------|---------------|
| SQL injection | HIGH | Drizzle ORM parameterized queries everywhere, no raw SQL interpolation | M0 ✅ | ORM bypass if raw `sql.raw()` used with user input |
| Agent tool escape (write outside workspace) | HIGH | SandboxProvider isolation — agent-worker runs in container, workspace mount is scoped | M1 | Container escape CVE |
| Migration tampering | MEDIUM | Migration files in git, CI replays on clean DB, reviewed before merge | M0 ✅ | Compromised git history |
| Log injection | LOW | pino JSON serialization prevents format string attacks | M0 ✅ | None |

### R — Repudiation

| Threat | Risk | Mitigation | Phase | Residual Risk |
|--------|------|------------|-------|---------------|
| Untracked admin actions | MEDIUM | All state changes through pg-boss jobs with run_events audit trail | M1 | Events could be deleted by DB admin |
| Untracked credential access | MEDIUM | Vault read/write logged with userId, timestamp | M2 | Log deletion by infrastructure admin |
| Run result manipulation | MEDIUM | Finalization strong-consistency gate enforces application-level integrity | M1 | DB-level access can bypass application state machine — mitigated by DB role separation (M4) and audit log immutability |

### I — Information Disclosure

| Threat | Risk | Mitigation | Phase | Residual Risk |
|--------|------|------------|-------|---------------|
| Credential leakage in logs | HIGH | pino redact default paths (authorization, token, password, apiKey, secret, cookie, credentials) | M0 ✅ | Custom fields not in default redact list |
| Credential leakage in sandbox | HIGH | Vault env injection — credentials in env vars, not files. Sandbox destroyed after run. | M2 | Memory dump before destruction |
| Cross-user data access | HIGH | Authorization guard on all queries (project_members check) | M1 | Missing guard on new endpoints |
| AI model sees credentials | MEDIUM | Minimize injection scope (only required env vars per run). Tool-level output audit + redaction in run_events. Tool whitelist limits file access scope. | M1/M2 | Model can still echo env vars in conversation; output-side redaction is best-effort |
| Error stack traces to client | MEDIUM | Production error handler returns generic messages, logs full stack server-side | M1 | Dev mode accidentally enabled in prod |

### D — Denial of Service

| Threat | Risk | Mitigation | Phase | Residual Risk |
|--------|------|------------|-------|---------------|
| Runaway AI execution | HIGH | Budget limit + timeout per run (Claude Code resilience) | M1 | Budget race condition between check and charge |
| Redis connection exhaustion | MEDIUM | Connection pool with max limit, health checks | M0 ✅ (stream package) | Sudden spike beyond pool max |
| Database connection exhaustion | MEDIUM | postgres.js pool with parsePoolMax() | M0 ✅ | Unclosed connections in error paths |
| Queue flooding | LOW | pg-boss built-in rate limiting, job TTL | M1 | Authenticated user creates excessive runs |

### E — Elevation of Privilege

| Threat | Risk | Mitigation | Phase | Residual Risk |
|--------|------|------------|-------|---------------|
| User → Admin escalation | HIGH | RBAC: Owner/Member roles, authorization guard middleware | M1 | Role check bypass on new API routes |
| Sandbox → Host escape | CRITICAL | SandboxProvider container isolation, no host mount except workspace | M1 | Container runtime CVE |
| Agent tool abuse | HIGH | Tool whitelist per agent config, allowed_tools field | M1 | Misconfigured agent allows dangerous tools |
| Vault scope escalation (project → platform) | HIGH | CHECK constraint in DB: platform scope requires NULL project_id | M0 ✅ | DB admin or migration with ALTER TABLE can disable constraint |

## Security Hardening Checklist

### M0 (Current) ✅

- [x] Parameterized queries only (Drizzle ORM)
- [x] Structured JSON logging with sensitive field redaction
- [x] Request ID validation (format + length)
- [x] DB connection pooling with limits
- [x] Redis connection with health checks
- [x] Vault DB constraint (scope check)
- [x] Dependabot enabled for dependency updates
- [x] Migration replay testing
- [x] SECURITY.md with vulnerability reporting process

### M1 (Required for Agent Loop)

- [ ] NextAuth.js session validation on all routes
- [ ] Authorization guard middleware (project_members)
- [ ] RBAC: Owner/Member role enforcement
- [ ] Claude Code budget limit + execution timeout
- [ ] SandboxProvider container isolation
- [ ] Tool whitelist enforcement
- [ ] Production error handler (no stack traces to client)

### M2 (Required for MVP)

- [ ] Vault encrypted storage + env injection
- [ ] Credential rotation support
- [ ] Rate limiting (in-memory for M2, Redis for M4)
- [ ] CSRF protection on mutation endpoints

### M4 (GA Hardening)

- [ ] SBOM generation
- [ ] Container image signing
- [ ] Audit log export
- [ ] Penetration testing
- [ ] OTEL security spans

## Principles

1. **Defense in depth** — multiple layers, no single point of failure
2. **Least privilege** — sandbox gets minimum required permissions
3. **Fail secure** — errors deny access, don't grant it
4. **Audit everything** — run_events is the audit trail
5. **No secrets in code** — all credentials through Vault or env
