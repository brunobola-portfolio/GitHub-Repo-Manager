# AGPL Open-Core + License Key System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform from MIT to AGPL v3 dual-license open-core model with JWT license key system for self-hosted Pro/Enterprise deployments.

**Architecture:** Replace MIT license with AGPL v3, add CLA for contributors, implement Ed25519-signed JWT license keys validated offline. The existing Stripe billing path stays untouched; license keys add a parallel tier resolution path for self-hosted instances via a `LICENSE_KEY` env var.

**Tech Stack:** Node.js ESM, `jose` (Ed25519 JWT), Express middleware, better-sqlite3, Vitest

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Replace | `LICENSE` | AGPL v3 full text |
| Create | `NOTICE` | Copyright + commercial license pointer |
| Create | `LICENSE-COMMERCIAL.md` | Commercial license terms for paid users |
| Create | `CLA.md` | Contributor License Agreement |
| Create | `.github/workflows/cla.yml` | CLA bot GitHub Action |
| Update | `CONTRIBUTING.md` | Add CLA + AGPL sections |
| Update | `package.json` | License field + jose dependency |
| Create | `server/lib/license.js` | JWT license generation + validation |
| Create | `server/routes/license.js` | License API endpoints |
| Create | `scripts/generate-keys.js` | Ed25519 keypair generation CLI |
| Create | `scripts/generate-license.js` | License key generation CLI |
| Create | `keys/.gitkeep` | Placeholder (public.pem generated at runtime) |
| Update | `server/config.js` | Add `licenseKey` config field |
| Update | `server/db.js` | Add `license_keys` table |
| Update | `server/middleware/require-tier.js` | Stripe OR license key tier resolution |
| Update | `server/routes/v1/index.js` | Mount license routes |
| Update | `.env.example` | Add `LICENSE_KEY` variable |
| Update | `.gitignore` | Add `keys/private.pem` |
| Update | `src/components/Settings/BillingSection.jsx` | Show license info when active |
| Create | `server/__tests__/license.test.js` | Unit tests for license module |
| Create | `server/__tests__/require-tier-license.test.js` | Integration tests for tier resolution |

---

### Task 1: Install jose dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install jose**

```bash
npm install jose
```

- [ ] **Step 2: Verify installation**

```bash
node -e "import('jose').then(m => console.log('jose OK, exports:', Object.keys(m).slice(0,5).join(', ')))"
```

Expected: `jose OK, exports: ...` with no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add jose for Ed25519 JWT license keys"
```

---

### Task 2: Replace LICENSE with AGPL v3

**Files:**
- Replace: `LICENSE`
- Create: `NOTICE`
- Create: `LICENSE-COMMERCIAL.md`

- [ ] **Step 1: Write AGPL v3 LICENSE**

Replace the entire `LICENSE` file with the full GNU Affero General Public License v3 text. Use the canonical version from https://www.gnu.org/licenses/agpl-3.0.txt with this preamble prepended:

```
GitHub Repo Manager
Copyright (c) 2025-2026 Bruno Marques - Bola Labs

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
```

Followed by the full AGPL v3 text.

- [ ] **Step 2: Create NOTICE file**

```
GitHub Repo Manager
Copyright (c) 2025-2026 Bruno Marques - Bola Labs

This software is licensed under the GNU Affero General Public License v3 (AGPL-3.0).
See the LICENSE file for the full license text.

Commercial License
------------------
A commercial license is available for organizations that wish to use this software
without the obligations of the AGPL. Commercial licenses include Pro and Enterprise
tiers with additional features and support.

For commercial licensing inquiries, contact: bruno@bolalabs.pt
Website: https://bolalabs.pt/license
```

- [ ] **Step 3: Create LICENSE-COMMERCIAL.md**

```markdown
# Commercial License Agreement

**GitHub Repo Manager - Commercial License**
**Bola Labs**

## 1. Grant of License

Subject to the terms of this agreement, Bola Labs grants the licensee a
non-exclusive, non-transferable license to use GitHub Repo Manager
without the obligations of the GNU Affero General Public License v3.

## 2. Scope

This commercial license covers:

