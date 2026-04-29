/*
 * GitHub Repo Manager
 * Mock AI factories — DEV ONLY (see mockRepos.js header).
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the MIT License. See LICENSE in the project root.
 */

export const mockAnalysis = (repo) => ({
  summary: `${repo.name} is a ${repo.language || 'multi-language'} project focused on ${repo.description || 'software development'}.`,
  health_score: Math.floor(Math.random() * 30) + 65,
  project_type: 'application',
  suggested_topics: ['open-source', repo.language?.toLowerCase() || 'code', 'development'].filter(Boolean),
  improvements: [
    'Add comprehensive documentation with examples',
    'Set up automated testing with CI/CD pipeline',
    'Include contribution guidelines (CONTRIBUTING.md)',
    'Add status badges to README',
  ],
  readme_suggestions: ['Installation', 'Usage Examples', 'API Reference'],
  highlights: [`Active ${repo.language || 'multi-language'} project`, 'Well-structured codebase'],
  quality_breakdown: { documentation: 15, community: 10, engineering: 12, polish: 5 },
  patterns: { hasInstallation: true, hasUsage: false, hasTests: true, hasCI: true, hasLicense: true },
})

export const mockSearchResults = (query) => [
  { repo_id: 1, score: 0.92, name: 'project-1', full_name: 'dev-user/project-1', description: `Matches "${query}" - React dashboard`, summary: 'A React-based dashboard for data visualization' },
  { repo_id: 2, score: 0.85, name: 'project-2', full_name: 'dev-user/project-2', description: `Related to "${query}" - API service`, summary: 'RESTful API service with authentication' },
  { repo_id: 3, score: 0.78, name: 'project-3', full_name: 'dev-user/project-3', description: `Contains "${query}" - Utility library`, summary: 'Collection of utility functions' },
]

export const mockQualityReport = (_repo) => ({
  score: Math.floor(Math.random() * 30) + 60,
  breakdown: { documentation: 18, community: 12, engineering: 15, polish: 5 },
  patterns: {
    hasInstallation: true, hasUsage: false, hasExamples: false,
    hasContributing: false, hasLicense: true, hasCI: true, hasTests: true,
  },
  recommendations: [
    { priority: 'high', action: 'Add usage examples to README' },
    { priority: 'medium', action: 'Add CONTRIBUTING.md for community guidelines' },
    { priority: 'low', action: 'Add status badges to README' },
  ],
  summary: 'Good quality. A few improvements would make it great.',
})

export const mockReadmeEnhancement = (repo) => ({
  enhancement: `## Installation\n\n\`\`\`bash\nnpm install ${repo.name}\n\`\`\`\n\n## Usage\n\n\`\`\`javascript\nimport { example } from '${repo.name}';\n\n// Your code here\n\`\`\`\n\n## Contributing\n\nContributions are welcome! Please read our contributing guidelines first.`,
  missingSections: ['Installation', 'Usage', 'Contributing'],
  patterns: { hasInstallation: false, hasUsage: false, hasContributing: false },
})

export const mockSuggestions = (repo) => ({
  suggestions: [
    { title: 'Add License', description: 'Include an open-source license file', type: 'improvement' },
    { title: 'Improve README', description: 'Add installation and usage instructions', type: 'improvement' },
    { title: 'Add Tests', description: 'Set up unit testing framework', type: 'improvement' },
  ],
  analysis: `${repo.name} could benefit from better documentation and testing.`,
})

export const mockBatchIndexResults = (repos) => ({
  success: true,
  processed: repos.length,
  results: repos.map(r => ({ repo: r.full_name, success: true, health_score: Math.floor(Math.random() * 30) + 65 })),
  skipped: 0,
})

export const mockIssuePlan = ({ repoFullName, issueNumber }) => ({
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
})

export const mockSuggestNameDescription = (repo) => {
    const currentName = repo?.name || 'unnamed-repo';
    const slug = String(currentName).toLowerCase().replace(/[_\s]+/g, '-').replace(/[^a-z0-9-]+/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    const language = repo?.language || 'Code';
    const topic = repo?.topics?.[0];
    const description = topic
        ? `${language} project for ${topic}`
        : `${language} repository`;
    return {
        source: 'deterministic',
        current: { name: currentName, description: repo?.description || '' },
        proposed: { name: slug || currentName, description },
        rationale: 'Mock-mode deterministic suggestion based on language and topics.',
        noChange: {
            name: (slug || currentName) === currentName,
            description: description === (repo?.description || ''),
        },
    };
};
