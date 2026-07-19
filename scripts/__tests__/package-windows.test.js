import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  NODE_VERSION,
  nodeZipFileName,
  nodeDistUrls,
  zipFileNameFor,
  sha256Hex,
  sha256File,
  parseShasums256,
  sha256SidecarContents,
  writeSha256Sidecar,
  getPackageVersion,
  getPublisher,
  assertDistBuilt,
  shouldSkipServerPath,
  betterSqlite3BinaryPath,
  readCachedZipIfValid,
  verifyAndCacheDownload,
} from '../package-windows.mjs'

describe('NODE_VERSION', () => {
  it('is pinned to a concrete 22.x semver (matches package.json engines range)', () => {
    expect(NODE_VERSION).toMatch(/^22\.\d+\.\d+$/)
  })
})

describe('nodeZipFileName / nodeDistUrls', () => {
  it('builds the official nodejs.org win-x64 zip filename', () => {
    expect(nodeZipFileName('22.23.1')).toBe('node-v22.23.1-win-x64.zip')
  })

  it('builds matching zip + SHASUMS256 URLs under the same version path', () => {
    const { zipUrl, shasumsUrl } = nodeDistUrls('22.23.1')
    expect(zipUrl).toBe('https://nodejs.org/dist/v22.23.1/node-v22.23.1-win-x64.zip')
    expect(shasumsUrl).toBe('https://nodejs.org/dist/v22.23.1/SHASUMS256.txt')
  })
})

describe('zipFileNameFor', () => {
  it('matches the exact naming convention the brief specifies', () => {
    expect(zipFileNameFor('4.6.1')).toBe('github-repo-manager-4.6.1-win-x64.zip')
  })
})

