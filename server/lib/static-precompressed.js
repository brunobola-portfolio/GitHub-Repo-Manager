import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

// Mirrors what `mime-types` (express.static's own dependency, verified via
// `mime.contentType()`) returns for the extensions scripts/precompress-assets.mjs
// actually compresses. Hardcoded rather than importing mime-types directly:
// that package is only a transitive dependency of express — never declared
// in our package.json — so depending on it risks breaking on a hoisting
// change we don't control. This map keeps Content-Type byte-identical to
// what express.static would have sent for the uncompressed file.
const CONTENT_TYPES = {
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
};

/**
 * Express middleware that serves the brotli/gzip siblings
 * scripts/precompress-assets.mjs writes at build time (brotli quality 11,
 * gzip level 9) instead of letting the `compression` middleware recompress
 * the same immutable bytes on every request at its default quality 4 (see
 * .dev/panel-2026-09-04/performance.md PERF-04: −58.5 KB / −15.4% on the
 * critical path from the quality bump alone).
 *
 * Mount BEFORE express.static, scoped to the assets prefix only
 * (`app.use('/assets', servePrecompressedAssets(path.join(distPath, 'assets')))`).
 * On a miss — no matching extension, no Accept-Encoding match, or no
 * precompressed sibling on disk — it calls next() and express.static (wrapped
 * by the `compression` middleware, as today) serves the request unchanged.
 *
 * `compression` itself already declines to re-encode a response that already
 * carries a `Content-Encoding` header (see node_modules/compression/index.js,
 * the "already encoded" branch checked in its `onHeaders` hook) — no `filter`
 * change was needed there.
 *
 * @param {string} assetsDir absolute path to dist/assets
 */
export function servePrecompressedAssets(assetsDir) {
    const root = path.resolve(assetsDir);

    return function precompressedAssetsMiddleware(req, res, next) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next();

        let relative;
        try {
            // req.path is already query-stripped by Express, and (because this
            // middleware is mounted at '/assets') already has that prefix
            // stripped too — decode manually since Express does not decode
            // req.path for us.
            relative = decodeURIComponent(req.path).replace(/^\/+/, '');
        } catch {
            return next(); // malformed percent-encoding
        }

        const ext = path.extname(relative).toLowerCase();
        const contentType = CONTENT_TYPES[ext];
        if (!contentType) return next();

        // Resolve before touching the filesystem so `..` traversal (encoded or
        // not) can never escape assetsDir — a request is only ever answered
        // from inside `root`.
        const resolved = path.resolve(root, relative);
        if (resolved !== root && !resolved.startsWith(root + path.sep)) {
            return next();
        }

        // Prefer br, but only when the .br sibling actually exists — a client
        // that accepts both must still get the .gz sibling if, say, an asset
        // under 1 KB was skipped by scripts/precompress-assets.mjs for one
        // encoding's threshold and not the other. Falling through to
        // express.static() on a missing .br (instead of trying .gz next)
        // would silently drop compression entirely for such a file.
        const acceptEncoding = String(req.headers['accept-encoding'] || '');
        const acceptsBr = /\bbr\b/.test(acceptEncoding);
        const acceptsGzip = /\bgzip\b/.test(acceptEncoding);

        let encoding = null;
        let candidate = null;
        if (acceptsBr && existsSync(`${resolved}.br`)) {
            encoding = 'br';
            candidate = `${resolved}.br`;
        } else if (acceptsGzip && existsSync(`${resolved}.gz`)) {
            encoding = 'gzip';
            candidate = `${resolved}.gz`;
        }
        if (!candidate) return next();

        let size;
        try {
            size = statSync(candidate).size;
        } catch {
            return next(); // sibling vanished between existsSync and stat
        }

        // Set headers before res.sendFile: `send` (which sendFile wraps) only
        // fills in Content-Type/Cache-Control when they are not already set,
        // so this order is what makes our values win instead of send's
        // extension-based guess (which would see ".br"/".gz" and guess wrong).
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Encoding', encoding);
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('Content-Length', size);
        // Same immutable policy the express.static handler below applies to
        // every /assets/* file — content-hashed filenames never change contents.
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

        if (req.method === 'HEAD') return res.end();

        res.sendFile(candidate, (err) => {
            if (err && !res.headersSent) next(err);
        });
    };
}
