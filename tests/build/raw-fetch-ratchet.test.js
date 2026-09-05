/*
 * Raw `fetch(` calls bypass src/utils/api.js#fetchWithRetry — and with it the
 * CSRF rotation-retry, the offline mutation queue, the session-expiry signal,
 * the 30 s timeout and the typed ApiError. The 2026-09-04 panel counted 166;
 * a follow-up pass (2026-09-05) migrated all mutations plus the simple JSON
 * GETs down to 39, leaving only: src/api/ai.js (19 — its own hardened AI
 * error/quota-gate contract, a separate future migration), src/api/
 * bulkConfirm.js (2 — bespoke two-step dry-run/confirmation-token protocol
 * with its own BulkError shape), App.jsx (2 — MOCK_MODE bootstrap that must
 * predate a CSRF token, and the documented raw /api/auth/session probe where
 * a 401 means "not logged in" not "session expired"), useAI.js (2 — askAI/
 * askAIStream's typed AI error contract + SSE streaming), the two SSE
 * streaming hooks (usePRChat.js, useStreaming.js), two health/connectivity
 * probes (useOnlineStatus.js, useSystemHealth.js) plus their AboutSection.jsx
 * restart-poll and the deliberately-minimal public StatusPage.jsx, one
 * cross-origin third-party call (useProviderModels.js → openrouter.ai), one
 * fire-and-forget session-refresh (useSessionExpiry.js), one isolated
 * best-effort crash-telemetry POST (ErrorBoundary.jsx), two Markdown-report
 * blob downloads (MigrationHistory.jsx, SummaryStep.jsx) plus
 * DangerZoneSection.jsx's data-export blob download, and 2 hits inside a
 * fake-diff string literal in a mock fixture (mockRepoDetail.js — not real
 * fetch calls). The migration is incremental; lower the ceiling as more of
 * these move over.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const CEILING = 39

/** The transport layer itself, and the two helpers that wrap fetch on purpose. */
const ALLOWED = new Set([
    'src/utils/api.js',
    'src/api/aiFetch.js',
    'src/utils/aiFetch.js',
    'src/api/sessionInfo.js',
])

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry).split('\\').join('/')
        if (statSync(p).isDirectory()) walk(p, out)
        else if (/\.(jsx?)$/.test(p)) out.push(p)
    }
    return out
}

// A bare call — not `.fetch(`, `refetch(`, `prefetch(`, `fetchWithRetry(`.
const RAW_FETCH = /(?<![.\w])fetch\(/g

function countRawFetch() {
    const perFile = []
    let total = 0
    for (const file of walk('src')) {
        if (ALLOWED.has(file)) continue
        const n = (readFileSync(file, 'utf8').match(RAW_FETCH) || []).length
        if (n) { perFile.push(`${file}: ${n}`); total += n }
    }
    return { total, perFile }
}

describe('raw fetch() ratchet', () => {
    it('finds call sites at all (guards the scanner)', () => {
        expect(countRawFetch().total).toBeGreaterThan(10)
    })

    it(`never exceeds the ceiling of ${CEILING}`, () => {
        const { total, perFile } = countRawFetch()
        expect(
            total,
            `raw fetch() count rose to ${total} (ceiling ${CEILING}) — route new calls through apiCall/fetchWithRetry:\n${perFile.join('\n')}`,
        ).toBeLessThanOrEqual(CEILING)
    })
})

/*
 * FE-02: a hardcoded '/api/...' string/template literal outside src/config.js
 * (which defines API_BASE_URL/API_BASE) and src/api/** (whose helpers already
 * hardcode paths relative to same-origin by design) ignores VITE_API_BASE_URL
 * — a non-same-origin deploy silently 404s from that call site. The
 * 2026-09-05 pass fixed every literal in every file it touched while
 * migrating fetch() call sites, measuring 66 remaining outside that set
 * (mostly AI hooks/components not yet migrated — see the raw-fetch ratchet
 * above). Seeded here so the count only ratchets down from here.
 */
const API_LITERAL_CEILING = 66

// A '/api/...' string or template literal, quoted or backticked.
const API_LITERAL = /['"`]\/api\/[^'"`]*['"`]/g

function countApiLiterals() {
    const perFile = []
    let total = 0
    for (const file of walk('src')) {
        if (file === 'src/config.js') continue
        if (file.startsWith('src/api/')) continue
        const n = (readFileSync(file, 'utf8').match(API_LITERAL) || []).length
        if (n) { perFile.push(`${file}: ${n}`); total += n }
    }
    return { total, perFile }
}

describe('hardcoded /api/ literal ratchet (FE-02)', () => {
    it('finds literals at all (guards the scanner)', () => {
        expect(countApiLiterals().total).toBeGreaterThan(10)
    })

    it(`never exceeds the ceiling of ${API_LITERAL_CEILING}`, () => {
        const { total, perFile } = countApiLiterals()
        expect(
            total,
            `hardcoded '/api/' literal count rose to ${total} (ceiling ${API_LITERAL_CEILING}) — use \${API_BASE_URL}/api/... (from src/config.js) instead:\n${perFile.join('\n')}`,
        ).toBeLessThanOrEqual(API_LITERAL_CEILING)
    })
})
