# GitHub Event Ingestion Pipeline (Phase E1)

## What it is

A webhook sink that captures GitHub repository events into four SQLite tables,
providing the foundational data layer for upcoming features:

- **Work Board** (cross-org PR / issue queue) — E3
- **DORA Metrics** (deploy frequency, MTTR) — E2+
- **Tech Debt tracking** — uses PR/issue lifecycle data
- **Dependency Risk** — uses PR metadata

No aggregation queries or UI exist yet — those are E2 (aggregation) and E3
(first Work Board consumer).

## Webhook setup

1. In your GitHub repository (or organisation) settings, go to
   **Webhooks → Add webhook**.
2. Set **Payload URL** to:
   ```
   https://your-domain/api/v1/webhooks/github
   ```
   (or `/api/webhooks/github` — both routes are equivalent)
3. Set **Content type** to `application/json`.
4. Set **Secret** to the same value as your `WEBHOOK_SECRET` environment
   variable on the server.
5. Under **Which events**, select **Let me select individual events** and
   enable:
   - Pull requests
   - Pull request reviews
   - Issues
   - Deployments (and Deployment statuses)

## Environment variable

| Variable         | Description                                         |
|------------------|-----------------------------------------------------|
| `WEBHOOK_SECRET` | Shared secret for HMAC-SHA256 signature verification |

No new scopes or GitHub App permissions are required — webhooks are
configured on the GitHub side with just the URL and secret.

## Events subscribed

| GitHub event type    | Actions captured                                                          |
|----------------------|---------------------------------------------------------------------------|
| `pull_request`       | opened, closed, reopened, review_requested, review_request_removed, assigned, unassigned, labeled |
| `pull_request_review`| submitted, dismissed                                                      |
| `issues`             | opened, closed, reopened, assigned, unassigned, labeled                   |
| `deployment_status`  | all states (success, failure, pending, in_progress, error)                |

## Tables

| Table                | Purpose                                                            |
|----------------------|--------------------------------------------------------------------|
| `pr_events`          | One row per PR lifecycle event. Tracks author, title, refs, merge state, reviewer/assignee lists. |
| `issue_events`       | One row per issue lifecycle event. Tracks author, assignees (JSON), labels (JSON). |
| `deployment_events`  | One row per deployment status change. Stores environment, state, SHA, ref. Used for DORA deploy frequency and MTTR. |
| `review_assignments` | Active review queue. One row per (repo, PR, reviewer). Updated as reviews are requested, submitted, or the PR closes. Enables "all PRs awaiting my review across the org" queries. |

All tables use `UNIQUE (github_event_id)` on the `X-GitHub-Delivery` header
value to ensure idempotency — GitHub retries are harmless.

## What is NOT here yet

- **Aggregation queries** — DORA metrics computation, Work Board roll-ups
  (Phase E2).
- **UI consumers** — Work Board component, DORA dashboard panels (Phase E3).
- **Scheduled backfill** — historical data can be seeded via the GitHub REST
  API in a future task.
- **Queue / retry layer** — handlers run synchronously inside the webhook
  process. BullMQ can be added in E2 if write latency becomes an issue at
  scale.

## Handler architecture

```
/api/v1/webhooks/github
  └─ githubEventsWebhookHandler (routes/github-events-webhook.js)
       ├─ verifyWebhookSignature (HMAC-SHA256, timing-safe)
       ├─ res.json({ received: true })   ← sent BEFORE handler runs
       └─ HANDLERS[eventType].handle(payload, deliveryId)
            ├─ pull_request     → lib/github-events/pull_request.js
            ├─ pull_request_review → lib/github-events/pull_request_review.js
            ├─ issues           → lib/github-events/issues.js
            └─ deployment_status → lib/github-events/deployment_status.js
```

The 200 response is returned immediately after signature verification. Handler
processing is asynchronous — if a handler throws, the error is logged but
GitHub never sees a non-2xx response and will not retry.
