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
    try {
        const git = simpleGit();
        const version = await git.version();
        return { installed: true, version: version?.installed ? version : null };
    } catch {
        return { installed: false, version: null };
    }
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
 * @returns {Object} { success, targetFullName, branchCount, error }
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
        githubToken,
        onProgress = () => {}
    } = params;

    const jobId = randomUUID();
    const workDir = join(TMP_DIR, jobId);
    let createdRepo = null;
    let reusedExistingRepo = false;
    let lfsFetchFailed = false;

    try {
        // Step 1: Validate
        onProgress('validating', 'Validating source repository...', 5);

        const authSourceUrl = credentials ? embedCredentials(sourceUrl, credentials) : sourceUrl;
        logger.debug({ sourceUrl: safeUrl(sourceUrl), authUrl: safeUrl(authSourceUrl) }, 'Import started');
        const validation = await validateSourceUrl(sourceUrl, credentials);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        // Step 2: Create GitHub repo (or reuse if it already exists and is empty)
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
                const isEmpty = (existing.size === 0) && !existing.default_branch;
                if (!isEmpty) {
                    throw new Error(
                        `Repository "${ownerSegment}${targetName}" already exists on GitHub and is not empty. Choose a different target name or delete it first.`,
                    );
                }
                createdRepo = existing;
                reusedExistingRepo = true;
                onProgress('creating', `Reusing empty repository "${existing.full_name}"...`, 18);
            } else {
                throw new Error(err?.message || `Failed to create GitHub repository: ${createRes.status}`);
            }
        }
        const targetFullName = createdRepo.full_name;

        // Step 3: Clone bare
        onProgress('cloning', `Cloning from source...`, 25);

        mkdirSync(workDir, { recursive: true });
        const git = simpleGit({ timeout: { block: DEFAULT_TIMEOUT_MS } });
        await git.clone(authSourceUrl, workDir, ['--bare']);

        // Step 4: Check for LFS
        const gitattrsPath = join(workDir, 'info', 'attributes');
        const hasLFS = existsSync(gitattrsPath) &&
            readFileSync(gitattrsPath, 'utf-8').includes('filter=lfs');

        if (hasLFS) {
            onProgress('lfs', 'Fetching LFS objects...', 40);
            const lfsGit = simpleGit(workDir);
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
            onProgress('lfs-migrate', 'Converting large files to LFS...', 50);
            const migrateGit = simpleGit(workDir);
            try {
                await migrateGit.raw([
                    'lfs', 'migrate', 'import',
                    '--above=100M',
                    '--everything',
                    '--yes',
                ]);
            } catch (e) {
                logger.warn({ err: e }, 'git-lfs migrate import failed; proceeding with original history');
            }
        }

        // Step 4c: Pre-check for blobs exceeding GitHub's per-file limit.
        // GitHub rejects pushes containing any blob > 100 MiB regardless of
        // total repo size, so this catches the case that size-strategy
        // planning (which looks at repo totals) misses. We skip when the
        // user has already opted into lfs-migrate or exclude — those paths
        // either fix the blobs in place or won't reach the push.
        if (sizeStrategy !== 'lfs-migrate' && sizeStrategy !== 'exclude') {
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
        onProgress('pushing', `Pushing to GitHub...`, 60);

        const pushUrl = `https://x-access-token:${githubToken}@github.com/${targetFullName}.git`;
        const bareGit = simpleGit(workDir);
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

        // Step 6: Push LFS if needed
        if (hasLFS) {
            onProgress('lfs-push', 'Pushing LFS objects...', 80);
            try {
                await bareGit.raw(['lfs', 'push', '--all', 'github']);
            } catch (e) {
                logger.warn({ err: e }, 'LFS push warning');
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
            reusedExistingRepo,
            emptySource,
            repoUrl: createdRepo.html_url
        };

    } catch (error) {
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
    safeUrl
};
