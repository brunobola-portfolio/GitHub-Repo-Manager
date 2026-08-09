#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Builds the Windows portable distribution:
 *
 *   github-repo-manager-<version>-win-x64.zip (+ .sha256 sidecar)
 *
 * Layout of the zip:
 *   app/                    server/, dist/, keys/public.pem, package.json,
 *                           scripts/first-run.mjs, and a PRUNED production
 *                           node_modules (built fresh via `npm ci --omit=dev`
 *                           inside the staged app dir — never copied from the
 *                           dev tree, which carries devDependencies).
 *   runtime/node.exe        official win-x64 Node build, version-pinned below
 *                           and verified against nodejs.org's SHASUMS256.txt.
 *   Start GitHub Repo Manager.cmd / Stop GitHub Repo Manager.cmd / *.ps1
 *                           launchers, copied verbatim from packaging/windows/
 *                           (the Inno Setup installer stages the same tree).
 *   GitHub Repo Manager.exe flashless launcher stub, compiled at package
 *                           time from packaging/windows/launcher/Launcher.cs
 *                           by the in-box .NET Framework 4.8 csc.exe.
 *   README-WINDOWS.txt
 *
 * Exported as pure/orchestration functions so the version pin, hashing, and
 * staging-layout logic can be unit tested without a real network call or a
 * multi-minute `npm ci`; see scripts/__tests__/package-windows.test.js.
 */
import { createHash } from 'node:crypto';
import {
    existsSync,
    mkdirSync,
    rmSync,
    readFileSync,
    writeFileSync,
    copyFileSync,
    cpSync,
    readdirSync,
    renameSync,
    unlinkSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT_DEFAULT = path.resolve(__dirname, '..');

// Node 24 LTS ("Krypton"). Bumped periodically — confirmed current at
// https://nodejs.org/dist/latest-v24.x/ on 2026-08-08. Must stay inside
// package.json's engines range (">=22.14 <25"; the 26 line is Current, not LTS).
//
// The runtime that RUNS the package does not have to match the one that built
// it: better-sqlite3 13 compiles against NAPI_VERSION=10 and ships
// ABI-independent prebuilds (prebuilds/win32-x64.node — no NODE_MODULE_VERSION
// in the filename), so the binary produced by `npm ci` on any supported Node
// loads on any other. That is also what lets the same lockfile serve both LTS
// lines; the compat-node-floor job in CI is what keeps it true.
export const NODE_VERSION = '24.19.0';
export const NODE_DIST_PLATFORM = 'win-x64';

export function nodeZipFileName(version = NODE_VERSION) {
    return `node-v${version}-${NODE_DIST_PLATFORM}.zip`;
}

export function nodeDistUrls(version = NODE_VERSION) {
    const base = `https://nodejs.org/dist/v${version}`;
    return {
        zipUrl: `${base}/${nodeZipFileName(version)}`,
        shasumsUrl: `${base}/SHASUMS256.txt`,
    };
}

export function zipFileNameFor(version) {
    return `github-repo-manager-${version}-win-x64.zip`;
}

export function sha256Hex(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}

export function sha256File(filePath) {
    return sha256Hex(readFileSync(filePath));
}

/**
 * Parse a SHASUMS256.txt body into a Map<filename, lowercase hex hash>.
 * Node's published checksum files use "<hash>  <filename>" (two spaces),
 * but this tolerates any run of whitespace and skips blank/comment lines.
 */
export function parseShasums256(text) {
    const map = new Map();
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(\S.*)$/);
        if (!match) continue;
        map.set(match[2].trim(), match[1].toLowerCase());
    }
    return map;
}

/**
 * `<hash>  <basename>\n` — matches the format `sha256sum` emits and the one
 * release.yml already publishes for the Linux dist tarball, so both assets
 * verify the same way for a downstream consumer.
 */
export function sha256SidecarContents(hash, fileName) {
    return `${hash}  ${fileName}\n`;
}

export function writeSha256Sidecar(filePath) {
    const hash = sha256File(filePath);
    const sidecarPath = `${filePath}.sha256`;
    writeFileSync(sidecarPath, sha256SidecarContents(hash, path.basename(filePath)), 'utf8');
    return { hash, sidecarPath };
}

