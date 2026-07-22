/**
 * Self-hosted "new version available" signal.
 *
 * Notify only — no self-mutating auto-update. Compares the latest GitHub
 * release tag against the running app's package.json version and caches the
 * result in memory so every Settings page load doesn't hit the GitHub API.
 *
 * Never throws: a network failure, a malformed release payload, or a
 * dev build running ahead of the last tagged release all degrade to a safe
 * "no claim" result rather than surfacing an error to the client.
 */
import logger from './logger.js';
import { compareVersions } from './env/version.js';

const RELEASES_URL = 'https://api.github.com/repos/brunobola-portfolio/GitHub-Repo-Manager/releases/latest';

// Short — this sits in the request path of an authenticated Settings load;
// a slow/hung GitHub API must never make that page feel broken.
const FETCH_TIMEOUT_MS = 5_000;

const CACHE_TTL_OK_MS = 24 * 60 * 60 * 1000; // 24h — release cadence is slow
const CACHE_TTL_FAIL_MS = 60 * 60 * 1000; // 1h — retry sooner after a failure

let cache = null; // { result, expiresAt }

function stripLeadingV(tag) {
    return String(tag ?? '').replace(/^v/i, '').trim();
}

function pickAsset(assets, suffix) {
    const found = Array.isArray(assets)
        ? assets.find((a) => typeof a?.name === 'string' && a.name.endsWith(suffix))
        : null;
    if (!found || typeof found.browser_download_url !== 'string') return null;
    return { name: found.name, url: found.browser_download_url, size: Number(found.size) || 0 };
}

/**
 * Picks the Windows self-update artifacts out of a GitHub release's
 * `assets[]`, ignoring anything else (source-code archives, other
 * platforms). Suffix-matched so the version-stamped filename doesn't need
 * to be parsed.
 */
export function extractReleaseAssets(assets) {
    return {
        setup: pickAsset(assets, '-setup.exe'),
        setupSha256: pickAsset(assets, '-setup.exe.sha256'),
        zip: pickAsset(assets, '-win-x64.zip'),
        zipSha256: pickAsset(assets, '-win-x64.zip.sha256'),
    };
}

/**
 * @param {object} [opts]
 * @param {string} opts.currentVersion - app's package.json version (no leading v)
 * @param {boolean} [opts.disabled] - UPDATE_CHECK=false: skip the outbound call entirely
 * @param {typeof fetch} [opts.fetchImpl] - injectable for tests
 * @returns {Promise<object>} `{ current, disabled: true, assets: null }` when disabled,
 *   otherwise `{ current, latest, updateAvailable, releaseUrl, checkedAt, assets }`
 *   (latest/updateAvailable/releaseUrl/assets are null when the check is inconclusive —
 *   a failed fetch never claims an update and never claims "up to date" either).
 */
export async function checkForUpdate({ currentVersion, disabled = false, fetchImpl = fetch } = {}) {
    if (disabled) {
        return { current: currentVersion, disabled: true, assets: null };
    }

    const now = Date.now();
    if (cache && cache.expiresAt > now) {
        return cache.result;
    }

    try {
        const res = await fetchImpl(RELEASES_URL, {
            method: 'GET',
            headers: { Accept: 'application/vnd.github+json' },
            // No auth header, no query params, no client-identifying data —
            // a plain GET with the runtime's default User-Agent.
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!res.ok) {
            throw new Error(`GitHub releases API responded ${res.status}`);
        }

        const data = await res.json();
        const latest = stripLeadingV(data?.tag_name);
        // A dev build running ahead of the last tagged release must not claim
        // an update — only a strictly newer latest counts.
        const updateAvailable = latest ? compareVersions(latest, currentVersion) > 0 : null;

        const result = {
            current: currentVersion,
            latest: latest || null,
            updateAvailable,
            releaseUrl: typeof data?.html_url === 'string' ? data.html_url : null,
            checkedAt: new Date().toISOString(),
            assets: extractReleaseAssets(data?.assets),
        };
        cache = { result, expiresAt: now + CACHE_TTL_OK_MS };
        return result;
    } catch (err) {
        logger.debug({ err: err?.message }, '[update-check] releases fetch failed');
        const result = {
            current: currentVersion,
            latest: null,
            updateAvailable: null,
            releaseUrl: null,
            checkedAt: new Date().toISOString(),
            assets: null,
        };
        cache = { result, expiresAt: now + CACHE_TTL_FAIL_MS };
        return result;
    }
}

/** Test-only: clear the in-memory cache between test cases. */
export function resetUpdateCheckCacheForTests() {
    cache = null;
}
