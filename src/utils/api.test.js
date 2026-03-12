import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ErrorType,
  ApiError,
  categorizeError,
  fetchWithRetry,
  safeParseJson,
  parseLinkHeaderTotal,
  apiCall,
  resetSessionExpired
} from './api'

describe('ApiError', () => {
  it('creates error with correct properties', () => {
    const error = new ApiError(ErrorType.NETWORK, 'Test message', 500)

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ApiError')
    expect(error.type).toBe(ErrorType.NETWORK)
    expect(error.status).toBe(500)
    expect(error.message).toBe('Test message')
  })

  it('uses default message when not provided', () => {
    const error = new ApiError(ErrorType.AUTHENTICATION)

    expect(error.userMessage).toBe('Your session has expired. Please login again.')
  })

  it('marks retryable errors correctly', () => {
    expect(new ApiError(ErrorType.NETWORK).isRetryable).toBe(true)
    expect(new ApiError(ErrorType.TIMEOUT).isRetryable).toBe(true)
    expect(new ApiError(ErrorType.SERVER).isRetryable).toBe(true)
    expect(new ApiError(ErrorType.BACKEND_UNAVAILABLE).isRetryable).toBe(true)

    expect(new ApiError(ErrorType.AUTHENTICATION).isRetryable).toBe(false)
    expect(new ApiError(ErrorType.AUTHORIZATION).isRetryable).toBe(false)
    expect(new ApiError(ErrorType.NOT_FOUND).isRetryable).toBe(false)
  })
})

describe('categorizeError', () => {
  let originalOnLine

  beforeEach(() => {
    originalOnLine = navigator.onLine
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: originalOnLine
    })
  })

  it('detects offline status', () => {
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: false
    })

    const error = categorizeError(200)
    expect(error.type).toBe(ErrorType.OFFLINE)
  })

  it('detects abort errors as timeout', () => {
    const abortError = new Error('Aborted')
    abortError.name = 'AbortError'

    const error = categorizeError(null, abortError)
    expect(error.type).toBe(ErrorType.TIMEOUT)
  })

  it('detects backend unavailable', () => {
    const fetchError = new TypeError('Failed to fetch')

    const error = categorizeError(null, fetchError)
    expect(error.type).toBe(ErrorType.BACKEND_UNAVAILABLE)
  })

  it('categorizes HTTP status codes correctly', () => {
    expect(categorizeError(401).type).toBe(ErrorType.AUTHENTICATION)
    expect(categorizeError(403).type).toBe(ErrorType.AUTHORIZATION)
    expect(categorizeError(404).type).toBe(ErrorType.NOT_FOUND)
    expect(categorizeError(400).type).toBe(ErrorType.VALIDATION)
    expect(categorizeError(422).type).toBe(ErrorType.VALIDATION)
    expect(categorizeError(429).type).toBe(ErrorType.RATE_LIMIT)
    expect(categorizeError(500).type).toBe(ErrorType.SERVER)
    expect(categorizeError(502).type).toBe(ErrorType.SERVER)
    expect(categorizeError(503).type).toBe(ErrorType.SERVER)
    expect(categorizeError(504).type).toBe(ErrorType.SERVER)
  })

  it('handles unknown status codes', () => {
    expect(categorizeError(418).type).toBe(ErrorType.UNKNOWN)
    expect(categorizeError(499).type).toBe(ErrorType.UNKNOWN)
  })

  it('categorizes 5xx errors as SERVER', () => {
    expect(categorizeError(550).type).toBe(ErrorType.SERVER)
    expect(categorizeError(599).type).toBe(ErrorType.SERVER)
  })
})

