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

All mint logic lives in a single module, [`server/lib/minter.js`](../../server/lib/minter.js) (new). Both Phase 1 (GitHub Actions) and Phase 2 (VPS Express route) are thin wrappers that invoke the same functions. This guarantees zero divergence between environments and makes migration a pure deployment exercise.

```
                    ┌─────────────────────────┐
                    │  server/lib/license.js  │   ← existing, unchanged
                    │  generateLicenseKey()   │     (Ed25519 signing)
                    │  validateLicenseKey()   │
                    └───────────┬─────────────┘
                                │
                                ▼
                    ┌─────────────────────────┐
                    │  server/lib/minter.js   │   ← NEW
                    │  mintLicense()          │     orchestrator
                    │  deliverLicense()       │     (mint + email + audit)
                    │  logMint()              │
                    │  orchestrateMint()      │
                    └──────┬──────────────┬───┘
                           │              │
                Phase 1    │              │    Phase 2 (future)
                           ▼              ▼
              ┌────────────────────┐  ┌──────────────────────────┐
              │  scripts/          │  │  server/routes/admin/    │
              │  mint-license-     │  │  mint.js (NEW in Ph2)    │
              │  action.js (NEW)   │  │  POST /api/admin/mint    │
              │                    │  │                          │
              │  called from       │  │  called from             │
              │  .github/          │  │  bolalabs.pt site or     │
              │  workflows/        │  │  Stripe webhook          │
              │  mint-license.yml  │  │                          │
              └────────┬───────────┘  └──────────┬───────────────┘
                       │                         │
                       ├─────────────┬───────────┤
                       ▼             ▼           ▼
              ┌──────────────┐  ┌─────────┐  ┌──────────────────┐
              │  Resend      │  │  GH     │  │  brunobola-      │
              │  (email      │  │  Action │  │  portfolio/      │
              │  delivery)   │  │  logs   │  │  license-log     │
              │              │  │  (masked│  │  (private repo,  │
              │              │  │  output)│  │  JSONL audit)    │
              └──────────────┘  └─────────┘  └──────────────────┘
```

### Components

| Component | State | Responsibility |
|---|---|---|
| [`server/lib/license.js`](../../server/lib/license.js) | Existing, unchanged | Core crypto: Ed25519 JWT sign + verify |
| `server/lib/minter.js` | **New** | Orchestrator: mint + deliver (email) + log (audit repo). Single source of truth for the end-to-end flow. |
| `scripts/mint-license-action.js` | **New** | Thin Node CLI wrapper invoked from the GH Action. Reads env vars, calls `orchestrateMint()`, emits masked output. |
| `.github/workflows/mint-license.yml` | **New** | Defines `workflow_dispatch` interface with typed inputs, loads secrets, runs the script. |
| [`scripts/generate-license.js`](../../scripts/generate-license.js) | Existing, refactored | Local CLI fallback. Refactored to import from `server/lib/minter.js` so logic is not duplicated. |
| `brunobola-portfolio/license-log` (private repo) | **New, separate** | Append-only `licenses.jsonl` audit trail. Does **not** contain license keys — only `lid` + metadata. |

### Data flow (Phase 1 happy path)

1. Bruno opens GitHub → Actions → "Mint License" → Run workflow
2. Fills form: `tier`, `org`, `email`, optional `seats`/`months`/`notes`/`dry_run`
3. GitHub Actions runner starts:
   a. Checks out the repo (pinned SHA)
   b. Sets up Node 20, runs `npm ci`
   c. Writes `LICENSE_PRIVATE_PEM` secret to `/tmp/private.pem` (perms 600)
   d. Masks the output via `::add-mask::` directive before any log lines
   e. Runs `node scripts/mint-license-action.js` with all secrets as env