- **Self-hosted deployments** for internal business use
- **On-premises installations** within the licensee's infrastructure
- **Modifications** for internal use (no obligation to publish source)
- **Integration** into proprietary systems without AGPL copyleft requirements

## 3. License Tiers

| Tier | Features | Seats |
|------|----------|-------|
| **Pro** | Unlimited repos, 500 AI queries/month, semantic search, basic migration, teams (up to seat limit), 5 API keys | As purchased |
| **Enterprise** | Everything in Pro + unlimited AI queries, full migration (Azure + GitLab), SSO/SAML, audit logs, unlimited teams, 20 API keys, priority support + SLA | As purchased |

## 4. License Key

Each commercial license is delivered as a cryptographically signed license key.
The key encodes the tier, seat count, and expiration date. No internet connection
is required for validation.

## 5. Restrictions

- License keys are non-transferable and bound to the purchasing organization
- Resale, sublicensing, or redistribution of the software under this license is prohibited
- The license does not grant rights to use Bola Labs trademarks

## 6. Term and Renewal

- Licenses are issued for 12-month terms (monthly or annual billing)
- Upon expiration, the software reverts to AGPL v3 community features (free tier)
- No data is lost upon expiration

## 7. Support

- **Pro:** Email support (bruno@bolalabs.pt)
- **Enterprise:** Priority support with SLA guarantees

## 8. Contact

For licensing inquiries:
- Email: bruno@bolalabs.pt
- Website: https://bolalabs.pt/license
```

- [ ] **Step 4: Update package.json license field**

Change the `"license"` field in `package.json` from `"MIT"` to `"AGPL-3.0-only"`.

- [ ] **Step 5: Commit**

```bash
git add LICENSE NOTICE LICENSE-COMMERCIAL.md package.json
git commit -m "chore(license): transition from MIT to AGPL v3 with commercial dual-license"
```

---

### Task 3: Add CLA and update CONTRIBUTING.md

**Files:**
- Create: `CLA.md`
- Create: `.github/workflows/cla.yml`
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Create CLA.md**

```markdown
# Contributor License Agreement

## GitHub Repo Manager - Individual Contributor License Agreement

Thank you for your interest in contributing to GitHub Repo Manager (the "Project"),
maintained by Bruno Marques / Bola Labs ("We" or "Us").

By submitting a pull request or other contribution to this Project, you agree to the
following terms:

### 1. Definitions

- **"Contribution"** means any original work of authorship, including modifications or
  additions to existing work, that you submit to this Project.
- **"Submit"** means any form of communication sent to the Project (pull requests,
  issues, commits, comments), excluding communications marked "Not a Contribution."

### 2. Grant of Rights

You grant to Bola Labs a perpetual, worldwide, non-exclusive, no-charge, royalty-free,
irrevocable license to use, reproduce, prepare derivative works of, publicly display,
publicly perform, sublicense, and distribute your Contributions and derivative works.

### 3. Dual Licensing

You understand that the Project is dual-licensed:
- **AGPL v3** for the open-source community
- **Commercial license** for organizations that require it

Your Contributions may be included in both the open-source and commercially licensed
versions of the software.

### 4. Your Rights

- You retain copyright ownership of your Contributions
- You may use your Contributions for any other purpose
- This agreement does not restrict your rights to your own work

### 5. Representations

You represent that:
- You are the original author of the Contribution
- You have the right to grant the above license
- Your Contribution does not violate any third-party rights

### 6. How to Sign

Comment "I have read the CLA and I agree" on your first pull request. This serves
as your electronic signature.

---

*This CLA is based on the Apache Individual Contributor License Agreement v2.0.*
```

- [ ] **Step 2: Create .github/workflows/cla.yml**

```yaml
name: CLA Assistant
on:
  issue_comment:
    types: [created]
  pull_request_target:
    types: [opened, synchronize]

permissions:
  actions: write
  contents: read
  pull-requests: write
  statuses: write

