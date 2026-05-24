// Tiny adapter that exposes a {get, put, patch} shape on top of native fetch.
// Used by the tagging writers so they can be tested cleanly with mocked
// `api` objects while production code uses fetch.

function buildErr(res, bodyText) {
  const err = new Error(`HTTP ${res.status}: ${res.statusText}`)
  err.response = { status: res.status, statusText: res.statusText, data: bodyText }
  return err
}

async function request(method, url, body, config = {}) {
  const headers = { ...(config.headers || {}) }
  let finalUrl = url

  // If `baseURL` is set on the shim, prepend it for relative URLs.
  if (this?.baseURL && url.startsWith('/')) {
    finalUrl = this.baseURL.replace(/\/$/, '') + url
  }

  if (body != null && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  const init = { method, headers }
  if (body != null) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
  }

  const res = await fetch(finalUrl, init)
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }

  if (!res.ok) throw buildErr(res, data)
  return { status: res.status, data }
}

export function createHttpShim({ baseURL } = {}) {
  const ctx = { baseURL: baseURL || null }
  return {
    baseURL: ctx.baseURL,
    get: (url, config) => request.call(ctx, 'GET', url, null, config),
    put: (url, body, config) => request.call(ctx, 'PUT', url, body, config),
    patch: (url, body, config) => request.call(ctx, 'PATCH', url, body, config),
    post: (url, body, config) => request.call(ctx, 'POST', url, body, config),
    delete: (url, config) => request.call(ctx, 'DELETE', url, null, config)
  }
}
