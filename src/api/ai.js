// =============================================================================
// aiApi — the *placeholder* (non-throwing) AI client.
//
// When AI is unconfigured or the provider 503s, these methods return an honest
// placeholder shape — real fields nulled, plus `{ mock: true, aiConfigured }`
// (and `runtimeUnavailable: true` for the 503 path) — so ambient AI surfaces
// (analysis cards, quality reports, batch index, search) degrade gracefully
// inline WITHOUT a try/catch. Tier/quota errors (429/403) and hard-required
// ops (e.g. planIssue) are the exceptions — they still throw.
//
// This is one of TWO intentional AI-client contracts. The other is
// `src/api/aiFetch.js`, which THROWS typed errors and owns the quota gate; use
// that for new, explicitly user-triggered AI actions. Full rationale + the
// (deferred) unification plan: docs/architecture/ai-client-contracts.md.
// =============================================================================
import { API_BASE } from '../config';
import { getCsrfToken } from '../utils/api';
import { getAIStatus } from './aiStatus';

// AI mocks live in src/__mocks__/mockAI.js. Each callsite inlines the
// `import.meta.env.DEV && VITE_MOCK_MODE === 'true'` check so Vite can
// statically eliminate the dynamic import() in production builds.

const getHeaders = () => {
    return {
        'Content-Type': 'application/json'
    };
};

// CSRF-protected POST/PUT/PATCH/DELETE helper. The server rejects mutations
// without a valid X-CSRF-Token (see server/middleware/csrf.js). fetchWithRetry
// does this automatically but we keep explicit status-code handling here
// (e.g. 503, 429, 403) so callers can branch on result codes.
async function mutationHeaders() {
    const token = await getCsrfToken();
    return { 'Content-Type': 'application/json', 'X-CSRF-Token': token };
}

// Short-circuit helper — when AI is not configured we skip the HTTP request
// entirely and return the caller's mock payload. This keeps the browser
// console clean (no 503) and gives the UI a stable `mock: true` contract to
// branch on.
async function withAIConfigured(mockFactory) {
    const status = await getAIStatus();
    if (!status?.configured) {
        const mock = mockFactory();
        return { ...mock, mock: true, aiConfigured: false };
    }
    return null;
}

/**
 * Unified response handler for AI endpoints.
 * Converts 429/403 into rich tier-error objects so callers can render
 * an upgrade CTA instead of a generic error message.
 */
async function handleAIResponse(res, operation) {
    if (res.status === 429) {
        const body = await res.json().catch(() => ({}));
        const error = new Error(body.error || 'AI query limit exceeded');
        error.status = 429;
        error.tierError = true;
        error.upgradeUrl = body.upgradeUrl || '/pricing';
        error.limit = body.limit;
        error.current = body.current;
        throw error;
    }
    if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        const error = new Error(body.error || 'Access denied');
        error.status = 403;
        error.tierError = true;
        error.upgradeUrl = body.upgradeUrl || '/pricing';
        throw error;
    }
    if (!res.ok) throw new Error(`${operation} failed: HTTP ${res.status}`);
    return res.json();
}

// Mock factories live in src/__mocks__/mockAI.js. They are loaded lazily so
// production builds (where MOCKS_ENABLED is statically false) tree-shake them.

// ---------------------------------------------------------------------------
// Unconfigured-AI placeholders
// ---------------------------------------------------------------------------
//
// When the user has no AI provider configured we still need to return *some*
// shape so consuming components don't crash, but we must NOT fabricate scores
// or recommendations — that's misleading. These factories return null for
// every numeric field and a single canonical message the UI can render as
// "Connect AI to see X".

const NEEDS_CONFIG_NOTE = 'Connect an AI provider in Settings → AI Configuration to see real analysis.'
const RUNTIME_UNAVAILABLE_NOTE = 'AI provider is temporarily unavailable — please try again in a moment.'

