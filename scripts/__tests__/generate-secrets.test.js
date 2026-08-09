// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  SECRET_SPECS,
  generateSecrets,
  formatEnvLines,
  findPopulatedKeys,
  appendSecretsToFile,
} from '../generate-secrets.mjs'

describe('generateSecrets', () => {
  it('emits exactly the four keys production requires', () => {
    expect(Object.keys(generateSecrets())).toEqual([
      'SESSION_SECRET',
      'API_KEY_SECRET',
      'WEBHOOK_SECRET',
      'CREDENTIAL_ENCRYPTION_KEY',
    ])
  })

  it('clears the 32-character floor startup-secrets-check.js enforces', () => {
    for (const [key, value] of Object.entries(generateSecrets())) {
      expect(value.length, `${key} is too short`).toBeGreaterThanOrEqual(32)
    }
  })

  it('makes every secret distinct — a shared value collapses two blast radii into one', () => {
    const values = Object.values(generateSecrets())
    expect(new Set(values).size).toBe(values.length)
  })

  it('does not repeat across invocations', () => {
    expect(generateSecrets().SESSION_SECRET).not.toBe(generateSecrets().SESSION_SECRET)
  })

  it('emits CREDENTIAL_ENCRYPTION_KEY as hex so shell/service-manager quoting cannot mangle it', () => {
    expect(generateSecrets().CREDENTIAL_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/)
  })

  it('emits the base64 secrets from the base64 alphabet only', () => {
    // Not cosmetic: .env has no quoting, so a stray newline or control byte
    // would truncate the value at dotenv parse time and silently weaken it.
    const { SESSION_SECRET, API_KEY_SECRET, WEBHOOK_SECRET } = generateSecrets()
    for (const value of [SESSION_SECRET, API_KEY_SECRET, WEBHOOK_SECRET]) {
      expect(value).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    }
  })

  it('every spec produces at least 32 bytes of entropy', () => {
    for (const spec of SECRET_SPECS) {
      expect(spec.bytes).toBeGreaterThanOrEqual(32)
    }
  })
})

describe('formatEnvLines', () => {
  it('renders one KEY=value per line with no quoting', () => {
    expect(formatEnvLines({ A: '1', B: '2' })).toBe('A=1\nB=2')
  })
})

describe('findPopulatedKeys', () => {
  const KEYS = ['SESSION_SECRET', 'WEBHOOK_SECRET']

  it('reports keys that already carry a value', () => {
    expect(findPopulatedKeys('SESSION_SECRET=abc\n', KEYS)).toEqual(['SESSION_SECRET'])
  })

  it('treats an empty placeholder as unset — that is the template case to fill', () => {
    expect(findPopulatedKeys('SESSION_SECRET=\nWEBHOOK_SECRET=   \n', KEYS)).toEqual([])
  })

  it('ignores commented-out lines', () => {
    expect(findPopulatedKeys('# SESSION_SECRET=abc\n', KEYS)).toEqual([])
  })

  it('does not match a key that is only a suffix of another', () => {
    // GRM_SESSION_SECRET must not satisfy the SESSION_SECRET check, or the
    // append guard would skip a genuinely unset key.
    expect(findPopulatedKeys('GRM_SESSION_SECRET=abc\n', ['SESSION_SECRET'])).toEqual([])
  })

  it('finds every populated key, not just the first', () => {
    expect(findPopulatedKeys('SESSION_SECRET=a\nWEBHOOK_SECRET=b\n', KEYS)).toEqual(KEYS)
  })

  // Both forms below are honoured by dotenv, so a guard that misses them lets
  // a second assignment be appended — and dotenv takes the LAST one, silently
  // rotating CREDENTIAL_ENCRYPTION_KEY under a database full of credentials
  // encrypted with the first.
  it('sees `export KEY=value`, which dotenv honours', () => {
    expect(findPopulatedKeys('export SESSION_SECRET=abc\n', ['SESSION_SECRET'])).toEqual(['SESSION_SECRET'])
  })

  it('sees a key on a BOM-prefixed first line (Notepad-saved file)', () => {
    expect(findPopulatedKeys('\uFEFFSESSION_SECRET=abc\n', ['SESSION_SECRET'])).toEqual(['SESSION_SECRET'])
  })

  it('resolves a duplicated key the way dotenv does \u2014 LAST wins, not first', () => {
    // The most dangerous shape: an empty placeholder above a real value. A
    // first-match scan reports "free", the guard lets the append through, and
    // the appended assignment then outranks the real key \u2014 rotating
    // CREDENTIAL_ENCRYPTION_KEY under a database of credentials encrypted with
    // it. Reproduced end-to-end before this was fixed.
    expect(findPopulatedKeys('SESSION_SECRET=\nSESSION_SECRET=the-real-one\n', ['SESSION_SECRET']))
      .toEqual(['SESSION_SECRET'])
  })

  it('reports free when the LAST occurrence is the empty one', () => {
    // The mirror case: dotenv resolves this to empty, so the key genuinely is
    // unset and appending is safe. Being conservative here would block a
    // legitimate first run.
    expect(findPopulatedKeys('SESSION_SECRET=stale\nSESSION_SECRET=\n', ['SESSION_SECRET'])).toEqual([])
  })

  it('handles CRLF line endings (the .env is edited on Windows)', () => {
    expect(findPopulatedKeys('SESSION_SECRET=\r\nSESSION_SECRET=real\r\n', ['SESSION_SECRET']))
      .toEqual(['SESSION_SECRET'])
  })
})

