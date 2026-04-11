# License Mint Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 1 of the license mint automation so Bruno can mint Ed25519-signed license keys from any device via a GitHub Actions `workflow_dispatch`, with email delivery via Resend and an append-only audit trail committed to a separate private repo — all while the signing `private.pem` never leaves GitHub Secrets.

**Architecture:** A shared `scripts/lib/minter.js` exposes composable primitives (`validateInput`, `mintLicense`, `deliverLicense`, `logMint`) that are invoked from `scripts/mint-license-action.js` — the CLI wrapper is the composition point where step-level errors and two-phase audit (pending → delivered) are handled. The workflow YAML runs the script on `workflow_dispatch` with secrets injected as env vars only at the step level. The same primitives are reusable from a future Phase 2 VPS Express route without refactor.

**Tech Stack:** Node.js 20, ESM, `jose@^6.2.2` for Ed25519 JWT signing, Vitest for tests, GitHub Actions with SHA-pinned dependencies, Resend HTTP API for email delivery, GitHub Contents REST API for audit commits.

**Spec reference:** [`docs/specs/2026-04-11-license-mint-automation-design.md`](../specs/2026-04-11-license-mint-automation-design.md) — all design decisions, failure modes, and risk analysis live there.

**Scope fence (out of scope for this plan — covered in spec's "Future work"):** Key rotation runtime, revocation list CRL, Stripe webhook integration, self-service customer portal, self-service customer portal.

**Manual operational steps (NOT code, executed by Bruno separately — see spec §Setup checklist):**

1. Backup `keys/private.pem` to 1Password + offline USB
2. Create Resend account, verify `bolalabs.pt` domain, sign DPA
3. Create private GitHub repo `brunobola-portfolio/license-log` with empty `licenses.jsonl` and `revoked.jsonl`
4. Create Fine-Grained PAT for `license-log` repo
5. Set GitHub Secrets (`LICENSE_PRIVATE_PEM`, `RESEND_API_KEY`, `LICENSE_LOG_PAT`) and repo variable (`vars.AUDIT_REPO`)
6. Run dry-run test after merging this plan's PR
7. Run first real mint for self-license

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `server/lib/license.js` | **Modify** | Add `kid` JWT header field, `algorithms: ['EdDSA']` allowlist on verify, optional `resolveKeyByKid` lookup function on `validateLicenseKey`. Backward compatible. |
| `server/middleware/require-tier.js` | **Modify** | Update `resolveEffectiveTier` call site to pass a single-key `resolveKeyByKid` stub that ignores `kid` and returns the one known public key. |
| `server/__tests__/license.test.js` | **Modify** | Update to assert `kid` header presence, cover the algorithms allowlist, and the new `resolveKeyByKid` lookup shape. |
| `scripts/lib/minter.js` | **Create** | Primitives: `validateInput`, `mintLicense`, `deliverLicense`, `logMint`, error classes. No orchestrator. |
| `scripts/__tests__/minter.test.js` | **Create** | Unit tests for every primitive + error class. |
| `scripts/mint-license-action.js` | **Create** | CLI wrapper / composition point for the GH Action. |
| `scripts/__tests__/mint-license-action.test.js` | **Create** | Integration test for the CLI wrapper with all primitives mocked. |
| `scripts/mint-failure-notify.js` | **Create** | Standalone failure notifier called by `if: failure()` step. |
| `scripts/__tests__/mint-failure-notify.test.js` | **Create** | Unit test for the notifier. |
| `.github/workflows/mint-license.yml` | **Create** | Workflow YAML with pre-emptive masking, SHA-pinned actions, `--ignore-scripts`, actor guard, concurrency, failure notification. |
| `.github/dependabot.yml` | **Create** | Enable automated SHA bumps for `github-actions` package-ecosystem so pinning doesn't regress. |
| `scripts/generate-license.js` | **Unchanged** | Deliberately NOT refactored — see spec §Appendix "Deliberately NOT modified". |
| `keys/private.pem` | **Unchanged** | Stays on Bruno's local machine + backups. Copied once into `LICENSE_PRIVATE_PEM` GitHub Secret. |

**Dependency note:** no new npm packages. `jose` is already a runtime dep. The native `fetch` (Node 18+) is used for Resend and GitHub API calls — no need for `node-fetch` or `axios`.

---

## Task 1: Add `kid` header, algorithms allowlist, and key resolver to `server/lib/license.js`

**Files:**

- Modify: [`server/lib/license.js`](../../server/lib/license.js)
- Modify: [`server/middleware/require-tier.js`](../../server/middleware/require-tier.js) (lines 30–37, `resolveEffectiveTier`)
- Modify: [`server/__tests__/license.test.js`](../../server/__tests__/license.test.js)

**Rationale:** Spec §6 "Changes to `server/lib/license.js`". Three changes must land together: `kid` header on sign, `algorithms` allowlist on verify, `resolveKeyByKid` lookup. All are backward compatible — existing callers that pass a single `publicKeyPem` keep working via a compatibility shim.

- [ ] **Step 1.1: Write failing test for `kid` in JWT header**

Add to [`server/__tests__/license.test.js`](../../server/__tests__/license.test.js) at the end of the existing `describe` block (before the closing `})`), inserting after the "should return null for invalid key format" test:

```js
  it('should include kid in the JWT header', async () => {
    const key = await generateLicenseKey({
      org: 'Test Corp', email: 'test@example.com', tier: 'pro', seats: 1, months: 12,
      kid: 'k-test-01',
    }, privateKey)
    const jwt = key.slice('grm_lic_'.length)
    const headerB64 = jwt.split('.')[0]
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString())
    expect(header.kid).toBe('k-test-01')
    expect(header.alg).toBe('EdDSA')
  })
```

- [ ] **Step 1.2: Run the test to verify it fails**

Run: `npx vitest run server/__tests__/license.test.js -t "should include kid"`
Expected: FAIL with `expected undefined to be 'k-test-01'` (because the current implementation doesn't emit `kid`).

- [ ] **Step 1.3: Implement `kid` support in `generateLicenseKey`**

Replace the `generateLicenseKey` function in [`server/lib/license.js`](../../server/lib/license.js) (lines 19–38) with:

```js
export async function generateLicenseKey(opts, privateKeyPem) {
  const { org, email, tier, seats, months, features, kid } = opts
  const lid = randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const exp = months > 0
    ? now + (months * 30 * 24 * 60 * 60)
    : now - 1

  const payload = { lid, org, email, tier, seats }
  if (features && features.length > 0) payload.features = features

  const header = { alg: ALG, typ: 'JWT' }
  if (kid) header.kid = kid

  const key = await importPKCS8(privateKeyPem, ALG)
  const jwt = await new SignJWT(payload)
    .setProtectedHeader(header)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key)

  return LICENSE_PREFIX + jwt
}
```

- [ ] **Step 1.4: Run the test to verify it passes**

Run: `npx vitest run server/__tests__/license.test.js -t "should include kid"`
Expected: PASS.

- [ ] **Step 1.5: Run the full license test suite to verify no regressions**

Run: `npx vitest run server/__tests__/license.test.js`
Expected: all 7 tests pass (6 original + 1 new).

- [ ] **Step 1.6: Write failing test for explicit `algorithms` allowlist**

Add this test to [`server/__tests__/license.test.js`](../../server/__tests__/license.test.js) inside the same `describe` block:

```js
  it('should reject a key signed with a disallowed algorithm', async () => {
    // Manually craft a JWT with HS256 using the public key as a shared secret
    // This simulates the classic "alg confusion" attack pattern
    const { SignJWT } = await import('jose')
    const forgedJwt = await new SignJWT({ lid: 'x', tier: 'enterprise', org: 'Attacker', seats: 9999 })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('2100-01-01')
      .sign(new TextEncoder().encode(publicKey))
    const forged = 'grm_lic_' + forgedJwt
    const payload = await validateLicenseKey(forged, publicKey)
    expect(payload).toBeNull()
  })
```

- [ ] **Step 1.7: Run the test to verify it fails (or passes — see note)**

Run: `npx vitest run server/__tests__/license.test.js -t "disallowed algorithm"`
Expected: **may already pass** because `jose` infers `EdDSA` from the SPKI key type and rejects HS256 at the key-import level. If it passes: good, move to 1.8 to add the explicit allowlist as a seatbelt. If it fails: the current `jose` version would have silently accepted the forged JWT, which is the vulnerability we're patching.

- [ ] **Step 1.8: Add explicit `algorithms` allowlist to `validateLicenseKey`**

Replace the `validateLicenseKey` function in [`server/lib/license.js`](../../server/lib/license.js) (lines 40–50) with:

```js
export async function validateLicenseKey(licenseKey, publicKeyOrResolver) {
  try {
    if (!licenseKey || !licenseKey.startsWith(LICENSE_PREFIX)) return null
    const jwt = licenseKey.slice(LICENSE_PREFIX.length)

    // If caller passed a function, resolve the public key by kid from the JWT header.
    // Otherwise treat the second arg as a static PEM string (backward compat).
    let publicKeyPem
    if (typeof publicKeyOrResolver === 'function') {
      const headerB64 = jwt.split('.')[0]
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString())
      publicKeyPem = publicKeyOrResolver(header.kid)
      if (!publicKeyPem) return null
    } else {
      publicKeyPem = publicKeyOrResolver
    }

    const key = await importSPKI(publicKeyPem, ALG)
    const { payload } = await jwtVerify(jwt, key, { algorithms: ['EdDSA'] })
    return payload
  } catch {
    return null
  }
}
```

- [ ] **Step 1.9: Run both tests and verify they pass**

Run: `npx vitest run server/__tests__/license.test.js`
Expected: all 8 tests pass.

- [ ] **Step 1.10: Write failing test for `resolveKeyByKid` lookup**

Add this test:

```js
  it('should validate using a resolveKeyByKid lookup function', async () => {
    const key = await generateLicenseKey({
      org: 'Resolver Corp', email: 'r@example.com', tier: 'pro', seats: 2, months: 12,
      kid: 'k-alpha',
    }, privateKey)

    const calls = []
    const resolver = (kid) => {
      calls.push(kid)
      return publicKey // single-key Phase 1 stub: return the one known key regardless of kid
    }

    const payload = await validateLicenseKey(key, resolver)
    expect(payload).not.toBeNull()
    expect(payload.tier).toBe('pro')
    expect(calls).toEqual(['k-alpha'])
  })

  it('should return null when resolver returns nothing', async () => {
    const key = await generateLicenseKey({
      org: 'Unknown Corp', email: 'u@example.com', tier: 'pro', seats: 1, months: 12,
      kid: 'k-unknown',
    }, privateKey)
    const payload = await validateLicenseKey(key, () => null)
    expect(payload).toBeNull()
  })
```

- [ ] **Step 1.11: Run the tests — both should pass because step 1.8 already implemented the resolver logic**

Run: `npx vitest run server/__tests__/license.test.js`
Expected: all 10 tests pass.

- [ ] **Step 1.12: Update `server/middleware/require-tier.js` to pass a single-key stub resolver**

Replace `resolveEffectiveTier` in [`server/middleware/require-tier.js`](../../server/middleware/require-tier.js) (lines 30–37) with:

```js
/**
 * Resolve the effective tier from Stripe subscription and/or license key.
 * Exported for testing.
 *
 * `publicKey` may be either a PEM string (legacy single-key) or a
 * `resolveKeyByKid` function (Phase 1 single-key stub, Phase 2+ multi-key map).
 */
export async function resolveEffectiveTier(stripeTier, licenseKey, publicKey) {
  if (stripeTier && stripeTier !== 'free') return stripeTier
  if (licenseKey && publicKey) {
    // Wrap a static key as a resolver that ignores kid (Phase 1 stub).
    // When Phase 2 ships multi-key support, callers pass a real lookup fn.
    const resolver = typeof publicKey === 'function'
      ? publicKey
      : () => publicKey
    const payload = await validateLicenseKey(licenseKey, resolver)
    if (payload && payload.tier) return payload.tier
  }
  return 'free'
}
```

- [ ] **Step 1.13: Run require-tier tests to confirm no regression**

Run: `npx vitest run server/__tests__/require-tier-license.test.js`
Expected: all existing tests pass unchanged.

- [ ] **Step 1.14: Commit**

```bash
git add server/lib/license.js server/middleware/require-tier.js server/__tests__/license.test.js
git commit -m "feat(license): add kid header, algorithms allowlist, and kid-resolver API

Prepares license.js for future key rotation (Phase 2+) without a
wire-format migration by landing the infrastructure now:

- generateLicenseKey accepts optional kid in opts and emits it in the
  protected header (backward compatible — existing callers still work)
- validateLicenseKey explicitly pins algorithms: ['EdDSA'] in jwtVerify
  as a seatbelt against future algorithm confusion regressions
- validateLicenseKey accepts either a static publicKeyPem string or a
  resolveKeyByKid function; require-tier.js wraps the existing single
  key as a single-key stub resolver

3 new tests cover the kid round-trip, alg confusion rejection, and
the resolver lookup API."
```

---

## Task 2: Scaffold `scripts/lib/minter.js` with error classes and test harness

**Files:**

- Create: `scripts/lib/minter.js`
- Create: `scripts/__tests__/minter.test.js`

**Rationale:** Start with just the 4 error class definitions + a minimal smoke test. Establishes the module skeleton, test file layout, and import paths before any real logic is written.

- [ ] **Step 2.1: Create the `scripts/lib/` directory structure**

Run: `mkdir -p "s:/Git Hub Repo Manager/scripts/lib" "s:/Git Hub Repo Manager/scripts/__tests__"`

- [ ] **Step 2.2: Create `scripts/lib/minter.js` with error classes only**

Create file `scripts/lib/minter.js` with content:

```js
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
// Commercial license: https://bolalabs.pt/license

/**
 * License minting primitives. Lives under scripts/lib/ (not server/lib/)
 * because this module runs in GitHub Action VMs and future Phase 2 Node
 * contexts — it never loads as part of the running Express server.
 *
 * See: docs/specs/2026-04-11-license-mint-automation-design.md
 */

/** Base class so `instanceof Error` + step-level matching both work. */
class MinterError extends Error {
  constructor(message, step) {
    super(message)
    this.name = this.constructor.name
    this.step = step
  }
}

export class InputValidationError extends MinterError {
  constructor(message) { super(message, 'validate') }
}

export class MintError extends MinterError {
  constructor(message) { super(message, 'mint') }
}

export class DeliveryError extends MinterError {
  constructor(message, { lid } = {}) {
    super(message, 'deliver')
    this.lid = lid
  }
}

export class AuditWriteError extends MinterError {
  constructor(message, { lastSha } = {}) {
    super(message, 'audit')
    this.lastSha = lastSha
  }
}
```

- [ ] **Step 2.3: Create `scripts/__tests__/minter.test.js` with smoke tests for the error classes**

Create file `scripts/__tests__/minter.test.js` with content:

```js
import { describe, it, expect } from 'vitest'
import {
  InputValidationError,
  MintError,
  DeliveryError,
  AuditWriteError,
} from '../lib/minter.js'

describe('minter error classes', () => {
  it('InputValidationError carries the "validate" step', () => {
    const e = new InputValidationError('bad tier')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('InputValidationError')
    expect(e.step).toBe('validate')
    expect(e.message).toBe('bad tier')
  })

  it('MintError carries the "mint" step', () => {
    const e = new MintError('key import failed')
    expect(e.step).toBe('mint')
  })

  it('DeliveryError carries the "deliver" step + optional lid', () => {
    const e = new DeliveryError('resend 500', { lid: 'lic_abc' })
    expect(e.step).toBe('deliver')
    expect(e.lid).toBe('lic_abc')
  })

  it('AuditWriteError carries the "audit" step + optional lastSha', () => {
    const e = new AuditWriteError('3 conflicts', { lastSha: 'abc123' })
    expect(e.step).toBe('audit')
    expect(e.lastSha).toBe('abc123')
  })
})
```

- [ ] **Step 2.4: Run the tests and verify they pass**

Run: `npx vitest run scripts/__tests__/minter.test.js`
Expected: 4 tests pass.

- [ ] **Step 2.5: Verify vitest resolves the new test directory**

The project's `vitest` configuration auto-discovers any `*.test.js` under the repo root. Confirm by running the full suite:

Run: `npx vitest run 2>&1 | tail -5`
Expected: output includes `minter.test.js (4 tests)` and total test count is +4 from baseline.

- [ ] **Step 2.6: Commit**

```bash
git add scripts/lib/minter.js scripts/__tests__/minter.test.js
git commit -m "feat(minter): scaffold scripts/lib/minter.js with error classes

Creates the primitives module under scripts/lib/ (not server/lib/)
because it runs exclusively in GitHub Action VMs and future Phase 2
standalone Node processes — never as part of the running Express server.

Lands only the 4 step-typed error classes (InputValidationError,
MintError, DeliveryError, AuditWriteError) and a smoke test. Subsequent
tasks fill in validateInput, mintLicense, deliverLicense, and logMint."
```

---

## Task 3: Implement `validateInput` primitive

**Files:**

- Modify: `scripts/lib/minter.js` (add `validateInput` export)
- Modify: `scripts/__tests__/minter.test.js` (add `validateInput` tests)

**Rationale:** Spec §2 specifies the exact validation rules. Centralizing validation in one primitive means Phase 2's Express route gets the same rules for free.

- [ ] **Step 3.1: Write failing tests for `validateInput`**

Add this block to the end of `scripts/__tests__/minter.test.js` (before the final closing brace):

```js
import { validateInput } from '../lib/minter.js'

describe('validateInput', () => {
  const valid = {
    tier: 'enterprise',
    org: 'Bola Labs Dev',
    email: 'bruno@bolalabs.pt',
    seats: '100',
    months: '24',
    notes: 'Dev self-license',
  }

  it('accepts a fully-specified valid input and coerces numeric strings', () => {
    const result = validateInput(valid)
    expect(result).toEqual({
      tier: 'enterprise',
      org: 'Bola Labs Dev',
      email: 'bruno@bolalabs.pt',
      seats: 100,
      months: 24,
      notes: 'Dev self-license',
    })
  })

  it('accepts minimal input with defaults', () => {
    const result = validateInput({
      tier: 'pro',
      org: 'Acme',
      email: 'a@b.co',
    })
    expect(result.seats).toBe(1)
    expect(result.months).toBe(12)
    expect(result.notes).toBe('')
  })

  it('rejects unknown tier', () => {
    expect(() => validateInput({ ...valid, tier: 'free' }))
      .toThrow(/tier must be "pro" or "enterprise"/)
  })

  it('rejects empty org', () => {
    expect(() => validateInput({ ...valid, org: '' }))
      .toThrow(/org is required/)
  })

  it('rejects org longer than 200 chars', () => {
    expect(() => validateInput({ ...valid, org: 'x'.repeat(201) }))
      .toThrow(/org must be ≤ 200 characters/)
  })

  it('rejects malformed email', () => {
    expect(() => validateInput({ ...valid, email: 'not-an-email' }))
      .toThrow(/email is not a valid address/)
  })

  it('rejects email longer than 254 chars', () => {
    const longEmail = 'a'.repeat(245) + '@b.com'  // 251 chars — too long is 255+
    expect(() => validateInput({ ...valid, email: 'a'.repeat(250) + '@b.com' }))
      .toThrow(/email must be ≤ 254 characters/)
  })

  it('rejects seats < 1', () => {
    expect(() => validateInput({ ...valid, seats: '0' }))
      .toThrow(/seats must be an integer between 1 and 10000/)
  })

  it('rejects seats > 10000', () => {
    expect(() => validateInput({ ...valid, seats: '10001' }))
      .toThrow(/seats must be an integer between 1 and 10000/)
  })

  it('rejects months < 1', () => {
    expect(() => validateInput({ ...valid, months: '0' }))
      .toThrow(/months must be an integer between 1 and 24/)
  })

  it('rejects months > 24', () => {
    expect(() => validateInput({ ...valid, months: '25' }))
      .toThrow(/months must be an integer between 1 and 24/)
  })

  it('rejects notes longer than 500 chars', () => {
    expect(() => validateInput({ ...valid, notes: 'x'.repeat(501) }))
      .toThrow(/notes must be ≤ 500 characters/)
  })

  it('throws InputValidationError specifically', async () => {
    const { InputValidationError } = await import('../lib/minter.js')
    try {
      validateInput({ ...valid, tier: 'free' })
      expect.fail('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(InputValidationError)
      expect(e.step).toBe('validate')
    }
  })
})
```

- [ ] **Step 3.2: Run the tests to verify they all fail**

Run: `npx vitest run scripts/__tests__/minter.test.js`
Expected: all 13 `validateInput` tests fail with `validateInput is not a function`.

- [ ] **Step 3.3: Implement `validateInput` in `scripts/lib/minter.js`**

Append to `scripts/lib/minter.js` (after the error classes):

```js
const TIERS = new Set(['pro', 'enterprise'])
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
const ORG_MAX = 200
const EMAIL_MAX = 254
const NOTES_MAX = 500
const SEATS_MIN = 1
const SEATS_MAX = 10000
const MONTHS_MIN = 1
const MONTHS_MAX = 24

function toPositiveInt(value, label, min, max) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new InputValidationError(`${label} must be an integer between ${min} and ${max}`)
  }
  return n
}

/**
 * Validate and normalize workflow inputs.
 *
 * Accepts string values (as produced by GitHub Actions workflow_dispatch
 * inputs, which are always strings) and returns numeric types where
 * appropriate.
 *
 * Throws InputValidationError on any failure. Runs before any crypto.
 */
export function validateInput(raw) {
  const tier = typeof raw.tier === 'string' ? raw.tier.trim() : ''
  if (!TIERS.has(tier)) {
    throw new InputValidationError('tier must be "pro" or "enterprise"')
  }

  const org = typeof raw.org === 'string' ? raw.org.trim() : ''
  if (!org) throw new InputValidationError('org is required')
  if (org.length > ORG_MAX) throw new InputValidationError(`org must be ≤ ${ORG_MAX} characters`)

  const email = typeof raw.email === 'string' ? raw.email.trim() : ''
  if (!email) throw new InputValidationError('email is required')
  if (email.length > EMAIL_MAX) throw new InputValidationError(`email must be ≤ ${EMAIL_MAX} characters`)
  if (!EMAIL_REGEX.test(email)) throw new InputValidationError('email is not a valid address')

  const seats = toPositiveInt(raw.seats ?? '1', 'seats', SEATS_MIN, SEATS_MAX)
  const months = toPositiveInt(raw.months ?? '12', 'months', MONTHS_MIN, MONTHS_MAX)

  const notes = typeof raw.notes === 'string' ? raw.notes : ''
  if (notes.length > NOTES_MAX) throw new InputValidationError(`notes must be ≤ ${NOTES_MAX} characters`)

  return { tier, org, email, seats, months, notes }
}
```

- [ ] **Step 3.4: Run the tests to verify they pass**

Run: `npx vitest run scripts/__tests__/minter.test.js`
Expected: all 17 tests in the file pass (4 error class + 13 validateInput).

- [ ] **Step 3.5: Commit**

```bash
git add scripts/lib/minter.js scripts/__tests__/minter.test.js
git commit -m "feat(minter): add validateInput primitive with strict bounds

Implements the single source of truth for input validation before any
mint crypto runs. Enforces tier allowlist, RFC-ish email regex, length
caps (org ≤ 200, email ≤ 254, notes ≤ 500), and numeric bounds
(seats 1-10000, months 1-24 — the 24-month cap limits key-compromise
tail risk per the expert security review).

13 tests cover valid cases, defaults, and every failure mode."
```

---

## Task 4: Implement `mintLicense` primitive

**Files:**

- Modify: `scripts/lib/minter.js` (add `mintLicense` export)
- Modify: `scripts/__tests__/minter.test.js` (add `mintLicense` tests)

**Rationale:** `mintLicense` wraps `generateLicenseKey` from `server/lib/license.js` with: the `kid` injection, the `::add-mask::` emission as its first action, and the dry-run short-circuit that returns `key: null`. Keeping the masking inside `mintLicense` is defense-in-depth with the YAML-level masking from Step 9.

- [ ] **Step 4.1: Write failing tests for `mintLicense`**

Add to `scripts/__tests__/minter.test.js` at the end (before the closing brace):

```js
import { mintLicense } from '../lib/minter.js'
import { generateKeyPair, validateLicenseKey } from '../../server/lib/license.js'

describe('mintLicense', () => {
  let privateKey, publicKey

  beforeAll(async () => {
    const pair = await generateKeyPair()
    privateKey = pair.privateKey
    publicKey = pair.publicKey
  })

  const validInput = {
    tier: 'enterprise',
    org: 'Bola Labs Dev',
    email: 'bruno@bolalabs.pt',
    seats: 100,
    months: 24,
    notes: 'Dev self-license',
  }

  it('returns { key, payload, fingerprint, kid } for a normal mint', async () => {
    const result = await mintLicense(validInput, {
      privateKeyPem: privateKey,
      publicKeyPem: publicKey,
      kid: 'k-test-01',
      dryRun: false,
    })
    expect(result.key).toMatch(/^grm_lic_/)
    expect(result.payload).toBeDefined()
    expect(result.payload.tier).toBe('enterprise')
    expect(result.payload.org).toBe('Bola Labs Dev')
    expect(result.payload.seats).toBe(100)
    expect(result.fingerprint).toMatch(/^SHA256:/)
    expect(result.kid).toBe('k-test-01')
  })

  it('produces a key that validates round-trip with the public key', async () => {
    const result = await mintLicense(validInput, {
      privateKeyPem: privateKey,
      publicKeyPem: publicKey,
      kid: 'k-test-02',
      dryRun: false,
    })
    const verified = await validateLicenseKey(result.key, publicKey)
    expect(verified).not.toBeNull()
    expect(verified.org).toBe('Bola Labs Dev')
    expect(verified.tier).toBe('enterprise')
  })

  it('returns key: null in dry-run mode (nothing to leak)', async () => {
    const result = await mintLicense(validInput, {
      privateKeyPem: privateKey,
      publicKeyPem: publicKey,
      kid: 'k-test-03',
      dryRun: true,
    })
    expect(result.key).toBeNull()
    expect(result.payload).toBeDefined()
    expect(result.payload.tier).toBe('enterprise')
    expect(result.fingerprint).toMatch(/^SHA256:/)
  })

  it('emits ::add-mask:: on the key to stdout before returning', async () => {
    const originalWrite = process.stdout.write.bind(process.stdout)
    const captured = []
    process.stdout.write = (chunk, ...rest) => {
      captured.push(String(chunk))
      return originalWrite(chunk, ...rest)
    }
    try {
      await mintLicense(validInput, {
        privateKeyPem: privateKey,
        publicKeyPem: publicKey,
        kid: 'k-test-04',
        dryRun: false,
      })
    } finally {
      process.stdout.write = originalWrite
    }
    const joined = captured.join('')
    expect(joined).toMatch(/::add-mask::grm_lic_/)
  })

  it('does NOT emit ::add-mask:: in dry-run mode (no key to mask)', async () => {
    const originalWrite = process.stdout.write.bind(process.stdout)
    const captured = []
    process.stdout.write = (chunk, ...rest) => {
      captured.push(String(chunk))
      return originalWrite(chunk, ...rest)
    }
    try {
      await mintLicense(validInput, {
        privateKeyPem: privateKey,
        publicKeyPem: publicKey,
        kid: 'k-test-05',
        dryRun: true,
      })
    } finally {
      process.stdout.write = originalWrite
    }
    const joined = captured.join('')
    expect(joined).not.toMatch(/::add-mask::grm_lic_/)
  })

  it('throws MintError on invalid private key PEM', async () => {
    const { MintError } = await import('../lib/minter.js')
    await expect(
      mintLicense(validInput, {
        privateKeyPem: 'not a pem',
        publicKeyPem: publicKey,
        kid: 'k-test-06',
        dryRun: false,
      })
    ).rejects.toBeInstanceOf(MintError)
  })
})
```

Also add `import { beforeAll } from 'vitest'` to the top of `scripts/__tests__/minter.test.js` by updating the existing import line:

```js
import { describe, it, expect, beforeAll } from 'vitest'
```

- [ ] **Step 4.2: Run the tests to verify they fail**

Run: `npx vitest run scripts/__tests__/minter.test.js`
Expected: all 6 `mintLicense` tests fail with `mintLicense is not a function`.

- [ ] **Step 4.3: Implement `mintLicense` in `scripts/lib/minter.js`**

First add the import at the top of `scripts/lib/minter.js` (after the existing header comment):

```js
import { generateLicenseKey } from '../../server/lib/license.js'
import { createHash } from 'node:crypto'
```

Then append after `validateInput`:

```js
/**
 * Compute a short fingerprint of a public key PEM for cross-referencing
 * audit entries with the signing keypair. Used for "which key signed this?"
 * lookups after future key rotation.
 */
function fingerprintPublicKey(publicKeyPem) {
  const hash = createHash('sha256').update(publicKeyPem).digest('hex')
  return 'SHA256:' + hash.slice(0, 32)
}

/**
 * Mint a license key from validated input.
 *
 * Contract:
 *  - On success, emits `::add-mask::<key>` to stdout as the FIRST action
 *    after signing, so GitHub Actions redacts the key in every subsequent
 *    log line (including exception stack traces).
 *  - In dry-run mode, returns { key: null, ... } — the key string is never
 *    populated, so there is nothing to leak.
 *  - Throws MintError wrapping any underlying crypto error.
 */
export async function mintLicense(validatedInput, options) {
  const { privateKeyPem, publicKeyPem, kid, dryRun } = options
  if (!privateKeyPem) throw new MintError('privateKeyPem is required')
  if (!publicKeyPem) throw new MintError('publicKeyPem is required')
  if (!kid) throw new MintError('kid is required')

  const fingerprint = fingerprintPublicKey(publicKeyPem)
  let key
  let payload
  try {
    key = await generateLicenseKey({ ...validatedInput, kid }, privateKeyPem)
    // Parse the payload by validating the key we just minted. This gives us
    // the exact payload (with lid and timestamps) for the audit log.
    const { validateLicenseKey } = await import('../../server/lib/license.js')
    payload = await validateLicenseKey(key, publicKeyPem)
    if (!payload) throw new Error('minted key failed round-trip validation')
  } catch (e) {
    throw new MintError(`mint failed: ${e.message}`)
  }

  if (dryRun) {
    // Do not populate `key`, do not emit ::add-mask::. Nothing to leak.
    return { key: null, payload, fingerprint, kid }
  }

  // FIRST action after signing — mask the key in GitHub Actions logs.
  // This is defense-in-depth with the YAML-level masking in the workflow.
  process.stdout.write(`::add-mask::${key}\n`)

  return { key, payload, fingerprint, kid }
}
```

- [ ] **Step 4.4: Run the tests to verify they pass**

Run: `npx vitest run scripts/__tests__/minter.test.js`
Expected: all 23 tests pass (4 error + 13 validate + 6 mint).

- [ ] **Step 4.5: Commit**

```bash
git add scripts/lib/minter.js scripts/__tests__/minter.test.js
git commit -m "feat(minter): add mintLicense primitive with ::add-mask:: safety

mintLicense wraps generateLicenseKey from server/lib/license.js, injects
the kid header, computes a public key fingerprint for audit cross-
referencing, and (on success, non-dry-run) immediately emits
::add-mask::<key> to stdout so GitHub Actions redacts the key in every
subsequent log line — covering the case where a downstream crash
produces a stack trace containing the returned object.

In dry-run mode, returns { key: null, ... } so the key string is never
populated and there is literally nothing to leak.

6 tests cover success round-trip, dry-run, ::add-mask:: emission, and
MintError wrapping for malformed PEMs."
```

---

## Task 5: Implement `deliverLicense` primitive

**Files:**

- Modify: `scripts/lib/minter.js` (add `deliverLicense` export)
- Modify: `scripts/__tests__/minter.test.js` (add `deliverLicense` tests)

**Rationale:** Email delivery via Resend HTTP API. Text-only body (not HTML) to eliminate any stored-XSS risk from `notes` reaching the customer's email client.

- [ ] **Step 5.1: Write failing tests for `deliverLicense`**

Add to `scripts/__tests__/minter.test.js`:

```js
import { deliverLicense } from '../lib/minter.js'

describe('deliverLicense', () => {
  let fetchMock, originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
    fetchMock = vi.fn()
    global.fetch = fetchMock
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  const sampleLicense = {
    key: 'grm_lic_sample',
    payload: {
      lid: 'lic_abc',
      tier: 'enterprise',
      org: 'Bola Labs Dev',
      seats: 100,
      iat: 1744372800,
      exp: 2059732800,
    },
  }

  it('POSTs to Resend with correct headers and text/plain body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'resend-msg-001' }),
    })

    const result = await deliverLicense({
      ...sampleLicense,
      recipient: 'bruno@bolalabs.pt',
      fromEmail: 'licenses@bolalabs.pt',
      resendApiKey: 'test-key',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer test-key')
    expect(init.headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(init.body)
    expect(body.from).toBe('licenses@bolalabs.pt')
    expect(body.to).toEqual(['bruno@bolalabs.pt'])
    expect(body.subject).toMatch(/license key/i)
    expect(body.text).toContain('grm_lic_sample')
    expect(body.text).toContain('Enterprise')
    expect(body.text).toContain('Bola Labs Dev')
    // Must NOT send html — text only
    expect(body.html).toBeUndefined()

    expect(result).toEqual({ messageId: 'resend-msg-001' })
  })

  it('throws DeliveryError on non-2xx response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ message: 'rate limit' }),
    })

    const { DeliveryError } = await import('../lib/minter.js')
    await expect(
      deliverLicense({
        ...sampleLicense,
        recipient: 'bruno@bolalabs.pt',
        fromEmail: 'licenses@bolalabs.pt',
        resendApiKey: 'test-key',
      })
    ).rejects.toBeInstanceOf(DeliveryError)
  })

  it('attaches the lid to DeliveryError for recovery', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    })

    try {
      await deliverLicense({
        ...sampleLicense,
        recipient: 'bruno@bolalabs.pt',
        fromEmail: 'licenses@bolalabs.pt',
        resendApiKey: 'test-key',
      })
      expect.fail('should have thrown')
    } catch (e) {
      expect(e.lid).toBe('lic_abc')
      expect(e.message).toMatch(/500/)
    }
  })

  it('throws DeliveryError if fetch itself rejects (network error)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const { DeliveryError } = await import('../lib/minter.js')
    await expect(
      deliverLicense({
        ...sampleLicense,
        recipient: 'bruno@bolalabs.pt',
        fromEmail: 'licenses@bolalabs.pt',
        resendApiKey: 'test-key',
      })
    ).rejects.toBeInstanceOf(DeliveryError)
  })
})
```

Update the top-level imports in `scripts/__tests__/minter.test.js` to include the vitest helpers used by the new tests:

```js
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
```

- [ ] **Step 5.2: Run the tests to verify they fail**

Run: `npx vitest run scripts/__tests__/minter.test.js`
Expected: 4 `deliverLicense` tests fail with `deliverLicense is not a function`.

- [ ] **Step 5.3: Implement `deliverLicense` in `scripts/lib/minter.js`**

Append to `scripts/lib/minter.js`:

```js
/**
 * Format the license payload into a plaintext email body.
 * Text-only to eliminate stored-XSS risk from attacker-controlled `notes`
 * reaching customer email clients that render HTML.
 */
function formatEmailBody({ key, payload }) {
  const tierLabel = payload.tier === 'enterprise' ? 'Enterprise' : 'Pro'
  const issued = new Date(payload.iat * 1000).toISOString().slice(0, 10)
  const expires = new Date(payload.exp * 1000).toISOString().slice(0, 10)
  return [
    'Hi,',
    '',
    'Your license for GitHub Repo Manager is ready.',
    '',
    'License Key:',
    key,
    '',
    'Details:',
    `  Tier:         ${tierLabel}`,
    `  Organization: ${payload.org}`,
    `  Seats:        ${payload.seats}`,
    `  Issued:       ${issued}`,
    `  Expires:      ${expires}`,
    '',
    'To activate, add this line to your .env file:',
    '',
    `  LICENSE_KEY=${key}`,
    '',
    'Then restart the server. To verify activation, check the server logs for:',
    '',
    `  License validated: ${payload.tier} tier (org: ${payload.org}, expires: ${expires})`,
    '',
    'Questions? Reply to this email.',
    '',
    '— Bola Labs',
  ].join('\n')
}

/**
 * Send a license key to the recipient via Resend.
 *
 * Text-only body. Throws DeliveryError on non-2xx or network failure,
 * with `lid` attached so the caller can reconcile from the pending audit entry.
 */
export async function deliverLicense({ key, payload, recipient, fromEmail, resendApiKey }) {
  if (!key) throw new DeliveryError('key is required (cannot deliver a dry-run)', { lid: payload?.lid })
  if (!recipient) throw new DeliveryError('recipient is required', { lid: payload?.lid })
  if (!fromEmail) throw new DeliveryError('fromEmail is required', { lid: payload?.lid })
  if (!resendApiKey) throw new DeliveryError('resendApiKey is required', { lid: payload?.lid })

  const body = {
    from: fromEmail,
    to: [recipient],
    subject: 'Your GitHub Repo Manager license key',
    text: formatEmailBody({ key, payload }),
  }

  let response
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new DeliveryError(`network error: ${e.message}`, { lid: payload?.lid })
  }

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}))
    throw new DeliveryError(
      `Resend returned ${response.status}: ${errBody.message || 'unknown error'}`,
      { lid: payload?.lid }
    )
  }

  const json = await response.json()
  return { messageId: json.id }
}
```

- [ ] **Step 5.4: Run the tests to verify they pass**

Run: `npx vitest run scripts/__tests__/minter.test.js`
Expected: all 27 tests pass (23 prior + 4 deliver).

- [ ] **Step 5.5: Commit**

```bash
git add scripts/lib/minter.js scripts/__tests__/minter.test.js
git commit -m "feat(minter): add deliverLicense primitive (Resend, text-only)

POSTs a license key to the recipient via Resend with a text/plain body
(never HTML) to eliminate any stored-XSS risk from attacker-controlled
notes reaching the customer's email client. Throws DeliveryError with
the lid attached so the CLI wrapper can reconcile failed deliveries
against the pending audit entry.

4 tests cover the happy path, non-2xx failure, lid propagation in
errors, and network-level failures."
```

---

## Task 6: Implement `logMint` primitive with optimistic concurrency

**Files:**

- Modify: `scripts/lib/minter.js` (add `logMint` export)
- Modify: `scripts/__tests__/minter.test.js` (add `logMint` tests)

**Rationale:** Spec §4 "Audit repo layout" + the two-phase audit pattern. `logMint` writes to `licenses.jsonl` via GitHub Contents REST API with `sha`-based optimistic concurrency + retry-on-409.

- [ ] **Step 6.1: Write failing tests for `logMint`**

Add to `scripts/__tests__/minter.test.js`:

```js
import { logMint } from '../lib/minter.js'

describe('logMint', () => {
  let fetchMock, originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
    fetchMock = vi.fn()
    global.fetch = fetchMock
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  const sampleEntry = {
    status: 'pending',
    payload: {
      lid: 'lic_abc',
      tier: 'enterprise',
      org: 'Bola Labs Dev',
      email: 'bruno@bolalabs.pt',
      seats: 100,
      iat: 1744372800,
      exp: 2059732800,
    },
    fingerprint: 'SHA256:fp123',
    notes: 'Dev self-license',
    auditRepo: 'brunobola-portfolio/license-log',
    pat: 'test-pat',
    runId: '1234567890',
    kid: 'k-test-01',
  }

  // Helper to build a GET response for the contents API
  function contentsResponse(lines = [], sha = 'current-sha') {
    const content = Buffer.from(lines.join('\n') + (lines.length ? '\n' : '')).toString('base64')
    return {
      ok: true,
      status: 200,
      json: async () => ({ content, sha }),
    }
  }

  function notFoundResponse() {
    return { ok: false, status: 404, json: async () => ({ message: 'Not Found' }) }
  }

  function putSuccessResponse(commitSha = 'new-commit-sha') {
    return {
      ok: true,
      status: 200,
      json: async () => ({ commit: { sha: commitSha } }),
    }
  }

  function conflictResponse() {
    return { ok: false, status: 409, json: async () => ({ message: 'sha does not match' }) }
  }

  it('creates licenses.jsonl on first write (GET 404 → PUT without sha)', async () => {
    fetchMock
      .mockResolvedValueOnce(notFoundResponse())
      .mockResolvedValueOnce(putSuccessResponse('sha-init'))

    const result = await logMint(sampleEntry)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toContain('/repos/brunobola-portfolio/license-log/contents/licenses.jsonl')
    expect(fetchMock.mock.calls[0][1].method ?? 'GET').toBe('GET')

    const putCall = fetchMock.mock.calls[1]
    expect(putCall[1].method).toBe('PUT')
    const putBody = JSON.parse(putCall[1].body)
    expect(putBody.sha).toBeUndefined() // no sha on initial create
    const decoded = Buffer.from(putBody.content, 'base64').toString('utf8')
    expect(decoded).toMatch(/"lid":"lic_abc"/)
    expect(decoded).toMatch(/"status":"pending"/)
    // Must NOT include the key
    expect(decoded).not.toMatch(/"key":/)
    expect(result.commitSha).toBe('sha-init')
  })

  it('appends to existing licenses.jsonl (GET sha → PUT with sha)', async () => {
    const existing = ['{"lid":"lic_old","status":"delivered"}']
    fetchMock
      .mockResolvedValueOnce(contentsResponse(existing, 'old-sha'))
      .mockResolvedValueOnce(putSuccessResponse('new-sha'))

    await logMint(sampleEntry)

    const putCall = fetchMock.mock.calls[1]
    const putBody = JSON.parse(putCall[1].body)
    expect(putBody.sha).toBe('old-sha')
    const decoded = Buffer.from(putBody.content, 'base64').toString('utf8')
    // Old line preserved
    expect(decoded).toMatch(/"lid":"lic_old"/)
    // New line appended
    expect(decoded).toMatch(/"lid":"lic_abc"/)
    // Lines are newline-separated
    expect(decoded.split('\n').filter(Boolean).length).toBe(2)
  })

  it('retries on 409 Conflict with a fresh sha', async () => {
    fetchMock
      .mockResolvedValueOnce(contentsResponse([], 'sha-attempt-1'))
      .mockResolvedValueOnce(conflictResponse())
      .mockResolvedValueOnce(contentsResponse([], 'sha-attempt-2'))
      .mockResolvedValueOnce(putSuccessResponse('sha-final'))

    const result = await logMint(sampleEntry)

    expect(fetchMock).toHaveBeenCalledTimes(4) // GET, PUT(fail), GET, PUT(success)
    expect(result.commitSha).toBe('sha-final')
  })

  it('throws AuditWriteError after 3 consecutive 409 conflicts', async () => {
    fetchMock.mockImplementation((url, init) => {
      if (!init || init.method !== 'PUT') return Promise.resolve(contentsResponse([], 'sha-race'))
      return Promise.resolve(conflictResponse())
    })

    const { AuditWriteError } = await import('../lib/minter.js')
    await expect(logMint(sampleEntry)).rejects.toBeInstanceOf(AuditWriteError)

    // 3 attempts × (GET + PUT) = 6 fetches
    expect(fetchMock.mock.calls.length).toBe(6)
  })

  it('JSON-stringifies the notes field (prevents raw concatenation)', async () => {
    fetchMock
      .mockResolvedValueOnce(notFoundResponse())
      .mockResolvedValueOnce(putSuccessResponse())

    const hostile = { ...sampleEntry, notes: 'line1\nline2","injected":"yes' }
    await logMint(hostile)

    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    const decoded = Buffer.from(putBody.content, 'base64').toString('utf8')
    // The decoded content is itself a JSONL line. Parse it to verify structural integrity.
    const parsed = JSON.parse(decoded.trim())
    expect(parsed.notes).toBe('line1\nline2","injected":"yes')
    // The "injected" field should NOT appear as a top-level field
    expect(parsed.injected).toBeUndefined()
  })

  it('writes delivered status with messageId on phase-2 audit update', async () => {
    fetchMock
      .mockResolvedValueOnce(contentsResponse([
        '{"lid":"lic_abc","status":"pending","tier":"enterprise"}',
      ], 'sha-1'))
      .mockResolvedValueOnce(putSuccessResponse('sha-2'))

    await logMint({
      ...sampleEntry,
      status: 'delivered',
      messageId: 'resend-msg-xyz',
    })

    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    const decoded = Buffer.from(putBody.content, 'base64').toString('utf8')
    // Both entries present (supersede append pattern)
    expect(decoded).toMatch(/"status":"pending"/)
    expect(decoded).toMatch(/"status":"delivered"/)
    expect(decoded).toMatch(/"messageId":"resend-msg-xyz"/)
  })
})
```

- [ ] **Step 6.2: Run the tests to verify they fail**

Run: `npx vitest run scripts/__tests__/minter.test.js`
Expected: 6 `logMint` tests fail with `logMint is not a function`.

- [ ] **Step 6.3: Implement `logMint` in `scripts/lib/minter.js`**

Append to `scripts/lib/minter.js`:

```js
const MAX_AUDIT_RETRIES = 3

/**
 * Build a single JSONL entry (one line, no trailing newline).
 * Uses JSON.stringify on the full object so `notes` and other string
 * fields are safely encoded — never concatenated into a template literal.
 */
function buildAuditEntry({ status, payload, fingerprint, notes, messageId, runId, kid }) {
  const entry = {
    ts: new Date().toISOString(),
    status,
    lid: payload.lid,
    kid,
    tier: payload.tier,
    org: payload.org,
    email: payload.email,
    seats: payload.seats,
    issuedAt: new Date(payload.iat * 1000).toISOString(),
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    fingerprint,
    notes: notes || '',
    mintedBy: 'github-actions',
    runId: runId || null,
    messageId: messageId || null,
    dryRun: false,
  }
  return JSON.stringify(entry)
}

/**
 * Fetch + decode the current licenses.jsonl from the audit repo.
 * Returns { sha, lines } on 200, { sha: null, lines: [] } on 404.
 * Throws on any other error.
 */
async function fetchAuditFile({ auditRepo, pat, filename }) {
  const url = `https://api.github.com/repos/${auditRepo}/contents/${filename}`
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (response.status === 404) return { sha: null, lines: [] }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new AuditWriteError(`GET audit failed: ${response.status} ${err.message || ''}`)
  }
  const body = await response.json()
  const content = Buffer.from(body.content, 'base64').toString('utf8')
  const lines = content.split('\n').filter(Boolean)
  return { sha: body.sha, lines }
}