jobs:
  cla-check:
    runs-on: ubuntu-latest
    steps:
      - name: CLA Assistant
        if: (github.event.comment.body == 'I have read the CLA and I agree' || github.event_name == 'pull_request_target')
        uses: contributor-assistant/github-action@v2.6.1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          path-to-signatures: 'signatures/cla.json'
          path-to-document: 'CLA.md'
          branch: 'main'
          allowlist: 'brunobola-portfolio,dependabot[bot],github-actions[bot]'
          custom-notsigned-prcomment: |
            Thank you for your contribution! Before we can merge this PR, you need to sign our
            [Contributor License Agreement](CLA.md).

            Please read the CLA and comment **"I have read the CLA and I agree"** to sign.

            This is a one-time requirement. The CLA allows us to distribute your contributions
            under both our open-source (AGPL v3) and commercial licenses.
          custom-pr-sign-comment: 'I have read the CLA and I agree'
```

- [ ] **Step 3: Update CONTRIBUTING.md**

Add these sections after the "## Prerequisites" section and before "## Local Setup":

```markdown
## Contributor License Agreement (CLA)

This project uses a dual-license model:
- **AGPL v3** for the open-source community
- **Commercial license** for organizations (see [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md))

Before your first contribution can be merged, you must sign our [CLA](CLA.md) by
commenting "I have read the CLA and I agree" on your pull request. This is a one-time
requirement.

The CLA grants Bola Labs the right to include your contributions in both the open-source
and commercially licensed versions. You retain full copyright over your work.
```

Update the "## License" section at the bottom from:

```markdown
By contributing you agree that your contributions will be licensed under the [MIT License](LICENSE).
```

to:

```markdown
By contributing you agree that your contributions will be licensed under the
[AGPL v3 License](LICENSE) and the terms of the [CLA](CLA.md).
```

Update the Code of Conduct email from `bruno@bolalabs.com` to `bruno@bolalabs.pt`.

- [ ] **Step 4: Create signatures directory**

```bash
mkdir -p signatures
echo '[]' > signatures/cla.json
```

- [ ] **Step 5: Commit**

```bash
git add CLA.md .github/workflows/cla.yml CONTRIBUTING.md signatures/cla.json
git commit -m "chore(legal): add CLA, CLA bot workflow, update contributing guide"
```

---

### Task 4: License key generation and validation module

**Files:**
- Create: `server/lib/license.js`
- Create: `scripts/generate-keys.js`
- Create: `scripts/generate-license.js`
- Create: `keys/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing tests**

Create `server/__tests__/license.test.js`:

```js
import { describe, it, expect, beforeAll } from 'vitest'
import { generateKeyPair } from '../lib/license.js'

let privateKey, publicKey

beforeAll(async () => {
  const pair = await generateKeyPair()
  privateKey = pair.privateKey
  publicKey = pair.publicKey
})

describe('license key generation and validation', () => {
  it('should generate a key with grm_lic_ prefix', async () => {
    const { generateLicenseKey } = await import('../lib/license.js')
    const key = await generateLicenseKey({
      org: 'Test Corp',
      email: 'test@example.com',
      tier: 'pro',
      seats: 3,
      months: 12,
    }, privateKey)
    expect(key).toMatch(/^grm_lic_/)
  })

  it('should validate a correctly signed key', async () => {
    const { generateLicenseKey, validateLicenseKey } = await import('../lib/license.js')
    const key = await generateLicenseKey({
      org: 'Test Corp',
      email: 'test@example.com',
      tier: 'pro',
      seats: 3,
      months: 12,
    }, privateKey)

    const payload = await validateLicenseKey(key, publicKey)
    expect(payload).not.toBeNull()
    expect(payload.tier).toBe('pro')
    expect(payload.org).toBe('Test Corp')
    expect(payload.seats).toBe(3)
  })

  it('should reject a tampered key', async () => {
    const { generateLicenseKey, validateLicenseKey } = await import('../lib/license.js')
    const key = await generateLicenseKey({
      org: 'Test Corp',
      email: 'test@example.com',
      tier: 'pro',
      seats: 1,
      months: 12,
    }, privateKey)

    const tampered = key.slice(0, -5) + 'XXXXX'
    const payload = await validateLicenseKey(tampered, publicKey)
    expect(payload).toBeNull()
  })

  it('should reject an expired key', async () => {
    const { generateLicenseKey, validateLicenseKey } = await import('../lib/license.js')
    const key = await generateLicenseKey({
      org: 'Expired Corp',
      email: 'expired@example.com',
      tier: 'enterprise',
      seats: 1,
      months: 0, // expires immediately
    }, privateKey)

    const payload = await validateLicenseKey(key, publicKey)
    expect(payload).toBeNull()
  })

  it('should parse a key without verification', async () => {
    const { generateLicenseKey, parseLicenseKey } = await import('../lib/license.js')
    const key = await generateLicenseKey({
      org: 'Parse Corp',
      email: 'parse@example.com',
      tier: 'enterprise',
      seats: 10,
      months: 6,
    }, privateKey)

    const payload = parseLicenseKey(key)
    expect(payload).not.toBeNull()
    expect(payload.org).toBe('Parse Corp')
    expect(payload.tier).toBe('enterprise')
  })

  it('should return null for invalid key format', async () => {
    const { validateLicenseKey } = await import('../lib/license.js')
    const payload = await validateLicenseKey('not-a-valid-key', publicKey)
    expect(payload).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run server/__tests__/license.test.js
```

