# GitHub Webhook Setup

The Cross-Repo Work Board, DORA metrics and Tech Debt tab are webhook-driven.
Without webhooks flowing in, the aggregation tables stay empty and every tab
shows the "No data yet — connect a webhook" hint. This guide walks through
configuring the webhook end-to-end.

---

## 1. Generate a strong `WEBHOOK_SECRET`

Webhook deliveries are authenticated with an HMAC-SHA256 signature that GitHub
computes over the raw request body using a shared secret. Generate a new one:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Copy the value into your `.env` file:

```
WEBHOOK_SECRET=<paste-here>
```

Restart the server so the new secret is picked up. In **development** the
secret is optional (`verifyWebhookSignature` short-circuits to `true`); in
**production** the startup check aborts if it is missing or shorter than 32
bytes.

---

## 2. Pick the right webhook target

| Scope | Events captured | Webhook at |
|-------|-----------------|------------|
| Single repo | Everything from that repo | `Repo → Settings → Webhooks → Add` |
| Entire organization | All repos under the org | `Org → Settings → Webhooks → Add` |

If you administer the org, the org-wide webhook is the low-effort option —
you will not have to configure one webhook per repository.

---

## 3. Create the webhook

In the GitHub UI:

1. **Payload URL:** `https://<your-domain>/api/v1/webhooks/github`
   - In local development behind ngrok / smee.io, use the tunnel URL.
   - Must be HTTPS in production. GitHub refuses `http://` except for
     `localhost`-style development tunnels that advertise HTTPS.
2. **Content type:** `application/json` — required. The server parses the body
   as JSON; form-url-encoded deliveries will 400.
3. **Secret:** paste the `WEBHOOK_SECRET` from step 1.
4. **SSL verification:** Enable. Disable only when pointing at a dev tunnel
   with a self-signed cert.
5. **Which events would you like to trigger this webhook?**
   Select **"Let me select individual events"** and tick:
    - `Pull requests`
    - `Pull request reviews`
    - `Issues`
    - `Deployment statuses`
    - (Optional) `Workflow runs` — only if you want the Actions dashboard
      populated.
6. **Active:** leave checked.
7. Click **Add webhook**.

---

## 4. Verify the handshake

GitHub immediately sends a `ping` delivery. Expected outcome:

- **Recent Deliveries** shows a green checkmark next to the ping.
- Response body: `{"success":true}` (200 OK).

If you see a red `401 Invalid webhook signature`, the secret does not match
the one in `.env`. Rotate one of them so they agree and redeliver from the
GitHub UI (click the failed delivery → **Redeliver**).

Manual probe from a shell (should answer 200):

```bash
curl -X POST https://<your-domain>/api/v1/webhooks/github \
  -H 'Content-Type: application/json' \
  -H 'X-GitHub-Event: ping' \
  -d '{}'
```

In **development** (no `WEBHOOK_SECRET` set) the same curl succeeds with
`200`. In **production** the same call without `X-Hub-Signature-256` fails
with `401` — the dev-lenient shortcut only applies when the secret is unset.

---

## 5. Wait for real events

Work Board tabs populate as GitHub delivers events:

| Tab | Event that writes data |
|-----|------------------------|
| My Reviews | `pull_request.review_requested` writes to `review_assignments` |
| Stale PRs | `pull_request.opened` (and the missing `closed`) |
| My Issues | `issues.opened` + `issues.assigned` |
| Review Load | `pull_request_review.submitted` flips `review_assignments.state` to `completed` |
| Tech Debt | `issues.labeled` with any of `tech-debt`, `technical-debt`, `technical debt`, `debt`, `refactor`, `refactoring`, `code-smell`, `cleanup` |
| DORA | `deployment_status` writes to `deployment_events` (deploy freq + lead time + CFR + MTTR) |

A freshly-installed webhook only sees events from its **install time
forward** — GitHub does not back-fill history. If a tab seems stuck on the
empty state, the fastest way to smoke-test is to push a dummy PR, request a
review, and refresh the Work Board.

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| 401 on every delivery | Secret mismatch | Rotate `WEBHOOK_SECRET` in both places, redeliver |
| 400 `Invalid JSON payload` | Content-type set to form-url-encoded | Change to `application/json` in the webhook UI |
| 200 but data never appears | Event checkbox not ticked | Edit the webhook, ensure `pull_request`/`issues`/`deployment_status` are enabled |
| Works in dev, 500s in prod | Startup check failing on secrets | Check server logs for the startup-secrets-check report; usually a missing `SESSION_SECRET`/`WEBHOOK_SECRET`/`EMAIL_PROVIDER` |
| GitHub shows "Recent deliveries → Delivery failed" | Server crashed or signature mismatch | The handshake layer (signature verification, JSON parsing) returns 5xx/4xx so GitHub will retry. Check logs for the root cause. |
| GitHub shows "Delivery succeeded" but data never lands | Handler failed after the 200 ack | `/api/v1/webhooks/github` uses a **fast-ack** pattern: we 200 the request and then dispatch handlers asynchronously so slow DB writes never block the response. A handler error is logged with `eventType`, `deliveryId`, `repoFullName` and the affected PR/issue number. Grep the logs for that delivery ID, fix the underlying cause, then hit **Redeliver** in the GitHub webhook UI to replay — every handler is idempotent via `INSERT OR IGNORE` on `github_event_id`. |

See [docs/event-ingestion.md](../event-ingestion.md) for the full list of
event tables and the schema each event writes to, and
[docs/work-board.md](../work-board.md) for the Work Board that consumes them.

---

## 7. Rotating the webhook secret

When rotating:

1. Generate a new secret with the command in step 1.
2. Update `.env` and restart the server. It now rejects deliveries signed
   with the old secret.
3. In the GitHub webhook UI, paste the new secret. Click **Update webhook**.
4. GitHub will start re-signing with the new secret on the next delivery.

If you need zero-downtime rotation (busy production webhook), run two app
instances briefly — one with each secret — behind a load balancer that
accepts either. GitHub does not support multiple secrets per webhook.
