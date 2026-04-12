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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TMP_DIR = join(__dirname, 'data', 'tmp');
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
        githubToken,
        onProgress = () => {}
    } = params;

    const jobId = randomUUID();
    const workDir = join(TMP_DIR, jobId);
    let createdRepo = null;

    try {
        // Step 1: Validate
        onProgress('validating', 'Validating source repository...', 5);

        const authSourceUrl = credentials ? embedCredentials(sourceUrl, credentials) : sourceUrl;
        logger.debug({ sourceUrl: safeUrl(sourceUrl), authUrl: safeUrl(authSourceUrl) }, 'Import started');
        const validation = await validateSourceUrl(sourceUrl, credentials);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        // Step 2: Create GitHub repo
        onProgress('creating', 'Creating target repository on GitHub...', 15);

        const endpoint = targetOwner
            ? `https://api.github.com/orgs/${targetOwner}/repos`
            : 'https://api.github.com/user/repos';

        const createRes = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${githubToken}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: targetName,
                description: description || `Imported from ${safeUrl(sourceUrl)}`,
                private: isPrivate,
                auto_init: false
            })
        });

        if (!createRes.ok) {
            const err = await createRes.json().catch(() => null);
            if (createRes.status === 422 && err?.errors?.[0]?.message?.includes('already exists')) {
                throw new Error(`Repository "${targetOwner ? targetOwner + '/' : ''}${targetName}" already exists on GitHub`);
            }
            throw new Error(err?.message || `Failed to create GitHub repository: ${createRes.status}`);
        }

        createdRepo = await createRes.json();
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
            }
        }

        // Step 5: Push mirror
        onProgress('pushing', `Pushing to GitHub...`, 60);

        const pushUrl = `https://x-access-token:${githubToken}@github.com/${targetFullName}.git`;
        const bareGit = simpleGit(workDir);
        await bareGit.addRemote('github', pushUrl);
        await bareGit.push('github', '--mirror');

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

        onProgress('complete', 'Import completed successfully!', 100);

        return {
            success: true,
            targetFullName,
            branchCount,
            hasLFS,
            repoUrl: createdRepo.html_url
        };

    } catch (error) {
        onProgress('failed', error.message, 0);

        // If we created a repo but import failed, we could optionally clean up
        // For now, leave the empty repo so the user can retry or manually push

        return {
            success: false,
            error: error.message,
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