/**
 * Put updated content to the audit file. sha is optional (absent = create).
 * Returns the new commit sha on success; throws AuditWriteError on 409 or other failure.
 */
async function putAuditFile({ auditRepo, pat, filename, sha, contentBase64, message }) {
  const url = `https://api.github.com/repos/${auditRepo}/contents/${filename}`
  const body = {
    message,
    content: contentBase64,
  }
  if (sha) body.sha = sha
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (response.status === 409) {
    throw new AuditWriteError('409 Conflict (sha mismatch)', { lastSha: sha })
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new AuditWriteError(`PUT audit failed: ${response.status} ${err.message || ''}`, { lastSha: sha })
  }
  const json = await response.json()
  return json.commit?.sha || 'unknown'
}

/**
 * Append (supersede pattern) a new audit entry to licenses.jsonl.
 *
 * Two-phase pattern: called first with status=pending (before email delivery),
 * then again with status=delivered (after). Each call APPENDS — the delivered
 * entry does not replace the pending entry, it supersedes it. Readers of the
 * audit file must collapse entries by `lid` at read time, interpreting the
 * latest entry as authoritative.
 *
 * Uses GitHub Contents API with optimistic concurrency (sha on PUT, retry on 409).
 * Entries NEVER include the license `key` field — only metadata.
 */