describe('sha256Hex / sha256File', () => {
  it('hashes a known buffer to its known SHA256', () => {
    // sha256("hello world"), a standard reference vector
    expect(sha256Hex(Buffer.from('hello world'))).toBe(
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    )
  })

  it('sha256File matches sha256Hex of the same bytes', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'grm-pkg-test-'))
    try {
      const file = path.join(dir, 'x.bin')
      const content = Buffer.from('deterministic content for hashing')
      writeFileSync(file, content)
      expect(sha256File(file)).toBe(sha256Hex(content))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('parseShasums256', () => {
  it('parses standard two-space "<hash>  <filename>" lines', () => {
    const hash = 'a'.repeat(64)
    const text = `${hash}  node-v22.23.1-win-x64.zip\n`
    const map = parseShasums256(text)
    expect(map.get('node-v22.23.1-win-x64.zip')).toBe(hash)
  })

  it('is case-insensitive on the hash and lowercases it', () => {
    const hash = 'A'.repeat(64)
    const text = `${hash}  node-v22.23.1-win-x64.zip\n`
    const map = parseShasums256(text)
    expect(map.get('node-v22.23.1-win-x64.zip')).toBe('a'.repeat(64))
  })

  it('tolerates a single space and an optional "*" binary-mode marker', () => {
    const hash = 'b'.repeat(64)
    const text = `${hash} *node-v22.23.1-win-x64.zip\n`
    const map = parseShasums256(text)
    expect(map.get('node-v22.23.1-win-x64.zip')).toBe(hash)
  })

  it('skips blank lines and comment lines', () => {
    const hash = 'c'.repeat(64)
    const text = `# comment\n\n${hash}  node-v22.23.1-win-x64.zip\n\n`
    const map = parseShasums256(text)
    expect(map.size).toBe(1)
    expect(map.get('node-v22.23.1-win-x64.zip')).toBe(hash)
  })

  it('returns an empty map for garbage input rather than throwing', () => {
    expect(parseShasums256('not a shasums file\nrandom text').size).toBe(0)
  })

  it('parses every real entry from a full multi-platform SHASUMS256.txt body', () => {
    const h1 = '1'.repeat(64)
    const h2 = '2'.repeat(64)
    const text = [
      `${h1}  node-v22.23.1-darwin-x64.tar.gz`,
      `${h2}  node-v22.23.1-win-x64.zip`,
    ].join('\n')
    const map = parseShasums256(text)
    expect(map.size).toBe(2)
    expect(map.get('node-v22.23.1-win-x64.zip')).toBe(h2)
  })
})

describe('sha256SidecarContents / writeSha256Sidecar', () => {
  it('formats as "<hash>  <basename>\\n" (sha256sum-compatible)', () => {
    expect(sha256SidecarContents('deadbeef', 'thing.zip')).toBe('deadbeef  thing.zip\n')
  })

  it('writeSha256Sidecar writes a sidecar next to the file with the real hash', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'grm-pkg-test-'))
    try {
      const file = path.join(dir, 'archive.zip')
      const content = Buffer.from('archive contents')
      writeFileSync(file, content)
      const { hash, sidecarPath } = writeSha256Sidecar(file)
      expect(hash).toBe(sha256Hex(content))
      expect(sidecarPath).toBe(`${file}.sha256`)
      expect(readFileSync(sidecarPath, 'utf8')).toBe(`${hash}  archive.zip\n`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('getPackageVersion / assertDistBuilt (fake repo tree)', () => {
  let repoRoot

  beforeEach(() => {
    repoRoot = mkdtempSync(path.join(tmpdir(), 'grm-pkg-repo-'))
  })

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true })
  })

  it('reads the version field out of package.json', () => {
    writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({ version: '9.9.9' }))
    expect(getPackageVersion(repoRoot)).toBe('9.9.9')
  })

  it('getPublisher extracts the company half of "<person> - <company>"', () => {
    writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({ author: 'Bruno Marques - Bola Labs, Inc.' }))
    expect(getPublisher(repoRoot)).toBe('Bola Labs, Inc.')
  })

  it('getPublisher matches this repo\'s real package.json author field', () => {
    // Regression guard: if the real author field's format ever changes,
    // this fails loudly instead of installer.iss silently shipping a wrong
    // Publisher via the /D define computed the same way in CI.
    expect(getPublisher()).toBe('Bola Labs, Inc.')
  })

  it('getPublisher falls back to the whole author string when there is no " - " separator', () => {
    writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({ author: 'Solo Author' }))
    expect(getPublisher(repoRoot)).toBe('Solo Author')
  })

  it('getPublisher returns an empty string rather than throwing when author is absent', () => {
    writeFileSync(path.join(repoRoot, 'package.json'), JSON.stringify({}))
    expect(getPublisher(repoRoot)).toBe('')
  })

  it('assertDistBuilt throws a clear error when dist/ is entirely missing', () => {
    expect(() => assertDistBuilt(repoRoot)).toThrow(/run `npm run build`/)
  })

  it('assertDistBuilt throws when dist/ exists but has no index.html (incomplete build)', () => {
    mkdirSync(path.join(repoRoot, 'dist'))
    expect(() => assertDistBuilt(repoRoot)).toThrow(/run `npm run build`/)
  })

  it('assertDistBuilt passes silently when dist/index.html exists', () => {
    mkdirSync(path.join(repoRoot, 'dist'))
    writeFileSync(path.join(repoRoot, 'dist', 'index.html'), '<html></html>')
    expect(() => assertDistBuilt(repoRoot)).not.toThrow()
  })
})

describe('shouldSkipServerPath', () => {
  it('skips the test directory (bulk, irrelevant at runtime)', () => {
    expect(shouldSkipServerPath(path.join('__tests__', 'health.test.js'))).toBe(true)
  })

  it('skips the eval harness directory', () => {
    expect(shouldSkipServerPath(path.join('evals', 'run.js'))).toBe(true)
  })

  it('skips the local data directory at server/data root (never ship a dev DB)', () => {
    expect(shouldSkipServerPath(path.join('data', 'manager.db'))).toBe(true)
    expect(shouldSkipServerPath('data')).toBe(true)
  })

  it('skips stray db/sqlite files anywhere in the tree', () => {
    expect(shouldSkipServerPath(path.join('lib', 'oops.db'))).toBe(true)
    expect(shouldSkipServerPath(path.join('lib', 'oops.sqlite3'))).toBe(true)
    expect(shouldSkipServerPath('manager.db-wal')).toBe(true)
  })

  it('does not skip ordinary runtime source files', () => {
    expect(shouldSkipServerPath('index.js')).toBe(false)
    expect(shouldSkipServerPath(path.join('lib', 'data-dir.js'))).toBe(false)
    expect(shouldSkipServerPath(path.join('routes', 'health.js'))).toBe(false)
  })

  it('does not false-positive on a dir merely named similarly (e.g. "database-utils")', () => {
    expect(shouldSkipServerPath(path.join('database-utils', 'index.js'))).toBe(false)
  })
})

