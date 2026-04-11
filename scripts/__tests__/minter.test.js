import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import {
  InputValidationError,
  MintError,
  DeliveryError,
  AuditWriteError,
  validateInput,
  mintLicense,
  deliverLicense,
} from '../lib/minter.js'
import { generateKeyPair, validateLicenseKey } from '../../server/lib/license.js'

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