export async function logMint(params) {
  const {
    status, payload, fingerprint, notes, messageId,
    auditRepo, pat, runId, kid,
  } = params

  if (!auditRepo) throw new AuditWriteError('auditRepo is required')
  if (!pat) throw new AuditWriteError('pat is required')
  if (!payload?.lid) throw new AuditWriteError('payload.lid is required')

  const filename = 'licenses.jsonl'
  const entry = buildAuditEntry({ status, payload, fingerprint, notes, messageId, runId, kid })
  const commitMessage = `${status}: ${payload.lid} (${payload.tier}, ${payload.org})`

  let lastError
  for (let attempt = 1; attempt <= MAX_AUDIT_RETRIES; attempt++) {
    try {
      const { sha, lines } = await fetchAuditFile({ auditRepo, pat, filename })
      const newLines = [...lines, entry]
      const contentBase64 = Buffer.from(newLines.join('\n') + '\n').toString('base64')
      const commitSha = await putAuditFile({
        auditRepo, pat, filename, sha, contentBase64, message: commitMessage,
      })
      return { commitSha, entryIndex: newLines.length - 1 }
    } catch (e) {
      lastError = e
      if (e instanceof AuditWriteError && e.message.startsWith('409')) {
        // Retry on conflict — loop continues to refresh sha
        continue
      }
      throw e
    }
  }
  throw new AuditWriteError(
    `audit write failed after ${MAX_AUDIT_RETRIES} attempts (409 conflicts)`,
    { lastSha: lastError?.lastSha }
  )
}
```

- [ ] **Step 6.4: Run the tests to verify they pass**

Run: `npx vitest run scripts/__tests__/minter.test.js`
Expected: all 33 tests pass (27 prior + 6 logMint).

- [ ] **Step 6.5: Commit**

```bash
git add scripts/lib/minter.js scripts/__tests__/minter.test.js
git commit -m "feat(minter): add logMint primitive with optimistic concurrency

