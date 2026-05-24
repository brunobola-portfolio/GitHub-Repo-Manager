// Parse JSON without throwing. Returns `fallback` (default null) on any error
// including null/undefined input. Used wherever we read JSON from SQLite TEXT
// columns or untrusted blobs and don't want to wrap every call in try/catch.
//
// Mirrors the behaviour we had inlined ad-hoc across ~36 server files.
export function safeJson(input, fallback = null) {
  if (input == null) return fallback
  if (typeof input === 'object') return input
  try { return JSON.parse(input) }
  catch { return fallback }
}
