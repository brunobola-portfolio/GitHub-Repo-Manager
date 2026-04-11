# License Mint Automation — Design Spec

**Status:** Draft · **Author:** Bruno Marques · **Date:** 2026-04-11
**Related:** [`docs/specs/2026-04-03-agpl-open-core-license-key-system.md`](2026-04-03-agpl-open-core-license-key-system.md) (original license key system), [`server/lib/license.js`](../../server/lib/license.js), [`scripts/generate-license.js`](../../scripts/generate-license.js), [`server/middleware/require-tier.js`](../../server/middleware/require-tier.js)

## Summary

GitHub Repo Manager ships under AGPL v3 with Pro/Enterprise features gated by signed Ed25519 license keys (see existing system in [`server/lib/license.js`](../../server/lib/license.js)). Today the only way to mint a license is to run `scripts/generate-license.js` locally with `keys/private.pem` on disk. This design automates that process through a GitHub Actions workflow so licenses can be minted from any device without copying the private key around, while keeping the private signing key protected in GitHub Secrets.

The design is explicitly **Phase 1** of a two-phase rollout: manual-trigger workflow for Bruno's own dev usage and early ad-hoc customer sales, with a clean migration path to a future VPS-hosted automation tied to Stripe checkout (Phase 2) that requires no rewrite — only moving secrets and adding an Express route.

## Goals

1. **Mint from any device** — Bruno can issue a license from any computer with a browser or `gh` CLI, without handling `private.pem` directly.
2. **Zero ongoing infrastructure cost** — no new hosted services required for Phase 1.
3. **Private key never leaves GitHub Secrets** — not stored on laptops, not committed to any repo, not transmitted in plaintext.
4. **Audit trail with permanent retention** — every mint recorded with metadata (not the key itself) in a separate private repo, readable via `git log`.
5. **Email delivery to recipient** — license key arrives at the destination inbox within seconds of minting.
6. **Reusable library for Phase 2** — when a VPS and site exist, the same code powers a `POST /api/admin/mint` route without duplication.

## Non-goals (explicit scope fence)

- ❌ Key rotation with `kid` header and multiple active public keys (deferred to Phase 2)
- ❌ Revocation list / CRL flow (file path reserved, no implementation)
- ❌ Stripe checkout → automatic mint wiring (deferred to Phase 2)
- ❌ Self-service customer portal (deferred, solved via site when it exists)
- ❌ Idempotency across duplicate mints (accepted: duplicate runs produce distinct valid keys)
- ❌ Automatic expiry warning emails (future nice-to-have)
- ❌ License management UI inside the Repo Manager app itself (audit repo is sufficient for Phase 1)

## Architecture

### The "one library, two wrappers" principle

All mint logic lives in a single module, [`scripts/lib/minter.js`](../../scripts/lib/minter.js) (new). Both Phase 1 (GitHub Actions) and Phase 2 (VPS Express route) are thin wrappers that invoke the same primitives. This guarantees zero divergence between environments and makes migration a pure deployment exercise.

```text
                    ┌─────────────────────────┐
                    │  server/lib/license.js  │  ← existing, small diff:
                    │  generateLicenseKey()   │    + kid header
                    │  validateLicenseKey()   │    + algorithms allowlist
                    └───────────┬─────────────┘
                                │
                                ▼
                    ┌─────────────────────────────────────┐
                    │  scripts/lib/minter.js (NEW)        │
                    │                                     │
                    │  Primitives (no orchestrator):      │
                    │    validateInput()                  │
                    │    mintLicense()                    │
                    │    deliverLicense()                 │
                    │    logMint(status)                  │
                    └──────┬────────────────────┬─────────┘
                           │                    │
                Phase 1    │                    │   Phase 2 (future)
                           ▼                    ▼
              ┌─────────────────────┐  ┌──────────────────────────┐
              │  scripts/           │  │  server/routes/admin/    │
              │  mint-license-      │  │  mint.js (NEW in Ph2)    │
              │  action.js (NEW)    │  │  POST /api/admin/mint    │
              │                     │  │                          │
              │  Composes           │  │  Composes primitives     │
              │  primitives:        │  │  with HTTP error map     │
              │  validate → mint    │  │                          │
              │  → logMint(pending) │  │  Note: deliverLicense    │
              │  → deliver          │  │  and logMint may use     │
              │  → logMint(delivrd) │  │  alternate impls on VPS  │
              └─────────┬───────────┘  └──────────┬───────────────┘
                        │                         │
                        ├─────────────┬───────────┤
                        ▼             ▼           ▼
              ┌──────────────┐  ┌─────────┐  ┌──────────────────┐
              │  Resend      │  │  GH     │  │  brunobola-      │
              │  (email      │  │  Action │  │  portfolio/      │
              │  delivery)   │  │  Summary│  │  license-log     │
              │              │  │  (masked│  │  (private repo,  │
              │              │  │  output)│  │  JSONL audit)    │
              └──────────────┘  └─────────┘  └──────────────────┘
```

### Components

| Component | State | Responsibility |
|---|---|---|
| [`server/lib/license.js`](../../server/lib/license.js) | **Existing, minor changes** | Core crypto: Ed25519 JWT sign + verify. Phase 1 adds `kid` header field and `algorithms: ['EdDSA']` allowlist on verify. See "Changes to `server/lib/license.js`" subsection below. |
| `scripts/lib/minter.js` | **New** | Primitives: `mintLicense`, `deliverLicense`, `logMint`, `validateInput`. Lives under `scripts/lib/` (not `server/lib/`) because it runs in GitHub Action VMs and in future Phase 2 Node contexts — it never loads as part of the running Express server. Exposes composable primitives only; there is **no** `orchestrateMint` god-function — composition is the caller's job. |
| `scripts/mint-license-action.js` | **New** | Thin Node CLI wrapper invoked from the GH Action. Composes the primitives in order: `validateInput → mintLicense → logMint(pending) → deliverLicense → logMint(delivered)`. Handles step-level errors explicitly and writes `$GITHUB_STEP_SUMMARY`. |
| `.github/workflows/mint-license.yml` | **New** | Defines `workflow_dispatch` + `repository_dispatch` interface with typed inputs, loads secrets, emits `::add-mask::` directives *before* Node runs, runs the script, and fires a failure notification on error. |
| [`scripts/generate-license.js`](../../scripts/generate-license.js) | **Existing, unchanged** | Local CLI fallback for emergency offline minting. Explicitly **not** refactored to import from `minter.js` — the "duplication" is only `generateLicenseKey()` which already lives in `license.js`. Leaving it standalone avoids "spooky action at a distance" where running the local CLI could accidentally trigger email/audit side effects. |
| `brunobola-portfolio/license-log` (private repo) | **New, separate** | Append-only `licenses.jsonl` audit trail with `status: pending\|delivered\|failed` per entry. Does **not** contain license keys — only `lid` + metadata. |

### Data flow (Phase 1 happy path)