describe('appendSecretsToFile', () => {
  let dir
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'grm-secrets-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  const SECRETS = { SESSION_SECRET: 'aaa', CREDENTIAL_ENCRYPTION_KEY: 'bbb' }

  it('writes the block when the target has no values yet', () => {
    const target = path.join(dir, '.env')
    writeFileSync(target, 'SESSION_SECRET=\nCREDENTIAL_ENCRYPTION_KEY=\n')
    expect(appendSecretsToFile(target, SECRETS)).toEqual({ ok: true, count: 2 })
    expect(readFileSync(target, 'utf8')).toContain('SESSION_SECRET=aaa')
  })

  it('REFUSES and writes nothing when a key already carries a value', () => {
    // The branch that stands between an operator and an accidental key
    // rotation. Nothing exercised it before, so a mutation disabling it left
    // the whole suite green.
    const target = path.join(dir, '.env')
    const before = 'SESSION_SECRET=already-set\n'
    writeFileSync(target, before)
    const result = appendSecretsToFile(target, SECRETS)
    expect(result.ok).toBe(false)
    expect(result.clash).toContain('SESSION_SECRET')
    expect(readFileSync(target, 'utf8'), 'the file must be untouched on refusal').toBe(before)
  })

  it('refuses on the `export` form too', () => {
    const target = path.join(dir, '.env')
    writeFileSync(target, 'export CREDENTIAL_ENCRYPTION_KEY=live-key\n')
    expect(appendSecretsToFile(target, SECRETS).ok).toBe(false)
  })

  it('creates a missing target atomically and owner-only', () => {
    const target = path.join(dir, 'new.env')
    const calls = []
    const io = {
      existsSync: () => false,
      readFileSync: () => '',
      openSync: (...args) => { calls.push(['open', ...args]); return 7 },
      writeSync: (...args) => calls.push(['write', ...args]),
      closeSync: (...args) => calls.push(['close', ...args]),
      appendFileSync: (...args) => calls.push(['append', ...args]),
    }
    expect(appendSecretsToFile(target, SECRETS, io).ok).toBe(true)
    // 'wx' is exclusive-create: nothing can be slipped in between the
    // existsSync check and the write. appendFileSync on a new file would also
    // land at 0666 & ~umask — 0644 on most POSIX hosts, i.e. every local user
    // can read the secrets.
    expect(calls[0]).toEqual(['open', target, 'wx', 0o600])
    expect(calls.at(-1)[0]).toBe('close')
    expect(calls.some((c) => c[0] === 'append')).toBe(false)
  })

  it('really does write owner-only on a real filesystem', () => {
    const target = path.join(dir, 'real.env')
    expect(appendSecretsToFile(target, SECRETS).ok).toBe(true)
    expect(readFileSync(target, 'utf8')).toContain('SESSION_SECRET=aaa')
    if (process.platform !== 'win32') {
      expect(statSync(target).mode & 0o777).toBe(0o600)
    }
  })

  it('separates the appended block from an existing file with no trailing newline', () => {
    const target = path.join(dir, '.env')
    writeFileSync(target, '# header')
    appendSecretsToFile(target, SECRETS)
    expect(readFileSync(target, 'utf8')).toMatch(/# header\n/)
  })
})