4. Inside the script:
   a. `mintLicense()` calls `generateLicenseKey()` → gets signed JWT + payload + fingerprint
   b. If `dry_run=true`: prints masked metadata, exits success
   c. Otherwise:
      - `deliverLicense()` POSTs to Resend API → email arrives at recipient inbox
      - `logMint()` appends one line to `licenses.jsonl` in `brunobola-portfolio/license-log` via the PAT
5. Runner cleans up `/tmp/private.pem` (paranoia; VM is destroyed anyway)
6. Action completes, Bruno sees success status

### Failure modes & degradation

| Failure | Behavior | Recovery |
|---|---|---|
| `RESEND_API_KEY` invalid | Workflow fails at `deliverLicense`, but mint already happened and key is printed masked in the log | Bruno reads key from log, forwards manually; fixes Resend key |
| `LICENSE_LOG_PAT` expired | Workflow fails at `logMint` after email already sent | Retry workflow with new PAT; dedupe audit manually if needed |
| Resend quota exhausted (>3k/month on free tier) | Workflow fails with clear error | Upgrade Resend plan or fall back to manual delivery |
| `LICENSE_PRIVATE_PEM` missing/corrupted | Workflow fails at step 3c before any side effects | Fix secret, re-run |
| Concurrent runs | Prevented by workflow concurrency group `license-mint` | N/A |
| Full GitHub Actions outage | Fall back to local `scripts/generate-license.js` on Bruno's machine (unchanged existing tool) | N/A |

## Detailed design

### 1. `.github/workflows/mint-license.yml`

**Trigger:** `workflow_dispatch` with typed inputs. Also `repository_dispatch` with `types: [mint-license]` for future programmatic triggers (from the site or external services).

**Inputs:**

| Name | Type | Required | Default | Validation |
|---|---|---|---|---|
| `tier` | choice | yes | `pro` | `pro` or `enterprise` (enforced by UI dropdown) |
| `org` | string | yes | — | Non-empty |
| `email` | string | yes | — | RFC 5322 format check in script |
| `seats` | string | no | `1` | Positive integer, ≤ 10000 |
| `months` | string | no | `12` | Positive integer, ≤ 120 |
| `notes` | string | no | `""` | Free-form, written to audit only |
| `dry_run` | boolean | no | `false` | If true: mint + print (masked) only, no side effects |

**Concurrency:** `group: license-mint`, `cancel-in-progress: false`. Prevents race conditions on audit repo commits.

**Permissions:** `contents: read` at workflow level (minimum). Audit repo writes use the separate `LICENSE_LOG_PAT`, not `GITHUB_TOKEN`.

**Action version pinning:** `actions/checkout` and `actions/setup-node` pinned to full commit SHAs (not tags) for supply chain safety. SHAs documented in a comment next to each `uses:` line with the resolved version for human readability.

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
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@<SHA>   # v4.x.x
      - uses: actions/setup-node@<SHA> # v4.x.x
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - name: Write private key to temp file
        env:
          LICENSE_PRIVATE_PEM: ${{ secrets.LICENSE_PRIVATE_PEM }}
        run: |
          umask 077
          printf '%s' "$LICENSE_PRIVATE_PEM" > /tmp/private.pem
      - name: Mint license
        env:
          KEY_FILE: /tmp/private.pem
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          LICENSE_LOG_PAT: ${{ secrets.LICENSE_LOG_PAT }}
          AUDIT_REPO: ${{ secrets.AUDIT_REPO }}
          FROM_EMAIL: licenses@bolalabs.pt
          TIER: ${{ inputs.tier }}
          ORG: ${{ inputs.org }}
          EMAIL: ${{ inputs.email }}
          SEATS: ${{ inputs.seats }}
          MONTHS: ${{ inputs.months }}
          NOTES: ${{ inputs.notes }}
          DRY_RUN: ${{ inputs.dry_run }}
          GITHUB_RUN_ID: ${{ github.run_id }}
        run: node scripts/mint-license-action.js
      - name: Cleanup
        if: always()
        run: rm -f /tmp/private.pem
