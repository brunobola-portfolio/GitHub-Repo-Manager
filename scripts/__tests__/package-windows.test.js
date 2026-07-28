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
  betterSqlite3BinaryCandidates,
  assertBetterSqlite3Binary,
  readCachedZipIfValid,
  verifyAndCacheDownload,
  frameworkCscPath,
  launcherCscArgs,
  LAUNCHER_EXE_NAME,
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

describe('betterSqlite3BinaryCandidates', () => {
  it('offers both the N-API prebuild and the node-gyp build under the staged app dir', () => {
    const appDir = path.join('C:', 'staging', 'app')
    const moduleDir = path.join(appDir, 'node_modules', 'better-sqlite3')
    expect(betterSqlite3BinaryCandidates(appDir)).toEqual([
      path.join(moduleDir, 'prebuilds', `${process.platform}-${process.arch}.node`),
      path.join(moduleDir, 'build', 'Release', 'better_sqlite3.node'),
    ])
  })
})

describe('assertBetterSqlite3Binary', () => {
  // better-sqlite3 13 moved to N-API: prebuilt binaries now ship inside the
  // package at prebuilds/<platform>-<arch>.node and node-gyp no longer produces
  // build/Release/better_sqlite3.node. A guard that knows only the old layout
  // blocks the release on a package that is actually fine.
  let appDir

  // The guard resolves the prebuild name from the RUNNING platform, so these
  // must too: the unit shards run on Linux while packaging runs on Windows, and
  // hardcoding win32-x64 makes "correct binary" and "foreign binary" swap
  // meanings between the two.
  const NATIVE = `${process.platform}-${process.arch}.node`
  const FOREIGN = `${process.platform}-${process.arch === 'x64' ? 'arm64' : 'x64'}.node`

  function stage(relPath) {
    const full = path.join(appDir, 'node_modules', 'better-sqlite3', ...relPath)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, 'binary')
    return full
  }

  beforeEach(() => {
    appDir = mkdtempSync(path.join(tmpdir(), 'grm-pkg-bs3-'))
  })

  afterEach(() => {
    rmSync(appDir, { recursive: true, force: true })
  })

  it('accepts the node-gyp layout (better-sqlite3 12 and source builds)', () => {
    stage(['build', 'Release', 'better_sqlite3.node'])
    expect(() => assertBetterSqlite3Binary(appDir)).not.toThrow()
  })

  it('accepts the N-API prebuilds layout (better-sqlite3 13)', () => {
    stage(['prebuilds', NATIVE])
    expect(() => assertBetterSqlite3Binary(appDir)).not.toThrow()
  })

  it('still aborts packaging when neither layout produced a binary', () => {
    mkdirSync(path.join(appDir, 'node_modules', 'better-sqlite3'), { recursive: true })
    expect(() => assertBetterSqlite3Binary(appDir)).toThrow(/native binary missing/)
  })

  it('does not accept a prebuild for the wrong architecture', () => {
    // Shipping an arm64 binary in an x64 package is exactly the crash on boot
    // this guard exists to prevent.
    stage(['prebuilds', FOREIGN])
    expect(() => assertBetterSqlite3Binary(appDir)).toThrow(/native binary missing/)
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

describe('launcher stub compilation', () => {
  it('uses the in-box .NET Framework 4.8 csc (guaranteed on Windows + CI)', () => {
    const csc = frameworkCscPath()
    expect(csc.toLowerCase()).toContain('framework64')
    expect(csc.toLowerCase()).toContain('v4.0.30319')
    expect(csc.toLowerCase().endsWith('csc.exe')).toBe(true)
  })

  it('compiles a flashless GUI-subsystem exe with the brand icon', () => {
    const args = launcherCscArgs({ source: 'L.cs', out: 'G.exe', icon: 'b.ico' })
    expect(args).toContain('/target:winexe')
    expect(args).toContain('/platform:anycpu')
    expect(args).toContain('/optimize+')
    expect(args).toContain('/r:System.Windows.Forms.dll')
    expect(args).toContain('/r:System.Drawing.dll')
    expect(args).toContain('/win32icon:b.ico')
    expect(args).toContain('/out:G.exe')
    expect(args[args.length - 1]).toBe('L.cs')
  })

  it('names the exe like the product', () => {
    expect(LAUNCHER_EXE_NAME).toBe('GitHub Repo Manager.exe')
  })
})

/**
 * Source-level guards on installer.iss. There is no Inno Setup compiler in
 * CI, so these read the Pascal rather than execute it — which still catches
 * the regression that matters, because the defect they cover was a missing
 * call, not a subtle runtime condition.
 */
describe('installer.iss — the tray must not survive an update', () => {
  const iss = readFileSync(path.join(process.cwd(), 'packaging/windows/installer.iss'), 'utf8')

  // IsAppRunning() matches node.exe by PID: the SERVER. The tray is a separate
  // process holding a lock on {app}\GitHub Repo Manager.exe, and the in-app
  // self-update asks the server to exit ~500 ms after spawning setup.exe — so
  // node is typically already gone when PrepareToInstall runs. Gating the tray
  // stop behind IsAppRunning() meant [Files] could not replace the locked exe,
  // the update aborted, and no server came back.
  function bodyOf(name) {
    const start = iss.indexOf(name)
    expect(start, `${name} not found in installer.iss`).toBeGreaterThan(-1)
    const end = iss.indexOf('\nend;', start)
    return iss.slice(start, end)
  }

  it('PrepareToInstall stops the tray even when the server is NOT running', () => {
    const body = bodyOf('function PrepareToInstall(')
    const notRunningBranch = body.slice(body.lastIndexOf('exit;'))
    expect(notRunningBranch).toMatch(/StopTrayIfRunning\(\)/)
  })

  it('PrepareToInstall still leaves both processes alone when the user declines', () => {
    const body = bodyOf('function PrepareToInstall(')
    const declineBranch = body.slice(body.indexOf('MB_YESNO'), body.indexOf('Setup cannot continue'))
    expect(declineBranch).not.toMatch(/StopTrayIfRunning|TryStopRunningApp/)
  })

  it('uninstall stops the tray on both branches', () => {
    const body = bodyOf('procedure CurUninstallStepChanged(')
    expect(body).toMatch(/TryStopRunningApp\(\)/)
    expect(body).toMatch(/StopTrayIfRunning\(\)/)
  })

  it('StopTrayIfRunning is declared before the procedures that call it', () => {
    // Pascal requires it, and Inno only fails at install time, not build time.
    expect(iss.indexOf('procedure StopTrayIfRunning'))
      .toBeLessThan(iss.indexOf('function PrepareToInstall('))
    expect(iss.indexOf('procedure StopTrayIfRunning'))
      .toBeLessThan(iss.indexOf('procedure CurUninstallStepChanged('))
  })
})

/**
 * apply-update.ps1 runs under Windows PowerShell 5.1, not pwsh 7.
 *
 * updater.js spawns it with powershell.exe, and 5.1's Expand-Archive is a
 * pure-PowerShell implementation with per-entry overhead. On the shipped
 * 128 MB package that took 16 minutes — measured in CI, 22:48:05 to 23:04:08 —
 * with the app stopped and the user staring at nothing. Benchmarked under 5.1
 * on 4000 small files: Expand-Archive 74.0 s, ZipFile::ExtractToDirectory
 * 2.3 s.
 *
 * The trap is that the SAME cmdlet is fast under pwsh 7, which every workflow
 * step uses — so the packaging job's own extraction steps looked healthy and
 * hid this for as long as the feature has existed.
 */
describe('apply-update.ps1 — extraction must not use the slow 5.1 cmdlet', () => {
  const script = readFileSync(path.join(process.cwd(), 'packaging/windows/apply-update.ps1'), 'utf8')

  // Comments explaining WHY it is banned would otherwise trip a naive search.
  const code = script
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')

  it('does not call Expand-Archive', () => {
    expect(code).not.toMatch(/Expand-Archive/)
  })

  it('extracts via ZipFile::ExtractToDirectory', () => {
    expect(code).toMatch(/\[System\.IO\.Compression\.ZipFile\]::ExtractToDirectory/)
    expect(code).toMatch(/Add-Type -AssemblyName System\.IO\.Compression\.FileSystem/)
  })

  it('clears the staging directory first, since ExtractToDirectory throws on an existing target', () => {
    // Expand-Archive -Force overwrote; the replacement does not.
    const extractIndex = code.indexOf('ExtractToDirectory')
    const before = code.slice(0, extractIndex)
    expect(before).toMatch(/Remove-Item -LiteralPath \$Staging -Recurse -Force/)
  })
})