export function getPackageVersion(repoRoot = REPO_ROOT_DEFAULT) {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    return pkg.version;
}

/**
 * Single source of truth for the installer/winget "Publisher" field.
 * package.json's "author" is "<person> - <company>" (e.g.
 * "Bruno Marques - Bola Labs, Inc."); the company half is what ships as
 * AppPublisher in installer.iss (passed in via /D, mirroring how
 * MyAppVersion is threaded through) — never hardcode it a second time
 * there. The winget locale template is a static reference file wingetcreate
 * never reads, so it just documents this function as the source in a
 * comment rather than being generated from it.
 */
export function getPublisher(repoRoot = REPO_ROOT_DEFAULT) {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const author = String(pkg.author || '').trim();
    const parts = author.split(' - ');
    return parts.length > 1 ? parts[parts.length - 1].trim() : author;
}

export const LAUNCHER_EXE_NAME = 'GitHub Repo Manager.exe';

/**
 * The legacy Framework 4.8 compiler ships inside Windows itself (and on
 * every GitHub windows-latest runner) — zero toolchain to install, and the
 * produced exe needs only the Framework 4.8 runtime preinstalled on all
 * supported Windows 10/11. Do not "upgrade" this to dotnet publish: that
 * either adds a runtime dependency or a 100x bigger AOT binary.
 */
export function frameworkCscPath() {
    const winDir = process.env.WINDIR || 'C:\\Windows';
    return path.join(winDir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
}

export function launcherCscArgs({ source, out, icon }) {
    return [
        '/nologo',
        '/target:winexe',
        '/platform:anycpu',
        '/optimize+',
        '/r:System.Windows.Forms.dll',
        // System.Drawing: the tray NotifyIcon loads the exe's own embedded
        // brand icon (Icon.ExtractAssociatedIcon). System.dll (HttpWebRequest
        // for the health poll, Microsoft.Win32.Registry for autostart) is in
        // the compiler's default reference set.
        '/r:System.Drawing.dll',
        `/win32icon:${icon}`,
        `/out:${out}`,
        source,
    ];
}

export function assertDistBuilt(repoRoot) {
    const distPath = path.join(repoRoot, 'dist');
    if (!existsSync(distPath) || !existsSync(path.join(distPath, 'index.html'))) {
        throw new Error(
            `dist/ not found (or incomplete) at ${distPath} — run \`npm run build\` before packaging.`,
        );
    }
}

/**
 * Directories/files inside server/ that must NEVER ship: test code (bulk,
 * irrelevant at runtime), the eval harness (dev-only, may carry a local
 * baseline file), and server/data — a fresh checkout can already contain a
 * real local SQLite DB (server/data/manager.db*); shipping it would leak
 * whoever built the package's local data into every install. Mirrors the
 * intent of .dockerignore's `server/data/*.db` + `*.db`/`*.sqlite*` excludes.
 */
export function shouldSkipServerPath(relativePath) {
    const segments = relativePath.split(path.sep);
    if (segments.includes('__tests__') || segments.includes('evals')) return true;
    if (segments[0] === 'data') return true;
    if (/\.(db|sqlite3?|db-wal|db-shm|db-journal)$/i.test(relativePath)) return true;
    return false;
}

function copyServerTree(repoRoot, appDir) {
    const src = path.join(repoRoot, 'server');
    const dest = path.join(appDir, 'server');
    cpSync(src, dest, {
        recursive: true,
        filter: (source) => {
            const rel = path.relative(src, source);
            if (rel === '') return true;
            return !shouldSkipServerPath(rel);
        },
    });
}

/**
 * Only keys/public.pem ever ships — license verification only needs the
 * public key, and keys/private.pem (gitignored, may exist locally for
 * signing) must never leave this machine. Mirrors the Dockerfile's
 * `COPY keys/public.pem` (never `COPY keys/`).
 */
function copyPublicKeyOnly(repoRoot, appDir) {
    const src = path.join(repoRoot, 'keys', 'public.pem');
    if (!existsSync(src)) {
        throw new Error(
            `keys/public.pem not found at ${src} — required for offline license verification; refusing to package without it.`,
        );
    }
    const destDir = path.join(appDir, 'keys');
    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, path.join(destDir, 'public.pem'));
}