1. Bruno opens GitHub → Actions → "Mint License" → Run workflow
2. Fills form: `tier`, `org`, `email`, optional `seats`/`months`/`notes`/`dry_run`
3. GitHub Actions runner starts:
   a. **Emits `::add-mask::` for `LICENSE_PRIVATE_PEM` in the workflow YAML before any other step runs.** This is a pure shell step — if subsequent steps crash with a stack trace that accidentally contains key material, GitHub's log processor still redacts it.
   b. Checks out the repo (pinned SHA via `actions/checkout`)
   c. Sets up Node 20, runs `npm ci --ignore-scripts --omit=dev`. `--ignore-scripts` prevents dependency postinstall hooks from executing in the same step that will soon have the signing secret available — a defense-in-depth mitigation against a compromised transitive dependency. `--omit=dev` trims the install footprint (the mint script depends only on `jose` at runtime).
   d. Runs `node scripts/mint-license-action.js` with secrets injected as env vars **only on this step** (not at the job level). `LICENSE_PRIVATE_PEM` is read directly from `process.env` inside the Node script and passed to `jose.importPKCS8()` without ever touching the filesystem.
4. Inside the script (two-phase audit to prevent orphaned keys):
   a. `validateInput()` rejects malformed tier/email/months/seats/notes. Throws before any crypto.
   b. `mintLicense()` calls `generateLicenseKey()` → returns signed JWT + payload + fingerprint. First line of `mintLicense()` calls `core.setSecret(key)` equivalent (emits `::add-mask::`) so the key is redacted in any subsequent log line — even on exception stack traces.
   c. If `dry_run=true`: writes metadata-only line to `$GITHUB_STEP_SUMMARY`, exits success. Does **not** return the actual key string from `mintLicense()` in dry_run mode.
   d. Otherwise:
      i. `logMint({ status: 'pending' })` appends one line to `licenses.jsonl` via GitHub REST API with optimistic concurrency (`sha` from GET, retry on 409 up to 3 times). This records the `lid` **before** attempting delivery — if the email step later fails, the key can be reconciled from audit.
      ii. `deliverLicense()` POSTs to Resend API → email arrives at recipient inbox with plaintext key + setup instructions.
      iii. `logMint({ status: 'delivered', lid })` updates the same entry (or appends a supersede entry if same-line update is complex) to mark successful delivery.
5. Writes success summary to `$GITHUB_STEP_SUMMARY`: tier, org, `lid`, fingerprint, audit commit SHA, Resend message ID. Key itself is masked by step 3a.
6. If any step fails after 4d.i, an `if: failure()` step fires a Resend email to Bruno with the `lid` + fingerprint so the orphaned key can be manually recovered or revoked.

### Failure modes & degradation

The audit-pending pattern (write audit as `pending` *before* email, update to `delivered` after) makes every failure mode recoverable. The table below uses "S4b/c/d" to refer to steps 4b/4c/4d in the data flow above.

| Failure | When it happens | Observable state after | Recovery |
|---|---|---|---|
| `validateInput()` rejects input | Before S4b (any crypto) | No audit entry, no email, no key generated | Re-run with corrected input |
| `generateLicenseKey()` throws | In S4b | No audit, no email | Re-run; check `LICENSE_PRIVATE_PEM` secret integrity |
| `logMint(pending)` fails (GET/PUT 409 or 401) | S4d.i, before email | No audit entry for this run, no email | Retry-on-409 loop (3 attempts). If still failing, workflow aborts with clear error; Bruno fixes PAT/conflict, re-runs. |
| `deliverLicense()` fails (Resend 4xx/5xx/quota) | S4d.ii, after pending audit | Audit entry exists with `status: pending`, **no email delivered** | `if: failure()` step emails Bruno with `lid` + fingerprint. Bruno can: (a) retry just delivery via a minimal "resend" workflow against the existing `lid`, or (b) append a `revoked` entry and mint fresh. No silent key loss — every minted key is in the audit trail. |
| `logMint(delivered)` fails (GET/PUT race on same file) | S4d.iii, after email | Audit shows `status: pending` but customer already received key | Retry-on-409 loop. Customer already has working key; worst case audit shows `pending` forever (benign false negative). Manual reconciliation: grep audit for `pending` entries older than 1h, update status manually via direct commit. |
| Network timeout mid-step | Any | Depends on step | Re-run. Pending audit entries from failed runs are recoverable via manual reconciliation; email step is idempotent from the customer's perspective (they either got it or didn't). |
| `LICENSE_PRIVATE_PEM` secret missing/corrupted | Before S4b (jose.importPKCS8 throws) | No side effects | Fix secret, re-run |
| Concurrent runs of this workflow | Prevented by `concurrency: group: license-mint, cancel-in-progress: false` | Second run queues | N/A — serial execution guaranteed |
| Concurrent writes to audit from **other** sources (manual commit, Dependabot PR merging) | During S4d.i or S4d.iii GET-PUT race | 409 Conflict from GitHub API | Retry-on-409 loop in `logMint` (up to 3 attempts, refreshing `sha` each time). After 3 failures, workflow aborts; Bruno investigates the conflicting write. |
| Full GitHub Actions outage | N/A | No mints possible | Fall back to local `scripts/generate-license.js` on Bruno's machine (unchanged existing tool, uses disk-based `private.pem`). |
| Wedged workflow run | Hitting `timeout-minutes: 10` | Step killed at timeout | Re-run. Concurrency group releases on timeout. |

## Detailed design

### 1. `.github/workflows/mint-license.yml`

**Trigger:** `workflow_dispatch` with typed inputs. Also `repository_dispatch` with `types: [mint-license]` for future programmatic triggers (from the site or external services).

**Inputs:**

| Name | Type | Required | Default | Validation (enforced in `validateInput()`) |
|---|---|---|---|---|
| `tier` | choice | yes | `pro` | `pro` or `enterprise` (UI dropdown + allowlist) |
| `org` | string | yes | — | Non-empty, max 200 chars |
| `email` | string | yes | — | RFC 5322 regex + max 254 chars |
| `seats` | string | no | `1` | Positive integer, ≤ 10000 |
| `months` | string | no | `12` | Positive integer, **≤ 24** (capped lower than before to force natural key rotation cycles — see "Future work / Key rotation") |
| `notes` | string | no | `""` | Max 500 chars, stored JSON-encoded (never raw string concatenation into audit or email) |
| `dry_run` | boolean | no | `false` | If true: validate + mint in-memory, write metadata-only line to `$GITHUB_STEP_SUMMARY`, exit. **Does not return the key string from `mintLicense()`** — the dry-run code path short-circuits before the key field is populated in the return value, preventing accidental logging. |

**Concurrency:** `group: license-mint`, `cancel-in-progress: false`. Serializes runs of *this workflow*. Does **not** protect against concurrent writes to the audit repo from other sources (Dependabot, manual edits, future Phase 2 VPS writes) — that case is handled by the `sha`-based optimistic concurrency + retry-on-409 logic inside `logMint()`.

