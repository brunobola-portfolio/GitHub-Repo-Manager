import { API_BASE_URL, MOCK_MODE } from '../config';

const REPO_MANAGER_API = `${API_BASE_URL}/api`;

const getHeaders = () => {
    return {
        'Content-Type': 'application/json'
    };
};

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

const mockQualityReport = (repo) => ({
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

        const res = await fetch(`${REPO_MANAGER_API}/ai/index`, {
            method: 'POST',
            headers: getHeaders(),
            credentials: 'include',
            body: JSON.stringify({ repo })
        });

        // Handle AI not configured - return mock data
        if (res.status === 503) {
            return { success: true, analysis: mockAnalysis(repo), mock: true };
        }
        if (!res.ok) throw new Error('Failed to index repository');
        return res.json();
    },

    // Semantic Search
    search: async (query) => {
        if (MOCK_MODE) {
            await new Promise(r => setTimeout(r, 800));
            return mockSearchResults(query);
        }

        const res = await fetch(`${REPO_MANAGER_API}/ai/search?q=${encodeURIComponent(query)}`, {
            headers: getHeaders(),
            credentials: 'include'
        });

        // Handle AI not configured - return mock results
        if (res.status === 503) {
            return mockSearchResults(query);
        }
        if (!res.ok) throw new Error('Search failed');
        return res.json();
    },

    // Get Metadata
    getMetadata: async (repoId) => {
        if (MOCK_MODE) {
            await new Promise(r => setTimeout(r, 500));
            // Return cached mock metadata or null
            const mockRepo = { id: repoId, name: `project-${repoId}`, language: 'JavaScript' };
            return mockAnalysis(mockRepo);
        }

        const res = await fetch(`${REPO_MANAGER_API}/ai/metadata/${repoId}`, {
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

        const res = await fetch(`${REPO_MANAGER_API}/ai/suggest`, {
            method: 'POST',
            headers: getHeaders(),
            credentials: 'include',
            body: JSON.stringify({ repo })
        });

        // Handle AI not configured
        if (res.status === 503) {
            return {
                suggestions: [
                    { title: 'AI Not Configured', description: 'Set GEMINI_API_KEY for real suggestions', type: 'info' }
                ],
                analysis: 'AI features require a Gemini API key. Using placeholder data.'
            };
        }
        if (!res.ok) throw new Error('Failed to fetch suggestions');
        return res.json();
    },

    // Enhance existing README
    enhanceReadme: async (repo) => {
        if (MOCK_MODE) {
            await new Promise(r => setTimeout(r, 1800));
            return { success: true, ...mockReadmeEnhancement(repo) };
        }

        const res = await fetch(`${REPO_MANAGER_API}/ai/readme/enhance`, {
            method: 'POST',
            headers: getHeaders(),
            credentials: 'include',
            body: JSON.stringify({ repo })
        });

        if (res.status === 503) {
            return { success: true, ...mockReadmeEnhancement(repo), mock: true };
        }
        if (!res.ok) throw new Error('Failed to enhance README');
        return res.json();
    },

    // Get comprehensive quality report
    getQualityReport: async (repo) => {
        if (MOCK_MODE) {
            await new Promise(r => setTimeout(r, 1500));
            return { success: true, report: mockQualityReport(repo), repo: repo.full_name };
        }

        const res = await fetch(`${REPO_MANAGER_API}/ai/quality-report`, {
            method: 'POST',
            headers: getHeaders(),
            credentials: 'include',
            body: JSON.stringify({ repo })
        });

        if (res.status === 503) {
            return { success: true, report: mockQualityReport(repo), repo: repo.full_name, mock: true };
        }
        if (!res.ok) throw new Error('Failed to get quality report');
        return res.json();
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

        const res = await fetch(`${REPO_MANAGER_API}/ai/batch-index`, {
            method: 'POST',
            headers: getHeaders(),
            credentials: 'include',
            body: JSON.stringify({ repos })
        });

        if (res.status === 503) {
            return {
                success: true,
                processed: repos.length,
                results: repos.map(r => ({ repo: r.full_name, success: true, health_score: Math.floor(Math.random() * 30) + 65 })),
                skipped: 0,
                mock: true
            };
        }
        if (!res.ok) throw new Error('Failed to batch index');
        return res.json();
    },

    // Check AI configuration status
    checkStatus: async () => {
        if (MOCK_MODE) {
            return { configured: true, provider: 'mock' };
        }

        try {
            const res = await fetch(`${REPO_MANAGER_API}/config/ai-status`, {
                credentials: 'include'
            });
            if (!res.ok) return { configured: false };
            return res.json();
        } catch {
            return { configured: false };
        }
    }
};
