// Builds the `Authorization: Basic ...` header value for HTTP requests.
// Azure DevOps uses Basic auth with an empty username and the PAT as the
// password (`:${pat}`); GitHub Basic flows (rare, mostly legacy) follow the
// same pattern but with a real username.
//
// Centralised so any future change to header construction (e.g. moving to
// bearer/PAT exchange) happens once.
export function basicAuthHeader(user, secret) {
  const raw = `${user || ''}:${secret || ''}`
  return `Basic ${Buffer.from(raw).toString('base64')}`
}
