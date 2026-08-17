// SPDX-License-Identifier: Apache-2.0
// Copyright 2025-2026 Bola Labs, Inc. Licensed under the Apache License 2.0.
/**
 * Refuse a request whose URL path hides a `..` behind percent-encoding.
 *
 * Most `/api/repos/*` handlers interpolate route params straight into a GitHub
 * API URL and call it with the caller's OAuth token — a token whose scopes
 * include `delete_repo` and `admin:org`, and which the user can never read.
 * Express decodes route params, and `%2f` does NOT split a path segment during
 * routing, so a param can carry a whole path:
 *
 *   PATCH /api/repos/o/r/issues/%2e%2e%2f%2e%2e%2f%2e%2e%2fuser%2frepos
 *     -> req.params.issue_number === '../../../user/repos'
 *     -> https://api.github.com/repos/o/r/issues/../../../user/repos
 *     -> https://api.github.com/repos/user/repos
 *
 * A bare `..` or `%2e%2e` as a whole segment is already 404'd by Express's own
 * routing (the path resolves and no route matches), which is exactly why the
 * dangerous form is the one that keeps the segment count intact. It was the
 * Contents routes that made this concrete; the same shape reaches Issues,
 * Branches/Releases and Actions. Fixing it per-handler means fixing it in
 * thirty files and in every file added afterwards, so it is refused once, here,
 * before any of them run.
 *
 * Deliberately narrow. It rejects only decoded dot-segments — `%2f` on its own
 * stays legal, because a branch name genuinely contains slashes
 * (`feature/thing` arrives as `feature%2Fthing`), and so does a file path.
 */
import logger from '../lib/logger.js';

const MAX_DECODE_PASSES = 4;

/**
 * Decode a segment repeatedly until it stops changing.
 * @returns {string|null} the decoded text, or null if the encoding is malformed
 */
function decodeFully(segment) {
    let decoded = segment;
    // A loop, not one pass: `%25252e` survives a single decode as `%252e`.
    for (let i = 0; i < MAX_DECODE_PASSES && decoded.includes('%'); i += 1) {
        let next;
        try {
            next = decodeURIComponent(decoded);
        } catch {
            return null;
        }
        if (next === decoded) break;
        decoded = next;
    }
    return decoded;
}

/**
 * True when the raw URL path, once decoded, contains a `.` or `..` segment.
 * @param {string} rawPath - req.path, still percent-encoded
 */
export function hidesTraversal(rawPath) {
    for (const rawSegment of String(rawPath || '').split('/')) {
        if (!rawSegment) continue;
        const decoded = decodeFully(rawSegment);
        if (decoded === null) return true; // malformed encoding is never a real name
        if (decoded.includes('\0')) return true;
        // The decoded text may itself be several segments (`%2f` did not split
        // during routing), so re-split before judging.
        for (const part of decoded.split(/[/\\]/)) {
            if (part === '..' || part === '.') return true;
        }
    }
    return false;
}

export function noPathTraversal(req, res, next) {
    if (hidesTraversal(req.path)) {
        logger.warn(
            { path: req.path, method: req.method, ip: req.ip },
            'Rejected a request whose URL path hides a traversal',
        );
        return res.status(400).json({ error: 'Invalid path' });
    }
    return next();
}

export default noPathTraversal;
