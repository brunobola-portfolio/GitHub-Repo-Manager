import { API_BASE, MOCK_MODE } from '../config';
import { getCsrfToken } from '../utils/api';
import { getAIStatus } from './aiStatus';

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

// Mock data generators for AI features
const mockAnalysis = (repo) => ({
    summary: `${repo.name} is a ${repo.language || 'multi-language'} project focused on ${repo.description || 'software development'}.`,
    health_score: Math.floor(Math.random() * 30) + 65, // 65-95
    project_type: 'application',
    suggested_topics: ['open-source', repo.language?.toLowerCase() || 'code', 'development'].filter(Boolean),
    improvements: [
        'Add comprehensive documentation with examples',
        'Set up automated testing with CI/CD pipeline',
        'Include contribution guidelines (CONTRIBUTING.md)',
        'Add status badges to README'
    ],
    readme_suggestions: ['Installation', 'Usage Examples', 'API Reference'],
    highlights: [
        `Active ${repo.language || 'multi-language'} project`,
        'Well-structured codebase'
    ],
    quality_breakdown: {
        documentation: 15,
        community: 10,
        engineering: 12,
        polish: 5
    },
    patterns: {
        hasInstallation: true,
        hasUsage: false,
        hasTests: true,
        hasCI: true,
        hasLicense: true
    }
});

const mockSearchResults = (query) => [
    { repo_id: 1, score: 0.92, name: 'project-1', full_name: 'dev-user/project-1', description: `Matches "${query}" - React dashboard`, summary: 'A React-based dashboard for data visualization' },
    { repo_id: 2, score: 0.85, name: 'project-2', full_name: 'dev-user/project-2', description: `Related to "${query}" - API service`, summary: 'RESTful API service with authentication' },
    { repo_id: 3, score: 0.78, name: 'project-3', full_name: 'dev-user/project-3', description: `Contains "${query}" - Utility library`, summary: 'Collection of utility functions' }
];

const mockQualityReport = (_repo) => ({
    score: Math.floor(Math.random() * 30) + 60,
    breakdown: { documentation: 18, community: 12, engineering: 15, polish: 5 },
    patterns: {
        hasInstallation: true, hasUsage: false, hasExamples: false,
        hasContributing: false, hasLicense: true, hasCI: true, hasTests: true
    },
    recommendations: [
        { priority: 'high', action: 'Add usage examples to README' },
        { priority: 'medium', action: 'Add CONTRIBUTING.md for community guidelines' },
        { priority: 'low', action: 'Add status badges to README' }
    ],
    summary: 'Good quality. A few improvements would make it great.'
});

const mockReadmeEnhancement = (repo) => ({
    enhancement: `## Installation\n\n\`\`\`bash\nnpm install ${repo.name}\n\`\`\`\n\n## Usage\n\n\`\`\`javascript\nimport { example } from '${repo.name}';\n\n// Your code here\n\`\`\`\n\n## Contributing\n\nContributions are welcome! Please read our contributing guidelines first.`,
    missingSections: ['Installation', 'Usage', 'Contributing'],
    patterns: { hasInstallation: false, hasUsage: false, hasContributing: false }
});