// Honest placeholder factories. The `note` helper makes the same shape work
// for both the unconfigured short-circuit and the runtime-503 path; only the
// summary text and the flag carrier differ. Consumers branch on
// `aiConfigured` (false → "set me up") vs `runtimeUnavailable` (true →
// "transient failure, retry").
const unconfiguredAnalysis = (repo, note = NEEDS_CONFIG_NOTE) => ({
    summary: note,
    health_score: null,
    project_type: null,
    suggested_topics: [],
    improvements: [],
    readme_suggestions: [],
    highlights: [],
    quality_breakdown: null,
    patterns: null,
    name: repo?.name,
    language: repo?.language,
})

const unconfiguredQualityReport = (repo, note = NEEDS_CONFIG_NOTE) => ({
    score: null,
    breakdown: null,
    patterns: null,
    recommendations: [],
    summary: note,
    repo: repo?.full_name,
})

const unconfiguredReadmeEnhancement = (note = NEEDS_CONFIG_NOTE) => ({
    enhancement: null,
    missingSections: [],
    patterns: null,
    note,
})

const unconfiguredSearchResults = (note = NEEDS_CONFIG_NOTE) => {
    const arr = []
    arr.note = note
    return arr
}

// AI Client Wrapper with mock fallbacks
export const aiApi = {
    // Trigger indexing for a specific repo
    indexRepo: async (repo) => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const { mockAnalysis } = await import('../__mocks__/mockAI.js');
            await new Promise(r => setTimeout(r, 1500)); // Simulate processing
            return { success: true, analysis: mockAnalysis(repo) };
        }

        const shortCircuit = await withAIConfigured(() => ({ success: true, analysis: unconfiguredAnalysis(repo) }));
        if (shortCircuit) return shortCircuit;

        const res = await fetch(`${API_BASE}/ai/index`, {
            method: 'POST',
            headers: await mutationHeaders(),
            credentials: 'include',
            body: JSON.stringify({ repo })
        });

        // Provider failed at runtime — user IS configured, the provider just
        // returned 503. Differentiate from the unconfigured case so the UI can
        // render a "try again" affordance instead of "connect AI".
        if (res.status === 503) {
            return {
                success: true,
                analysis: unconfiguredAnalysis(repo, RUNTIME_UNAVAILABLE_NOTE),
                mock: true,
                aiConfigured: true,
                runtimeUnavailable: true,
            };
        }
        return handleAIResponse(res, 'index');
    },

    // Semantic Search
    search: async (query) => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const { mockSearchResults } = await import('../__mocks__/mockAI.js');
            await new Promise(r => setTimeout(r, 800));
            return mockSearchResults(query);
        }

        const status = await getAIStatus();
        if (!status?.configured) {
            const results = unconfiguredSearchResults()
            results.mock = true
            results.aiConfigured = false
            return results
        }

        const res = await fetch(`${API_BASE}/ai/search?q=${encodeURIComponent(query)}`, {
            headers: getHeaders(),
            credentials: 'include'
        });

        // Provider failed at runtime — user IS configured but provider 503'd.
        // Surface a "try again" note so the UI doesn't push them back to setup.
        if (res.status === 503) {
            const results = unconfiguredSearchResults(RUNTIME_UNAVAILABLE_NOTE)
            results.mock = true
            results.aiConfigured = true
            results.runtimeUnavailable = true
            return results
        }
        return handleAIResponse(res, 'search');
    },

    // Get Metadata
    getMetadata: async (repoId) => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const { mockAnalysis } = await import('../__mocks__/mockAI.js');
            await new Promise(r => setTimeout(r, 500));
            const mockRepo = { id: repoId, name: `project-${repoId}`, language: 'JavaScript' };
            return mockAnalysis(mockRepo);
        }

        const res = await fetch(`${API_BASE}/ai/metadata/${repoId}`, {
            headers: getHeaders(),
            credentials: 'include'
        });
        if (!res.ok) throw new Error('Failed to fetch metadata');
        return res.json();
    },

    // Get Suggestions (Existing feature, reused)
    getSuggestions: async (repo) => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const { mockSuggestions } = await import('../__mocks__/mockAI.js');
            await new Promise(r => setTimeout(r, 1200));
            return mockSuggestions(repo);
        }

        const unconfiguredSuggestions = () => ({
            suggestions: [
                { title: 'AI Not Configured', description: 'Set GEMINI_API_KEY for real suggestions', type: 'info' }
            ],
            analysis: 'AI features require a Gemini API key. Using placeholder data.',
        });

        const shortCircuit = await withAIConfigured(unconfiguredSuggestions);
        if (shortCircuit) return shortCircuit;

        const res = await fetch(`${API_BASE}/ai/suggest`, {
            method: 'POST',
            headers: await mutationHeaders(),
            credentials: 'include',
            body: JSON.stringify({ repo })
        });

        // Handle AI not configured
        if (res.status === 503) {
            return { ...unconfiguredSuggestions(), mock: true, aiConfigured: false };
        }
        return handleAIResponse(res, 'suggest');
    },

    // Suggest a concrete name + description for the repo. The server returns a
    // unified shape (source: 'ai' | 'deterministic'); the modal renders the
    // same UI either way and decides what to display via `source`.
    suggestNameDescription: async (repoId, options = {}) => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const { mockSuggestNameDescription } = await import('../__mocks__/mockAI.js');
            await new Promise(r => setTimeout(r, 600));
            // In mock-mode the modal still passes the full repo object,
            // so we emulate the lookup here for the test fixture.
            const fakeRepo = { id: repoId, name: `repo-${repoId}`, language: 'JavaScript', topics: ['demo'] };
            return mockSuggestNameDescription(fakeRepo, options.context);
        }

        const body = { repoId };
        if (options.context) body.context = options.context;

        const res = await fetch(`${API_BASE}/ai/suggest-name-description`, {
            method: 'POST',
            headers: await mutationHeaders(),
            credentials: 'include',
            body: JSON.stringify(body),
        });
        return handleAIResponse(res, 'suggest-name-description');
    },

    // Enhance existing README
    enhanceReadme: async (repo) => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const { mockReadmeEnhancement } = await import('../__mocks__/mockAI.js');
            await new Promise(r => setTimeout(r, 1800));
            return { success: true, ...mockReadmeEnhancement(repo) };
        }

        const shortCircuit = await withAIConfigured(() => ({ success: true, ...unconfiguredReadmeEnhancement() }));
        if (shortCircuit) return shortCircuit;

        const res = await fetch(`${API_BASE}/ai/readme/enhance`, {
            method: 'POST',
            headers: await mutationHeaders(),
            credentials: 'include',
            body: JSON.stringify({ repo })
        });

        if (res.status === 503) {
            return {
                success: true,
                ...unconfiguredReadmeEnhancement(RUNTIME_UNAVAILABLE_NOTE),
                mock: true,
                aiConfigured: true,
                runtimeUnavailable: true,
            };
        }
        return handleAIResponse(res, 'enhance README');
    },

    // Get comprehensive quality report
    getQualityReport: async (repo) => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const { mockQualityReport } = await import('../__mocks__/mockAI.js');
            await new Promise(r => setTimeout(r, 1500));
            return { success: true, report: mockQualityReport(repo), repo: repo.full_name };
        }

        const shortCircuit = await withAIConfigured(() => ({ success: true, report: unconfiguredQualityReport(repo), repo: repo.full_name }));
        if (shortCircuit) return shortCircuit;

        const res = await fetch(`${API_BASE}/ai/quality-report`, {
            method: 'POST',
            headers: await mutationHeaders(),
            credentials: 'include',
            body: JSON.stringify({ repo })
        });

        if (res.status === 503) {
            return {
                success: true,
                report: unconfiguredQualityReport(repo, RUNTIME_UNAVAILABLE_NOTE),
                repo: repo.full_name,
                mock: true,
                aiConfigured: true,
                runtimeUnavailable: true,
            };
        }
        return handleAIResponse(res, 'quality report');
    },

    // Batch index multiple repos
    batchIndex: async (repos) => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const { mockBatchIndexResults } = await import('../__mocks__/mockAI.js');
            await new Promise(r => setTimeout(r, 2000));
            return mockBatchIndexResults(repos);
        }

        // Honest unconfigured/runtime-failure placeholder: signal that no
        // analysis ran instead of fabricating health scores.
        const buildPlaceholder = (note = NEEDS_CONFIG_NOTE) => ({
            success: true,
            processed: 0,
            results: repos.map(r => ({ repo: r.full_name, success: false, health_score: null, note })),
            skipped: repos.length,
            note,
        });

        const shortCircuit = await withAIConfigured(buildPlaceholder);
        if (shortCircuit) return shortCircuit;

        const res = await fetch(`${API_BASE}/ai/batch-index`, {
            method: 'POST',
            headers: await mutationHeaders(),
            credentials: 'include',
            body: JSON.stringify({ repos })
        });

        if (res.status === 503) {
            return {
                ...buildPlaceholder(RUNTIME_UNAVAILABLE_NOTE),
                mock: true,
                aiConfigured: true,
                runtimeUnavailable: true,
            };
        }
        return handleAIResponse(res, 'batch index');
    },

    // Find repos semantically similar to the given repo (by full_name)
    findSimilar: async (repoId) => {
        const res = await fetch(`/api/ai/search?mode=similar-by-id&repoId=${encodeURIComponent(repoId)}`, {
            credentials: 'include'
        })
        if (res.status === 404) return { notIndexed: true }
        return handleAIResponse(res, 'findSimilar')
    },

    // Issue-to-PR planner (plan-only mode). Takes an issue number in a repo
    // and returns a structured plan (files to touch, approach, tests, risks).
    planIssue: async ({ repoFullName, issueNumber, extraContext }) => {
        if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
            const { mockIssuePlan } = await import('../__mocks__/mockAI.js')
            await new Promise(r => setTimeout(r, 1600))
            return mockIssuePlan({ repoFullName, issueNumber })
        }

        const status = await getAIStatus()
        if (!status?.configured) {
            const err = new Error('AI not configured. Set up a provider in Settings → AI Configuration.')
            err.status = 503
            err.code = 'AI_NOT_CONFIGURED'
            throw err
        }

        const res = await fetch(`${API_BASE}/ai/issue-to-plan`, {
            method: 'POST',
            headers: await mutationHeaders(),
            credentials: 'include',
            body: JSON.stringify({ repoFullName, issueNumber, extraContext }),
        })
        if (res.status === 503) {
            const err = new Error('AI not configured. Set up a provider in Settings → AI Configuration.')
            err.status = 503
            err.code = 'AI_NOT_CONFIGURED'
            throw err
        }
        return handleAIResponse(res, 'issue plan')
    },

    // Check AI configuration status (uses shared cache)
    checkStatus: () => getAIStatus(),

    // Post-migration polish — thin wrappers around existing endpoints, grouped
    // so useAIPolish can stay free of fetch wiring and stays easy to mock in
    // tests. See docs/specs/2026-05-08-post-migration-ai-polish.md for the
    // wider design.
    polish: {
        getDescription: async (repoId, options = {}) => aiApi.suggestNameDescription(repoId, options),
        getTopics: async (repoId) => aiApi.getMetadata(repoId),
        generateReadme: async (repo) => {
            if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
                const { mockReadmeEnhancement } = await import('../__mocks__/mockAI.js')
                await new Promise(r => setTimeout(r, 1200))
                return { success: true, ...mockReadmeEnhancement(repo) }
            }
            const res = await fetch(`${API_BASE}/ai/readme`, {
                method: 'POST',
                headers: await mutationHeaders(),
                credentials: 'include',
                body: JSON.stringify({ repo }),
            })
            return handleAIResponse(res, 'generate README')
        },
    },
};
