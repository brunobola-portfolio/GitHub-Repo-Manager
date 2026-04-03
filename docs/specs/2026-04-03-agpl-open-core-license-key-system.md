# AGPL Open-Core Model + License Key System

**Date:** 2026-04-03
**Status:** Approved
**Author:** Bruno Marques / Claude

## Overview

Transform GitHub Repo Manager from MIT to an AGPL v3 open-core model with dual-licensing. Add a license key system that allows self-hosted deployments to unlock Pro/Enterprise features without Stripe.

### Goals

1. **Protect against SaaS clones** while keeping the project truly open source
2. **Enable community contributions** via CLA that grants Bola Labs dual-license rights
3. **Monetize self-hosted deployments** via signed license keys (JWT)
4. **Keep the existing Stripe flow** for cloud SaaS users unchanged

### Non-Goals

- Separating Enterprise code into a separate repository (keep monorepo)
- Obfuscating or encrypting source code
- Online license validation / phone-home (must work air-gapped)

---

## 1. Legal Foundation

### 1.1 AGPL v3 License

Replace `LICENSE` with the full GNU Affero General Public License v3 text.

- **Why AGPL over GPL**: AGPL closes the "SaaS loophole" -- anyone who deploys the software as a network service must share their source code modifications. This prevents competitors from taking the code and offering it as a hosted service without contributing back.
- **Impact on users**: Self-hosting for internal use is fine under AGPL. Companies that want to embed the software in proprietary products or offer it as SaaS buy a commercial license.

Update `package.json` license field to `"AGPL-3.0-only"`.

### 1.2 SPDX Headers

Add to all `.js` and `.jsx` source files:

```
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2025-2026 Bola Labs. All rights reserved.
// Commercial license: https://bolalabs.pt/license
```

### 1.3 NOTICE File

Standard NOTICE file with:
- Copyright holder: Bruno Marques - Bola Labs
- License: AGPL v3
- Pointer to commercial license for enterprise use
- Contact: bruno@bolalabs.pt

### 1.4 Commercial License

`LICENSE-COMMERCIAL.md` describing terms for paid users:
- License key holders may use the software without AGPL obligations
- Covers self-hosted and on-prem deployments
- Tied to tier (Pro/Enterprise), seat count, and expiration date
- Non-transferable, non-sublicensable
- Includes right to modify for internal use

### 1.5 CLA (Contributor License Agreement)

`CLA.md` with simple terms:
- Contributors grant Bola Labs a perpetual, worldwide, non-exclusive license to use, modify, and sublicense their contributions
- Contributors retain copyright on their contributions
- This allows Bola Labs to offer commercial licenses without violating contributor rights
- Based on the Apache Individual CLA (industry standard, well-understood)

### 1.6 CLA Bot (GitHub Actions)

`.github/workflows/cla.yml` using CLA Assistant Lite (lightweight, free):
- On PR opened: checks if author has signed CLA
- If not signed: posts comment with link to sign
- Signature stored in a signatures file or GitHub issue
- PR cannot merge until CLA is signed (status check)

### 1.7 CONTRIBUTING.md Update

Add sections:
- CLA requirement and how to sign
- Explanation of AGPL + commercial dual-license model
- Clarify that all contributions fall under AGPL and the CLA terms
- Keep existing code style rules (JSX, Tailwind, Conventional Commits)

---

## 2. License Key System

### 2.1 Key Format

```
grm_lic_<base64url-encoded-JWT>
```

The JWT is signed with Ed25519 (fast, small signatures, secure). The payload:

```json
{
  "lid": "550e8400-e29b-41d4-a716-446655440000",
  "org": "Acme Corp",
  "email": "admin@acme.com",
  "tier": "pro",
  "seats": 3,
  "features": ["migration", "semantic_search", "teams"],
  "iat": 1743638400,
  "exp": 1775174400
}
```

Fields:
- `lid`: unique license ID (UUID v4)
- `org`: organization name
- `email`: licensee email
- `tier`: "pro" or "enterprise"
- `seats`: max concurrent users (enforced on self-host)
- `features`: explicit feature list (superset validated against tier)
- `iat`: issued-at timestamp
- `exp`: expiration timestamp

### 2.2 Cryptographic Keys

- **Private key** (`keys/private.pem`): Ed25519, used only by admin to sign licenses. NEVER committed to git. Added to `.gitignore`.
- **Public key** (`keys/public.pem`): Ed25519, committed to repo. Used by self-hosted servers to validate license signatures offline.
- Key generation via `scripts/generate-keys.js` (one-time setup).

### 2.3 Database Table

```sql
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
);
```

Used for:
- Tracking issued licenses in the admin backoffice
- Revoking licenses (set `revoked_at`)
- Audit trail

Note: self-hosted servers do NOT need this table to validate keys. Validation is purely cryptographic (verify JWT signature + check expiry). This table lives on the central admin instance only.

### 2.4 Server Module: `server/lib/license.js`

Exports:
- `generateLicenseKey(payload, privateKeyPem)` -- signs JWT, returns `grm_lic_...` string
- `validateLicenseKey(key, publicKeyPem)` -- verifies signature, checks expiry, returns payload or null
- `parseLicenseKey(key)` -- extracts payload without verification (for display)
- `isLicenseExpired(payload)` -- checks `exp` against current time
- `LICENSE_PREFIX = 'grm_lic_'`

Dependencies: `jose` (native Ed25519/EdDSA support, zero dependencies, Web Crypto API based). Preferred over `jsonwebtoken` which lacks Ed25519 support.