Implements the two-phase audit write pattern via GitHub Contents REST
API. logMint is called once with status=pending (before delivery) and
once with status=delivered (after), each time APPENDING a new JSONL
line — the supersede pattern keeps git diffs trivial and tamper-
evident. Readers collapse entries by lid at read time.

Optimistic concurrency via sha-on-PUT + retry-on-409 (up to 3 attempts)
survives concurrent writes from Dependabot/manual edits/future Phase 2
VPS writers. After 3 conflicts, throws AuditWriteError.

Audit entries NEVER contain the license key string — only lid + metadata.
JSON.stringify is used throughout to prevent notes-field injection.

6 tests cover: first-write (no sha), append (with sha), retry-on-409,
3-attempt exhaustion, notes injection resistance, and phase-2 supersede."
```

---

## Task 7: Implement `scripts/mint-license-action.js` CLI wrapper

**Files:**

- Create: `scripts/mint-license-action.js`
- Create: `scripts/__tests__/mint-license-action.test.js`

**Rationale:** The composition point. Orchestrates the 5-step flow (validate → mint → logMint(pending) → deliver → logMint(delivered)), maps primitive errors to exit codes, and writes `$GITHUB_STEP_SUMMARY`.

- [ ] **Step 7.1: Write failing tests for the CLI wrapper**

Create `scripts/__tests__/mint-license-action.test.js` with content:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The action script is invoked as a module; we import its default exported
// `runMintAction({ env, writers })` function so we can drive it without
// actually spawning node or touching real env.

import { runMintAction } from '../mint-license-action.js'

describe('mint-license-action', () => {
  let tmpDir, summaryPath, env

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mint-action-'))
    summaryPath = join(tmpDir, 'summary')
    writeFileSync(summaryPath, '')
    env = {
      LICENSE_PRIVATE_PEM: '__WILL_BE_REPLACED_PER_TEST__',
      // Test override: in production the script reads keys/public.pem from
      // disk after checkout. Tests inject a matching throwaway keypair via
      // env.PUBLIC_KEY_PEM so we don't need a real committed key for tests.
      PUBLIC_KEY_PEM: '__WILL_BE_REPLACED_PER_TEST__',
      RESEND_API_KEY: 'resend-test',
      LICENSE_LOG_PAT: 'pat-test',
      AUDIT_REPO: 'brunobola-portfolio/license-log',
      FROM_EMAIL: 'licenses@bolalabs.pt',
      TIER: 'enterprise',
      ORG: 'Test Co',
      EMAIL: 'test@example.com',
      SEATS: '10',
      MONTHS: '12',
      NOTES: 'Test',
      DRY_RUN: 'false',
      GITHUB_RUN_ID: '1000',
      GITHUB_STEP_SUMMARY: summaryPath,
      KID: 'k-test',
    }
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('runs the happy path: validate -> mint -> pending -> deliver -> delivered -> exit 0', async () => {
    // Generate a real keypair for this test so mintLicense works end-to-end
    const { generateKeyPair } = await import('../../server/lib/license.js')
    const pair = await generateKeyPair()
    env.LICENSE_PRIVATE_PEM = pair.privateKey
    env.PUBLIC_KEY_PEM = pair.publicKey

    // Mock fetch for Resend + GitHub Contents API
    const originalFetch = global.fetch
    let fetchCalls = 0
    global.fetch = vi.fn((url, init) => {
      fetchCalls++
      if (url.includes('api.resend.com')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'msg-001' }) })
      }
      if (url.includes('api.github.com') && (init?.method === 'GET' || !init?.method)) {
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
      }
      if (url.includes('api.github.com') && init?.method === 'PUT') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ commit: { sha: 'abc123' } }) })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    let exitCode
    try {
      exitCode = await runMintAction({ env })
    } finally {
      global.fetch = originalFetch
    }

    expect(exitCode).toBe(0)
    expect(fetchCalls).toBeGreaterThanOrEqual(4) // at minimum: GET, PUT, Resend POST, GET, PUT

    const summary = readFileSync(summaryPath, 'utf8')
    expect(summary).toMatch(/tier.*enterprise/i)
    expect(summary).toMatch(/Test Co/)
    expect(summary).toMatch(/lic_/)
    // Must NOT contain the full license key
    expect(summary).not.toMatch(/grm_lic_[A-Za-z0-9._-]{20}/)
  })

  it('dry-run short-circuits after mint: no fetch, summary only', async () => {
    const { generateKeyPair } = await import('../../server/lib/license.js')
    const pair = await generateKeyPair()
    env.LICENSE_PRIVATE_PEM = pair.privateKey
    env.PUBLIC_KEY_PEM = pair.publicKey
    env.DRY_RUN = 'true'

    const originalFetch = global.fetch
    global.fetch = vi.fn(() => {
      throw new Error('dry-run should not call fetch')
    })

    let exitCode
    try {
      exitCode = await runMintAction({ env })
    } finally {
      global.fetch = originalFetch
    }

    expect(exitCode).toBe(0)
    expect(global.fetch).not.toHaveBeenCalled()

    const summary = readFileSync(summaryPath, 'utf8')
    expect(summary).toMatch(/dry.run/i)
  })

  it('exits 2 on InputValidationError', async () => {
    env.TIER = 'free'  // invalid
    env.LICENSE_PRIVATE_PEM = 'will-not-be-used'
    env.PUBLIC_KEY_PEM = 'will-not-be-used'

    const exitCode = await runMintAction({ env })
    expect(exitCode).toBe(2)
  })

  it('exits 5 on DeliveryError and leaves pending audit entry intact', async () => {
    const { generateKeyPair } = await import('../../server/lib/license.js')
    const pair = await generateKeyPair()
    env.LICENSE_PRIVATE_PEM = pair.privateKey
    env.PUBLIC_KEY_PEM = pair.publicKey

    const originalFetch = global.fetch
    const ghCalls = { get: 0, put: 0 }
    global.fetch = vi.fn((url, init) => {
      if (url.includes('api.resend.com')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ message: 'resend down' }) })
      }
      if (url.includes('api.github.com')) {
        if (init?.method === 'PUT') {
          ghCalls.put++
          return Promise.resolve({ ok: true, status: 200, json: async () => ({ commit: { sha: 'abc' } }) })
        }
        ghCalls.get++
        return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    let exitCode
    try {
      exitCode = await runMintAction({ env })
    } finally {
      global.fetch = originalFetch
    }

    expect(exitCode).toBe(5)
    // Pending audit write must have happened (one PUT for pending)
    expect(ghCalls.put).toBe(1)
  })
})
```