```

The actual SHAs resolve at implementation time.

### 2. `server/lib/minter.js` — public API

```js
/**
 * Mint a license key from a signed payload.
 * Pure function: no side effects, no network calls.
 */
export async function mintLicense(
  { tier, org, email, seats, months, notes },
  privateKeyPem
) {
  // Validates inputs, calls generateLicenseKey() from license.js
  // Returns { key, payload, fingerprint }
}

/**
 * Send license key to recipient via Resend.
 */
export async function deliverLicense(
  { key, payload, recipient, fromEmail, resendApiKey }
) {
  // POSTs to https://api.resend.com/emails
  // Returns { messageId }
  // Throws on non-2xx response
}

/**
 * Append a JSONL entry to the audit repo via GitHub REST API.
 * Does NOT write the license key itself — only lid + metadata.
 */
export async function logMint(
  { payload, fingerprint, notes, auditRepo, pat }
) {
  // 1. GET contents of licenses.jsonl via REST API
  // 2. Append one line with the new entry
  // 3. PUT updated contents (idempotent commit)
  // Returns { commitSha }
}

/**
 * End-to-end orchestration. The only function callers need.
 */
export async function orchestrateMint(input, options) {
  const license = await mintLicense(input, options.privateKeyPem)
  if (options.dryRun) {
    return { license, delivery: null, audit: null, dryRun: true }
  }
  const delivery = await deliverLicense({
    ...license,
    recipient: input.email,
    fromEmail: options.fromEmail,
    resendApiKey: options.resendApiKey,
  })
  const audit = await logMint({
    payload: license.payload,
    fingerprint: license.fingerprint,
    notes: input.notes,
    auditRepo: options.auditRepo,
    pat: options.pat,
  })
  return { license, delivery, audit, dryRun: false }
}
```

### 3. `scripts/mint-license-action.js` — CLI wrapper

Thin orchestrator script run by the GitHub Action. Responsibilities:

1. Read and validate env vars
2. Read `KEY_FILE` contents
3. Emit `::add-mask::<value>` directives for the license key and fingerprint **before** any other output
4. Call `orchestrateMint()`
5. Print human-readable success message (with key already masked by step 3)
6. Exit with appropriate code

Target size: ~60 lines including error handling and input validation.

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
  "lid": "lic_abc123xyz",
  "tier": "enterprise",
  "org": "Bola Labs Dev",
  "email": "bruno@bolalabs.pt",
  "seats": 100,
  "months": 120,
  "issuedAt": "2026-04-11T12:34:56Z",
  "expiresAt": "2036-04-11T12:34:56Z",
  "fingerprint": "SHA256:abcd...",
  "notes": "Dev self-license",
  "mintedBy": "github-actions",
  "runId": "1234567890",
  "dryRun": false
}
```

**Fields deliberately absent:** the `key` string itself. This is non-negotiable — if the audit repo is ever compromised, the attacker gets metadata but no usable keys.

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

The template is hardcoded in `deliverLicense()` for Phase 1. A future iteration can externalize it to a template file when the product supports multiple locales or custom branding per customer.

### 6. Secrets required in the public repo

| Secret name | Purpose | Source |
|---|---|---|
| `LICENSE_PRIVATE_PEM` | Ed25519 private key to sign licenses | Contents of `keys/private.pem` |
| `RESEND_API_KEY` | Email delivery auth | Created in Resend dashboard, single-scope (Send emails only) |
| `LICENSE_LOG_PAT` | Commit access to `brunobola-portfolio/license-log` | Fine-grained GitHub PAT, scoped to single repo, `contents: write` only, 1-year expiry |
| `AUDIT_REPO` | Repo name for audit commits | Plaintext `brunobola-portfolio/license-log` (not secret, stored as secret for parity / easy renaming) |

## Testing plan

### Unit tests (`server/__tests__/minter.test.js`, new)

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

