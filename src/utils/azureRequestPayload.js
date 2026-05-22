/**
 * Build the credential + host portion of an Azure API request body.
 *
 * Centralises the rule "prefer savedCredentialId, fall back to pat" so
 * every caller doesn't reimplement the conditional (and forget the
 * savedCredentialId branch, like /azure/repos did before the fix).
 *
 * @param {object} source  the wizard source state slice (host, pat, credentialMode, savedCredentialId)
 * @returns {{ host: string, pat?: string, savedCredentialId?: number }}
 */
export function azureCredPayload(source) {
  const host = source?.host || 'dev.azure.com'
  const isPersonal = source?.credentialMode === 'personalPat'
  if (isPersonal && source?.savedCredentialId) {
    return { host, savedCredentialId: source.savedCredentialId }
  }
  if (isPersonal && source?.pat?.trim()) {
    return { host, pat: source.pat }
  }
  // serverPat / oauth — backend will resolve from session/env.
  return { host }
}