### 2.5 Middleware Update: `server/middleware/require-tier.js`

Current `getUserTier(userId)` queries `user_subscriptions` for Stripe tier.

New resolution order:

```
function resolveEffectiveTier(userId):
  1. stripeSubscription = query user_subscriptions WHERE user_id AND status='active'
  2. if stripeSubscription.tier exists and != 'free':
       return stripeSubscription.tier
  3. licenseKey = process.env.LICENSE_KEY
  4. if licenseKey:
       payload = validateLicenseKey(licenseKey, publicKey)
       if payload and not expired:
         return payload.tier
  5. return 'free'
```

The `LICENSE_KEY` env var is the self-host mechanism. The admin sets it once in `.env` and the entire instance runs at that tier.

Seat enforcement: when license has `seats: N`, the middleware counts active users in the last 30 days. If count > N, new logins are blocked with a clear error message.

### 2.6 API Endpoints: `server/routes/license.js`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/license` | Session | Returns current license info (tier, org, expiry, seats used/total) |
| `POST` | `/api/v1/license/validate` | None | Validates a key string, returns tier + expiry (for setup wizards) |
| `POST` | `/api/v1/admin/license/generate` | Admin | Generates a signed license key |
| `POST` | `/api/v1/admin/license/revoke` | Admin | Revokes a key by ID |
| `GET` | `/api/v1/admin/license/list` | Admin | Lists all issued licenses |

Admin endpoints are for the central Bola Labs admin instance. Self-hosted servers only use `GET /license` and the env var.

### 2.7 CLI Script: `scripts/generate-license.js`

```bash
node scripts/generate-license.js \
  --tier pro \
  --org "Acme Corp" \
  --email "admin@acme.com" \
  --seats 5 \
  --months 12
```

Output:
```
License generated successfully!
  ID:      550e8400-e29b-41d4-a716-446655440000
  Tier:    pro
  Org:     Acme Corp
  Seats:   5
  Expires: 2027-04-03

License Key:
grm_lic_eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9...

Add to .env:
LICENSE_KEY=grm_lic_eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9...
```

### 2.8 Key Generation Script: `scripts/generate-keys.js`

One-time script to generate Ed25519 keypair:

```bash
node scripts/generate-keys.js
```

Creates `keys/private.pem` and `keys/public.pem`. Warns if private key already exists (never overwrite).

---

## 3. Frontend Changes

### 3.1 BillingSection.jsx

When `LICENSE_KEY` is active (detected via `GET /api/v1/license`):
- Show "Licensed: Pro" or "Licensed: Enterprise" with org name
- Show expiration date and seat usage (e.g., "3 of 5 seats used")
- Show "Manage License" link to bolalabs.pt instead of Stripe portal
- When no license and no Stripe subscription: show current upgrade prompts

### 3.2 Footer / About

Add subtle license notice: "AGPL v3 | Commercial license available" with link to bolalabs.pt/license.

---

## 4. Environment & Config

### 4.1 New Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LICENSE_KEY` | No | Self-host license key (`grm_lic_...`) |

### 4.2 .env.example Update

Add `LICENSE_KEY=` with comment explaining it's optional and for self-hosted Pro/Enterprise.

### 4.3 .gitignore Update

Add `keys/private.pem` to prevent accidental commit of the signing key.

---

## 5. Files Summary

| Action | File | Description |
|--------|------|-------------|
| Replace | `LICENSE` | MIT to AGPL v3 full text |
| Create | `NOTICE` | Copyright + commercial license pointer |
| Create | `LICENSE-COMMERCIAL.md` | Commercial license terms |
| Create | `CLA.md` | Contributor License Agreement |
| Create | `.github/workflows/cla.yml` | CLA bot automation |
| Update | `CONTRIBUTING.md` | Add CLA + AGPL sections |
| Update | `package.json` | License field to AGPL-3.0-only |
| Create | `server/lib/license.js` | JWT license key validation/generation |
| Create | `server/routes/license.js` | License API endpoints |
| Create | `scripts/generate-license.js` | CLI to generate license keys |
| Create | `scripts/generate-keys.js` | CLI to generate Ed25519 keypair |
| Create | `keys/public.pem` | Public key for validation (committed) |
| Create | `keys/.gitkeep` | Placeholder for keys directory |
| Update | `server/middleware/require-tier.js` | Stripe OR license key resolution |
| Update | `server/db.js` | Add license_keys table |
| Update | `.env.example` | Add LICENSE_KEY variable |
| Update | `.gitignore` | Add keys/private.pem |
| Update | `src/components/Settings/BillingSection.jsx` | Show license info |

---

## 6. Security Considerations

- Private key never committed, never deployed to self-hosted instances
- License keys stored as SHA256 hashes in admin database
- JWT uses Ed25519 (EdDSA) -- not RSA, not HMAC (HMAC would let self-hosters forge keys)
- Seat enforcement is soft (counts active users) not hard (doesn't lock out existing sessions)
- License validation is pure crypto -- no network calls, no privacy concerns
- Revocation list: optional future enhancement. For now, revoked licenses are tracked in admin DB and flagged on renewal

## 7. Testing Strategy

- Unit tests for `server/lib/license.js`: generate, validate, expired, tampered, wrong key
- Integration tests for `server/routes/license.js`: all endpoints
- Integration tests for `require-tier.js`: Stripe tier, license tier, fallback to free
- E2E: self-host flow with LICENSE_KEY env var
