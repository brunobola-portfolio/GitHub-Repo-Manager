# Work Board

The Cross-Repo Work Board gives engineers and team leads a single view of all
review assignments, open issues, stale PRs, and DORA engineering metrics across
every tracked repository.

## What the Work Board shows

| Tab | Who can see it | Description |
|-----|---------------|-------------|
| **My Reviews** | Free+ | PRs where you are a requested reviewer and the review is still pending |
| **Stale PRs** | Pro+ | Open PRs that have not been merged or closed within a configurable threshold (default 7 days) |
| **My Issues** | Free+ | Open issues that are assigned to your GitHub login |
| **Review Load** | Pro+ | Per-reviewer submitted vs pending counts over the last 30 days — stacked-bar view to spot imbalanced review queues |
| **Tech Debt** | Pro+ | Open issues labelled `tech-debt`, `technical-debt`, `technical debt` (with space), `debt`, `refactor`, `refactoring`, `code-smell`, or `cleanup`, grouped by repo with hotspot ranking |
| **DORA** | Enterprise+ | Four-metric dashboard: deploy frequency, lead-time p50/p90, change failure rate, MTTR p50/p90 — plus CSV export |

## Pricing tier gating

| Feature | Free | Pro | Enterprise |
|---------|------|-----|------------|
| My Reviews | Yes | Yes | Yes |
| My Issues | Yes | Yes | Yes |
| Stale PRs | — | Yes | Yes |
| Review Load | — | Yes | Yes |
| Tech Debt | — | Yes | Yes |
| DORA — deploy frequency | — | — | Yes |
| DORA — lead time (p50/p90) | — | — | Yes |
| DORA — change failure rate | — | — | Yes |
| DORA — MTTR (p50/p90) | — | — | Yes |
| DORA — CSV export | — | — | Yes |

Users who attempt to access a higher-tier tab see an "Upgrade" card with a link
to the pricing page.

## How it works — the ingestion pipeline

The Work Board is powered by a three-layer pipeline:

```
GitHub webhooks
       │
       ▼
E1: Event ingestion  (server/routes/github-events-webhook.js)
       │  pr_events, issue_events, deployment_events, review_assignments
       ▼
E2: Aggregation queries  (server/lib/event-aggregations.js)
       │  listMyPendingReviews, listStalePRs, listMyOpenIssues,
       │  deployFrequency, leadTimeForChanges, reviewLoadByReviewer
       ▼
E3: Work Board API + UI  (server/routes/work-board.js + src/components/WorkBoard/)
```

No data appears until at least one webhook delivery has been processed.

## API endpoints

All endpoints live under `/api/v1/work-board/` and require an authenticated
session.

| Method | Path | Tier | Notes |
|--------|------|------|-------|
| GET | `/my-reviews` | Free+ | `?limit=N` |
| GET | `/my-issues` | Free+ | `?limit=N` |
| GET | `/stale-prs` | Pro+ | `?staleAfterDays=7&repoIds=1,2,3&limit=50` |
| GET | `/review-load` | Pro+ | `?since=ISO&repoIds=…` |
| GET | `/deploy-freq` | Enterprise+ | `?environment=production&since=ISO&repoIds=…` |
| GET | `/lead-time` | Enterprise+ | `?since=ISO&repoIds=…` |

## Webhook setup

To start populating the Work Board, register a GitHub webhook for each
organisation or repository you want to track:

1. Go to **Settings → Webhooks** in your GitHub organisation.
2. Set the Payload URL to `https://<your-host>/api/v1/webhooks/github`.
3. Set Content type to `application/json`.
4. Set the **Secret** to the value of your `WEBHOOK_SECRET` environment variable.
5. Select **individual events**: `Pull requests`, `Pull request reviews`,
   `Issues`, `Deployments`, `Deployment statuses`.

See also: `docs/event-ingestion.md` for the full ingestion reference.

## MOCK_MODE

When `VITE_MOCK_MODE=true` (the default in demo mode) the Work Board renders
with synthetic data — 5 pending reviews, 10 stale PRs, sample DORA metrics —
without making any backend calls. This lets the UI render in a demo environment.
