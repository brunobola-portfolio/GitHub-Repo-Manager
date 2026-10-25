/*
 * Licence-capability honesty gate.
 *
 * v4.11.0 shipped licence revocation — an admin can revoke a key by `lid` and
 * verifyLicenseKey() consults the list on every check. Five surfaces kept
 * saying the opposite: the licence-delivery email told every paying customer
 * their key "is not remotely revocable", and both policy docs explained the
 * design as having "no revocation list to maintain" and "no runtime revocation
 * check". Two of those were the commercial licence terms.
 *
 * The claim that stays TRUE is narrower and worth keeping precise: the list is
 * per-instance, so BolaLabs cannot disable a key on someone else's
 * self-hosted install. This gate pins the capability to the copy, so shipping
 * one without the other fails here rather than in a customer's inbox.
 */
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

const EMAIL_SOURCE = 'server/lib/license-issuer.js'
const POLICY_DOCS = ['docs/billing-and-licensing.md', 'docs/LICENSE-COMMERCIAL.md']

// Phrases that are only honest while revocation does NOT exist. Each is the
// exact wording that shipped, so none can false-positive on the accurate
// replacement text (which says revocation exists and is per-instance).
const CONTRADICTED_BY_REVOCATION = [
  'not remotely revocable',
  'no revocation list to maintain',
  'there is no runtime revocation check',
  'there is no server call to check against at runtime',
]

describe('licence revocation capability', () => {
  const licenseLib = readFileSync('server/lib/license.js', 'utf8')

  it('is actually wired into verification, not just exported', () => {
    // If this ever stops being true, the copy below becomes honest again and
    // this whole gate should be revisited — which is why it is asserted rather
    // than assumed.
    expect(licenseLib).toMatch(/export\s+function\s+revokeLicense/)
    const verifyFn = licenseLib.slice(licenseLib.indexOf('export async function verifyLicenseKey'))
    expect(
      verifyFn.slice(0, verifyFn.indexOf('\n}')),
      'verifyLicenseKey must consult getLicenseRevocation for revocation to be real',
    ).toMatch(/getLicenseRevocation\(/)
  })
})

describe('surfaces do not contradict the shipped capability', () => {
  for (const phrase of CONTRADICTED_BY_REVOCATION) {
    it(`the licence email does not claim "${phrase}"`, () => {
      // This text is delivered to every paying customer on checkout and on
      // every monthly renewal — the highest-consequence copy in the repo.
      expect(readFileSync(EMAIL_SOURCE, 'utf8')).not.toContain(phrase)
    })

    for (const doc of POLICY_DOCS) {
      it(`${doc} does not claim "${phrase}"`, () => {
        expect(readFileSync(doc, 'utf8')).not.toContain(phrase)
      })
    }
  }

  // Forbidding the stale phrases is only half a gate: deleting the whole
  // affirmative paragraph also removes every forbidden phrase, so silence
  // passed. These require the claim to actually be stated.
  it('the policy doc states that revocation exists and names its surface', () => {
    const policy = readFileSync('docs/billing-and-licensing.md', 'utf8')
    expect(policy).toMatch(/revocation exists/i)
    expect(policy).toContain('/api/license/revocations')
  })

  it('the policy doc records the limit that IS real (per-instance, no phone-home)', () => {
    // Deleting the false claim must not delete the honest caveat with it:
    // customers are entitled to know revocation cannot reach their own install.
    const policy = readFileSync('docs/billing-and-licensing.md', 'utf8')
    expect(policy).toMatch(/phone-home/)
    expect(policy).toMatch(/per-instance/i)
  })

  it('no surface promises self-hosters that renewal needs no action, or that a key never expires', () => {
    // Every monthly email said "no action needed" while a self-hosted admin
    // had to paste each new key, and the docs said a key "never actually
    // expires" while it died before its replacement was minted.
    for (const phrase of ['no action needed', 'never actually expires', 'replaced every cycle', 'replaced every billing cycle']) {
      expect(readFileSync(EMAIL_SOURCE, 'utf8').toLowerCase()).not.toContain(phrase)
      for (const doc of POLICY_DOCS) {
        expect(readFileSync(doc, 'utf8').toLowerCase(), `${doc}: "${phrase}"`).not.toContain(phrase)
      }
    }
  })

  it('the policy doc states that refunds revoke keys, and that is wired in the webhook', () => {
    expect(readFileSync('docs/billing-and-licensing.md', 'utf8')).toMatch(/refunds and lost disputes revoke/i)
    const webhook = readFileSync('server/routes/stripe-webhooks.js', 'utf8')
    expect(webhook).toMatch(/revokeKeysFor\(subscriptionId, 'refund'\)/)
    expect(webhook).toMatch(/revokeKeysFor\(subscriptionId, 'dispute'\)/)
  })

  it('the check-in is described as it ships: validation offline, daily check-in, and how to turn it off', () => {
    // The check-in made "no phone-home" untrue as a blanket claim. What stays
    // true, and must stay written down, is that validation never needs the
    // network and that an operator can switch the check-in off.
    const policy = readFileSync('docs/billing-and-licensing.md', 'utf8')
    expect(policy).toMatch(/Validation never requires the\s+network/)
    expect(policy).toContain('LICENSE_AUTO_RENEW=false')
    expect(policy).toContain('/api/v1/license/checkin')
    const commercial = readFileSync('docs/LICENSE-COMMERCIAL.md', 'utf8')
    expect(commercial).toContain('LICENSE_AUTO_RENEW=false')
    expect(commercial).not.toMatch(/never\s+phones home/)
    expect(readFileSync('README.md', 'utf8')).toContain('LICENSE_AUTO_RENEW=false')
    // And the code does what the docs say: the switch exists.
    expect(readFileSync('server/lib/license-checkin.js', 'utf8')).toMatch(/LICENSE_AUTO_RENEW/)
  })

  it('every privacy surface states the machine hash the check-in actually sends', () => {
    // The check-in sends a hash of the OS machine id. A privacy page listing
    // what the issuer keeps without it would understate what leaves the box.
    const client = readFileSync('server/lib/license-checkin.js', 'utf8')
    expect(client).toMatch(/machine: machineOnce\(\)/)
    expect(readFileSync('src/components/PublicLegal/PrivacyPage.jsx', 'utf8')).toMatch(/hash of\s+the machine/)
    const inventory = readFileSync('docs/privacy-and-data.md', 'utf8')
    expect(inventory).toMatch(/BolaLabs licence service/)
    expect(inventory).toMatch(/hash of the machine's OS id/)
    expect(readFileSync('docs/billing-and-licensing.md', 'utf8')).toMatch(/never\s+widen/)
  })

  it('no doc points operators at a licence-revocation CLI, because none exists', () => {
    // `npm run admin:revoke` runs admin-grant.mjs --revoke, which clears a
    // USER's admin flag (UPDATE users SET is_admin = 0). Two docs named it as
    // the revocation tool — the instruction an operator follows during a
    // chargeback, which would leave the key live and demote an admin.
    for (const doc of POLICY_DOCS.concat('docs/guides/license-keys-and-portal.md')) {
      const body = readFileSync(doc, 'utf8')
      const claims = [...body.matchAll(/^.*admin:revoke.*$/gm)].map((m) => m[0])
      for (const line of claims) {
        expect(line, `${doc} must not present admin:revoke as a licence tool`).toMatch(/admin.flag|is_admin|not this|unrelated/i)
      }
    }
  })
})