- [ ] **Step 7.2: Run the tests to verify they fail**

Run: `npx vitest run scripts/__tests__/mint-license-action.test.js`
Expected: tests fail with "Cannot find module '../mint-license-action.js'" or similar.

- [ ] **Step 7.3: Implement `scripts/mint-license-action.js`**

Create file `scripts/mint-license-action.js` with content:

```js
#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
// Commercial license: https://bolalabs.pt/license

/**
 * mint-license-action.js — CLI composition point for the GH Actions mint workflow.
 *
 * Invoked by .github/workflows/mint-license.yml. Reads config from env vars,
 * composes the primitives in scripts/lib/minter.js in order, maps errors to
 * exit codes, and writes $GITHUB_STEP_SUMMARY.
 *
 * Exit codes:
 *   0 — success (or dry-run success)
 *   2 — InputValidationError
 *   3 — MintError
 *   4 — AuditWriteError (pending phase)
 *   5 — DeliveryError
 *   6 — AuditWriteError (delivered phase)
 *   1 — any other error
 */

import { readFileSync, appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  validateInput,
  mintLicense,
  deliverLicense,
  logMint,
  InputValidationError,
  MintError,
  DeliveryError,
  AuditWriteError,
} from './lib/minter.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const DEFAULT_PUBLIC_KEY_PATH = join(REPO_ROOT, 'keys', 'public.pem')

/**
 * Resolve the public key from env or disk.
 *
 * Tests set env.PUBLIC_KEY_PEM directly (they generate a throwaway keypair).
 * In production the workflow does not set it — the script reads the committed
 * keys/public.pem so there is a single source of truth. If Bruno ever rotates,
 * he updates both keys/public.pem (committed) and LICENSE_PRIVATE_PEM (GH Secret)
 * in the same PR, which makes misalignment impossible.
 */
function resolvePublicKey(env) {
  if (env.PUBLIC_KEY_PEM) return env.PUBLIC_KEY_PEM
  return readFileSync(DEFAULT_PUBLIC_KEY_PATH, 'utf8')
}

function writeSummary(summaryPath, lines) {
  if (!summaryPath) return
  try {
    appendFileSync(summaryPath, lines.join('\n') + '\n', 'utf8')
  } catch {
    // Best-effort; don't fail the mint because summary append failed
  }
}

export async function runMintAction({ env }) {
  const summaryPath = env.GITHUB_STEP_SUMMARY
  const runId = env.GITHUB_RUN_ID
  const kid = env.KID || 'k-default'
  const dryRun = env.DRY_RUN === 'true'

  // ---- Step 1: validate input
  let input
  try {
    input = validateInput({
      tier: env.TIER,
      org: env.ORG,
      email: env.EMAIL,
      seats: env.SEATS,
      months: env.MONTHS,
      notes: env.NOTES,
    })
  } catch (e) {
    process.stderr.write(`[validate] ${e.message}\n`)
    writeSummary(summaryPath, ['## ❌ License mint failed', '', `**Step:** validate`, `**Error:** ${e.message}`])
    return 2
  }

  // ---- Step 2: mint license
  let license
  let publicKeyPem
  try {
    publicKeyPem = resolvePublicKey(env)
  } catch (e) {
    process.stderr.write(`[mint] public key load failed: ${e.message}\n`)
    writeSummary(summaryPath, ['## ❌ License mint failed', '', `**Step:** mint`, `**Error:** cannot load public key: ${e.message}`])
    return 3
  }
  try {
    license = await mintLicense(input, {
      privateKeyPem: env.LICENSE_PRIVATE_PEM,
      publicKeyPem,
      kid,
      dryRun,
    })
  } catch (e) {
    process.stderr.write(`[mint] ${e.message}\n`)
    writeSummary(summaryPath, ['## ❌ License mint failed', '', `**Step:** mint`, `**Error:** ${e.message}`])
    return 3
  }

  // ---- Dry-run short-circuit: metadata summary + exit
  if (dryRun) {
    writeSummary(summaryPath, [
      '## 🧪 Dry-run mint (no email sent, no audit commit)',
      '',
      `| Field | Value |`,
      `|---|---|`,
      `| tier | ${license.payload.tier} |`,
      `| org | ${license.payload.org} |`,
      `| email | ${license.payload.email} |`,
      `| seats | ${license.payload.seats} |`,
      `| lid | ${license.payload.lid} |`,
      `| kid | ${license.kid} |`,
      `| fingerprint | ${license.fingerprint} |`,
      `| expiresAt | ${new Date(license.payload.exp * 1000).toISOString().slice(0, 10)} |`,
    ])
    return 0
  }

  // ---- Step 3: logMint(pending) — record BEFORE delivery
  try {
    await logMint({
      status: 'pending',
      payload: license.payload,
      fingerprint: license.fingerprint,
      notes: input.notes,
      auditRepo: env.AUDIT_REPO,
      pat: env.LICENSE_LOG_PAT,
      runId,
      kid: license.kid,
    })
  } catch (e) {
    process.stderr.write(`[audit-pending] ${e.message}\n`)
    writeSummary(summaryPath, ['## ❌ License mint failed', '', `**Step:** audit-pending`, `**Error:** ${e.message}`])
    return 4
  }

  // ---- Step 4: deliver
  let delivery
  try {
    delivery = await deliverLicense({
      key: license.key,
      payload: license.payload,
      recipient: input.email,
      fromEmail: env.FROM_EMAIL,
      resendApiKey: env.RESEND_API_KEY,
    })
  } catch (e) {
    process.stderr.write(`[deliver] ${e.message} (lid=${e.lid})\n`)
    writeSummary(summaryPath, [
      '## ⚠️ License minted but not delivered',
      '',
      `**Step:** deliver`,
      `**Error:** ${e.message}`,
      `**lid:** ${license.payload.lid} (recoverable from audit \`pending\` entry)`,
      `**fingerprint:** ${license.fingerprint}`,
    ])
    return 5
  }

  // ---- Step 5: logMint(delivered) — supersede the pending entry
  try {
    await logMint({
      status: 'delivered',
      payload: license.payload,
      fingerprint: license.fingerprint,
      notes: input.notes,
      messageId: delivery.messageId,
      auditRepo: env.AUDIT_REPO,
      pat: env.LICENSE_LOG_PAT,
      runId,
      kid: license.kid,
    })
  } catch (e) {
    process.stderr.write(`[audit-delivered] ${e.message}\n`)
    writeSummary(summaryPath, [
      '## ⚠️ License delivered but delivered-status audit write failed',
      '',
      `**Step:** audit-delivered`,
      `**Error:** ${e.message}`,
      `**lid:** ${license.payload.lid}`,
      `**messageId:** ${delivery.messageId}`,
      `**Note:** customer has the working key. Audit shows \`pending\` forever. Manually reconcile if needed.`,
    ])
    return 6
  }

  // ---- Success summary
  writeSummary(summaryPath, [
    '## ✅ License minted and delivered',
    '',
    `| Field | Value |`,
    `|---|---|`,
    `| tier | ${license.payload.tier} |`,
    `| org | ${license.payload.org} |`,
    `| email | ${license.payload.email} |`,
    `| seats | ${license.payload.seats} |`,
    `| lid | ${license.payload.lid} |`,
    `| kid | ${license.kid} |`,
    `| fingerprint | ${license.fingerprint} |`,
    `| expiresAt | ${new Date(license.payload.exp * 1000).toISOString().slice(0, 10)} |`,
    `| messageId | ${delivery.messageId} |`,
  ])
  return 0
}

