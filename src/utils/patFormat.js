/**
 * Generic, provider-agnostic client-side sanity check for a pasted Personal
 * Access Token. This is ONLY a fast pre-flight to catch obvious paste mistakes
 * (whitespace, surrounding quotes, far-too-short/long) before a server
 * round-trip — it is deliberately NOT authoritative and NOT provider-specific.
 *
 * The server (azure-service.validatePat) is the real validator: it actually
 * calls the host with the token. On-prem TFS / ADS tokens do not share Azure
 * DevOps' base32 shape, so we must not hard-code provider prefixes or exact
 * lengths client-side, or we'd reject legitimate tokens.
 *
 * @param {string} raw
 * @returns {{ ok: boolean, severity: 'ok'|'warning'|'error'|'empty', message: string }}
 */
export function validatePatFormat(raw) {
  const pat = typeof raw === 'string' ? raw : ''

  // Empty is "not ok" but silent — don't nag before the user has typed.
  if (!pat.trim()) return { ok: false, severity: 'empty', message: '' }

  if (/\s/.test(pat)) {
    return { ok: false, severity: 'error', message: 'Remove spaces or line breaks — paste only the token.' }
  }
  if (/^['"`].*['"`]$/.test(pat)) {
    return { ok: false, severity: 'error', message: 'Remove the surrounding quotes — paste the raw token.' }
  }
  if (pat.length < 20) {
    return { ok: false, severity: 'warning', message: 'This looks too short to be a valid PAT.' }
  }
  if (pat.length > 1000) {
    return { ok: false, severity: 'error', message: "That's longer than any valid token — check what you pasted." }
  }
  // Tokens are URL-safe base64 / base32. Anything outside that set is almost
  // certainly a paste error (a URL, a sentence, smart quotes, …).
  if (!/^[A-Za-z0-9._~+/=-]+$/.test(pat)) {
    return { ok: false, severity: 'warning', message: 'Contains unusual characters — double-check the token.' }
  }
  return { ok: true, severity: 'ok', message: 'Looks like a valid token format.' }
}
