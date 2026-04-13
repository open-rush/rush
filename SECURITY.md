# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| main (latest) | Yes |

## Reporting a Vulnerability

**Do NOT open a public issue for security vulnerabilities.**

Please report security vulnerabilities by emailing: **security@lux.dev**

You should receive a response within 48 hours. If you don't, please follow up to ensure we received your report.

### What to Include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Process

1. You report via email
2. We acknowledge within 48 hours
3. We investigate and determine severity
4. We develop and test a fix
5. We release a patch and publish a security advisory
6. We credit you in the advisory (unless you prefer anonymity)

### Scope

The following are in scope:
- Authentication and authorization bypass
- SQL injection, XSS, CSRF
- Sandbox escape (agent-worker breaking isolation)
- Credential leakage (Vault, env injection)
- Privilege escalation

### Out of Scope

- Denial of service (unless trivially exploitable)
- Social engineering
- Issues in dependencies (report upstream, but let us know)