// AI Client Wrapper with mock fallbacks
export const aiApi = {
    // Trigger indexing for a specific repo
    indexRepo: async (repo) => {
        if (MOCK_MODE) {
            await new Promise(r => setTimeout(r, 1500)); // Simulate processing
            return { success: true, analysis: mockAnalysis(repo) };
        }

        const shortCircuit = await withAIConfigured(() => ({ success: true, analysis: mockAnalysis(repo) }));
        if (shortCircuit) return shortCircuit;

        const res = await fetch(`${API_BASE}/ai/index`, {
            method: 'POST',
            headers: await mutationHeaders(),
            credentials: 'include',
            body: JSON.stringify({ repo })
        });

        // Handle AI not configured - return mock data
        if (res.status === 503) {
            return { success: true, analysis: mockAnalysis(repo), mock: true, aiConfigured: false };
        }
        return handleAIResponse(res, 'index');
    },

    // Semantic Search
    search: async (query) => {
        if (MOCK_MODE) {
            await new Promise(r => setTimeout(r, 800));
            return mockSearchResults(query);
        }

        const status = await getAIStatus();
        if (!status?.configured) {
            const results = mockSearchResults(query)
            results.mock = true
            results.aiConfigured = false
            return results
        }

        const res = await fetch(`${API_BASE}/ai/search?q=${encodeURIComponent(query)}`, {
            headers: getHeaders(),
            credentials: 'include'
        });

        // Handle AI not configured - return mock results with flag
        if (res.status === 503) {
            const results = mockSearchResults(query)
            results.mock = true
            results.aiConfigured = false
            return results
        }
        return handleAIResponse(res, 'search');
    },

    // Get Metadata
    getMetadata: async (repoId) => {
        if (MOCK_MODE) {
            await new Promise(r => setTimeout(r, 500));
            // Return cached mock metadata or null
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
        if (MOCK_MODE) {
            await new Promise(r => setTimeout(r, 1200));
            return {
                suggestions: [
                    { title: 'Add License', description: 'Include an open-source license file', type: 'improvement' },
                    { title: 'Improve README', description: 'Add installation and usage instructions', type: 'improvement' },
                    { title: 'Add Tests', description: 'Set up unit testing framework', type: 'improvement' }
                ],
                analysis: `${repo.name} could benefit from better documentation and testing.`
            };
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

    // Enhance existing README
    enhanceReadme: async (repo) => {
        if (MOCK_MODE) {
            await new Promise(r => setTimeout(r, 1800));
            return { success: true, ...mockReadmeEnhancement(repo) };
        }

        const shortCircuit = await withAIConfigured(() => ({ success: true, ...mockReadmeEnhancement(repo) }));
        if (shortCircuit) return shortCircuit;

        const res = await fetch(`${API_BASE}/ai/readme/enhance`, {
            method: 'POST',
            headers: await mutationHeaders(),
            credentials: 'include',
            body: JSON.stringify({ repo })
        });

        if (res.status === 503) {
            return { success: true, ...mockReadmeEnhancement(repo), mock: true, aiConfigured: false };
        }
        return handleAIResponse(res, 'enhance README');
    },

    // Get comprehensive quality report
    getQualityReport: async (repo) => {
        if (MOCK_MODE) {
            await new Promise(r => setTimeout(r, 1500));
            return { success: true, report: mockQualityReport(repo), repo: repo.full_name };
        }

        const shortCircuit = await withAIConfigured(() => ({ success: true, report: mockQualityReport(repo), repo: repo.full_name }));
        if (shortCircuit) return shortCircuit;

        const res = await fetch(`${API_BASE}/ai/quality-report`, {
            method: 'POST',
            headers: await mutationHeaders(),
            credentials: 'include',
            body: JSON.stringify({ repo })
        });

        if (res.status === 503) {
            return { success: true, report: mockQualityReport(repo), repo: repo.full_name, mock: true, aiConfigured: false };
        }
        return handleAIResponse(res, 'quality report');
    },

    // Batch index multiple repos
    batchIndex: async (repos) => {
        if (MOCK_MODE) {
            await new Promise(r => setTimeout(r, 2000));
            return {
                success: true,
                processed: repos.length,
                results: repos.map(r => ({ repo: r.full_name, success: true, health_score: Math.floor(Math.random() * 30) + 65 })),
                skipped: 0
            };
        }

        const buildMock = () => ({
            success: true,
            processed: repos.length,
            results: repos.map(r => ({ repo: r.full_name, success: true, health_score: Math.floor(Math.random() * 30) + 65 })),
            skipped: 0,
        });

        const shortCircuit = await withAIConfigured(buildMock);
        if (shortCircuit) return shortCircuit;

        const res = await fetch(`${API_BASE}/ai/batch-index`, {
            method: 'POST',
            headers: await mutationHeaders(),
            credentials: 'include',
            body: JSON.stringify({ repos })
        });

        if (res.status === 503) {
            return { ...buildMock(), mock: true, aiConfigured: false };
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
        if (MOCK_MODE) {
            await new Promise(r => setTimeout(r, 1600))
            return {
                plan: {
                    title: `Implement #${issueNumber}: mock plan`,
                    approach:
                        'Parse the issue, identify the relevant module, add a small adapter that routes the new request, and extend the existing integration test suite. Keep changes additive to avoid breaking current consumers.',
                    files: [
                        { path: 'src/services/example.js', action: 'modify', notes: 'Add a new exported function wrapping the existing helper' },
                        { path: 'src/routes/example.js', action: 'modify', notes: 'Expose a POST endpoint that calls the new helper' },
                        { path: 'tests/services/example.test.js', action: 'create', notes: 'Cover happy path + invalid input + quota exceeded' },
                    ],
                    tests: 'Unit test the new helper with valid / invalid input. Add integration test that hits the new endpoint end-to-end.',
                    risks: 'Rate-limit interaction with the downstream API; keep request budget modest. No DB migration needed.',
                    estimatedHours: 4,
                },
                issue: {
                    number: issueNumber,
                    title: `Mock issue #${issueNumber}`,
                    url: `https://github.com/${repoFullName}/issues/${issueNumber}`,
                    state: 'open',
                    labels: ['enhancement'],
                },
                mock: true,
            }
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
};
