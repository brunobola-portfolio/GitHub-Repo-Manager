# Admin DLQ Guide

Operator walkthrough for the email and webhook dead-letter queues introduced
in v3.6.0 and wrapped with UI + CLI in v3.7.0. Quick reference lives in
[`docs/operations.md`](../operations.md#dead-letter-queues-email--webhook);
this page is the deep dive.

## What's in each queue

### Email DLQ — `email_dead_letter`

Populated by `server/lib/email.js` when:

- Resend returns a non-retriable 4xx (malformed address, blocked recipient).
- The retry budget is exhausted (default 4 attempts with exponential backoff).
- Resend is reachable but returns a persistent 5xx on every retry.

Row shape:

| Column | Meaning |
| ------ | ------- |
| `id` | Auto-increment PK. |
| `to_address` | Original recipient. |
| `template_name` | e.g. `license-issued`, `payment-failed`. |
| `payload_json` | Template variables, resolved subject/body. |
| `last_error` | The terminal error string returned by Resend. |
| `attempts` | Retry count before giving up. |
| `created_at`, `resolved_at` | Soft-delete via `resolved_at IS NOT NULL`. |

### Webhook DLQ — `webhook_events_dead_letter`

Populated by the signature-verified GitHub webhook ingest path when the
handler throws **after** the event was committed to the inbox (so we don't
ack the event to GitHub without some record of it).

Row shape:

| Column | Meaning |
| ------ | ------- |
| `id` | Auto-increment PK. |
| `event_type` | GitHub `X-GitHub-Event`, e.g. `pull_request`. |
| `delivery_id` | `X-GitHub-Delivery` header (unique per delivery). |
| `payload_json` | Raw payload. |
| `last_error` | Handler error + stack. |
| `created_at`, `resolved_at` | Same soft-delete pattern as email. |

## CLI

All subcommands live in [`server/scripts/admin-dlq.mjs`](../../server/scripts/admin-dlq.mjs) and share
[`_cli-utils.mjs`](../../server/scripts/_cli-utils.mjs) for argv parsing,
pretty tables, and confirm prompts. Zero runtime deps, Windows-portable.

### `summary`

```bash
npm run admin:dlq -- summary
```

```
source    unresolved   resolved (30d)
email            12                3
webhook           0                1
```

Use as a health signal. Any non-zero `unresolved` email count after Resend
recovery means there are still per-user permanent failures to triage.

### `list`

```bash
npm run admin:dlq -- list --source email
npm run admin:dlq -- list --source webhook --state resolved
npm run admin:dlq -- list --source email --limit 50
```

Default `--state unresolved`, `--limit 20`. Output is a fixed-column table
suitable for piping into other commands.

### `retry`

```bash
npm run admin:dlq -- retry --id 42
npm run admin:dlq -- retry --source email --id 42   # explicit source
```

Re-invokes the original handler with the stored payload. On success the row
is soft-deleted (`resolved_at` set). On failure the row's `last_error` and
`attempts` update.

### `resolve`

```bash
npm run admin:dlq -- resolve --id 42
```

Soft-delete without retrying. Use for:

- Duplicate events (GitHub redelivered).
- Malformed payloads that will never succeed.
- Events for a retired integration (e.g. user deleted the webhook).

Always commit a short note explaining the decision if you resolve more than
a handful at once — the audit chain records the action but not your reasoning.

### `sweep`

```bash
npm run admin:dlq:sweep                 # dry-run, prints what would be deleted
npm run admin:dlq:sweep -- --apply      # actually deletes
npm run admin:dlq:sweep -- --days 90    # custom retention window
```

Hard-deletes rows where `resolved_at < now - <days>`. Default is 30 days.
Dry-run is the default on purpose — rows with resolved context can still be
useful when investigating a pattern after the fact.

## UI (`/admin/dlq`)

Same data as the CLI, in a React page lazy-loaded behind a `requireAdmin` +
`useIsAdmin()` gate. Chunk size ≈ 4.5 KB gzip.

- **Tabs** Email / Webhook.
- **Filter** All / Unresolved / Resolved.
- **Row actions** Retry (solid button) and Resolve (ghost button). Both
  confirm via toast rather than a modal — the action is reversible by the
  audit chain if needed.
- **Detail drawer** opens a side-panel with the full payload (JSON tree) and
  the last error. Good for debugging without SQL access.

## Audit trail

Every retry / resolve lands in the SOC 2 CC7.2 hash-chained audit log
(`audit_log_v2`) under category `dlq.email.*` or `dlq.webhook.*`. The chain
is append-only — recovering a mis-resolved event means re-creating it from
the payload, not editing the audit row.

Verify chain integrity after a known-clean restore:

```bash
npm run audit:verify
```

## Troubleshooting

**"Retry says success but the email didn't arrive."**
Check the Resend dashboard — success here means the provider accepted the
payload, not that the user saw it. A subsequent Resend failure would
re-enqueue the row.

**"Two DLQ rows with the same `delivery_id`."**
The first handler throw committed to the inbox, GitHub redelivered, the
second handler throw added the duplicate. Retry one, resolve the other.

**"`list --source webhook` returns nothing but the summary shows 5
unresolved."**
Your `NODE_ENV` points at a different SQLite file than the running server.
CLI reads `DB_PATH` the same as the server — check both environments match.