// Main entry when run as a script (not imported by tests)
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('mint-license-action.js')) {
  runMintAction({ env: process.env }).then((code) => process.exit(code ?? 1)).catch((e) => {
    process.stderr.write(`[fatal] ${e.message}\n`)
    process.exit(1)
  })
}
```

- [ ] **Step 7.4: Run the tests to verify they pass**

Run: `npx vitest run scripts/__tests__/mint-license-action.test.js`
Expected: all 4 tests pass.

- [ ] **Step 7.5: Run the full test suite to verify no regressions**

Run: `npx vitest run 2>&1 | tail -10`
Expected: all prior tests still pass + new tests from Tasks 1–7.

- [ ] **Step 7.6: Commit**

```bash
git add scripts/mint-license-action.js scripts/__tests__/mint-license-action.test.js
git commit -m "feat(minter): add mint-license-action.js CLI composition wrapper

The composition point for the GH Actions mint workflow. Reads config
from env vars, runs the 5-step flow (validate -> mint -> pending audit
-> deliver -> delivered audit) and maps each primitive's error class
to a distinct exit code (2/3/4/5/6).

The two-phase audit pattern means a Resend failure after the pending
entry is recoverable: the lid is already in the audit trail, the summary
surfaces it for manual reconciliation, and the customer simply gets
re-minted.

