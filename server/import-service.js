/**
 * Import Service
 * Handles repository import/migration using git clone --bare + push --mirror
 * Uses simple-git for all git operations
 */

import { simpleGit } from 'simple-git';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import logger from './lib/logger.js';
import { detectTool } from './lib/env/detect.js';
import { isInternalUrl, resolveAndValidateHost } from './lib/url-validator.js';
import {
    findOversizedBlobs,
    parseOversizedPushError,
    encodeOversizedError,
    GITHUB_FILE_SIZE_LIMIT_BYTES,
} from './lib/oversized-blobs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Canonical temp root for ALL import workdirs (git clones, git-tfs, TFVC
// snapshots). Exported so route-level strategies don't re-derive it with
// their own __dirname arithmetic — that's how multi-GB clones ended up
// inside server/routes/ once already.
export const TMP_DIR = join(__dirname, 'data', 'tmp');
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Ensure tmp dir exists
if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
}

/**
 * Check if git is available on the system
 */
async function checkGitInstalled() {
    const r = await detectTool('git');
    return { installed: r.status === 'ok' || r.status === 'outdated', version: r.version };
}

/**
 * Validate a git URL is reachable (using ls-remote)
 */
async function validateSourceUrl(url, credentials) {
    // SSRF protection: block internal/private URLs
    if (isInternalUrl(url)) {
        return { valid: false, error: 'URL targets a private or internal network. Only public HTTPS and git:// URLs are allowed.' };
    }

    // DNS rebinding protection: resolve hostname and verify IP is not private
    const dnsValid = await resolveAndValidateHost(url);
    if (!dnsValid) {
        return { valid: false, error: 'URL resolves to a private or internal network address.' };
    }

    const authUrl = credentials ? embedCredentials(url, credentials) : url;
    try {
        const git = simpleGit();
        await git.listRemote(['--heads', authUrl]);
        return { valid: true };
    } catch (e) {
        const msg = e.message || '';
        if (msg.includes('Authentication') || msg.includes('403') || msg.includes('401')) {
            return { valid: false, error: 'Authentication failed. Check your credentials.' };
        }
        if (msg.includes('not found') || msg.includes('404')) {
            return { valid: false, error: 'Repository not found. Check the URL.' };
        }
        return { valid: false, error: `Cannot access repository: ${msg.substring(0, 200)}` };
    }
}

/**
 * Sanitize a repository name to be valid for GitHub
 * GitHub allows: a-zA-Z0-9, -, _, .
 */
function sanitizeRepoName(name) {
    if (!name) return '';
    return name
        .trim()
        .replace(/\s+/g, '-')           // spaces to dashes
        .replace(/[^a-zA-Z0-9._-]/g, '') // remove invalid chars
        .replace(/\.{2,}/g, '.')         // collapse multiple dots
        .replace(/^[-.]|[-.]$/g, '')     // no leading/trailing dash or dot
        .substring(0, 100);              // max length
}

/**
 * Embed credentials into a git URL
 */
function embedCredentials(url, credentials) {
    if (!credentials) return url;

    const { type, token, username, password } = credentials;

    // Azure DevOps may return remoteUrl with existing userinfo (e.g. org@dev.azure.com).
    // Naive string replace ('https://' → 'https://PAT@') creates double @ which breaks URL parsing.
    // We use URL.host (excludes userinfo) and URL.pathname (keeps %20 encoding intact) to build
    // a clean URL with only the new credentials.
    const parsed = new URL(url);

    switch (type) {
        case 'pat':
        case 'token':
            if (parsed.hostname === 'dev.azure.com') {
                return `https://${encodeURIComponent(token)}@${parsed.host}${parsed.pathname}`;
            }
            return `https://x-access-token:${encodeURIComponent(token)}@${parsed.host}${parsed.pathname}`;

        case 'basic':
            return `https://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${parsed.host}${parsed.pathname}`;

        default:
            return url;
    }
}