Expected: FAIL — `server/lib/license.js` does not exist.

- [ ] **Step 3: Implement server/lib/license.js**

```js
import { SignJWT, jwtVerify, generateKeyPair as joseGenerateKeyPair, exportPKCS8, exportSPKI, importSPKI, importPKCS8 } from 'jose'
import { randomUUID } from 'crypto'

export const LICENSE_PREFIX = 'grm_lic_'
const ALG = 'EdDSA'

/**
 * Generate an Ed25519 keypair for license signing.
 * Returns PEM strings for storage.
 */
export async function generateKeyPair() {
  const { privateKey, publicKey } = await joseGenerateKeyPair(ALG, { crv: 'Ed25519' })
  return {
    privateKey: await exportPKCS8(privateKey),
    publicKey: await exportSPKI(publicKey),
  }
}

/**
 * Generate a signed license key.
 *
 * @param {object} opts
 * @param {string} opts.org - Organization name
 * @param {string} opts.email - Licensee email
 * @param {string} opts.tier - 'pro' or 'enterprise'
 * @param {number} opts.seats - Max concurrent users
 * @param {number} opts.months - License duration in months (0 = already expired, for testing)
 * @param {string} privateKeyPem - PKCS8 PEM private key
 * @returns {Promise<string>} License key string prefixed with grm_lic_
 */
export async function generateLicenseKey(opts, privateKeyPem) {
  const { org, email, tier, seats, months } = opts
  const lid = randomUUID()
  const now = Math.floor(Date.now() / 1000)

  const exp = months > 0
    ? now + (months * 30 * 24 * 60 * 60)
    : now - 1 // already expired (testing)

  const key = await importPKCS8(privateKeyPem, ALG)
  const jwt = await new SignJWT({
    lid,
    org,
    email,
    tier,
    seats,
  })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key)

  return LICENSE_PREFIX + jwt
}

/**
 * Validate a license key. Returns the decoded payload or null.
 *
 * @param {string} licenseKey - Full key string (grm_lic_...)
 * @param {string} publicKeyPem - SPKI PEM public key
 * @returns {Promise<object|null>} Decoded payload or null if invalid/expired
 */
export async function validateLicenseKey(licenseKey, publicKeyPem) {
  try {
    if (!licenseKey || !licenseKey.startsWith(LICENSE_PREFIX)) return null
    const jwt = licenseKey.slice(LICENSE_PREFIX.length)
    const key = await importSPKI(publicKeyPem, ALG)
    const { payload } = await jwtVerify(jwt, key)
    return payload
  } catch {
    return null
  }
}

/**
 * Parse a license key without cryptographic verification (for display only).
 *
 * @param {string} licenseKey - Full key string (grm_lic_...)
 * @returns {object|null} Decoded payload or null
 */
export function parseLicenseKey(licenseKey) {
  try {
    if (!licenseKey || !licenseKey.startsWith(LICENSE_PREFIX)) return null
    const jwt = licenseKey.slice(LICENSE_PREFIX.length)
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    return payload
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run server/__tests__/license.test.js
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Create scripts/generate-keys.js**

```js
#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { generateKeyPair } from '../server/lib/license.js'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const keysDir = join(__dirname, '..', 'keys')

