/**
 * Decode the sentinel-prefixed error payload emitted by the server's
 * import-service when a migration fails with GH001-class blob-too-large
 * rejections. Mirrors `decodeOversizedError` in server/lib/oversized-blobs.js;
 * kept client-side as a separate copy because the two layers don't share a
 * module boundary and the payload shape is trivial.
 *
 * Returns null for plain-text errors so callers can fall back to <pre>.
 */
const STRUCTURED_ERROR_PREFIX = 'OVERSIZED_FILES:'

export function decodeOversizedError(errorMessage) {
  if (typeof errorMessage !== 'string') return null
  if (!errorMessage.startsWith(STRUCTURED_ERROR_PREFIX)) return null
  const rest = errorMessage.slice(STRUCTURED_ERROR_PREFIX.length)
  const pipe = rest.indexOf('|')
  const json = pipe === -1 ? rest : rest.slice(0, pipe)
  const fallback = pipe === -1 ? '' : rest.slice(pipe + 1)
  try {
    const parsed = JSON.parse(json)
    if (!Array.isArray(parsed.files)) return null
    return { files: parsed.files, fallback }
  } catch {
    return null
  }
}