Dry-run short-circuits after mint: no fetch to GitHub or Resend,
metadata-only summary written, exit 0.

4 integration tests cover happy path, dry-run, validation failure,
and delivery failure with pending audit persistence."
```

---

## Task 8: Implement `scripts/mint-failure-notify.js`

**Files:**

- Create: `scripts/mint-failure-notify.js`
- Create: `scripts/__tests__/mint-failure-notify.test.js`

**Rationale:** The `if: failure()` step in the workflow YAML runs this standalone script. Kept separate from `mint-license-action.js` because the main script may have crashed before its own error handler could run — a completely independent process is needed for failure notifications.

- [ ] **Step 8.1: Write failing test**

Create `scripts/__tests__/mint-failure-notify.test.js`:

```js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { notifyFailure } from '../mint-failure-notify.js'

describe('mint-failure-notify', () => {
  let fetchMock, originalFetch

  beforeEach(() => {
    originalFetch = global.fetch
    fetchMock = vi.fn()
    global.fetch = fetchMock
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('sends an alert to Resend with run URL and event type', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'notify-001' }),
    })

    await notifyFailure({
      resendApiKey: 'test-key',
      fromEmail: 'licenses@bolalabs.pt',
      toEmail: 'bruno@bolalabs.pt',
      runId: '1234567890',
      repo: 'brunobola-portfolio/GitHub-Repo-Manager',
      eventName: 'workflow_dispatch',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.subject).toMatch(/failed|failure/i)
    expect(body.text).toContain('1234567890')
    expect(body.text).toContain('brunobola-portfolio/GitHub-Repo-Manager')
    expect(body.text).toContain('workflow_dispatch')
    // Must NOT contain any license material
    expect(body.text).not.toMatch(/grm_lic_/)
    expect(body.text).not.toMatch(/private_pem/i)
  })

  it('is a no-op if resendApiKey is missing (graceful degradation)', async () => {
    // If Resend is unconfigured, the failure notifier should exit silently
    // rather than throwing — it's already a failure handler.
    await expect(notifyFailure({
      resendApiKey: '',
      fromEmail: 'licenses@bolalabs.pt',
      toEmail: 'bruno@bolalabs.pt',
      runId: '1', repo: 'r', eventName: 'e',
    })).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 8.2: Run the test to verify it fails**

Run: `npx vitest run scripts/__tests__/mint-failure-notify.test.js`
Expected: test fails with "Cannot find module '../mint-failure-notify.js'".

- [ ] **Step 8.3: Implement `scripts/mint-failure-notify.js`**

Create file `scripts/mint-failure-notify.js`:

```js
#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.

/**
 * mint-failure-notify.js — standalone failure notifier for the mint workflow.
 *
 * Invoked by the `if: failure()` step in .github/workflows/mint-license.yml.
 * Sends a minimal email to Bruno containing only the run URL, event type,
 * and repo — NO license key or fingerprint or any other crypto material.
 *
 * Kept as a separate script (not part of mint-license-action.js) because
 * the main script may have crashed before its own handler could run — a
 * completely independent process is needed for reliable failure reporting.
 */

import { parseArgs } from 'node:util'

export async function notifyFailure({ resendApiKey, fromEmail, toEmail, runId, repo, eventName }) {
  if (!resendApiKey) {
    // Graceful degradation — if Resend isn't configured, exit silently.
    // This is already a failure handler; we don't want to fail on failure.
    return
  }

  const runUrl = `https://github.com/${repo}/actions/runs/${runId}`
  const text = [
    'The License Mint workflow failed.',
    '',
    `Repository: ${repo}`,
    `Event: ${eventName}`,
    `Run ID: ${runId}`,
    `Run URL: ${runUrl}`,
    '',
    'Check the run logs and step summary for details.',
    'This notification contains no license material by design.',
    '',
    '— Mint failure notifier',
  ].join('\n')

  const body = {
    from: fromEmail || 'licenses@bolalabs.pt',
    to: [toEmail || 'bruno@bolalabs.pt'],
    subject: `⚠️ License mint workflow failed (${eventName})`,
    text,
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      process.stderr.write(`[notify] Resend returned ${response.status}\n`)
    }
  } catch (e) {
    process.stderr.write(`[notify] network error: ${e.message}\n`)
  }
}

// Main entry when run as a script
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('mint-failure-notify.js')) {
  const { values } = parseArgs({
    options: {
      'run-id': { type: 'string' },
      'repo': { type: 'string' },
      'event': { type: 'string' },
    },
  })
  notifyFailure({
    resendApiKey: process.env.RESEND_API_KEY,
    fromEmail: 'licenses@bolalabs.pt',
    toEmail: 'bruno@bolalabs.pt',
    runId: values['run-id'],
    repo: values['repo'],
    eventName: values['event'],
  }).finally(() => process.exit(0))
}
```

- [ ] **Step 8.4: Run the tests to verify they pass**

Run: `npx vitest run scripts/__tests__/mint-failure-notify.test.js`
Expected: 2 tests pass.

- [ ] **Step 8.5: Commit**

```bash
git add scripts/mint-failure-notify.js scripts/__tests__/mint-failure-notify.test.js
git commit -m "feat(minter): add standalone mint-failure-notify.js