if (!existsSync(keysDir)) mkdirSync(keysDir, { recursive: true })

const privatePath = join(keysDir, 'private.pem')
const publicPath = join(keysDir, 'public.pem')

if (existsSync(privatePath)) {
  console.error('ERROR: keys/private.pem already exists.')
  console.error('Delete it manually if you want to regenerate (this will invalidate ALL existing licenses).')
  process.exit(1)
}

const { privateKey, publicKey } = await generateKeyPair()

writeFileSync(privatePath, privateKey, 'utf-8')
writeFileSync(publicPath, publicKey, 'utf-8')

console.log('Ed25519 keypair generated successfully!')
console.log(`  Private key: ${privatePath}`)
console.log(`  Public key:  ${publicPath}`)
console.log('')
console.log('IMPORTANT: Never commit keys/private.pem to git.')
console.log('The public key (keys/public.pem) is safe to commit.')
```

- [ ] **Step 6: Create scripts/generate-license.js**

```js
#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
import { generateLicenseKey, parseLicenseKey } from '../server/lib/license.js'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseArgs } from 'util'

const __dirname = dirname(fileURLToPath(import.meta.url))

const { values } = parseArgs({
  options: {
    tier: { type: 'string', default: 'pro' },
    org: { type: 'string', default: 'Self' },
    email: { type: 'string', default: '' },
    seats: { type: 'string', default: '1' },
    months: { type: 'string', default: '12' },
    'key-file': { type: 'string', default: join(__dirname, '..', 'keys', 'private.pem') },
  },
})

const keyFile = values['key-file']
if (!existsSync(keyFile)) {
  console.error(`ERROR: Private key not found at ${keyFile}`)
  console.error('Run: node scripts/generate-keys.js')
  process.exit(1)
}

if (!['pro', 'enterprise'].includes(values.tier)) {
  console.error('ERROR: --tier must be "pro" or "enterprise"')
  process.exit(1)
}

const privateKeyPem = readFileSync(keyFile, 'utf-8')

const key = await generateLicenseKey({
  org: values.org,
  email: values.email,
  tier: values.tier,
  seats: parseInt(values.seats, 10),
  months: parseInt(values.months, 10),
}, privateKeyPem)

const payload = parseLicenseKey(key)
const expiresAt = new Date(payload.exp * 1000).toISOString().split('T')[0]

console.log('')
console.log('License generated successfully!')
console.log(`  ID:      ${payload.lid}`)
console.log(`  Tier:    ${payload.tier}`)
console.log(`  Org:     ${payload.org}`)
console.log(`  Email:   ${payload.email || '(none)'}`)
console.log(`  Seats:   ${payload.seats}`)
console.log(`  Expires: ${expiresAt}`)
console.log('')
console.log('License Key:')
console.log(key)
console.log('')
console.log('Add to .env:')
console.log(`LICENSE_KEY=${key}`)
```

- [ ] **Step 7: Setup keys directory and gitignore**

Create `keys/.gitkeep` (empty file).

Add to `.gitignore`:

```
# License signing keys (NEVER commit the private key)
keys/private.pem
```

- [ ] **Step 8: Commit**

```bash
git add server/lib/license.js server/__tests__/license.test.js scripts/generate-keys.js scripts/generate-license.js keys/.gitkeep .gitignore
git commit -m "feat(license): add Ed25519 JWT license key generation and validation"
```

---

### Task 5: Add license_keys table and config

**Files:**
- Modify: `server/db.js:347-348` (after usage_metrics table, before indexes)
- Modify: `server/config.js:38-39` (after webhookSecret)
- Modify: `.env.example`

- [ ] **Step 1: Add license_keys table to db.js**

Insert after the `usage_metrics` UNIQUE index (line 348) and before the "Indexes for performance" comment (line 350):

```js
        // License Keys Table (admin tracking for issued licenses)
        db.exec(`
            CREATE TABLE IF NOT EXISTS license_keys (
                id TEXT PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                license_key_hash TEXT NOT NULL UNIQUE,
                tier TEXT NOT NULL CHECK(tier IN ('pro', 'enterprise')),
                seats INTEGER NOT NULL DEFAULT 1,
                org_name TEXT,
                email TEXT,
                issued_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                revoked_at TEXT,
                metadata TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_license_keys_hash ON license_keys(license_key_hash)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_license_keys_tier ON license_keys(tier)`);