**Permissions:** `contents: read` at workflow level (minimum). Audit repo writes use the separate `LICENSE_LOG_PAT`, not `GITHUB_TOKEN`. All other permissions (`id-token`, `packages`, `actions`, `issues`, etc.) are implicitly denied by omission.

**Actor guard on `repository_dispatch`:** the job has `if: github.event_name == 'workflow_dispatch' || github.actor == github.repository_owner`. Prevents a leaked PAT with `contents: write` from being abused to mint licenses via `repository_dispatch` events fired by someone other than Bruno.

**Action version pinning:** `actions/checkout` and `actions/setup-node` pinned to full commit SHAs with the resolved semver in an inline comment. A new `.github/dependabot.yml` is added to this PR enabling `package-ecosystem: "github-actions"` with `directory: "/"` so SHAs are automatically bumped on upstream releases and maintainers don't regress to tag pins by copy-paste.

**Steps:**

```yaml
name: Mint License

on:
  workflow_dispatch:
    inputs:
      tier:
        type: choice
        options: [pro, enterprise]
        default: pro
      org:
        required: true
      email:
        required: true
      seats:
        default: '1'
      months:
        default: '12'
      notes:
        default: ''
      dry_run:
        type: boolean
        default: false
  repository_dispatch:
    types: [mint-license]

concurrency:
  group: license-mint
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  mint:
    # Only the repo owner can trigger via repository_dispatch. workflow_dispatch
    # is already maintainer-gated by GitHub's platform UI.
    if: github.event_name == 'workflow_dispatch' || github.actor == github.repository_owner
    runs-on: ubuntu-latest
    timeout-minutes: 10
    # Optional (recommended) — wrap in an environment with required reviewer
    # for click-to-confirm on every mint. Disabled in Phase 1 for solo-dev speed,
    # enabled before first real customer mint.
    # environment: production-mint
    env:
      # Exposed only to the single "Mint license" step below, never at job level.
      # We emit ::add-mask:: on this value in the first step so GitHub's log
      # processor redacts it even if a later step throws a stack trace containing it.
      LICENSE_PRIVATE_PEM: ${{ secrets.LICENSE_PRIVATE_PEM }}
    steps:
      - name: Pre-emptive secret masking
        # Runs BEFORE checkout/Node. Any subsequent step that accidentally prints
        # LICENSE_PRIVATE_PEM (e.g. via a stack trace) is redacted by the GH log
        # processor. Masking must happen at the workflow level, not inside Node,
        # because a crash during module load would precede any in-process masking.
        run: |
          echo "::add-mask::$LICENSE_PRIVATE_PEM"
      - uses: actions/checkout@<SHA>   # v4.x.x
      - uses: actions/setup-node@<SHA> # v4.x.x
        with:
          node-version: '20'
          cache: 'npm'
      - name: Install dependencies
        # --ignore-scripts: dependency postinstall hooks are disabled, mitigating
        #   supply-chain attacks that would otherwise run with LICENSE_PRIVATE_PEM
        #   in the environment.
        # --omit=dev: trims install to runtime deps only. The mint script depends
        #   on `jose` (already a runtime dep via server/lib/license.js).
        run: npm ci --ignore-scripts --omit=dev
      - name: Mint license
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          LICENSE_LOG_PAT: ${{ secrets.LICENSE_LOG_PAT }}
          AUDIT_REPO: ${{ vars.AUDIT_REPO }}  # Not a secret — repo name is not sensitive
          FROM_EMAIL: licenses@bolalabs.pt
          TIER: ${{ inputs.tier || github.event.client_payload.tier }}
          ORG: ${{ inputs.org || github.event.client_payload.org }}
          EMAIL: ${{ inputs.email || github.event.client_payload.email }}
          SEATS: ${{ inputs.seats || github.event.client_payload.seats }}
          MONTHS: ${{ inputs.months || github.event.client_payload.months }}
          NOTES: ${{ inputs.notes || github.event.client_payload.notes }}
          DRY_RUN: ${{ inputs.dry_run || github.event.client_payload.dry_run }}
          GITHUB_RUN_ID: ${{ github.run_id }}
          GITHUB_STEP_SUMMARY: ${{ github.step_summary }}
        # Script reads LICENSE_PRIVATE_PEM directly from process.env — the secret
        # never touches the filesystem of the runner.
        run: node scripts/mint-license-action.js
      - name: Notify on failure
        if: failure()
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
        run: |
          # Minimal failure ping to Bruno's inbox with the run URL.
          # Does NOT contain any license material — only "run X failed at step Y".
          node scripts/mint-failure-notify.js \
            --run-id "${{ github.run_id }}" \
            --repo "${{ github.repository }}" \
            --event "${{ github.event_name }}"
```

The actual SHAs resolve at implementation time. Dependabot will propose updates going forward.

### 2. `scripts/lib/minter.js` — primitives (no orchestrator)

**Location rationale:** this module lives under `scripts/lib/`, not `server/lib/`, because it never loads as part of the running Express server. It runs inside a GitHub Actions VM in Phase 1 and will later run inside a standalone Node process for Phase 2. Placing it under `server/lib/` would create a phantom server dependency and force the workflow to `npm ci` the entire backend dep tree.

**Design principle:** primitives only, no god-function. The `mint-license-action.js` CLI wrapper is the composition point. This gives the caller step-level error visibility (critical for the audit-pending recovery pattern) and keeps each primitive pure and independently testable.

```js
/**
 * Validate + normalize workflow inputs.
 * Runs before any crypto. Throws on invalid input with a descriptive error.
 *
 * Enforces:
 *  - tier ∈ {'pro', 'enterprise'}
 *  - org: non-empty, ≤ 200 chars
 *  - email: RFC 5322 regex, ≤ 254 chars
 *  - seats: integer, 1 ≤ seats ≤ 10000
 *  - months: integer, 1 ≤ months ≤ 24
 *  - notes: string, ≤ 500 chars (later JSON-encoded, never concatenated)
 */
export function validateInput(raw) {
  // Returns { tier, org, email, seats, months, notes } with types coerced.
  // Throws InputValidationError on any failure.
}

/**
 * Mint a license key. Pure function: no network, no filesystem, no logging.
 *
 * IMPORTANT: this function emits `::add-mask::<key>` as its FIRST action,
 * BEFORE returning, so even if the returned object is accidentally logged
 * or serialized in a stack trace downstream, GitHub's log processor
 * redacts the key string.
 *
 * In dry_run mode, the returned object has `key: null` — the key string
 * is never populated, so nothing to leak.
 */
export async function mintLicense(
  validatedInput,
  { privateKeyPem, dryRun }
) {
  // 1. Calls generateLicenseKey() from server/lib/license.js (unchanged core crypto)
  //    with validated input + currently-active kid
  // 2. Emits ::add-mask:: on the returned key string (unless dryRun)
  // 3. Returns { key, payload, fingerprint, kid } or { key: null, payload, fingerprint, kid } in dry-run
}

/**
 * Send a license key to the recipient via Resend.
 * Text-only email body (NOT HTML) to eliminate any stored-XSS risk
 * from attacker-controlled `notes` reaching an email client.
 */
export async function deliverLicense(
  { key, payload, recipient, fromEmail, resendApiKey }
) {
  // POSTs to https://api.resend.com/emails with text/plain body.
  // Returns { messageId }.
  // Throws DeliveryError on non-2xx response.
}

/**
 * Append or update an entry in licenses.jsonl via GitHub REST API with
 * optimistic concurrency (sha-based PUT + retry on 409).
 *
 * Two-phase audit pattern:
 *   - logMint({ status: 'pending', ...meta }) is called BEFORE deliverLicense
 *     — records the lid so delivery failures don't orphan keys.
 *   - logMint({ status: 'delivered', lid, messageId }) is called AFTER
 *     delivery succeeds — updates (or supersedes) the pending entry.
 *
 * All writes use JSON.stringify on the entry — `notes` is never concatenated.
 * Retry loop: up to 3 attempts on 409 Conflict, refreshing `sha` each time.
 * On 4th failure throws AuditWriteError with the last conflicting SHA.
 */
export async function logMint(
  { status, payload, fingerprint, notes, messageId, auditRepo, pat }
) {
  // Returns { commitSha, entryIndex }.
}
```

