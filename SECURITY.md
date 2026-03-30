# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 2.x     | :white_check_mark: |
| < 2.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in GitHub Repo Manager, please report it responsibly.

**Do NOT open a public GitHub Issue for security vulnerabilities.**

Instead, please email **security@bolalabs.com** with:

1. A description of the vulnerability
2. Steps to reproduce the issue
3. Potential impact assessment
4. Any suggested fixes (optional)

We will acknowledge your report within **48 hours** and aim to provide a fix within **7 days** for critical issues.

## Security Architecture

### Authentication

- **GitHub OAuth 2.0** with PKCE flow for user authentication
- **Session-based** with `httpOnly`, `sameSite: 'lax'`, and `secure` (production) cookies
- **Azure DevOps OAuth** callback validates `state` parameter against session-stored nonce to prevent CSRF; `requireAuth` is intentionally omitted on the callback route since it runs in a popup before the session is established
- Sessions stored server-side in SQLite (not in cookies)

### API Security

- **Helmet.js** for HTTP security headers (CSP, X-Frame-Options, HSTS, Referrer-Policy)
- **Rate limiting**: 200 req/15min for API, 20 req/15min for auth endpoints
- **Input validation**: Zod schemas on all mutation endpoints
- **SSRF protection**: Internal/private URL blocking with DNS rebinding checks on import URLs
- **Parameterized SQL**: All database queries use prepared statements (never string interpolation)

### Credential Handling

- **GitHub tokens** are stored only in server-side sessions, never exposed to the client
- **Azure DevOps PATs** are encrypted at rest with AES-256-GCM (PBKDF2-derived key) when stored for scheduled migrations, and automatically purged after use
- **`SESSION_SECRET`** is enforced in production (server refuses to start with the default value)
- **No credentials in logs**: Structured logging (pino) with URL credential redaction

### Data Storage

- **SQLite** with WAL mode for concurrent read performance
- **No PII** stored beyond GitHub usernames and session tokens
- All user data is local to the server instance (no cloud telemetry)

## Security Best Practices for Deployment

1. **Set a strong `SESSION_SECRET`** (minimum 32 random characters)
2. **Use HTTPS** in production (required for secure cookies)
3. **Restrict OAuth scopes** to the minimum required permissions
4. **Keep dependencies updated**: Run `npm audit` regularly
5. **Do not expose port 3001** directly; use a reverse proxy (nginx, Caddy)
6. **Review `.env.example`** for all configurable security settings

## Dependencies

This project uses automated dependency auditing. Key security-relevant dependencies:

| Package | Purpose |
|---------|---------|
| `helmet` | HTTP security headers |
| `express-rate-limit` | API rate limiting |
| `express-session` | Secure session management |
| `better-sqlite3` | Parameterized SQL queries |
| `pino` | Structured logging (no credential leaks) |