5. **Add four secrets** to `brunobola-portfolio/GitHub-Repo-Manager` repo settings:
   - `LICENSE_PRIVATE_PEM` → paste contents of `keys/private.pem`
   - `RESEND_API_KEY` → from step 2
   - `LICENSE_LOG_PAT` → from step 4
   - `AUDIT_REPO` → `brunobola-portfolio/license-log` (plaintext is fine — this is not actually secret, but storing as a secret makes renaming the audit repo a one-step change without editing the workflow YAML)

6. **Merge the implementation PR** (the plan that follows this spec will produce one PR adding `server/lib/minter.js`, `scripts/mint-license-action.js`, `.github/workflows/mint-license.yml`, and tests).

7. **Run a dry-run test**:
   - Actions → "Mint License" → Run workflow
   - tier: `pro`, org: `Test`, email: `bruno@bolalabs.pt`, `dry_run: true`
   - Verify: action succeeds, log shows masked key, **no** email received, **no** audit commit created

8. **Run the first real mint** — a self-license for development:
   - tier: `enterprise`, org: `Bola Labs Dev`, email: `bruno@bolalabs.pt`, seats: `100`, months: `120`, `dry_run: false`
   - Verify: email arrives in inbox, audit commit appears in `brunobola-portfolio/license-log/licenses.jsonl`
   - Copy the `LICENSE_KEY` from the email into the local `.env` file
   - Set `VITE_MOCK_MODE=false`
   - Run `npm run dev:all`
   - Confirm backend log shows `License validated: enterprise tier (org: Bola Labs Dev, expires: 2036-04-11)`
   - Navigate to Teams → verify teams load without 403

## Phase 2 — Migration to VPS (future, documented here for continuity)

When bolalabs.pt has a VPS and the main site exists:

1. **Add Express route** in the site's backend:
   ```js
   // routes/admin/mint.js
   import { orchestrateMint } from '../../server/lib/minter.js' // same module
   router.post('/api/admin/mint', requireAdminAuth, async (req, res) => {
     const result = await orchestrateMint(req.body, {
       privateKeyPem: process.env.LICENSE_PRIVATE_PEM,
       resendApiKey: process.env.RESEND_API_KEY,
       auditRepo: process.env.AUDIT_REPO,
       pat: process.env.LICENSE_LOG_PAT,
       fromEmail: 'licenses@bolalabs.pt',
     })
     res.json(result)
   })
   ```

2. **Copy secrets** from GitHub Secrets to VPS environment (via Fly.io secrets, systemd drop-in, SOPS, or whatever secret management the VPS uses).

3. **Wire Stripe webhook** handler to call `orchestrateMint()` directly on `checkout.session.completed` events for self-hosted price IDs.

4. **Run both paths in parallel for 1–3 months** — GitHub Actions remains as a warm backup. Manual mints still work via the action.

5. **Cut over** when confident:
   - Remove `LICENSE_PRIVATE_PEM`, `RESEND_API_KEY`, and `LICENSE_LOG_PAT` from GitHub Secrets
   - Leave the workflow YAML file committed but disable the workflow (or add a `if: false` guard) for emergency re-activation

**What does not change in Phase 2:**
- `server/lib/license.js` (crypto primitives)
- `server/lib/minter.js` (orchestration)
- `licenses.jsonl` schema and audit repo layout
- Format and validity of issued license keys

**Portability guarantee:** if the site later moves from Fly.io to another host, or from `bolalabs.pt` to another domain, or from Resend to another email provider, only environment variables need updating. No code changes.

## Future work (out of scope for Phase 1)

These are documented so the Phase 1 implementation doesn't paint the design into a corner:

### Key rotation

Today the `public.pem` is committed at `keys/public.pem` and loaded once at backend startup by [`require-tier.js`](../../server/middleware/require-tier.js). If the private key is ever compromised, the only recovery is to generate a new keypair, re-issue all outstanding licenses, and push a code update with the new public key — because existing licenses signed with the old key would still appear valid.