```

- [ ] **Step 2: Add licenseKey to config.js**

In the `configSchema` object, after the `webhookSecret` line, add:

```js
    // License key (optional, for self-hosted Pro/Enterprise)
    licenseKey: z.string().optional(),
```

In the `loadConfig()` function's parse object, after `webhookSecret`, add:

```js
        licenseKey: process.env.LICENSE_KEY,
```

- [ ] **Step 3: Update .env.example**

Add after the Webhook Security section:

```
# ----------------------------------
# License Key (Optional - Self-Hosted Pro/Enterprise)
# ----------------------------------
# For self-hosted deployments, set a license key to unlock Pro or Enterprise features.
# Purchase a license at https://bolalabs.pt/license
# Without a key, the app runs with free-tier limits.
# LICENSE_KEY=grm_lic_...
```

- [ ] **Step 4: Commit**

```bash
git add server/db.js server/config.js .env.example
git commit -m "feat(license): add license_keys table and LICENSE_KEY config"
```

---

### Task 6: Update require-tier middleware for license key resolution

**Files:**
- Modify: `server/middleware/require-tier.js`
- Create: `server/__tests__/require-tier-license.test.js`

- [ ] **Step 1: Write the failing tests**

Create `server/__tests__/require-tier-license.test.js`:

```js
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { generateKeyPair, generateLicenseKey } from '../lib/license.js'

let publicKeyPem, privateKeyPem

beforeAll(async () => {
  const pair = await generateKeyPair()
  privateKeyPem = pair.privateKey
  publicKeyPem = pair.publicKey
})