The if: failure() step in mint-license.yml invokes this script as an
independent process. Kept separate from mint-license-action.js because
that script may have crashed before its own handler ran — a fresh
process is the only reliable way to report the failure.

Sends a minimal Resend email containing only the GH Actions run URL,
event type, and repo — no license key, no fingerprint, no private_pem,
nothing secret. Graceful degradation when resendApiKey is missing
(silent exit) because we don't want to fail on a failure path.

2 tests cover the happy path (verify no license material leaks into
the body) and the graceful degradation path."
```

---

## Task 9: Create `.github/workflows/mint-license.yml` and `.github/dependabot.yml`

**Files:**

- Create: `.github/workflows/mint-license.yml`
- Create: `.github/dependabot.yml`

**Rationale:** Spec §1 "Workflow". Pre-emptive YAML-level masking, SHA-pinned actions, `--ignore-scripts --omit=dev`, actor guard, concurrency, `if: failure()` notification, all the bells and whistles from the expert review.

- [ ] **Step 9.1: Look up current SHAs for pinned actions**

The pinning target SHAs change over time. Use these known-stable values (verify they are current via `gh api`, but these work today):

- `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683` — v4.2.2
- `actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a` — v4.2.0

Verify each is still latest (optional):

```bash
gh api repos/actions/checkout/git/ref/tags/v4 --jq .object.sha
gh api repos/actions/setup-node/git/ref/tags/v4 --jq .object.sha
```

If the shown SHAs differ from the ones above, use the output of `gh api`. Dependabot will propose updates automatically once the workflow is merged.

- [ ] **Step 9.2: Create `.github/workflows/mint-license.yml`**

Create file `.github/workflows/mint-license.yml` with content:

```yaml
name: Mint License

# Self-hosted license minting. See docs/specs/2026-04-11-license-mint-automation-design.md
# for the full design rationale and threat model.

on:
  workflow_dispatch:
    inputs:
      tier:
        type: choice
        description: 'License tier'
        options: [pro, enterprise]
        default: pro
        required: true
      org:
        description: 'Licensee organization'
        required: true
      email:
        description: 'Recipient email address'
        required: true
      seats:
        description: 'Number of seats'
        default: '1'
      months:
        description: 'Validity in months (max 24)'
        default: '12'
      notes:
        description: 'Internal notes (audit only, ≤500 chars)'
        default: ''
      dry_run:
        type: boolean
        description: 'Dry-run: mint + summarize only, no email, no audit commit'
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
    # is already maintainer-gated at the platform level by GitHub.
    if: github.event_name == 'workflow_dispatch' || github.actor == github.repository_owner
    runs-on: ubuntu-latest
    timeout-minutes: 10
    env:
      # Only the private key is in secrets. The matching public key is
      # committed at keys/public.pem and read from disk by the mint script.
      LICENSE_PRIVATE_PEM: ${{ secrets.LICENSE_PRIVATE_PEM }}
    steps:
      - name: Pre-emptive secret masking
        # Runs BEFORE checkout/Node. Any later step that accidentally prints
        # LICENSE_PRIVATE_PEM via a stack trace is redacted by the GH log
        # processor. Masking must happen at the workflow level — crashes
        # during Node module load would otherwise precede in-process masking.
        run: |
          echo "::add-mask::$LICENSE_PRIVATE_PEM"
          echo "::add-mask::${{ inputs.email || github.event.client_payload.email }}"
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
      - uses: actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a  # v4.2.0
        with:
          node-version: '20'
          cache: 'npm'
      - name: Install dependencies
        # --ignore-scripts: dependency postinstall hooks are disabled so a
        #   compromised transitive dep can't run with LICENSE_PRIVATE_PEM
        #   in the environment.
        # --omit=dev: trims the install footprint — the mint script only
        #   depends on `jose` at runtime, which is a production dep already.
        run: npm ci --ignore-scripts --omit=dev
      - name: Mint license
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          LICENSE_LOG_PAT: ${{ secrets.LICENSE_LOG_PAT }}
          AUDIT_REPO: ${{ vars.AUDIT_REPO }}
          FROM_EMAIL: licenses@bolalabs.pt
          KID: ${{ vars.LICENSE_KID || 'k-default' }}
          TIER: ${{ inputs.tier || github.event.client_payload.tier }}
          ORG: ${{ inputs.org || github.event.client_payload.org }}
          EMAIL: ${{ inputs.email || github.event.client_payload.email }}
          SEATS: ${{ inputs.seats || github.event.client_payload.seats }}
          MONTHS: ${{ inputs.months || github.event.client_payload.months }}
          NOTES: ${{ inputs.notes || github.event.client_payload.notes }}
          DRY_RUN: ${{ inputs.dry_run || github.event.client_payload.dry_run || 'false' }}
          GITHUB_RUN_ID: ${{ github.run_id }}
        run: node scripts/mint-license-action.js
      - name: Notify on failure
        if: failure()
        env:
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
        run: |
          node scripts/mint-failure-notify.js \
            --run-id "${{ github.run_id }}" \
            --repo "${{ github.repository }}" \
            --event "${{ github.event_name }}"
```

- [ ] **Step 9.3: Create `.github/dependabot.yml`**

Create file `.github/dependabot.yml` with content:

```yaml
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    groups:
      actions-minor:
        update-types:
          - "minor"
          - "patch"
    # Workflow files that use SHA-pinned actions are auto-updated.
    # Tag-pinned workflows (ci.yml, cla.yml, deploy.yml, docker.yml) get
    # PRs too but those only bump tags — SHA pinning lives in mint-license.yml.
```

- [ ] **Step 9.4: Validate the workflow YAML syntax**

Run (validates the YAML file parses correctly — does not check semantics):

```bash
node -e "const yaml=require('yaml');const fs=require('fs');const doc=yaml.parse(fs.readFileSync('.github/workflows/mint-license.yml','utf8'));console.log('valid:',!!doc.jobs.mint.steps.length,'steps:',doc.jobs.mint.steps.length)"
```

Expected: `valid: true steps: 6`

If `yaml` is not installed globally, use `npx`:

```bash
npx -y yaml@2 -s "const fs=require('fs'); const y=require('yaml'); console.log(y.parse(fs.readFileSync('.github/workflows/mint-license.yml','utf8')).jobs.mint.steps.length)"
```

Alternatively, if the project already has a YAML parser in node_modules, just run ESLint's YAML plugin or simply load the file with the one-liner.

- [ ] **Step 9.5: Validate the dependabot.yml syntax**

```bash
node -e "const yaml=require('yaml');const fs=require('fs');const doc=yaml.parse(fs.readFileSync('.github/dependabot.yml','utf8'));console.log('version:',doc.version,'ecosystems:',doc.updates.length)"
```

Expected: `version: 2 ecosystems: 1`

- [ ] **Step 9.6: Commit**

```bash
git add .github/workflows/mint-license.yml .github/dependabot.yml
git commit -m "ci(mint): add mint-license workflow with SHA-pinned actions

Phase 1 of the license mint automation per the spec. Key design points:

- Pre-emptive ::add-mask:: step runs BEFORE checkout/Node so LICENSE_
  PRIVATE_PEM is redacted even on module-load crashes
- actions/checkout and actions/setup-node pinned to full commit SHAs
  (not tags) for supply chain safety
- npm ci --ignore-scripts --omit=dev prevents compromised transitive
  deps from running in the same step that has the signing secret
- Actor guard (if: github.actor == github.repository_owner) prevents
  a leaked PAT from abusing repository_dispatch
- concurrency: license-mint serializes runs; logMint has its own
  optimistic-concurrency retry for the audit file
- if: failure() step fires mint-failure-notify.js as an independent
  process to send an alert containing NO license material
- timeout 10 min accommodates cold npm cache + jose import

.github/dependabot.yml enables automated SHA bumps for the
github-actions ecosystem so pinning doesn't regress."
```

---

## Task 10: Final verification — full test suite + lint

**Files:** none (verification only)

- [ ] **Step 10.1: Run the full test suite**

Run: `npx vitest run 2>&1 | tail -10`
Expected: all tests pass (baseline 562 + new tests from Tasks 1, 2–8 totaling roughly +40 tests).

- [ ] **Step 10.2: Run ESLint on the new/modified files**

Run:

```bash
npx eslint server/lib/license.js server/middleware/require-tier.js scripts/lib/minter.js scripts/mint-license-action.js scripts/mint-failure-notify.js scripts/__tests__/minter.test.js scripts/__tests__/mint-license-action.test.js scripts/__tests__/mint-failure-notify.test.js
```

Expected: no output (clean).

- [ ] **Step 10.3: Verify the git log shows clean commits**

Run: `git log --oneline main..HEAD`
Expected: 9 commits (one per task), each with a clear conventional-commit message.

- [ ] **Step 10.4: Verify there are no uncommitted changes**

Run: `git status --short`
Expected: empty output.

---

## What happens after this plan merges (manual, NOT code)

Bruno executes the spec's "Setup checklist (one-time, ~25 minutes)" to prepare the operational resources:

1. Backup `keys/private.pem` to 1Password + offline USB
2. Create Resend account, verify `bolalabs.pt`, sign DPA, get API key
3. Create private repo `brunobola-portfolio/license-log` with empty `licenses.jsonl` + `revoked.jsonl`
4. Create Fine-Grained PAT scoped to the audit repo
5. Set 3 GitHub Secrets: `LICENSE_PRIVATE_PEM` (contents of `keys/private.pem`), `RESEND_API_KEY`, `LICENSE_LOG_PAT`. The public key does NOT need to be a secret — it is read from the committed `keys/public.pem` after checkout.
6. Set 1–2 repo Variables: `AUDIT_REPO=brunobola-portfolio/license-log`, optionally `LICENSE_KID=k-2026-04-11`
7. Run the workflow in `dry_run: true` mode as a first smoke test
8. Run the workflow for real to mint the self-license (enterprise, `Bola Labs Dev`, 24 months)
9. Copy the license key from the email into the local `.env` file, set `VITE_MOCK_MODE=false`, run `npm run dev:all`, verify backend log shows `License validated: enterprise tier`

The plan's code changes are complete after Task 10. Steps 1–9 above are operational and do not appear in the plan as tasks.