describe('fetchWithRetry', () => {
  beforeEach(() => {
    resetSessionExpired()
    vi.useFakeTimers()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    // Clear pending timers without executing them to avoid unhandled rejections
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns response on successful request', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ data: 'test' })
    }

    global.fetch.mockResolvedValueOnce(mockResponse)

    const response = await fetchWithRetry('https://api.example.com/test')

    expect(response).toBe(mockResponse)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('retries on network errors', async () => {
    const networkError = new TypeError('Failed to fetch')
    global.fetch
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({ ok: true, status: 200 })

    const promise = fetchWithRetry('https://api.example.com/test', {}, {
      maxRetries: 2,
      baseDelay: 100,
      timeout: 5000
    })

    // Run all pending timers
    await vi.runAllTimersAsync()

    const response = await promise

    expect(response.ok).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  it('throws after max retries exceeded', async () => {
    const serverError = {
      ok: false,
      status: 500
    }

    global.fetch.mockResolvedValue(serverError)

    const promise = fetchWithRetry('https://api.example.com/test', {}, {
      maxRetries: 2,
      baseDelay: 100,
      timeout: 5000
    })

    // Attach rejection handler BEFORE advancing timers to prevent unhandled rejection
    const resultPromise = promise.catch(error => error)

    await vi.runAllTimersAsync()

    const error = await resultPromise
    expect(error).toBeInstanceOf(ApiError)
    expect(error.type).toBe(ErrorType.SERVER)
    expect(global.fetch).toHaveBeenCalledTimes(3) // Initial + 2 retries
  })

  it('does not retry non-retryable errors', async () => {
    const authError = {
      ok: false,
      status: 401
    }

    global.fetch.mockResolvedValueOnce(authError)

    await expect(
      fetchWithRetry('https://api.example.com/test')
    ).rejects.toThrow(ApiError)

    expect(global.fetch).toHaveBeenCalledTimes(1) // No retries
  })

  it('respects custom timeout', async () => {
    vi.useRealTimers()
    // Mock fetch to hang until signal is aborted
    global.fetch.mockImplementation((_url, opts) => {
      return new Promise((_resolve, reject) => {
        const onAbort = () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        }
        if (opts?.signal?.aborted) {
          onAbort()
          return
        }
        opts?.signal?.addEventListener('abort', onAbort)
      })
    })

    const promise = fetchWithRetry('https://api.example.com/test', {}, {
      maxRetries: 0,
      timeout: 50
    })

    await expect(promise).rejects.toThrow()
  })

  it('includes abort signal in fetch call', async () => {
    const mockResponse = { ok: true, status: 200 }
    global.fetch.mockResolvedValueOnce(mockResponse)

    await fetchWithRetry('https://api.example.com/test')

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/test',
      expect.objectContaining({
        signal: expect.any(AbortSignal)
      })
    )
  })
})

describe('safeParseJson', () => {
  it('parses JSON response correctly', async () => {
    const mockResponse = {
      headers: {
        get: vi.fn().mockReturnValue('application/json')
      },
      json: vi.fn().mockResolvedValue({ data: 'test' })
    }

    const result = await safeParseJson(mockResponse)

    expect(result).toEqual({ data: 'test' })
  })

  it('handles GitHub API content type', async () => {
    const mockResponse = {
      headers: {
        get: vi.fn().mockReturnValue('application/vnd.github+json')
      },
      json: vi.fn().mockResolvedValue({ id: 123 })
    }

    const result = await safeParseJson(mockResponse)

    expect(result).toEqual({ id: 123 })
  })

  it('returns raw text for non-JSON responses', async () => {
    const mockResponse = {
      headers: {
        get: vi.fn().mockReturnValue('text/html')
      },
      text: vi.fn().mockResolvedValue('<html>Test</html>')
    }

    const result = await safeParseJson(mockResponse)

    expect(result).toEqual({
      __rawText: '<html>Test</html>',
      __contentType: 'text/html'
    })
  })

  it('throws on invalid JSON', async () => {
    const mockResponse = {
      headers: {
        get: vi.fn().mockReturnValue('application/json')
      },
      json: vi.fn().mockRejectedValue(new Error('Invalid JSON')),
      text: vi.fn().mockResolvedValue('not json')
    }

    await expect(safeParseJson(mockResponse)).rejects.toThrow('Invalid JSON')
  })

  it('handles missing headers gracefully', async () => {
    const mockResponse = {
      headers: null,
      text: vi.fn().mockResolvedValue('fallback')
    }

    const result = await safeParseJson(mockResponse)

    expect(result).toEqual({
      __rawText: 'fallback',
      __contentType: ''
    })
  })
})

describe('parseLinkHeaderTotal', () => {
  it('parses last page from Link header', () => {
    const linkHeader = '<https://api.github.com/repos?page=1>; rel="first", <https://api.github.com/repos?page=5>; rel="last"'

    const total = parseLinkHeaderTotal(linkHeader)

    expect(total).toBe(5)
  })

  it('handles complex Link headers with multiple relations', () => {
    const linkHeader = [
      '<https://api.github.com/repos?page=2>; rel="next"',
      '<https://api.github.com/repos?page=10>; rel="last"',
      '<https://api.github.com/repos?page=1>; rel="first"'
    ].join(', ')

    const total = parseLinkHeaderTotal(linkHeader)

    expect(total).toBe(10)
  })

  it('returns null when last relation not found', () => {
    const linkHeader = '<https://api.github.com/repos?page=2>; rel="next"'

    const total = parseLinkHeaderTotal(linkHeader)

    expect(total).toBeNull()
  })

  it('returns null for invalid header', () => {
    expect(parseLinkHeaderTotal('invalid')).toBeNull()
    expect(parseLinkHeaderTotal('')).toBeNull()
    expect(parseLinkHeaderTotal(null)).toBeNull()
  })

  it('handles URLs with multiple query parameters', () => {
    const linkHeader = '<https://api.github.com/repos?per_page=100&page=15&sort=updated>; rel="last"'

    const total = parseLinkHeaderTotal(linkHeader)

    expect(total).toBe(15)
  })

  it('returns null when page parameter missing', () => {
    const linkHeader = '<https://api.github.com/repos?per_page=100>; rel="last"'

    const total = parseLinkHeaderTotal(linkHeader)

    expect(total).toBeNull()
  })
})

describe('apiCall', () => {
  beforeEach(() => {
    resetSessionExpired()
    vi.useFakeTimers()
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('makes API call with credentials included', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue('application/json')
      },
      json: vi.fn().mockResolvedValue({ success: true })
    }

    global.fetch.mockResolvedValueOnce(mockResponse)

    const result = await apiCall('https://api.example.com/test')

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/test',
      expect.objectContaining({
        credentials: 'include'
      })
    )

    expect(result).toEqual({ success: true })
  })

  it('merges custom options with defaults', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      headers: {
        get: vi.fn().mockReturnValue('application/json')
      },
      json: vi.fn().mockResolvedValue({})
    }

    global.fetch.mockResolvedValueOnce(mockResponse)

    await apiCall('https://api.example.com/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/test',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      })
    )
  })
})