// We test the resolveEffectiveTier logic in isolation
describe('resolveEffectiveTier', () => {
  it('should return free when no stripe and no license key', async () => {
    const { resolveEffectiveTier } = await import('../middleware/require-tier.js')
    // No LICENSE_KEY env, no DB subscription
    const tier = await resolveEffectiveTier(null, null, publicKeyPem)
    expect(tier).toBe('free')
  })

  it('should return license tier when LICENSE_KEY is valid', async () => {
    const key = await generateLicenseKey({
      org: 'Test', email: 'test@test.com', tier: 'enterprise', seats: 5, months: 12,
    }, privateKeyPem)

    const { resolveEffectiveTier } = await import('../middleware/require-tier.js')
    const tier = await resolveEffectiveTier(null, key, publicKeyPem)
    expect(tier).toBe('enterprise')
  })

  it('should prefer stripe tier over license key', async () => {
    const key = await generateLicenseKey({
      org: 'Test', email: 'test@test.com', tier: 'pro', seats: 1, months: 12,
    }, privateKeyPem)

    const { resolveEffectiveTier } = await import('../middleware/require-tier.js')
    // Simulate stripe returning 'enterprise'
    const tier = await resolveEffectiveTier('enterprise', key, publicKeyPem)
    expect(tier).toBe('enterprise')
  })

  it('should return free when license key is expired', async () => {
    const key = await generateLicenseKey({
      org: 'Expired', email: 'x@x.com', tier: 'pro', seats: 1, months: 0,
    }, privateKeyPem)

    const { resolveEffectiveTier } = await import('../middleware/require-tier.js')
    const tier = await resolveEffectiveTier(null, key, publicKeyPem)
    expect(tier).toBe('free')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run server/__tests__/require-tier-license.test.js
```

Expected: FAIL — `resolveEffectiveTier` is not exported.

- [ ] **Step 3: Update server/middleware/require-tier.js**

Replace the entire file:

```js
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'
import { getTierOrder } from '../lib/feature-flags.js'
import { validateLicenseKey } from '../lib/license.js'
import { config } from '../config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load public key for license validation (once at startup)
const publicKeyPath = join(__dirname, '..', '..', 'keys', 'public.pem')
const PUBLIC_KEY = existsSync(publicKeyPath)
  ? readFileSync(publicKeyPath, 'utf-8')
  : null

// Cache validated license to avoid re-parsing on every request
let cachedLicenseTier = null
let cachedLicenseKey = null
let cachedLicensePayload = null

/**
 * Resolve the effective tier from Stripe subscription and/or license key.
 * Exported for testing.
 *
 * @param {string|null} stripeTier - Tier from Stripe subscription (or null)
 * @param {string|null} licenseKey - LICENSE_KEY env value (or null)
 * @param {string|null} publicKey - PEM public key for validation (or null)
 * @returns {Promise<string>} Resolved tier
 */
export async function resolveEffectiveTier(stripeTier, licenseKey, publicKey) {
  // 1. Stripe subscription takes priority
  if (stripeTier && stripeTier !== 'free') return stripeTier

  // 2. License key fallback
  if (licenseKey && publicKey) {
    const payload = await validateLicenseKey(licenseKey, publicKey)
    if (payload && payload.tier) return payload.tier
  }

  // 3. Default
  return 'free'
}

function getStripeTier(userId) {
  if (!userId) return null
  const row = db.prepare(
    'SELECT tier FROM user_subscriptions WHERE user_id = ? AND status = ?'
  ).get(userId, 'active')
  return row?.tier || null
}

export function getUserTier(userId) {
  const stripeTier = getStripeTier(userId)
  if (stripeTier && stripeTier !== 'free') return stripeTier

  // Check cached license key
  const envKey = config.licenseKey || null
  if (envKey && PUBLIC_KEY) {
    // Use cache to avoid async in sync context
    if (envKey === cachedLicenseKey && cachedLicenseTier) {
      return cachedLicenseTier
    }
    // Fallback: return free now, async init will populate cache
    return cachedLicenseTier || 'free'
  }

  return 'free'
}

/**
 * Get the full license payload (for API responses).
 */
export function getLicenseInfo() {
  return cachedLicensePayload
}

export function requireTier(minTier) {
  const minOrder = getTierOrder(minTier)
  return (req, res, next) => {
    const userTier = getUserTier(req.session?.userId || req.tenantId)
    req.userTier = userTier
    if (getTierOrder(userTier) >= minOrder) return next()
    return res.status(403).json({
      error: 'upgrade_required',
      message: `This feature requires the ${minTier} plan`,
      currentTier: userTier,
      requiredTier: minTier,
    })
  }
}

export function attachTier(req, res, next) {
  req.userTier = getUserTier(req.session?.userId || req.tenantId)
  next()
}

// Warm the license cache at startup (async)
async function initLicenseCache() {
  const envKey = config.licenseKey || null
  if (envKey && PUBLIC_KEY) {
    const payload = await validateLicenseKey(envKey, PUBLIC_KEY)
    if (payload && payload.tier) {
      cachedLicenseKey = envKey
      cachedLicenseTier = payload.tier
      cachedLicensePayload = payload
      console.log(`License validated: ${payload.tier} tier (org: ${payload.org || 'N/A'}, expires: ${new Date(payload.exp * 1000).toISOString().split('T')[0]})`)
    } else {
      console.warn('LICENSE_KEY is set but invalid or expired.')
    }
  }
}

initLicenseCache().catch(() => {})
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run server/__tests__/require-tier-license.test.js
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Run full test suite to verify no regressions**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/middleware/require-tier.js server/__tests__/require-tier-license.test.js
git commit -m "feat(license): update tier middleware to resolve from Stripe or license key"
```

---

### Task 7: License API endpoints

**Files:**
- Create: `server/routes/license.js`
- Modify: `server/routes/v1/index.js:46` (add route mount)

- [ ] **Step 1: Create server/routes/license.js**

```js
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getLicenseInfo } from '../middleware/require-tier.js'
import { validateLicenseKey, parseLicenseKey } from '../lib/license.js'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicKeyPath = join(__dirname, '..', '..', 'keys', 'public.pem')
const PUBLIC_KEY = existsSync(publicKeyPath)
  ? readFileSync(publicKeyPath, 'utf-8')
  : null

const router = Router()

// GET /api/v1/license — current license info
router.get('/', requireAuth, (req, res) => {
  const info = getLicenseInfo()
  if (!info) {
    return res.json({
      active: false,
      source: 'none',
      tier: req.userTier || 'free',
    })
  }

  // Count active users for seat enforcement
  const activeUsers = db.prepare(
    "SELECT COUNT(*) as count FROM users WHERE last_login > datetime('now', '-30 days')"
  ).get()

  res.json({
    active: true,
    source: 'license_key',
    tier: info.tier,
    org: info.org,
    email: info.email,
    seats: info.seats,
    seatsUsed: activeUsers?.count || 0,
    expiresAt: info.exp ? new Date(info.exp * 1000).toISOString() : null,
    issuedAt: info.iat ? new Date(info.iat * 1000).toISOString() : null,
  })
})

// POST /api/v1/license/validate — validate a key (for setup wizards)
router.post('/validate', async (req, res) => {
  const { key } = req.body
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid key' })
  }

  if (!PUBLIC_KEY) {
    return res.status(500).json({ error: 'License validation not configured (missing public key)' })
  }

  const payload = await validateLicenseKey(key, PUBLIC_KEY)
  if (!payload) {
    return res.status(400).json({ valid: false, error: 'Invalid or expired license key' })
  }

  res.json({
    valid: true,
    tier: payload.tier,
    org: payload.org,
    seats: payload.seats,
    expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
  })
})

export default router
```

- [ ] **Step 2: Mount license routes in v1/index.js**

Add import at the top of `server/routes/v1/index.js`:

```js
import licenseRoutes from '../license.js'
```

Add mount after the `usageRoutes` line:

```js
router.use('/license', licenseRoutes);
```

- [ ] **Step 3: Verify build**

```bash
npx vite build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add server/routes/license.js server/routes/v1/index.js
git commit -m "feat(license): add license info and validation API endpoints"
```

---

### Task 8: Update BillingSection to show license info

**Files:**
- Modify: `src/components/Settings/BillingSection.jsx`

- [ ] **Step 1: Add license state and fetch**

At the top of the `BillingSection` component function, add a license state alongside existing subscription state. Add a `useEffect` that fetches `GET /api/v1/license` and stores the result. When the response has `active: true` and `source: 'license_key'`, display the license info instead of the Stripe billing UI.

- [ ] **Step 2: Add LicenseCard component**

Add a new `LicenseCard` function component inside the file (before `BillingSection`) that displays:
- Tier name with the existing `TIER_CONFIG` styling
- Organization name
- Seat usage (e.g., "3 of 5 seats used") with a progress bar
- Expiration date
- A link to `https://bolalabs.pt/license` for license management
- A badge showing "Licensed" with the tier's `badgeVariant`

- [ ] **Step 3: Render LicenseCard when license is active**

In the `BillingSection` return, add a conditional before the existing Stripe `PlanCard`:

```jsx
{license?.active && license.source === 'license_key' ? (
  <LicenseCard license={license} />
) : (
  <PlanCard ... />
)}
```

- [ ] **Step 4: Verify build**

```bash
npx vite build
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/Settings/BillingSection.jsx
git commit -m "feat(ui): show license info in billing section for self-hosted instances"
```

---

### Task 9: Generate keypair, run end-to-end test, final verification

**Files:** None new (verification only)

- [ ] **Step 1: Generate a test keypair**

```bash
node scripts/generate-keys.js
```

Expected: `keys/private.pem` and `keys/public.pem` created.

- [ ] **Step 2: Generate a test license**

```bash
node scripts/generate-license.js --tier pro --org "Bola Labs" --email "bruno@bolalabs.pt" --seats 5 --months 12
```

Expected: License key printed to stdout.

- [ ] **Step 3: Verify build**

```bash
npx vite build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 5: Commit public key (do NOT commit private key)**

```bash
git add keys/public.pem keys/.gitkeep
git commit -m "chore: add Ed25519 public key for license validation"
```

- [ ] **Step 6: Final verification — check git status is clean**

```bash
git status
```

Expected: Working tree clean (private.pem should be gitignored).