**Proper solution (Phase 2+):**
- Add `kid` (key ID) field to the JWT header inside `generateLicenseKey`
- Store multiple public keys in `keys/public-*.pem` or in a JSON manifest `keys/pubkeys.json`
- `validateLicenseKey` picks the public key by `kid`
- Old keys can be marked deprecated and eventually removed when no outstanding licenses use them

**Why not now:** adds complexity to the existing `license.js` module and requires a schema migration on the JWT payload. Not justified before the first customer exists.

### Revocation list (CRL)

The `revoked.jsonl` file path is reserved in the audit repo. A future enhancement:
- On customer refund/breach, append a line `{"lid":"...","revokedAt":"...","reason":"..."}`
- `require-tier.js` runs a periodic job (daily?) to fetch `revoked.jsonl` from the audit repo
- Cached locally; licenses whose `lid` appears in the list are refused even if signature is valid

**Why not now:** no customers yet, and offline customers can't fetch revocation lists anyway. Requires thinking about the offline trust model.

### Stripe integration (Phase 2)

Phase 2 wires `checkout.session.completed` → `orchestrateMint()` via a new webhook handler. The mint code is ready today; the trigger isn't.

### Self-service customer portal

When the bolalabs.pt site exists, customers can:
- View their active licenses
- Re-send the license key email if lost
- Upgrade tier (Pro → Enterprise) — triggers a new mint
- Cancel / mark as "not for production" to trigger revocation

All of this is orchestrated against the same `server/lib/minter.js` module plus the audit repo as source of truth.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| GitHub account compromised | Attacker can mint licenses | 2FA enforced on Bruno's account (baseline), backup of `private.pem` in 1Password allows rotation if needed |
| `LICENSE_LOG_PAT` leaked | Attacker can write garbage to audit repo | PAT scoped to single repo, `contents: write` only, cannot read other repos. Rotate annually. Audit repo git history is tamper-evident. |
| Resend account compromised | Attacker can send emails from `licenses@bolalabs.pt` | Rotate API key, check Resend audit logs, SPF/DKIM still protect downstream clients |
| `private.pem` lost (no backup followed) | Cannot mint new licenses, existing ones still valid until expiry | Mandatory backup step (1Password + offline USB) in setup checklist. Spec treats this as non-negotiable. |
| GitHub Secrets retention bug / platform outage | Workflow fails | Local `scripts/generate-license.js` remains as manual fallback on Bruno's machine |
| Duplicate mints from double-click | Two valid keys for the same recipient | Accepted. Both remain valid until expiry. Can be cleaned up manually in audit if needed. |
| Supply-chain attack on `actions/checkout` or `actions/setup-node` | Malicious code runs with secrets available | Actions pinned to full commit SHAs, not tags. Reviewed at update time. |

## Open questions

None blocking Phase 1. The following can be decided at implementation time without changing the design:

- **Exact email wording/HTML template:** can be iterated without changing `deliverLicense()` signature.
- **Node version in the action:** `20` is a safe default matching the project's current engines.
- **Whether `AUDIT_REPO` is a secret or a plain variable:** stored as secret for consistency and easy rename without changing code.

## Appendix: file inventory

**New files:**
- `server/lib/minter.js`
- `scripts/mint-license-action.js`
- `.github/workflows/mint-license.yml`
- `server/__tests__/minter.test.js`

**Modified files:**

- `scripts/generate-license.js` — refactored to import from `server/lib/minter.js` for shared logic (no behavior change for local CLI usage)

**New external resources:**

- `brunobola-portfolio/license-log` (private GitHub repo, outside this repo's tree)
- Resend account + DNS records on `bolalabs.pt`
- GitHub Fine-Grained PAT

**No changes to:**

- `server/lib/license.js`
- `server/middleware/require-tier.js`
- `keys/public.pem`
- `keys/private.pem` (stays on Bruno's local machine + backups)
