# Next-Session Handoff — 2026-04-19

## Context

This session shipped BYOK (Z.1–Z.4), E1 (event ingestion), E2+E3 (Work Board), G (SOC 2 hardening), email service, license issuance, and a docs/env sweep. See commit log from 2026-04-19 for the full arc.

## Start-of-session smoke test

Before any feature work, ask the new agent to run:

1. `npm run dev:all` and verify the app boots without errors.
2. Open http://localhost:5173, log in via GitHub OAuth, navigate to:
   - Dashboard
   - Repositories
   - Work Board — all 4 tabs should render (mock data or empty states)
   - Settings → AI Configuration
   - Pricing page
3. Fire a test webhook:
   ```bash
   curl -X POST http://localhost:3001/api/v1/webhooks/github \
     -H 'Content-Type: application/json' \
     -H 'X-GitHub-Event: ping' \
     -d '{}'
   ```
   Expect 200. (In dev, `WEBHOOK_SECRET` unset is allowed — no 401.)
4. `npx vitest run` — expect ~1473 pass / 1 skipped / 0 failures.

If any step fails, fix before feature work.

## Open items by priority

### Priority 1 — before any code change

Review the current state of these files and confirm they reflect actual behavior:

- [ ] `.env.example` matches `server/config.js`
- [ ] `README.md` points users to Settings → AI Configuration for BYOK (not env vars)
- [ ] `docs/index.md` lists every doc under `docs/`
- [ ] `ROADMAP.md` "Recently Shipped" is current

### Priority 2 — production readiness

These are needed for any non-demo deployment:

- [ ] Generate Ed25519 license signing key:
      ```bash
      node -e "import('./server/lib/license.js').then(m => m.generateKeyPair()).then(k => console.log(k.privateKey))"
      ```
      Put the result in `LICENSE_SIGNING_PRIVATE_KEY_PEM`.
- [ ] Create Stripe account + products + set `STRIPE_*` env vars (see `docs/billing-and-licensing.md`)
- [ ] Configure email delivery: set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM`
- [ ] Generate strong `SESSION_SECRET`, `WEBHOOK_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `API_KEY_SECRET` (all ≥ 32 bytes):
      ```bash
      node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
      ```
- [ ] Configure the GitHub App/webhook to point at `/api/v1/webhooks/github` with the `WEBHOOK_SECRET` above
- [ ] Schedule retention pass via cron:
      ```cron
      0 3 * * * cd /app && npm run retention:run
      ```

### Priority 3 — feature completion (in expert-panel-review order)

- [ ] Command Palette live search (PRs/issues/branches via GitHub API proxy) — currently only searches local repos
- [ ] Dependency Risk Scoring + reachability filter (panel item 1.4) — needs Syft/Grype integration
- [ ] Multi-repo bulk template actions (panel item 1.3) — UI pending
- [ ] DORA Dashboard polish — sparklines exist in Work Board but full dashboard deferred
- [ ] Technical Debt Tracker (panel item 2.4) — reuses Work Board infra
- [ ] AI Issue-to-PR Planner (panel item 2.1 plan-only mode)

### Priority 4 — polish / nice to have

- [ ] Sidebar nav entry for Work Board (currently only Header + Command Palette)
- [ ] App-level smoke test file that boots Express and hits every new endpoint
- [ ] MCP host (Phase 3.1 from panel) — expose our data as MCP server
- [ ] BYOKUpgradeBanner copy is currently in Portuguese — translate to English

## Known gotchas

1. `LICENSE_SIGNING_PRIVATE_KEY_PEM` must be set in prod if Stripe is enabled — `startup-secrets-check.js` now verifies this and aborts boot if missing.
2. `EMAIL_PROVIDER=console` silently succeeds in prod — set `EMAIL_PROVIDER=resend` for real delivery.
3. `AI_REQUIRE_USER_CONFIG=true` disables the shared `GEMINI_API_KEY` fallback — set this for multi-tenant SaaS.
4. Work Board only shows data once webhooks start flowing. The empty state explains this.
5. The audit log is append-only — any direct `INSERT`/`UPDATE`/`DELETE` fails the trigger. Always use `auditLog(req, ...)` or `auditLogDirect({ actor_user_id, action, entity_type, entity_id, metadata })`.
6. In dev, `WEBHOOK_SECRET` unset causes `verifyWebhookSignature` to return `true` (lenient). In production it returns `false` and startup-secrets-check enforces the key is set.
7. Work Board endpoints read `req.session.userLogin` (not `githubLogin` or `login`) — confirmed fixed in this session (C2).

## Key files changed this session

| File | Change |
|------|--------|
| `server/middleware/auth.js` | C1: `verifyWebhookSignature` dev-lenient when `WEBHOOK_SECRET` unset |
| `server/routes/work-board.js` | C2: read `req.session.userLogin` (was `githubLogin`) |
| `server/lib/startup-secrets-check.js` | C3: check `LICENSE_SIGNING_PRIVATE_KEY_PEM` when Stripe enabled |
| `server/lib/audit.js` | I2: new `auditLogDirect()` export for background tasks |
| `server/lib/retention.js` | I2: use `auditLogDirect()` instead of raw INSERT |
| `src/components/BYOKUpgradeBanner.jsx` | I4: skip fetch when `MOCK_MODE` is true |
| `.env.example` | Full overhaul — all undocumented vars documented |
| `server/config.js` | Zod schema extended to match `.env.example` |
| `README.md` | BYOK reframe — badges, tagline, AI section, FAQ, Recently Shipped |
| `docs/index.md` | Added Guides section + 5 new doc entries + 4 April-19 spec entries |
| `ROADMAP.md` | "Custom AI Model Selection" moved to Recently Shipped; BYOK/Work Board/SOC 2 added |
| `docs/security-hardening.md` | Fixed G2 "deferred" contradiction |
| `docs/specs/2026-04-19-next-session-handoff.md` | This file |

## Commands to run at session end

```bash
npx vitest run    # full suite — expect ~1473 pass / 0 fail
npm run lint      # eslint
```

Then manual smoke in browser before committing.