/**
 * Decide what to do when the target repo name already exists on GitHub.
 * Pure (no I/O). An existing *empty* repo is always reused (nothing to lose);
 * a non-empty repo is replaced only when the user chose `onConflict: 'replace'`,
 * otherwise the import fails with the "already exists" error.
 *
 * @param {{ size:number, defaultBranch:(string|null|undefined), onConflict?:string }} args
 * @returns {{ action: 'reuse'|'replace'|'fail' }}
 */
export function decideConflictResolution({ size, defaultBranch, onConflict }) {
    const isEmpty = size === 0 && !defaultBranch;
    if (isEmpty) return { action: 'reuse' };
    if (onConflict === 'replace') return { action: 'replace' };
    return { action: 'fail' };
}

/**
 * Whether `git lfs push` must run after the mirror push. True when the source
 * already used LFS OR when `sizeStrategy === 'lfs-migrate'` converted blobs to
 * LFS pointers during this run — in the latter case `hasLFS` (read from the
 * pristine source attributes) is false, but the local repo now has LFS objects
 * that would otherwise be left dangling (pointers pushed, objects missing).
 * @param {boolean} hasLFS - source repo already used LFS
 * @param {string} [sizeStrategy]
 * @returns {boolean}
 */
export function lfsPushNeeded(hasLFS, sizeStrategy) {
    return !!hasLFS || sizeStrategy === 'lfs-migrate';
}

/**
 * Verify git-lfs is installed before relying on it (lfs-migrate / lfs push).
 * Without this, a missing git-lfs silently falls back to the original history
 * and the run fails later at the opaque "exceeds 100 MB" push error. Throws a
 * coded, actionable error instead.
 * @param {(args:string[])=>Promise<any>} runRaw - runs `git <args>` (e.g. git.raw)
 */
export async function ensureGitLfs(runRaw) {
    // The repo-scoped runRaw stays the detection path (honours the repo's PATH),
    // but normalise the "missing" verdict through the engine's status model.
    const probe = await detectTool('git-lfs', {
        runner: async (_cmd, args) => ({ stdout: await runRaw(args) }),
        force: true,
    });
    if (probe.status === 'missing') {
        const err = new Error(
            "Git LFS is not installed on the migration server, so files over GitHub's 100 MB limit cannot be converted. Install git-lfs (https://git-lfs.com) on the server and retry, or choose \"Exclude\" for this repository.",
        );
        err.code = 'GIT_LFS_MISSING';
        throw err;
    }
}

/**
 * Args for `git lfs migrate import` — converts every blob over GitHub's 100 MiB
 * per-file limit to an LFS pointer across all refs, non-interactively.
 *
 * The `--above` size unit MUST be one git-lfs accepts (`b`/`kb`/`mb`/`gb`/`tb`
 * or the binary `kib`/`mib`/…). A bare `M` is rejected with
 * `unknown unit: "m"`, which aborts the conversion; the run then proceeds with
 * the original history and dies later at the opaque oversized-push error.
 * `100MiB` is kept byte-aligned with GITHUB_FILE_SIZE_LIMIT_BYTES (100 * 1024²).
 */
export const LFS_MIGRATE_IMPORT_ARGS = [
    'lfs', 'migrate', 'import',
    '--above=100MiB',
    '--everything',
    '--yes',
];

/**
 * Delete a repository on GitHub. Treats 404 as success (already gone) and
 * maps 403 to an actionable message (orgs can forbid member deletions).
 * @param {string} owner
 * @param {string} repo
 * @param {object} headers - GitHub auth headers
 */
