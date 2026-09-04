#!/usr/bin/env node
/**
 * Postbuild step: writes `.br` (brotli quality 11) and `.gz` (gzip level 9)
 * siblings next to every eligible file under dist/assets/.
 *
 * Vite content-hashes dist/assets/* and server/index.js already serves that
 * directory with `Cache-Control: public, max-age=31536000, immutable` — so
 * every byte is served unchanged, forever, to every client. That makes it
 * safe (and worthwhile) to pay brotli's expensive quality-11 pass once here,
 * instead of the `compression` middleware's quality-4 default recompressing
 * the same bytes on every single request (see server/lib/static-precompressed.js,
 * which serves these siblings; .dev/panel-2026-09-04/performance.md PERF-04
 * measured q4 vs q11 as −58.5 KB / −15.4% on the critical path).
 *
 * Idempotent: always overwrites, so re-running (or a partial prior run) never
 * produces stale or duplicate output. Vite empties dist/ on every build by
 * default, so in practice this only ever sees fresh assets.
 */
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { brotliCompressSync, gzipSync, constants as zlibConstants } from 'node:zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST_ASSETS = join(__dirname, '..', 'dist', 'assets')

// Extensions worth precompressing: text formats with a real ratio to gain.
// `.map` sourcemaps are included when present — they're large, text, and
// (if ever served) benefit the same as their .js.
const ELIGIBLE_EXTENSIONS = new Set(['.js', '.css', '.svg', '.json', '.txt', '.map'])

const MIN_SIZE_BYTES = 1024

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...walk(full))
    } else if (ELIGIBLE_EXTENSIONS.has(extname(entry)) && st.size >= MIN_SIZE_BYTES) {
      out.push({ path: full, size: st.size })
    }
  }
  return out
}

function brotli(buf) {
  return brotliCompressSync(buf, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: buf.length,
    },
  })
}

function gzip(buf) {
  return gzipSync(buf, { level: 9 })
}

export function precompressAssets(assetsDir = DIST_ASSETS) {
  if (!existsSync(assetsDir)) {
    console.warn(`[precompress-assets] ${assetsDir} does not exist — skipping (did the build run?)`)
    return { files: 0, rawBytes: 0, brBytes: 0, gzBytes: 0 }
  }

  const files = walk(assetsDir)
  let rawBytes = 0
  let brBytes = 0
  let gzBytes = 0

  for (const { path: filePath, size } of files) {
    const buf = readFileSync(filePath)
    const br = brotli(buf)
    const gz = gzip(buf)
    writeFileSync(`${filePath}.br`, br)
    writeFileSync(`${filePath}.gz`, gz)
    rawBytes += size
    brBytes += br.length
    gzBytes += gz.length
  }

  const pct = (compressed) => (rawBytes === 0 ? '0.0' : ((1 - compressed / rawBytes) * 100).toFixed(1))
  console.log(
    `[precompress-assets] ${files.length} files: ${(rawBytes / 1024).toFixed(1)} KB raw -> ` +
      `br ${(brBytes / 1024).toFixed(1)} KB (-${pct(brBytes)}%), gz ${(gzBytes / 1024).toFixed(1)} KB (-${pct(gzBytes)}%)`,
  )

  return { files: files.length, rawBytes, brBytes, gzBytes }
}

// Only run the CLI when invoked directly, so tests can import precompressAssets().
// pathToFileURL (not a hand-built file:// string) is what makes this comparison
// hold on Windows, where argv[1] is a `D:\…` path with backslashes.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  precompressAssets()
}
