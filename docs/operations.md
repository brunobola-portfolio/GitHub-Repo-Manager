# Operations Runbook

Day-two guide for people who run GitHub Repo Manager in production. For the
how-to-build side, see [`docs/index.md`](index.md).

## Contents

- [Quick reference](#quick-reference)
- [Release flow](#release-flow)
- [Dead-letter queues](#dead-letter-queues-email--webhook)
- [Public status page](#public-status-page)
- [Bundle budget](#bundle-budget)
- [Audit trail](#audit-trail)
- [Admin access](#admin-access)
- [Common incidents](#common-incidents)

---

## Quick reference

| Concern | Where |
| ------- | ----- |
| Live health | `GET /api/health/ready` and public [`/status`](#public-status-page) |
| Admin DLQ UI | `/admin/dlq` (requires `users.is_admin = 1`) |
| Admin DLQ CLI | `npm run admin:dlq -- --help` |
| Release notes | [`CHANGELOG.md`](../CHANGELOG.md) + [GitHub Releases](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/releases) |
| Security boundaries | [`docs/security-hardening.md`](security-hardening.md) (G1–G9) |
| Env reference | [`.env.example`](../.env.example) |
| CI pipelines | `.github/workflows/` (`ci.yml`, `deploy.yml`) |

---

## Release flow

Releases are cut from `main` as annotated tags. CI + Deploy workflows must be
green before and after the tag.

1. Confirm `main` is green: `gh run list --branch main --limit 3 --workflow CI`.
2. Update `CHANGELOG.md` with a new dated section under `[Unreleased]`
   (Keep-a-Changelog format). Move the Unreleased compare-link anchor.
3. Bump `package.json` `version` to match.
4. If the "What's new in v..." link in `README.md` points to the previous
   tag, refresh it.
5. Commit as `chore(release): vX.Y.Z` (no `Co-Authored-By` lines per
   [CLAUDE.md](../CLAUDE.md)).
6. Tag: `git tag vX.Y.Z && git push origin main vX.Y.Z`.
7. Watch CI: `gh run watch <id> --exit-status`.
8. GitHub Release notes are generated from the tag — attach the relevant
   `CHANGELOG.md` section.

**Do not force-push tags.** If a release is wrong, cut a `vX.Y.(Z+1)` patch.

---

## Dead-letter queues (email + webhook)

Two sources of failed async work land in DLQs — both replayable.

- **Email DLQ** (`email_dead_letter` table). Populated by `server/lib/email.js`
  when Resend rejects terminally (4xx that isn't rate-limit) or the retry
  budget is exhausted. Each row carries the full payload and the last error.
- **Webhook DLQ** (`webhook_events_dead_letter` table). Populated by the
  signature-verified ingest path when handler logic throws after the event
  is already committed to the inbox.

### CLI

```bash
npm run admin:dlq -- --help                 # subcommands
npm run admin:dlq -- summary                # counts by source + resolved state
npm run admin:dlq -- list --source email    # list unresolved email entries
npm run admin:dlq -- retry --id 42          # re-invoke the original handler
npm run admin:dlq -- resolve --id 42        # soft-delete (keeps audit trace)

npm run admin:dlq:sweep                     # dry-run: hard-delete resolved > 30d
npm run admin:dlq:sweep -- --apply          # actually delete
```

All retry/resolve mutations are written to the SOC 2 CC7.2 audit chain
(`audit_log_v2`) under category `dlq.*`.

### UI

`/admin/dlq` — tabs for Email / Webhook, filter (All / Unresolved / Resolved),
per-row Retry + Resolve, side-panel detail with full payload. Chunk is
lazy-loaded (~4.5 KB gzip) and gated behind `requireAdmin` on the server and
`useIsAdmin()` on the client (fail-closed when `users.is_admin !== 1`).

### When to retry vs. resolve

| Symptom | Action |
| ------- | ------ |
| Resend was down, failed 5xx | Retry (provider came back) |
| Webhook handler threw on a transient upstream error | Retry |
| Payload has a permanent bad field (malformed event from a retired integration) | Resolve (document in the commit) |
| Duplicate of an already-processed event | Resolve |

If the retry throws again, the DLQ row updates with the new error — inspect
the stored error before retrying a third time.

---

## Public status page

`/status` is unauthenticated, renders from `src/components/PublicStatus/StatusPage.jsx`,
and polls `GET /api/health/ready` every 30 s. It ships in its own chunk
(~2 KB gzip) and is linked from the footer of every page.

- **Green pill** — all checks return `ok`.
- **Amber pill** — at least one check is `degraded`; the per-check table
  shows which. Typically GitHub-rate-limit or BYOK-provider degradation.
- **Red pill** — `/api/health/ready` returned 5xx or the endpoint is
  unreachable. The app itself is down — check your load balancer first.

The status indicator also appears in the header (`useSystemHealth`) for
logged-in users, with a popover listing the failing checks.

Add or remove checks in `server/routes/health.js`. Each check should be
read-only and timeout-bounded (default 2 s).

---

## Bundle budget

`scripts/check-bundle-size.mjs` enforces per-chunk gzip budgets after `npm
run build`:

| Chunk | Budget (gzip) |
| ----- | ------------- |
| main | 60 KB |
| vendor-react | 65 KB |
| vendor-ui | 35 KB |
| vendor-icons | 20 KB |
| WorkBoardPage | 20 KB |

If the script fails, run `npm run build:analyze` to open the
`rollup-plugin-visualizer` treemap and identify the regression. Common
causes: importing a new icon pack into `main` instead of `vendor-icons`,
inlining a markdown/shiki module that should be lazy-loaded, or a
non-tree-shaken util dragging a big transitive dep.

---

## Audit trail

Every privileged mutation (admin actions, DLQ retries, license operations,
migration state changes) lands in `audit_log_v2` as a SOC 2 CC7.2
hash-chained event:

- Each row stores `actor_id`, `category`, `action`, `payload` (JSON), and a
  `prev_hash` + `this_hash` linking the row to the previous one.
- A chain break (mismatched `this_hash`) indicates tampering — chain
  integrity can be verified with `npm run audit:verify` (wraps
  `server/scripts/verify-audit-chain.mjs`).
- Rows are append-only; there is no API surface that updates or deletes
  audit entries.

---

## Admin access

Administrative endpoints require `users.is_admin = 1`. This is intentionally
distinct from subscription tier (`pro`, `enterprise`) — paying customers
are not operators.

```bash
npm run admin:grant -- --login <github-login>
npm run admin:revoke -- --login <github-login>
```

Granting admin is audit-logged. The flag is read on every request
(`requireAdmin` queries the users table, not the session), so revocation
takes effect immediately.

---

## Common incidents

### "All tabs in RepoDetail show a spinner forever"

Fixed in v3.7.1 — `useRepoDetail` returned a non-memoised object, so
`useTabData`'s `[api, filter]` deps caused an abort-retry loop. If a similar
symptom appears elsewhere, check that any hook returning multiple callbacks
wraps the return in `useMemo` with all callback refs as deps.

### CSRF 403 on every mutation after a deployment

Symptoms: every POST/PATCH/PUT/DELETE returns 403 `csrf_invalid` right
after a deploy. The session cookie from the old process encodes a CSRF
token that the new process rejects because `SESSION_SECRET` rotated.

- Short-term: users re-login, or the client retries once after fetching
  `GET /api/auth/csrf-token`.
- `fetchWithRetry` already implements the auto-retry (`src/utils/api.js`).

### Stripe webhook retries duplicating licenses

Fixed in v3.6.0 (B2). If it reappears: confirm the webhook handler still
uses a synchronous better-sqlite3 transaction + explicit
`forgetIdempotency()` on async failure. Do **not** wrap the idempotency
write in an async callback.

### GitHub API circuit breaker open

Pattern: every GitHub-backed endpoint suddenly returns 503 with
`breaker_open`. The client tripped after 5 failures in 60 s and will stay
open for 30 s. Usually GitHub was briefly degraded — wait it out. If it
doesn't recover, check the logs for the underlying status code.

### DLQ filling up

Check the status page first — if email / webhook providers are degraded,
expect DLQ growth. Once recovered: `npm run admin:dlq -- summary` to size
the backlog, then `admin:dlq -- list` + `retry` in batches. For a large
backlog, script the retry loop against the CLI output (stable flags).

After the incident, run `npm run admin:dlq:sweep` to hard-delete resolved
rows older than the retention window.
