# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 4.x     | :white_check_mark: |
| < 4.0   | :x:                |

Only the latest 4.x release line receives security fixes. There is no backport
process: the last 3.x release was **3.8.0** (April 2026) and nothing has been
published on that line since, so a fix for a 3.x install means upgrading to
4.x. Upgrades within 4.x are in-place — the database migrates forward
automatically on first boot.

## Reporting a Vulnerability

If you discover a security vulnerability in GitHub Repo Manager, please report it responsibly.

**Do NOT open a public GitHub Issue for security vulnerabilities.**

Instead, please email **bruno@bolalabs.pt** with:

1. A description of the vulnerability
2. Steps to reproduce the issue
3. Potential impact assessment
4. Any suggested fixes (optional)

We will acknowledge your report within **48 hours** and aim to provide a fix within **7 days** for critical issues.

## Security Architecture

### Authentication

- **GitHub OAuth 2.0** for user authentication
- **Session-based** with `httpOnly`, `sameSite: 'lax'`, and `secure` (production) cookies
- **Azure DevOps OAuth** callback validates `state` parameter against session-stored nonce to prevent CSRF; `requireAuth` is intentionally omitted on the callback route since it runs in a popup before the session is established
- Sessions stored server-side in SQLite (not in cookies)

### API Security

- **Helmet.js** for HTTP security headers (CSP, X-Frame-Options, HSTS, Referrer-Policy)
- **Rate limiting**: 200 req/15min for API, 20 req/15min for auth endpoints, and
  1000 per 5 minutes per IP on the inbound webhook endpoints — those mount
  before the session middleware (they need the raw body for HMAC), so the
  global limiter never sees them
- **Input validation**: Zod schemas on all mutation endpoints; `:owner`,
  `:repo`, `:sha` and numeric IDs are checked by Express `router.param` guards
  before any handler runs, against one definition of a legal GitHub name
  (`server/lib/github-names.js`)
- **SSRF protection**: Internal/private URL blocking with DNS rebinding checks on
  import URLs. Every call that carries the user's GitHub token resolves through
  `resolveGitHubUrl()`, which will only produce a URL whose origin is exactly
  `https://api.github.com`
- **Parameterized SQL**: All database queries use prepared statements (never string interpolation)

### Credential Handling

- **GitHub tokens** are stored only in server-side sessions, never exposed to the client
- **Azure DevOps PATs** are encrypted at rest with AES-256-GCM (PBKDF2-derived key) when stored for scheduled migrations, and automatically purged after use
- **`SESSION_SECRET`** is enforced in production (server refuses to start with the default value)
- **No credentials in logs**: Structured logging (pino) with URL credential redaction

### Data Storage

- **SQLite** with WAL mode for concurrent read performance
- All user data is local to the server instance (**no cloud telemetry**) — it
  is never sent to Bola Labs, and a self-hosted instance is the sole
  controller of everything below

**Personal data actually stored** (GDPR-relevant inventory — the schema is in
[`server/db.js`](server/db.js) and
[`server/lib/db-migrations.js`](server/lib/db-migrations.js)):

| Data | Where | When it exists |
| ---- | ----- | -------------- |
| GitHub numeric id, username, avatar URL | `users` | Every signed-in account |
| Email address from the GitHub profile | `users.email` | Every sign-in — written from the OAuth profile response (`null` when the GitHub account has no public email) |
| Session records (including the GitHub access token) | server-side session store | While a session is live; rolling, 7-day absolute ceiling |
| Licensee email, organization, seat count | `installed_license` | Only after a Pro/Enterprise license key is activated on the instance |
| Stripe customer id, subscription id, checkout session id | `user_subscriptions`, `issued_licenses` | Only on instances running Stripe billing |
| Issued license keys + delivery status | `issued_licenses` | Only on instances issuing licenses |
| Full outbound email — recipient address, subject and body | `email_dead_letter` | Only when a delivery fails; rows persist until retried or resolved by an operator |

Retention and erasure: the daily maintenance pass honours
`DATA_RETENTION_DAYS` (with a warning email `DATA_RETENTION_WARNING_LEAD_DAYS`
ahead), and GDPR Article 17 (erasure) / Article 20 (portability) are
self-service from Settings. Deleting a user cascades or nulls their rows per
the foreign keys above; `email_dead_letter` is operator-managed and is **not**
keyed to a user, so review it separately when handling an erasure request.

## Security Best Practices for Deployment

1. **Set a strong `SESSION_SECRET`** (minimum 32 random characters)
2. **Use HTTPS** in production (required for secure cookies)
3. **Restrict OAuth scopes** to the minimum required permissions
4. **Keep dependencies updated**: Run `npm audit` regularly
5. **Do not expose port 3001** directly; use a reverse proxy (nginx, Caddy)
6. **Review `.env.example`** for all configurable security settings

## Static analysis

CodeQL runs on every pull request and on `main`. The policy is that the alert
list is kept at zero open items: a finding is either fixed or dismissed with a
written reason naming what the query cannot see — an Express `router.param`
guard, a cookie flag that depends on `NODE_ENV`, a checksum verified after a
download. Dismissals are visible in the repository's Security tab; "we will
look at it later" is not one of the available reasons.

Dependabot alerts are treated the same way. Transitive dev-only advisories that
upstream has not yet released a fix for are pinned with an `overrides` entry
rather than left open.

## Dependencies

This project uses automated dependency auditing. Key security-relevant dependencies:

| Package | Purpose |
|---------|---------|
| `helmet` | HTTP security headers |
| `express-rate-limit` | API rate limiting |
| `express-session` | Secure session management |
| `better-sqlite3` | Parameterized SQL queries |
| `pino` | Structured logging (no credential leaks) |