function copyStaticAppFiles(repoRoot, appDir) {
    mkdirSync(appDir, { recursive: true });
    copyFileSync(path.join(repoRoot, 'package.json'), path.join(appDir, 'package.json'));
    copyFileSync(path.join(repoRoot, 'package-lock.json'), path.join(appDir, 'package-lock.json'));
    cpSync(path.join(repoRoot, 'dist'), path.join(appDir, 'dist'), { recursive: true });
    mkdirSync(path.join(appDir, 'scripts'), { recursive: true });
    copyFileSync(
        path.join(repoRoot, 'scripts', 'first-run.mjs'),
        path.join(appDir, 'scripts', 'first-run.mjs'),
    );
    copyServerTree(repoRoot, appDir);
    copyPublicKeyOnly(repoRoot, appDir);
}

/**
 * `npm ci --omit=dev` inside the staged app dir, using the package.json +
 * lockfile just copied there — the "copied workspace" approach, chosen over
 * `--prefix` because it guarantees postinstall's relative
 * `node server/check-native-modules.js` resolves against the staged tree
 * (server/ must already be copied in before this runs), and keeps
 * better-sqlite3's win32-x64 prebuilt binary intact (same npm/Node instance
 * installing it end to end, no cross-copy of a native module directory).
 */
function pruneProductionDeps(appDir) {
    execFileSync('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
        cwd: appDir,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
}

/**
 * Where a usable win32-x64 binary can legitimately live, newest layout first.
 *
 * better-sqlite3 13 moved to N-API and now publishes prebuilt binaries inside
 * the package as `prebuilds/<platform>-<arch>.node`; node-gyp's
 * `build/Release/better_sqlite3.node` only appears when the module is compiled
 * from source (and is still the whole story on 12.x). Both are shippable, so
 * the guard accepts either — but only for THIS platform+arch: a package
 * carrying someone else's prebuild is precisely the boot crash it exists to
 * prevent.
 */
export function betterSqlite3BinaryCandidates(appDir) {
    const moduleDir = path.join(appDir, 'node_modules', 'better-sqlite3');
    return [
        path.join(moduleDir, 'prebuilds', `${process.platform}-${process.arch}.node`),
        path.join(moduleDir, 'build', 'Release', 'better_sqlite3.node'),
    ];
}

export function assertBetterSqlite3Binary(appDir) {
    const candidates = betterSqlite3BinaryCandidates(appDir);
    if (candidates.some((p) => existsSync(p))) return;
    throw new Error(
        `better-sqlite3 native binary missing after npm ci. Looked for:\n` +
        candidates.map((p) => `  - ${p}`).join('\n') + '\n' +
        `The staged node_modules did not produce a ${process.platform}-${process.arch} prebuilt binary — ` +
        'packaging aborted rather than shipping a package that will crash on boot.',
    );
}

async function downloadToBuffer(url) {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Download failed: ${url} -> HTTP ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
}

/**
 * Reads a cached copy of the Node runtime zip iff it exists AND matches the
 * expected hash. A direct try/catch on ENOENT rather than an
 * existsSync-then-readFileSync pair: the latter is a check-then-act — the
 * file could be removed (or be mid-write from a concurrent packaging run
 * sharing the same cache dir) in the gap between the check and the read.
 * Returns null on any cache miss (absent or hash mismatch), never throws for
 * that case — only a real unexpected fs error propagates.
 */
export function readCachedZipIfValid(cachedZipPath, expectedHash) {
    let cached;
    try {
        cached = readFileSync(cachedZipPath);
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
    return sha256Hex(cached) === expectedHash ? cached : null;
}

/**
 * Verifies a freshly-downloaded buffer against the expected hash BEFORE any
 * byte of it ever reaches the cache path (never write-then-verify) — a
 * mismatch throws before any write is attempted. Once verified, the buffer
 * is committed to cachedZipPath atomically: written to a unique temp file
 * first, then `renameSync`'d into place, so cachedZipPath is never
 * observable half-written and a crash mid-download can never leave a
 * corrupt file where readCachedZipIfValid would later find (and trust) it.
 */
export function verifyAndCacheDownload(buffer, expectedHash, zipName, cachedZipPath) {
    const actualHash = sha256Hex(buffer);
    if (actualHash !== expectedHash) {
        throw new Error(
            `Node.js runtime download failed SHA256 verification: ${zipName}\n` +
            `  expected ${expectedHash}\n  actual   ${actualHash}`,
        );
    }
    const tempPath = `${cachedZipPath}.${process.pid}-${Date.now()}.tmp`;
    writeFileSync(tempPath, buffer);
    try {
        renameSync(tempPath, cachedZipPath);
    } catch (err) {
        try { unlinkSync(tempPath); } catch { /* best-effort cleanup, original error wins */ }
        throw err;
    }
    return buffer;
}

/**
 * Downloads (or reuses a hash-verified cache of) the official Node win-x64
 * build, verifies it against nodejs.org's own SHASUMS256.txt, and extracts
 * only node.exe + its LICENSE into runtimeDir — never the full zip (npm/npx
 * etc. are not needed; the launchers invoke server/index.js directly).
 */
export async function ensureNodeRuntime({ version = NODE_VERSION, cacheDir, runtimeDir }) {
    const { zipUrl, shasumsUrl } = nodeDistUrls(version);
    const zipName = nodeZipFileName(version);
    mkdirSync(cacheDir, { recursive: true });
    mkdirSync(runtimeDir, { recursive: true });

    const shasumsText = await (await fetch(shasumsUrl)).text();
    const shasums = parseShasums256(shasumsText);
    const expectedHash = shasums.get(zipName);
    if (!expectedHash) {
        throw new Error(`SHASUMS256.txt for Node ${version} has no entry for ${zipName}`);
    }

    const cachedZipPath = path.join(cacheDir, zipName);
    let zipBuffer = readCachedZipIfValid(cachedZipPath, expectedHash);
    if (!zipBuffer) {
        const downloaded = await downloadToBuffer(zipUrl);
        zipBuffer = verifyAndCacheDownload(downloaded, expectedHash, zipName, cachedZipPath);
    }

    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    const nodeExeEntry = entries.find((e) => !e.isDirectory && /\/node\.exe$/i.test(e.entryName));
    const licenseEntry = entries.find((e) => !e.isDirectory && /\/LICENSE$/.test(e.entryName));
    if (!nodeExeEntry) {
        throw new Error(`node.exe entry not found inside ${zipName}`);
    }
    zip.extractEntryTo(nodeExeEntry.entryName, runtimeDir, false, true);
    if (licenseEntry) {
        zip.extractEntryTo(licenseEntry.entryName, runtimeDir, false, true);
    }

    const nodeExePath = path.join(runtimeDir, 'node.exe');
    if (!existsSync(nodeExePath)) {
        throw new Error(`Extraction did not produce ${nodeExePath}`);
    }
    return { nodeExePath, version };
}

function copyLaunchers(packagingWindowsDir, stagingRoot) {
    const files = ['Start GitHub Repo Manager.cmd', 'Stop GitHub Repo Manager.cmd', 'start.ps1', 'stop.ps1', 'apply-update.ps1', 'README-WINDOWS.txt'];
    for (const name of files) {
        const src = path.join(packagingWindowsDir, name);
        if (!existsSync(src)) {
            throw new Error(`Launcher file missing: ${src}`);
        }
        copyFileSync(src, path.join(stagingRoot, name));
    }
}

function compileLauncher(packagingWindowsDir, stagingDir) {
    const csc = frameworkCscPath();
    if (!existsSync(csc)) {
        throw new Error(
            `csc.exe not found at ${csc} — the launcher stub needs the in-box .NET Framework 4.8 compiler (present on all stock Windows 10/11 and CI runners).`,
        );
    }
    execFileSync(csc, launcherCscArgs({
        source: path.join(packagingWindowsDir, 'launcher', 'Launcher.cs'),
        out: path.join(stagingDir, LAUNCHER_EXE_NAME),
        icon: path.join(packagingWindowsDir, 'assets', 'repomanager.ico'),
    }), { stdio: 'inherit' });
}

function listAllFiles(dir, base = dir) {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listAllFiles(full, base));
        } else {
            out.push(path.relative(base, full));
        }
    }
    return out;
}