describe('betterSqlite3BinaryPath', () => {
  it('points at the standard prebuilt-binary location under the staged app dir', () => {
    const appDir = path.join('C:', 'staging', 'app')
    expect(betterSqlite3BinaryPath(appDir)).toBe(
      path.join(appDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
    )
  })
})

describe('readCachedZipIfValid (no existsSync-then-readFileSync check-then-act)', () => {
  let cacheDir

  beforeEach(() => {
    cacheDir = mkdtempSync(path.join(tmpdir(), 'grm-pkg-cache-'))
  })

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true })
  })

  it('returns null (not a thrown ENOENT) when the cache file does not exist at all', () => {
    const missing = path.join(cacheDir, 'node-vX-win-x64.zip')
    expect(readCachedZipIfValid(missing, 'a'.repeat(64))).toBeNull()
  })

  it('returns the buffer when the cached file matches the expected hash', () => {
    const content = Buffer.from('a cached node runtime zip, pretend')
    const hash = sha256Hex(content)
    const cachedZipPath = path.join(cacheDir, 'node-vX-win-x64.zip')
    writeFileSync(cachedZipPath, content)
    const result = readCachedZipIfValid(cachedZipPath, hash)
    expect(result).not.toBeNull()
    expect(Buffer.compare(result, content)).toBe(0)
  })

  it('returns null (a safe cache miss, not the stale bytes) when the cached file exists but the hash no longer matches', () => {
    const content = Buffer.from('a cached node runtime zip, pretend')
    const cachedZipPath = path.join(cacheDir, 'node-vX-win-x64.zip')
    writeFileSync(cachedZipPath, content)
    expect(readCachedZipIfValid(cachedZipPath, 'f'.repeat(64))).toBeNull()
  })

  it('propagates a real fs error other than ENOENT rather than silently treating it as a cache miss', () => {
    // A directory where a file is expected: readFileSync throws EISDIR, which
    // must NOT be swallowed the way a genuine "file absent" ENOENT is.
    const dirAsFile = path.join(cacheDir, 'oops-a-directory')
    mkdirSync(dirAsFile)
    expect(() => readCachedZipIfValid(dirAsFile, 'a'.repeat(64))).toThrow()
  })
})

describe('verifyAndCacheDownload (verify BEFORE any byte reaches disk, atomic write)', () => {
  let cacheDir

  beforeEach(() => {
    cacheDir = mkdtempSync(path.join(tmpdir(), 'grm-pkg-cache-'))
  })

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true })
  })

  it('writes the verified buffer to cachedZipPath and returns it, with no leftover temp file', () => {
    const content = Buffer.from('freshly downloaded node runtime zip, pretend')
    const hash = sha256Hex(content)
    const cachedZipPath = path.join(cacheDir, 'node-vX-win-x64.zip')

    const result = verifyAndCacheDownload(content, hash, 'node-vX-win-x64.zip', cachedZipPath)

    expect(Buffer.compare(result, content)).toBe(0)
    expect(existsSync(cachedZipPath)).toBe(true)
    expect(Buffer.compare(readFileSync(cachedZipPath), content)).toBe(0)
    // No stray `<cachedZipPath>.<pid>-<timestamp>.tmp` files left in cacheDir —
    // the rename must have moved (not copied) the verified bytes into place.
    const leftoverTemp = readdirSync(cacheDir).filter((f) => f.endsWith('.tmp'))
    expect(leftoverTemp).toEqual([])
  })

  it('throws on a hash mismatch and never writes anything to cachedZipPath at all', () => {
    const content = Buffer.from('tampered or corrupted download')
    const cachedZipPath = path.join(cacheDir, 'node-vX-win-x64.zip')

    expect(() =>
      verifyAndCacheDownload(content, 'f'.repeat(64), 'node-vX-win-x64.zip', cachedZipPath),
    ).toThrow(/SHA256 verification/)

    // The whole point of verify-before-write: an unverified/mismatched
    // download must never reach the final path, not even partially.
    expect(existsSync(cachedZipPath)).toBe(false)
    const files = readdirSync(cacheDir)
    expect(files).toEqual([])
  })
})

describe('existsSync sanity (guards against a bad tmpdir cleanup in earlier tests)', () => {
  it('the OS tmpdir itself still exists', () => {
    expect(existsSync(tmpdir())).toBe(true)
  })
})