**What is NOT in this module:** there is no `orchestrateMint`. Composition happens in `scripts/mint-license-action.js` where step-level failures can be handled with the full context of what succeeded and what didn't. The expert architecture review flagged bundling these primitives into a single function as making the audit-pending recovery pattern impossible to express.

**Error types:** `InputValidationError`, `MintError`, `DeliveryError`, `AuditWriteError` — each extends `Error` with a `.step` field so the CLI wrapper and the Phase 2 Express route can map them to exit codes / HTTP status codes uniformly.

### 3. `scripts/mint-license-action.js` — CLI wrapper & composition point

This script is the **composition point** for the mint flow. It owns the sequencing, step-level error handling, and `$GITHUB_STEP_SUMMARY` output. The architecture review flagged this as the correct place for composition (vs. burying it in a `minter.js` orchestrator).

**Responsibilities (in order):**

1. **Read env vars** from `process.env`. Does not use `dotenv` (the GH Action injects them directly via the step's `env:` block).
2. **Read `LICENSE_PRIVATE_PEM` directly from `process.env`** — never touches the filesystem. Never stored in a variable that could be captured by `util.inspect()`.
3. **Call `validateInput(raw)`** on the inputs. Throws `InputValidationError` with clear messages on any failure → exit 2.
4. **Call `mintLicense(input, { privateKeyPem, dryRun })`**. `mintLicense()` internally emits `::add-mask::` on the key string before returning (belt-and-suspenders with the YAML-level masking). Throws `MintError` → exit 3.
5. **If `dry_run === true`:** writes a metadata-only summary line to `$GITHUB_STEP_SUMMARY` (no key, no fingerprint in full, just `tier`, `org`, `lid`, expiration date) and exits 0.
6. **`logMint({ status: 'pending', ... })`** — records the entry *before* delivery so orphaned keys are recoverable. Throws `AuditWriteError` → exit 4.
7. **`deliverLicense({ key, payload, recipient, fromEmail, resendApiKey })`** — sends the email. Throws `DeliveryError` → exit 5. **Crucially**, if this step fails, the process has ALREADY written a `pending` audit entry with the `lid`, so Bruno can reconcile manually.
8. **`logMint({ status: 'delivered', lid, messageId })`** — updates the pending entry. Throws `AuditWriteError` → exit 6. At this point the customer has the key and the audit is in an inconsistent state (`pending` forever, not fatal).
9. **Writes success summary to `$GITHUB_STEP_SUMMARY`** — tier, org, `lid`, fingerprint (masked in logs but visible in summary, which is more restricted), audit commit SHA, Resend message ID. The actual key is never written to the summary.
10. **Exit 0.**

**Error handling pattern:** each step catches its own primitive's error class, logs a structured message (to stderr, NOT stdout — to avoid any mixing with potential masked key output), and re-throws or exits with the matching code. The `if: failure()` step in the workflow YAML then sends Bruno a notification email.

**Target size:** ~100 lines including the error handling, summary formatting, and input/env validation. No longer "thin" — it's the place where all the operational knowledge lives.

### 3.1 `scripts/mint-failure-notify.js` — failure notifier

Small companion script (~30 lines) invoked by the `if: failure()` step in the workflow. Uses the same `RESEND_API_KEY` to send a plaintext email to Bruno's inbox with:

- The GH Actions run URL
- The event type (`workflow_dispatch` or `repository_dispatch`)
- The failed step name (if determinable from env)
- **No** license key or fingerprint material — the notification is about operational health, not licensing content

This is kept as a separate script (not part of `mint-license-action.js`) because the main script may have crashed before reaching its own error handler, so a completely independent process is needed.

### 4. Audit repo layout: `brunobola-portfolio/license-log`

```
license-log/                             (private, init-on-setup)
├── README.md
├── licenses.jsonl
├── revoked.jsonl                        (reserved, empty for Phase 1)
└── .github/
    └── workflows/
        └── validate.yml                 (validates JSONL integrity on push)
```

**`licenses.jsonl` entry schema** (one per line):

```json
{
  "ts": "2026-04-11T12:34:56Z",
  "status": "delivered",
  "lid": "lic_abc123xyz",
  "kid": "k-2026-04-11",
  "tier": "enterprise",
  "org": "Bola Labs Dev",
  "email": "bruno@bolalabs.pt",
  "seats": 100,
  "months": 24,
  "issuedAt": "2026-04-11T12:34:56Z",
  "expiresAt": "2028-04-11T12:34:56Z",
  "fingerprint": "SHA256:abcd...",
  "notes": "Dev self-license",
  "mintedBy": "github-actions",
  "runId": "1234567890",
  "messageId": "resend-msg-abc",
  "dryRun": false
}
```

**New fields added in this revision** (vs. the initial design):

- `status` — one of `pending`, `delivered`, `failed`, `revoked`. Enables the two-phase audit pattern that prevents orphaned keys when delivery fails mid-flow.
- `kid` — key ID of the signing private key. Allows future key rotation without breaking existing licenses (the validator picks the right public key by `kid`). Initially all entries have the same `kid`; this prepares for the Phase 2 multi-key migration.
- `messageId` — Resend message ID, populated only after successful delivery. Enables forensic lookup in Resend's send history.

**Fields deliberately absent:** the `key` string itself. This is non-negotiable — if the audit repo is ever compromised, the attacker gets metadata but no usable keys.

**Concurrency safety:** all writes to `licenses.jsonl` go through `logMint()` which uses the GitHub Contents API's `sha` field for optimistic concurrency. A GET-PUT race from concurrent writers (e.g., a Phase 2 VPS writer + this GitHub Action + a Dependabot-triggered automerge on a sibling file in the same repo) returns `409 Conflict`. `logMint()` retries up to 3 times with a fresh `sha` before throwing `AuditWriteError`. The JSONL append-only format means conflicts are resolvable by rebasing on the latest state.

**Two-phase write pattern:** the flow writes two entries per mint — `pending` before email, `delivered` after. The second write can either:

- **(a) Update-in-place** — read the file, find the pending line by `lid`, replace `status: pending` → `status: delivered`, PUT. Atomic from the git commit perspective.
- **(b) Supersede append** — append a new line with the same `lid` but `status: delivered`. The reader interprets the latest entry per `lid` as authoritative.

**Decision**: use **(b) supersede append** for Phase 1 because it's strictly append-only (no line replacement), keeps git diffs trivial (always +1 line, never -1 +1), and makes the audit tamper-evident by design (you can only add, never rewrite). The cost is that readers must collapse entries by `lid` at read time — trivial for <10k entries.

**`README.md`** of the audit repo contains:
- Current public key fingerprint (for cross-reference)
- Explanation of the JSONL schema
- Warning to never commit the private key here
- Pointer back to this spec

**`validate.yml`** runs on every push: ensures each line of `licenses.jsonl` is valid JSON, has all required fields, and that timestamps are ISO 8601. Catches human edits that break the format.

### 5. Email template

Sent via Resend to `input.email` with `from: licenses@bolalabs.pt`:

```
Subject: Your GitHub Repo Manager license key

Hi,

Your license for GitHub Repo Manager is ready.

License Key:
grm_lic_<long_base64url_string>

Details:
  Tier:       Enterprise
  Organization: Bola Labs Dev
  Seats:      100
  Issued:     2026-04-11
  Expires:    2036-04-11

To activate, add this line to your .env file:

  LICENSE_KEY=grm_lic_<long_base64url_string>

Then restart the server. To verify activation, check the server logs for:

  License validated: enterprise tier (org: Bola Labs Dev, expires: 2036-04-11)

Questions? Reply to this email.

— Bola Labs
```

**Important:** the email body is **plaintext only**, never HTML. The `notes` input is attacker-controlled (via the `workflow_dispatch` form, which anyone with write access to the repo can use) and this eliminates any stored-XSS risk from a crafted `notes` value reaching a customer's email client that renders HTML. Resend supports both text/plain and text/html bodies; `deliverLicense()` explicitly uses text/plain.

The template is hardcoded in `deliverLicense()` for Phase 1. A future iteration can externalize it to a template file when the product supports multiple locales or custom branding per customer.

### 6. Changes to `server/lib/license.js`

The initial spec draft claimed this file was "unchanged". Expert security review flagged 3 small additions that should land in the same PR as Phase 1 to avoid painting the system into a corner:

**6.1 Add `kid` field to JWT header on sign**

Today `generateLicenseKey()` emits a JWT with a header containing only `alg` and `typ`. Phase 1 adds a `kid` (key ID) field derived from the fingerprint of the signing public key (or a static identifier like `k-2026-04-11` for the initial keypair). The change is ~5 lines.

```js
// Before:
new jose.SignJWT(payload).setProtectedHeader({ alg: 'EdDSA' })

// After:
new jose.SignJWT(payload).setProtectedHeader({ alg: 'EdDSA', kid: getActiveKid() })
```

**Why now, even with only one keypair:** when key rotation eventually happens (Phase 2+), the validator needs to pick the right public key per-license. Without `kid`, every license signed before rotation becomes unverifiable after rotation. Adding `kid` now costs ~5 lines and makes future rotation a non-breaking change.

**6.2 Add explicit `algorithms` allowlist on verify**

Today `validateLicenseKey()` calls `jwtVerify(jwt, key)` without specifying which algorithms are accepted. `jose` infers from the key type (Ed25519 → EdDSA only), so this is currently safe — but it's one unrelated refactor away from introducing an algorithm confusion vulnerability (the class of bugs where HS256 keys get interpreted as asymmetric public keys and signatures are accepted incorrectly).

```js
// Before:
const { payload } = await jwtVerify(jwt, key)

// After:
const { payload } = await jwtVerify(jwt, key, { algorithms: ['EdDSA'] })
```

One-line seatbelt against future regressions. Referenced by OWASP JWT guidance.

**6.3 Resolve public key by `kid` at verify time**

To consume the new `kid` field, `validateLicenseKey()` accepts a key-lookup function instead of (or in addition to) a single static public key:

```js
// Phase 1: one key, function returns it regardless of kid
const resolveKeyByKid = (kid) => DEFAULT_PUBLIC_KEY

// Phase 2: multi-key map
const resolveKeyByKid = (kid) => KEY_MAP.get(kid) ?? throw new Error('Unknown kid')
```

[`server/middleware/require-tier.js`](../../server/middleware/require-tier.js) updates its call site to pass `resolveKeyByKid`. The existing single-key behavior is preserved for Phase 1 — `resolveKeyByKid` always returns the one known key and ignores the `kid` field. Phase 2 will fill this in.

**Scope of the change to `license.js`:** ~20 lines added, existing tests updated to pass `resolveKeyByKid` and to assert the presence of `kid` in signed outputs. Existing license key format is backward-compatible: old keys without `kid` can still be parsed (header fields are optional per JWT spec).

### 7. Secrets and variables required in the public repo

| Name | Type | Purpose | Source |
|---|---|---|---|
| `LICENSE_PRIVATE_PEM` | Secret | Ed25519 private key to sign licenses | Contents of `keys/private.pem` (one-time copy from local keypair) |
| `RESEND_API_KEY` | Secret | Email delivery auth (used by both `mint-license-action.js` and `mint-failure-notify.js`) | Created in Resend dashboard, single-scope (Send emails only) |
| `LICENSE_LOG_PAT` | Secret | Commit access to `brunobola-portfolio/license-log` | Fine-grained GitHub PAT, scoped to single repo, `contents: write` only (note: fine-grained PATs grant read alongside write for Contents — blast radius acceptable because the audit repo never contains sensitive key material), 1-year expiry |
| `AUDIT_REPO` | **Variable** | Audit repo name (`brunobola-portfolio/license-log`) | Stored as a repo-level variable (`vars.AUDIT_REPO`), not a secret — the value is not actually sensitive and storing as a variable makes it visible in the Actions UI for sanity-checking |

## Testing plan

### Unit tests (`scripts/__tests__/minter.test.js`, new)

- `mintLicense`: with a known test keypair, verify the round-trip (generate → validate) returns the same payload and that the fingerprint matches `sha256(public.pem)`.
- `deliverLicense`: with `global.fetch` mocked, verify:
  - POST URL is `https://api.resend.com/emails`
  - Authorization header is `Bearer ${RESEND_API_KEY}`
  - Body contains `from`, `to`, `subject`, `text`
  - Non-2xx response throws with status code in message
- `logMint`: with `global.fetch` mocked, verify:
  - GET request to the correct audit file URL
  - PUT request with base64-encoded contents + commit message
  - New line is appended (not replacing existing content)
  - Failed GET on 404 (empty file case) creates a new file correctly

### Integration test (manual, one-time on setup)

Described in "Setup checklist" below. The first `dry_run` workflow run *is* the integration test.

### Security tests

- Run `scripts/mint-license-action.js` with a deliberately leaked private key in verbose mode to verify masking works (key never appears in plaintext stdout/stderr).
- Attempt to exfiltrate `LICENSE_PRIVATE_PEM` from within the workflow via a fake PR — GitHub's built-in policy (secrets not exposed to fork PRs) must block this. Documented as "verified by GH platform", not tested by us.

## Setup checklist (one-time, ~25 minutes)

1. **Backup `keys/private.pem`** to at least two locations:
   - Encrypted entry in 1Password (or Bitwarden, etc.)
   - Encrypted USB drive stored offline
   - Verify both backups are readable before proceeding.

2. **Create Resend account** at resend.com:
   - Add domain `bolalabs.pt`
   - Add the SPF, DKIM, and MX records from Resend to your Cloudflare (or DNS provider) for `bolalabs.pt`
   - Wait 5–10 minutes, confirm "verified" status in Resend
   - Create API key with scope "Send emails" only → save for step 5

3. **Create private GitHub repo** `brunobola-portfolio/license-log`:
   - Visibility: private
   - Initialize with a README
   - Add empty `licenses.jsonl` file
   - Add empty `revoked.jsonl` file
   - Edit README to include the current public key fingerprint (obtain with: `openssl pkey -pubin -in keys/public.pem -outform DER | openssl dgst -sha256`)

4. **Create Fine-Grained Personal Access Token** at github.com/settings/tokens?type=beta:
   - Resource owner: `brunobola-portfolio`
   - Repository access: only `license-log`
   - Repository permissions: `Contents: Read and write` (nothing else)
   - Expiration: 1 year (set a calendar reminder to rotate)
   - Save the token for step 5

5. **Add three Secrets** to `brunobola-portfolio/GitHub-Repo-Manager` repo settings (Settings → Secrets and variables → Actions → Secrets):
   - `LICENSE_PRIVATE_PEM` → paste contents of `keys/private.pem`
   - `RESEND_API_KEY` → from step 2
   - `LICENSE_LOG_PAT` → from step 4

   Then add **two repository Variables** (Settings → Secrets and variables → Actions → Variables):
   - `AUDIT_REPO` → `brunobola-portfolio/license-log` (plaintext is fine — audit repo name is not sensitive, and storing as a variable makes it visible in the Actions UI for sanity-checking)
   - `LICENSE_KID` → `k-2026-04-11` (or any date-stamped identifier for the currently-active signing key — the workflow reads this via `${{ vars.LICENSE_KID || 'k-default' }}`, so omitting it falls back to `k-default` but loses the date-based traceability intended by the design)

6. **Merge the implementation PR** (the plan that follows this spec will produce one PR adding `scripts/lib/minter.js`, `scripts/mint-license-action.js`, `scripts/mint-failure-notify.js`, `.github/workflows/mint-license.yml`, `.github/dependabot.yml`, tests, and the small additive changes to `server/lib/license.js` + `server/middleware/require-tier.js` for `kid` support).

7. **Run a dry-run test**:
   - Actions → "Mint License" → Run workflow
   - tier: `pro`, org: `Test`, email: `bruno@bolalabs.pt`, `dry_run: true`
   - Verify: action succeeds, log shows masked key, **no** email received, **no** audit commit created

8. **Run the first real mint** — a self-license for development:
   - tier: `enterprise`, org: `Bola Labs Dev`, email: `bruno@bolalabs.pt`, seats: `100`, months: `24`, `dry_run: false` (the 24-month cap is enforced by `validateInput` — see "Key rotation" under Future work for the rationale)
   - Verify: email arrives in inbox, audit commit appears in `brunobola-portfolio/license-log/licenses.jsonl`
   - Copy the `LICENSE_KEY` from the email into the local `.env` file
   - Set `VITE_MOCK_MODE=false`
   - Run `npm run dev:all`
   - Confirm backend log shows `License validated: enterprise tier (org: Bola Labs Dev, expires: 2036-04-11)`
   - Navigate to Teams → verify teams load without 403

## Phase 2 — Migration to VPS (future, documented here for continuity)

When bolalabs.pt has a VPS and the main site exists:

1. **Add Express route** in the site's backend that composes the primitives directly (same pattern as `scripts/mint-license-action.js`, just with HTTP error mapping instead of process exit codes):

   ```js
   // routes/admin/mint.js
   import {
     validateInput, mintLicense, deliverLicense, logMint,
     InputValidationError, DeliveryError, AuditWriteError,
   } from '../../scripts/lib/minter.js'

   router.post('/api/admin/mint', requireAdminAuth, async (req, res) => {
     try {
       const input = validateInput(req.body)
       const license = await mintLicense(input, {
         privateKeyPem: process.env.LICENSE_PRIVATE_PEM,
         dryRun: !!req.body.dry_run,
       })
       if (input.dryRun) return res.json({ lid: license.payload.lid, dryRun: true })
       await logMint({ status: 'pending', ...license, auditRepo: ..., pat: ... })
       const delivery = await deliverLicense({ ...license, recipient: input.email, ... })
       await logMint({ status: 'delivered', lid: license.payload.lid, messageId: delivery.messageId, ... })
       res.json({ lid: license.payload.lid, messageId: delivery.messageId })
     } catch (e) {
       if (e instanceof InputValidationError) return res.status(400).json({ error: e.message })
       if (e instanceof DeliveryError) return res.status(502).json({ error: 'Delivery failed', lid: e.lid })
       if (e instanceof AuditWriteError) return res.status(500).json({ error: 'Audit write failed' })
       throw e
     }
   })
   ```

   **Honest caveat on "zero refactor":** `mintLicense()` reuses unchanged. `deliverLicense()` may need an alternate implementation if Phase 2 uses a different provider (e.g., Postmark) or custom per-customer branding. `logMint()` may swap from GitHub REST to a local SQLite or filesystem append for lower latency. The architecture review flagged "zero refactor" as overly optimistic — the honest claim is "mint reuses, deliver and audit may need alternate impls".

2. **Copy secrets** from GitHub Secrets to VPS environment (via Fly.io secrets, systemd drop-in, SOPS, or whatever secret management the VPS uses).

3. **Wire Stripe webhook** handler to compose the primitives on `checkout.session.completed` events for self-hosted price IDs, with `months` matching the billing period.

4. **Run both paths in parallel for 1–3 months** — GitHub Actions remains as a warm backup. Manual mints still work via the action.

5. **Cut over** when confident:
   - Remove `LICENSE_PRIVATE_PEM`, `RESEND_API_KEY`, and `LICENSE_LOG_PAT` from GitHub Secrets
   - Leave the workflow YAML file committed but disable the workflow (or add a `if: false` guard) for emergency re-activation

**What does not change in Phase 2:**

- `server/lib/license.js` (crypto primitives)
- `scripts/lib/minter.js` `mintLicense()` + `validateInput()` (unchanged)
- `licenses.jsonl` schema and audit repo layout
- Format and validity of issued license keys
- `kid` field in JWT headers (introduced in Phase 1, forms the basis for Phase 2 key rotation)

**May change in Phase 2:** `deliverLicense()` and `logMint()` implementations may be swapped for alternate backends (different email provider, local DB audit) while preserving the same function signatures.

## Future work (out of scope for Phase 1)

These are documented so the Phase 1 implementation doesn't paint the design into a corner:

### Key rotation

Phase 1 lands the **infrastructure** for rotation (see §6 "Changes to `server/lib/license.js`"): `kid` field in signed JWT headers, `resolveKeyByKid` lookup at verification, `kid` captured in the audit `licenses.jsonl` schema. What remains for Phase 2+:

**Proper solution (Phase 2+):**

- Store multiple public keys in `keys/public-*.pem` or in a JSON manifest `keys/pubkeys.json`
- `resolveKeyByKid` actually routes by `kid` (Phase 1 stub ignores `kid` and returns the single key)
- Old keys can be marked deprecated and eventually removed when no outstanding licenses use them

**Why not implement multi-key now:** single-keypair operation is acceptable for the first 6-12 months (zero to small number of customers). The Phase 1 `kid` plumbing means when rotation becomes necessary, it's a pure configuration change — no wire-format migration required.

**Recovery posture without rotation (Phase 1):** if the private key leaks before Phase 2 rotation is implemented, the playbook is: (1) generate a new keypair, (2) update `LICENSE_PRIVATE_PEM` in GH Secrets, (3) update `keys/public.pem` in the repo, (4) iterate the audit repo to find all `delivered` entries, (5) re-mint each with the new `kid`, (6) email each customer the new key. The `months ≤ 24` cap on license validity limits this exposure to a maximum 24-month tail.

### Revocation list (CRL)

The `revoked.jsonl` file path is reserved in the audit repo. A future enhancement:
- On customer refund/breach, append a line `{"lid":"...","revokedAt":"...","reason":"..."}`
- `require-tier.js` runs a periodic job (daily?) to fetch `revoked.jsonl` from the audit repo
- Cached locally; licenses whose `lid` appears in the list are refused even if signature is valid

**Why not now:** no customers yet, and offline customers can't fetch revocation lists anyway. Requires thinking about the offline trust model.

### Stripe integration (Phase 2)

Phase 2 wires `checkout.session.completed` → the same primitives in `scripts/lib/minter.js` via a new webhook handler in the VPS backend. The mint code is ready today; the trigger isn't. **Billing alignment constraint**: when wiring Stripe, the `months` parameter passed to `mintLicense()` must match the billing period (monthly Stripe price → `months: 1`, annual Stripe price → `months: 12`). Mismatching these produces a user-visible bug where a customer paying monthly keeps access for 24 months after cancelling (until Phase 2 revocation ships). This constraint is documented here so Phase 2 implementation doesn't miss it.

### Self-service customer portal

When the bolalabs.pt site exists, customers can:

- View their active licenses
- Re-send the license key email if lost
- Upgrade tier (Pro → Enterprise) — triggers a new mint
- Cancel / mark as "not for production" to trigger revocation

All of this is orchestrated against the same `scripts/lib/minter.js` primitives plus the audit repo as source of truth.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| GitHub account compromised | Attacker can mint licenses | 2FA enforced on Bruno's account (baseline), backup of `private.pem` in 1Password allows rotation if needed, optional `environment: production-mint` gate adds click-to-confirm |
| `LICENSE_LOG_PAT` leaked | Attacker can read + write audit repo (fine-grained PATs grant both for Contents) | PAT scoped to single repo only, rotate annually. Audit repo git history is tamper-evident. Audit entries deliberately contain no license key material — blast radius is customer email + org name, not credentials. |
| Resend account compromised | Attacker can send emails from `licenses@bolalabs.pt` | Rotate API key, check Resend audit logs, SPF/DKIM still protect downstream clients. Consider dedicated Resend account for license delivery, separate from other projects. |
| `private.pem` lost (no backup followed) | Cannot mint new licenses, existing ones still valid until expiry | Mandatory backup step (1Password + offline USB) in setup checklist. Spec treats this as non-negotiable. |
| Private key compromised (leaked, copied, exfiltrated) | Attacker can forge arbitrary licenses | (1) `months ≤ 24` cap limits tail exposure to 24 months. (2) `kid` infrastructure (added in §6) enables clean rotation in Phase 2+. (3) Until revocation ships, recovery requires re-minting all `delivered` entries from audit with a new `kid` and force-pushing a public key update. |
| GitHub Secrets retention bug / platform outage | Workflow fails | Local `scripts/generate-license.js` remains as manual fallback on Bruno's machine |
| Duplicate mints from double-click | Two valid keys for the same recipient | Accepted. Both remain valid until expiry. Both are recorded in audit with distinct `lid` values — manual reconciliation is straightforward. |
| Supply-chain attack on `actions/checkout` / `actions/setup-node` | Malicious code runs with secrets available | Actions pinned to full commit SHAs, Dependabot enabled for automated SHA bumps. `npm ci --ignore-scripts` prevents transitive postinstall execution in the same step as the signing secret. |
| `notes` field XSS attempting to reach email or audit | Stored XSS in customer email client, audit log pollution | `notes` is `JSON.stringify`'d on every write and emitted in text/plain email body only (never HTML). 500 char cap prevents audit spam. |
| Audit commit race with external writers (Dependabot, manual, future Phase 2 VPS) | 409 Conflict on `licenses.jsonl` PUT | `logMint()` uses `sha`-based optimistic concurrency + retry-on-409 loop (3 attempts). Beyond 3 conflicts, workflow aborts with structured error; Bruno investigates. |
| Resend-OK-but-audit-FAIL produces orphaned key | Customer has key, Bruno has no record | Two-phase audit pattern: `status: pending` written BEFORE delivery, `status: delivered` appended AFTER. Every minted key is traceable. `if: failure()` fires a notification email with the `lid` for manual reconciliation. |
| GDPR erasure request (Art. 17) | Must remove customer PII from immutable git history | Documented erasure procedure: `git filter-repo --replace-text` on the offending entry, force-push the audit repo, rotate `LICENSE_LOG_PAT`, note the action in a separate `erasures.log`. Operationally feasible at low volume; not scalable — becomes a Phase 2 problem when customer base grows. |
| Personal data breach on audit repo | 72h CNPD notification obligation under GDPR Art. 33 | Playbook: (1) detect via GitHub audit log on the private repo, (2) scope the breach by `git log --since=` on `licenses.jsonl`, (3) notify CNPD within 72h with affected record count, (4) notify affected customers if risk assessment is "high". Blast radius is bounded because license keys themselves are never in the audit repo. |

## Legal & compliance (Phase 1 minimum)

This section captures the GDPR / compliance items that the expert legal review flagged. All items below are **paperwork, not code** — they do not change the technical design but must be executed before the first real customer mint.

**Data controller:** Bruno Marques / Bola Labs, Portugal. Contact: `bruno@bolalabs.pt`.

**Personal data processed by the system:**

- Customer email (provided on mint, delivered-to via Resend, stored in audit repo)
- Organization name (provided on mint, stored in audit repo, embedded in signed license payload)
- Signed license key with expiry (delivered via email, NOT stored in audit)
- Mint metadata (timestamp, `lid`, tier, seats, fingerprint, run ID — stored in audit)

**Lawful basis (GDPR Article 6):**

- **6(1)(b) — Contract performance**: for the mint itself + audit entry. The license cannot be delivered or validated without the email and org. Processing is strictly necessary to perform the license sale contract.
- **6(1)(c) — Legal obligation**: for retention of the mint record. Portuguese tax law (Código do IVA, LGT) requires ~10 years of invoice/sale records — this *justifies* the long retention in the audit repo rather than conflicting with storage-limitation principles under Art. 5(1)(e).

Legitimate interest (6(1)(f)) is **not** the right basis here — don't claim it.

**Data processors (all covered by DPF or require DPA):**

- **GitHub (Microsoft)** — hosts both the public repo and the private audit repo. DPF-certified. DPA auto-accepted via GitHub ToS. No separate signing required.
- **Resend** — email delivery provider (US-based, Delaware). DPF-certified. DPA **must be actively signed** in Resend dashboard during Phase 1 setup (see setup checklist step 2).
- **Stripe** (Phase 2 only) — DPF-certified, DPA auto-accepted via Stripe ToS.

**International transfer mechanism:** EU-US Data Privacy Framework (DPF) adequacy decision for all three processors. No Standard Contractual Clauses needed while DPF stands. Record this reliance in a simple processing register (`docs/compliance/processing-register.md`, created as part of Phase 1 setup — **not** part of this spec's scope).

**Privacy notice obligation:** before the first real customer mint, publish a minimal privacy notice at `bolalabs.pt/privacy` covering: controller identity, data collected, 6(1)(b)+(c) basis, retention tied to tax law, processor list (GitHub, Resend, Stripe later), transfer mechanism (DPF), data subject rights (access, rectification, erasure, portability), complaint route (CNPD). Link from the license delivery email footer. This is the highest-leverage compliance artifact and is **not blocked by this spec** — it's pre-launch launch prep.

**Right to erasure (Art. 17) — operational playbook:**

1. Verify the request is valid (verify the requestor owns the email on file).
2. Use `git filter-repo --replace-text <replacement-file>` on `licenses.jsonl` in the private audit repo to redact the offending entry (replace `email`/`org` fields with `[erased]`).
3. Force-push the rewritten history. Communicate force-push risk to any collaborators (Phase 1 = solo, no risk).
4. Rotate `LICENSE_LOG_PAT` immediately after force-push (paranoia: stale tokens could have cached the old SHA).
5. Append a row to `erasures.log` in the same audit repo recording: timestamp, `lid`, requestor email hash (SHA-256, not the email itself), justification.
6. Notify the requestor within 30 days that erasure is complete.

**Acceptable at low volume, does not scale** — beyond ~50 customers, this becomes a Phase 2 problem and needs a proper erasure API.

**Breach notification (Art. 33) — 72h playbook:**

1. **Detect**: monitor GitHub audit log on the private audit repo for unauthorized access (monthly manual check Phase 1, automated alert Phase 2).
2. **Scope**: `git log --since="<incident date>" licenses.jsonl` to count affected records.
3. **Classify**: since the audit repo never contains key material, a breach exposes contact data (email + org name), not credentials. Risk is typically "notify CNPD, may notify affected customers if risk is high".
4. **Notify CNPD** within 72h of detection via the [CNPD online portal](https://www.cnpd.pt). Include affected record count, nature of breach, likely consequences, mitigation taken.
5. **Notify customers** only if the risk assessment is "high" under Art. 34.
6. **Document** the incident in a separate `incidents.log` in the compliance folder.

**EULA enforceability:** the license key is delivered via email without click-through acceptance. This is weak contractually for Phase 1 ad-hoc sales. Mitigation: include the EULA text (or a link to `bolalabs.pt/eula`) in the delivery email, and require written acceptance via email reply before minting for customer sales. For the self-license (Bruno himself), no EULA needed — same party is both licensor and licensee. Phase 2 Stripe checkout will solve this via a mandatory "I agree to terms" checkbox.

**Input `email` masking in GH Actions logs:** the workflow will also emit `::add-mask::$EMAIL` in the pre-emptive masking step so the customer email doesn't appear in the run history (which has 90-day retention). Low-value nit per the expert review, but free to implement.

## Open questions

None blocking Phase 1. The following can be decided at implementation time without changing the design:

- **Exact email wording:** can be iterated without changing `deliverLicense()` signature.
- **Node version in the action:** `20` is a safe default matching the project's current engines.
- **Whether to use `environment: production-mint` for click-to-confirm:** recommended but optional; enabled before first real customer mint.

## Appendix: file inventory

**New files:**

- `scripts/lib/minter.js` — primitives: `validateInput`, `mintLicense`, `deliverLicense`, `logMint` (+ error classes). Located under `scripts/lib/` (not `server/lib/`) because it never loads inside the running Express server.
- `scripts/mint-license-action.js` — CLI wrapper / composition point invoked by the GH Action
- `scripts/mint-failure-notify.js` — standalone failure notifier invoked by `if: failure()` step
- `.github/workflows/mint-license.yml` — workflow definition
- `.github/dependabot.yml` — enables automated SHA bumps for `github-actions` package-ecosystem (prevents regression to tag pins)
- `scripts/__tests__/minter.test.js` — unit tests for the primitives (co-located with `scripts/lib/minter.js`, not under `server/__tests__/`)

**Modified files:**

- `server/lib/license.js` — small additive changes per §6: `kid` header on sign, `algorithms: ['EdDSA']` allowlist on verify, `resolveKeyByKid` lookup parameter. Backward compatible.
- `server/middleware/require-tier.js` — updated call site to pass `resolveKeyByKid` (Phase 1 stub returns the single known key regardless of `kid`)
- `server/__tests__/license.test.js` — updated to assert `kid` header presence and to use the new `resolveKeyByKid` API

**Deliberately NOT modified:**

- `scripts/generate-license.js` — the expert architecture review flagged importing `minter.js` from this local CLI as "spooky action at a distance". The existing `generateLicenseKey()` in `server/lib/license.js` is the real shared primitive; duplication between this local CLI and the GH Action's composition wrapper is zero. Left standalone.

**New external resources (not in this repo's tree):**

- `brunobola-portfolio/license-log` (private GitHub repo)
- Resend account + DNS records on `bolalabs.pt`
- GitHub Fine-Grained PAT (`LICENSE_LOG_PAT`)
- `vars.AUDIT_REPO` repo variable on the public repo

**No changes to:**

- `keys/public.pem` — remains the single currently-active public key for Phase 1
- `keys/private.pem` — stays on Bruno's local machine + backups (1Password + offline USB), copied once into `LICENSE_PRIVATE_PEM` GH Secret