/**
 * Zips stagingRoot's contents (not the stagingRoot folder itself) so the
 * archive extracts flat: app/, runtime/, Start ....cmd, etc. at the zip root.
 * Entries are added in a sorted, deterministic order; the hash is computed
 * from the file written to disk (post-close), so it is always internally
 * consistent with the bytes actually shipped, even though byte-for-byte
 * reproducibility across separate runs (mtimes differ) is not attempted.
 */
function zipStagingTree(stagingRoot, outZipPath) {
    const zip = new AdmZip();
    const relFiles = listAllFiles(stagingRoot).sort();
    for (const rel of relFiles) {
        const zipPath = path.dirname(rel);
        zip.addLocalFile(path.join(stagingRoot, rel), zipPath === '.' ? '' : zipPath.split(path.sep).join('/'));
    }
    mkdirSync(path.dirname(outZipPath), { recursive: true });
    zip.writeZip(outZipPath);
}

/**
 * Full pipeline: staging tree -> pruned deps -> bundled runtime -> launchers
 * -> zip + sha256. Wipes stagingDir at the start of every run (the Node
 * runtime cache lives in a sibling directory so this never forces a
 * redownload) so a version bump or a previous failed run can't leave stale
 * files in the shipped archive.
 */
export async function packageWindows({
    repoRoot = REPO_ROOT_DEFAULT,
    stagingDir,
    outDir,
    nodeVersion = NODE_VERSION,
} = {}) {
    if (!stagingDir) throw new Error('packageWindows: stagingDir is required');
    if (!outDir) throw new Error('packageWindows: outDir is required');

    assertDistBuilt(repoRoot);

    rmSync(stagingDir, { recursive: true, force: true });
    mkdirSync(stagingDir, { recursive: true });

    const appDir = path.join(stagingDir, 'app');
    const runtimeDir = path.join(stagingDir, 'runtime');
    const cacheDir = path.join(path.dirname(stagingDir), '.node-runtime-cache');

    copyStaticAppFiles(repoRoot, appDir);
    pruneProductionDeps(appDir);
    assertBetterSqlite3Binary(appDir);

    await ensureNodeRuntime({ version: nodeVersion, cacheDir, runtimeDir });

    const packagingWindowsDir = path.join(repoRoot, 'packaging', 'windows');
    copyLaunchers(packagingWindowsDir, stagingDir);
    compileLauncher(packagingWindowsDir, stagingDir);

    const version = getPackageVersion(repoRoot);
    const zipName = zipFileNameFor(version);
    const zipPath = path.join(outDir, zipName);
    zipStagingTree(stagingDir, zipPath);
    const { hash, sidecarPath } = writeSha256Sidecar(zipPath);

    return { version, zipPath, sidecarPath, hash };
}

function parseCliArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--staging') args.staging = argv[++i];
        else if (arg === '--out') args.out = argv[++i];
        else if (arg === '--repo-root') args.repoRoot = argv[++i];
        else if (arg === '--node-version') args.nodeVersion = argv[++i];
    }
    return args;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
    const cli = parseCliArgs(process.argv.slice(2));
    const repoRoot = cli.repoRoot ? path.resolve(cli.repoRoot) : REPO_ROOT_DEFAULT;
    const stagingDir = cli.staging ? path.resolve(cli.staging) : path.join(repoRoot, '.dev', 'package-windows', 'staging');
    const outDir = cli.out ? path.resolve(cli.out) : path.join(repoRoot, '.dev', 'package-windows', 'out');

    packageWindows({ repoRoot, stagingDir, outDir, nodeVersion: cli.nodeVersion })
        .then(({ version, zipPath, sidecarPath, hash }) => {
            process.stdout.write(`[package-windows] ${version} -> ${zipPath}\n`);
            process.stdout.write(`[package-windows] sha256 ${hash} -> ${sidecarPath}\n`);
        })
        .catch((err) => {
            process.stderr.write(`[package-windows] FAILED: ${err.stack || err.message}\n`);
            process.exitCode = 1;
        });
}