export async function deleteGithubRepo(owner, repo, headers) {
    const res = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        { method: 'DELETE', headers },
    );
    if (res.status === 204 || res.status === 404) return;
    if (res.status === 403) {
        throw new Error(
            `Could not delete the existing repository "${owner}/${repo}" — the organization may block members from deleting repositories, or your token lacks delete permission on it. Enable "Allow members to delete repositories" in the org settings or delete it manually, then retry.`,
        );
    }
    const body = await res.json().catch(() => null);
    throw new Error(`Failed to delete existing repository "${owner}/${repo}": ${body?.message || res.status}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Throws a distinguishable cancellation error when the caller's isCancelled()
 * flag is set. Checked at every phase boundary so a mid-run cancel stops the
 * import at the next opportunity even during phases with no git child process
 * to hard-abort (GitHub REST calls for create/reuse/replace, oversized-blob
 * scan, etc). `importRepository`'s catch block recognizes `err.code === 'CANCELLED'`
 * and reports the run as cancelled, not failed.
 */
function throwIfCancelled(isCancelled) {
    if (isCancelled()) {
        const err = new Error('Migration cancelled');
        err.code = 'CANCELLED';
        throw err;
    }
}

/**
 * Polls isCancelled() and trips the AbortController the moment it flips true —
 * this is what turns a cancel request into a genuine hard-kill of whatever git
 * child process (clone/LFS fetch/LFS migrate/push/LFS push) is running at that
 * instant, via simple-git's built-in `abort` plugin (SIGINT to the spawned
 * process). Returns the interval handle so the caller can clear it.
 */
function startCancelWatcher(isCancelled, abortController) {
    const timer = setInterval(() => {
        if (isCancelled()) abortController.abort();
    }, 400);
    if (timer.unref) timer.unref();
    return timer;
}

/**
 * Create a GitHub repo, retrying while the name is still "already exists"
 * (GitHub frees a just-deleted name a beat after DELETE returns).
 * @returns {object} the created repo JSON
 */
async function createGithubRepoWithRetry(endpoint, headers, payload, { tries = 5, delayMs = 1000 } = {}) {
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (res.ok) return res.json();
        const err = await res.json().catch(() => null);
        const stillExists = res.status === 422
            && err?.errors?.[0]?.message?.includes('already exists');
        if (!stillExists) {
            throw new Error(err?.message || `Failed to create GitHub repository: ${res.status}`);
        }
        lastErr = err;
        if (i < tries - 1) await sleep(delayMs);
    }
    throw new Error(lastErr?.message || 'Repository name did not free up after deletion — try again.');
}

/**
 * Strip credentials from URL for safe logging
 */
function safeUrl(url) {
    return url.replace(/\/\/[^@]+@/, '//***@');
}

/**
 * Import a repository from source URL to GitHub
 * @param {Object} params
 * @param {string} params.sourceUrl - Git clone URL
 * @param {Object} params.credentials - Source credentials { type, token, username, password }
 * @param {string} params.targetOwner - GitHub owner or org
 * @param {string} params.targetName - GitHub repo name
 * @param {boolean} params.isPrivate - Make target repo private
 * @param {string} params.description - Target repo description
 * @param {string} params.githubToken - GitHub access token
 * @param {function} params.onProgress - Progress callback (status, message, pct)
 * @param {function} [params.isCancelled] - Returns true once cancellation has been
 *   requested. Polled between every phase (stops the import at the next boundary)
 *   AND wired into an AbortController watcher that hard-kills the active git child
 *   process (clone/LFS fetch/LFS migrate/push/LFS push) the moment it flips true.
 * @returns {Object} { success, targetFullName, branchCount, error, cancelled? }
 */
async function importRepository(params) {
    const {
        sourceUrl,
        credentials,
        targetOwner,
        targetName,
        isPrivate = true,
        description = '',
        sizeStrategy,
        onConflict = 'fail',
        githubToken,
        onProgress = () => {},
        isCancelled = () => false,
    } = params;

    const jobId = randomUUID();
    const workDir = join(TMP_DIR, jobId);
    let createdRepo = null;
    let reusedExistingRepo = false;
    let replacedExistingRepo = false;
    let lfsFetchFailed = false;
    let lfsPushFailed = false;

    const abortController = new AbortController();
    const cancelWatcher = startCancelWatcher(isCancelled, abortController);

    try {
        // Step 1: Validate
        throwIfCancelled(isCancelled);
        onProgress('validating', 'Validating source repository...', 5);

        const authSourceUrl = credentials ? embedCredentials(sourceUrl, credentials) : sourceUrl;
        logger.debug({ sourceUrl: safeUrl(sourceUrl), authUrl: safeUrl(authSourceUrl) }, 'Import started');
        const validation = await validateSourceUrl(sourceUrl, credentials);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        // Step 2: Create GitHub repo (or reuse if it already exists and is empty)
        throwIfCancelled(isCancelled);
        onProgress('creating', 'Creating target repository on GitHub...', 15);

        const endpoint = targetOwner
            ? `https://api.github.com/orgs/${targetOwner}/repos`
            : 'https://api.github.com/user/repos';
        const ownerSegment = targetOwner ? `${targetOwner}/` : '';
        const githubHeaders = {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        };

        // GitHub rejects descriptions longer than ~350 chars with a 422 that
        // doesn't pinpoint the field. Truncate (with ellipsis) so legitimately
        // long Azure descriptions don't break create.
        const rawDescription = description || `Imported from ${safeUrl(sourceUrl)}`;
        const safeDescription = rawDescription.length > 350
            ? rawDescription.slice(0, 347) + '...'
            : rawDescription;

        const createRes = await fetch(endpoint, {
            method: 'POST',
            headers: { ...githubHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: targetName,
                description: safeDescription,
                private: isPrivate,
                auto_init: false
            })
        });

        if (createRes.ok) {
            createdRepo = await createRes.json();
        } else {
            const err = await createRes.json().catch(() => null);
            const alreadyExists = createRes.status === 422
                && err?.errors?.[0]?.message?.includes('already exists');

            // Distinguish auth/permission failures so the user knows what to
            // do. A generic "Failed: 403" tells them nothing actionable.
            if (createRes.status === 401) {
                throw new Error('GitHub token expired or invalid. Reconnect your GitHub account and try again.');
            }
            if (createRes.status === 403 && !alreadyExists) {
                throw new Error(
                    targetOwner
                        ? `No permission to create repositories in ${targetOwner}. Make sure your GitHub account is a member with "Administration: Read & write", or pick a different target.`
                        : 'No permission to create repositories on your GitHub account. Check that your token has the "repo" scope.',
                );
            }
            if (createRes.status === 404 && targetOwner) {
                throw new Error(`Organization "${targetOwner}" not found on GitHub. Check the spelling or pick a different target.`);
            }

            if (alreadyExists) {
                // Reuse path: fetch the existing repo and let the push proceed
                // only if it has no commits. GitHub reports size in KB; an
                // unpushed repo has size 0 AND default_branch null. Both must
                // hold so we don't overwrite a repo that briefly reported 0
                // size in a stale read.
                const ownerSlug = targetOwner || (await (async () => {
                    const me = await fetch('https://api.github.com/user', { headers: githubHeaders });
                    if (!me.ok) return null;
                    const j = await me.json();
                    return j?.login || null;
                })());
                if (!ownerSlug) {
                    throw new Error(`Repository "${ownerSegment}${targetName}" already exists on GitHub`);
                }
                const existingRes = await fetch(
                    `https://api.github.com/repos/${encodeURIComponent(ownerSlug)}/${encodeURIComponent(targetName)}`,
                    { headers: githubHeaders },
                );
                if (!existingRes.ok) {
                    throw new Error(`Repository "${ownerSegment}${targetName}" already exists on GitHub`);
                }
                const existing = await existingRes.json();
                const decision = decideConflictResolution({
                    size: existing.size,
                    defaultBranch: existing.default_branch,
                    onConflict,
                });
                if (decision.action === 'fail') {
                    throw new Error(
                        `Repository "${ownerSegment}${targetName}" already exists on GitHub and is not empty. Choose a different target name or delete it first.`,
                    );
                }
                if (decision.action === 'replace') {
                    // Destructive: delete the existing repo, then recreate it
                    // empty so the normal --mirror push path applies. Logged so
                    // the deletion is traceable in server logs.
                    logger.warn({ owner: ownerSlug, repo: targetName }, 'Replacing existing non-empty repo (delete + recreate)');
                    onProgress('creating', `Replacing existing repository "${existing.full_name}"...`, 16);
                    await deleteGithubRepo(ownerSlug, targetName, githubHeaders);
                    createdRepo = await createGithubRepoWithRetry(endpoint, githubHeaders, {
                        name: targetName,
                        description: safeDescription,
                        private: isPrivate,
                        auto_init: false,
                    });
                    replacedExistingRepo = true;
                } else {
                    createdRepo = existing;
                    reusedExistingRepo = true;
                    onProgress('creating', `Reusing empty repository "${existing.full_name}"...`, 18);
                }
            } else {
                throw new Error(err?.message || `Failed to create GitHub repository: ${createRes.status}`);
            }
        }
        const targetFullName = createdRepo.full_name;

        // Step 3: Clone bare
        throwIfCancelled(isCancelled);
        onProgress('cloning', `Cloning from source...`, 25);

        mkdirSync(workDir, { recursive: true });
        const git = simpleGit({ timeout: { block: DEFAULT_TIMEOUT_MS }, abort: abortController.signal });
        await git.clone(authSourceUrl, workDir, ['--bare']);

        // Step 4: Check for LFS
        throwIfCancelled(isCancelled);
        const gitattrsPath = join(workDir, 'info', 'attributes');
        const hasLFS = existsSync(gitattrsPath) &&
            readFileSync(gitattrsPath, 'utf-8').includes('filter=lfs');

        if (hasLFS) {
            onProgress('lfs', 'Fetching LFS objects...', 40);
            const lfsGit = simpleGit(workDir, { abort: abortController.signal });
            try {
                await lfsGit.raw(['lfs', 'fetch', '--all']);
            } catch (e) {
                logger.warn({ err: e }, 'LFS fetch warning');
                // Continue even if LFS fetch fails - pointers will still be pushed
                // but mark this so the SummaryStep can warn the user instead of
                // silently shipping a target with orphaned LFS pointers.
                lfsFetchFailed = true;
            }
        }

        // Step 4b: Apply sizeStrategy === 'lfs-migrate' (convert large blobs to LFS in-place).
        if (sizeStrategy === 'lfs-migrate') {
            throwIfCancelled(isCancelled);
            onProgress('lfs-migrate', 'Converting large files to LFS...', 50);
            const migrateGit = simpleGit(workDir, { abort: abortController.signal });
            // Fail fast with a clear message if git-lfs is missing — otherwise the
            // conversion silently no-ops and the run dies later at the opaque
            // "exceeds 100 MB" push error, which reads as if Replace/LFS did nothing.
            await ensureGitLfs((args) => migrateGit.raw(args));
            try {
                await migrateGit.raw(LFS_MIGRATE_IMPORT_ARGS);
            } catch (e) {
                // Converting the oversized blobs is the entire point of the
                // lfs-migrate strategy. If it fails, the blobs are untouched and
                // the push is guaranteed to be rejected — so surface the real
                // cause now instead of silently proceeding to the opaque
                // "exceeded 100 MB during push" error that masks it.
                logger.error({ err: e }, 'git-lfs migrate import failed');
                const err = new Error(
                    `Converting large files to Git LFS failed: ${(e?.message || 'unknown git-lfs error').trim()}. The repository was left unchanged — retry, and if it persists check the migration server's git-lfs install.`,
                );
                err.code = 'LFS_MIGRATE_FAILED';
                throw err;
            }
        }

        // Step 4c: Pre-check for blobs exceeding GitHub's per-file limit.
        // GitHub rejects pushes containing any blob > 100 MiB regardless of
        // total repo size, so this catches the case that size-strategy
        // planning (which looks at repo totals) misses. We skip when the
        // user has already opted into lfs-migrate or exclude — those paths
        // either fix the blobs in place or won't reach the push.
        if (sizeStrategy !== 'lfs-migrate' && sizeStrategy !== 'exclude') {
            throwIfCancelled(isCancelled);
            onProgress('inspecting', 'Inspecting repository for oversized files...', 55);
            const oversized = await findOversizedBlobs(workDir, GITHUB_FILE_SIZE_LIMIT_BYTES);
            if (oversized.length > 0) {
                const err = new Error(
                    `${oversized.length} file(s) exceed GitHub's 100 MB per-file limit. Migrate the affected paths to Git LFS and retry.`,
                );
                err.code = 'OVERSIZED_FILES';
                err.files = oversized;
                throw err;
            }
        }

        // Step 4d: Race guard — when we entered the reuse path minutes ago,
        // someone may have pushed to the target in the meantime. Verify it's
        // still empty right before we touch it, otherwise --mirror could
        // overwrite or fail non-obviously.
        if (reusedExistingRepo) {
            onProgress('verifying', 'Re-checking target is still empty...', 58);
            const [ownerSeg, nameSeg] = targetFullName.split('/');
            const freshRes = await fetch(
                `https://api.github.com/repos/${encodeURIComponent(ownerSeg)}/${encodeURIComponent(nameSeg)}`,
                { headers: githubHeaders },
            );
            if (freshRes.ok) {
                const fresh = await freshRes.json();
                if ((fresh.size > 0) || fresh.default_branch) {
                    throw new Error(
                        `Target "${targetFullName}" was modified during this migration — it no longer looks empty. Start a fresh migration so we don't overwrite the new content.`,
                    );
                }
            }
            // Soft-fail on freshRes !ok: prefer attempting the push (which
            // will fail safely with non-fast-forward) over aborting on a
            // transient API blip.
        }

        // Step 5: Push mirror
        throwIfCancelled(isCancelled);
        onProgress('pushing', `Pushing to GitHub...`, 60);

        const pushUrl = `https://x-access-token:${githubToken}@github.com/${targetFullName}.git`;
        const bareGit = simpleGit(workDir, { abort: abortController.signal });
        await bareGit.addRemote('github', pushUrl);
        try {
            await bareGit.push('github', '--mirror');
        } catch (pushErr) {
            const stderr = pushErr?.message || pushErr?.stderr || pushErr?.task?.stdErr || '';
            const parsed = parseOversizedPushError(stderr);
            if (parsed) {
                const err = new Error(
                    `${parsed.files.length} file(s) exceeded GitHub's 100 MB limit during push.`,
                );
                err.code = 'OVERSIZED_FILES';
                err.files = parsed.files;
                throw err;
            }
            // Branch protection / rulesets reject pushes with these tokens.
            // Surface a clear actionable message instead of the raw remote
            // rejection wall.
            if (/protected branch|ruleset|rule.*violation|cannot.*force-push/i.test(stderr)) {
                throw new Error(
                    `GitHub blocked the push: branch protection or a repository ruleset on "${targetFullName}" prevents mirroring. Disable protection on the target temporarily, or pick a different target.`,
                );
            }
            // --mirror needs the target empty (or strictly fast-forwardable).
            // A non-fast-forward rejection on reuse means the race guard above
            // missed a write — surface the concrete recovery path.
            if (/non-fast-forward|rejected.*fetch first|not a fast-forward/i.test(stderr)) {
                throw new Error(
                    `Target "${targetFullName}" already has commits that conflict with the source history. Delete the target or pick a different name and retry.`,
                );
            }
            throw pushErr;
        }

        // Step 6: Push LFS if needed. Also runs when lfs-migrate converted blobs
        // this run — those objects exist only locally and must be uploaded, or
        // the target ends up with pointers to missing objects.
        if (lfsPushNeeded(hasLFS, sizeStrategy)) {
            throwIfCancelled(isCancelled);
            onProgress('lfs-push', 'Pushing LFS objects...', 80);
            // Retry transient failures (network/rate-limit). If it still fails we
            // do NOT silently succeed: flag it so the Summary warns the user that
            // the target has LFS pointers to missing objects (clone will fail)
            // and they should retry — instead of reporting a clean success.
            const LFS_PUSH_TRIES = 3;
            for (let attempt = 1; attempt <= LFS_PUSH_TRIES; attempt++) {
                // The mirror push already landed the main repo content on GitHub —
                // a cancel here can't undo that, but it should stop burning retries
                // and backoff sleeps on a run the user already asked to stop.
                if (isCancelled()) break;
                try {
                    await bareGit.raw(['lfs', 'push', '--all', 'github']);
                    lfsPushFailed = false;
                    break;
                } catch (e) {
                    lfsPushFailed = true;
                    if (attempt < LFS_PUSH_TRIES) {
                        logger.warn({ err: e, attempt }, 'LFS push failed; retrying');
                        await sleep(2000 * attempt);
                    } else {
                        logger.error({ err: e }, 'LFS push failed after retries — target has orphaned LFS pointers');
                    }
                }
            }
        }

        // Count branches
        const refs = await bareGit.raw(['for-each-ref', '--format=%(refname)', 'refs/heads/']);
        const branchCount = refs.trim().split('\n').filter(Boolean).length;

        // Step 7: Align default branch on the target when we reused an
        // existing repo whose default was set up before we knew the source's
        // layout (typical case: target pre-created with `main`, source uses
        // `master` or vice versa). Without this, the target's HEAD can point
        // at a ref that --mirror just deleted, leaving the repo UI broken.
        if (reusedExistingRepo) {
            try {
                const sourceHead = await bareGit.raw(['symbolic-ref', '--short', 'HEAD']).then(s => s.trim()).catch(() => null);
                if (sourceHead && createdRepo.default_branch && sourceHead !== createdRepo.default_branch) {
                    const [ownerSeg, nameSeg] = targetFullName.split('/');
                    await fetch(
                        `https://api.github.com/repos/${encodeURIComponent(ownerSeg)}/${encodeURIComponent(nameSeg)}`,
                        {
                            method: 'PATCH',
                            headers: { ...githubHeaders, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ default_branch: sourceHead }),
                        },
                    );
                }
            } catch (e) {
                logger.warn({ err: e }, 'Default branch alignment skipped');
            }
        }

        // Empty source: --mirror pushed zero refs. Treat as success but
        // surface so SummaryStep can show "Source had no commits" instead of
        // a misleading "0 branches migrated" line.
        const emptySource = branchCount === 0;

        onProgress('complete', emptySource
            ? 'Import completed — source had no commits.'
            : 'Import completed successfully!', 100);

        return {
            success: true,
            targetFullName,
            branchCount,
            hasLFS,
            lfsFetchFailed,
            lfsPushFailed,
            reusedExistingRepo,
            replacedExistingRepo,
            emptySource,
            repoUrl: createdRepo.html_url
        };

    } catch (error) {
        // Cancellation is not a failure. It reaches here either via an explicit
        // throwIfCancelled() checkpoint (err.code === 'CANCELLED') or because the
        // AbortController watcher killed the in-flight git child process (clone/
        // LFS fetch/LFS migrate/push) — in that second case the rejection can be
        // any simple-git abort error, so isCancelled() itself is the source of
        // truth for whether this catch is a real failure or a requested stop.
        if (error?.code === 'CANCELLED' || isCancelled()) {
            onProgress('cancelled', 'Migration cancelled', 0);
            return {
                success: false,
                cancelled: true,
                error: 'Migration cancelled',
                targetFullName: createdRepo?.full_name || null
            };
        }

        // Structured oversized-files errors get a sentinel-prefixed encoding so
        // the SummaryStep can render a premium panel instead of dumping stderr.
        const errorMessage = error?.code === 'OVERSIZED_FILES' && Array.isArray(error.files)
            ? encodeOversizedError(error.files, error.message)
            : error.message;

        onProgress('failed', errorMessage, 0);

        // If we created a repo but import failed, we could optionally clean up
        // For now, leave the empty repo so the user can retry or manually push

        return {
            success: false,
            error: errorMessage,
            targetFullName: createdRepo?.full_name || null
        };
    } finally {
        clearInterval(cancelWatcher);
        // Always cleanup temp directory
        try {
            if (existsSync(workDir)) {
                rmSync(workDir, { recursive: true, force: true });
            }
        } catch (e) {
            logger.warn({ err: e }, 'Import cleanup warning');
        }
    }
}

export {
    checkGitInstalled,
    validateSourceUrl,
    sanitizeRepoName,
    importRepository,
    embedCredentials,
    safeUrl,
    throwIfCancelled,
    startCancelWatcher
};
