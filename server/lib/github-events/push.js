// SPDX-License-Identifier: Apache-2.0
/**
 * GitHub `push` webhook handler.
 *
 * Invalidates commit caches when commits land on a tracked branch. The
 * payload's `ref` is `refs/heads/branch-name`; we strip the prefix so the
 * resource_key matches what /api/repos/:o/:r/commits stores.
 */
import logger from '../logger.js';
import { invalidateByRepo } from '../gh-cache.js';

export async function handle(payload, eventId) {
    const repoFullName = payload?.repository?.full_name;
    if (!repoFullName) {
        logger.debug({ eventId }, 'push: missing repo full_name');
        return;
    }

    // Drop both the commits list cache and any per-commit detail cache for
    // the repo (we don't know which specific commits get cached here, and
    // a list-level invalidation covers the common case).
    const dropped = invalidateByRepo(repoFullName, 'commits')
        + invalidateByRepo(repoFullName, 'branches');

    logger.debug(
        { eventId, repoFullName, dropped, ref: payload.ref },
        '[gh-cache] invalidated commits/branches cache after push',
    );
}
