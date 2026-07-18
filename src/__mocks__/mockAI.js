/*
 * GitHub Repo Manager
 * Mock AI factories — DEV ONLY (see mockRepos.js header).
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the GNU AGPL v3.0 only (SPDX: AGPL-3.0-only). See LICENSE in the project root.
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

export const mockSuggestNameDescription = (repo, context) => {
    const currentName = repo?.name || 'unnamed-repo';
    const slug = String(currentName).toLowerCase().replace(/[_\s]+/g, '-').replace(/[^a-z0-9-]+/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    const language = repo?.language || 'Code';
    const topic = repo?.topics?.[0];
    const description = topic
        ? `${language} project for ${topic}`
        : `${language} repository`;

    // Synthesize the enriched response shape consumed by <PremiumRationale />.
    // Confidence and signalsUsed mirror what the real builder would emit so
    // mock-mode shows the same premium UI as production.
    const signals = context?.signals || {};
    const customFiles = Array.isArray(context?.customFiles) ? context.customFiles : [];
    const signalsUsed = [];
    if (signals.readme !== false) signalsUsed.push({ kind: 'readme', label: 'README', bytes: 1432 });
    if (signals.manifest !== false) signalsUsed.push({ kind: 'manifest', label: 'package.json', bytes: 612 });
    if (signals.entrypoints) signalsUsed.push({ kind: 'entrypoints', label: 'src/index.js', bytes: 480 });
    if (signals.folderStructure) signalsUsed.push({ kind: 'folderStructure', label: 'top-level dirs', bytes: 96 });
    if (signals.topics !== false && (repo?.topics?.length ?? 0) > 0) signalsUsed.push({ kind: 'topicsLanguage', label: `topics + language`, bytes: 64 });
    customFiles.slice(0, 5).forEach((p) => signalsUsed.push({ kind: 'customFile', label: p, bytes: 800 }));

    const hasReadme = signals.readme !== false;
    const hasManifest = signals.manifest !== false;
    const confidence = hasReadme && hasManifest ? 'high' : (hasReadme || hasManifest) ? 'medium' : 'low';

    return {
        source: 'deterministic',
        current: { name: currentName, description: repo?.description || '' },
        proposed: { name: slug || currentName, description },
        rationale: 'Mock-mode suggestion based on language and topics. Live AI provider returns the same shape with richer reasoning.',
        noChange: {
            name: (slug || currentName) === currentName,
            description: description === (repo?.description || ''),
        },
        confidence,
        signalsUsed,
        redactions: [],
    };
};

// README Studio — deterministic score payload for demo mode, mirroring the
// exact shape of GET /:owner/:repo/readme-studio/score (server route wraps
// generateQualityReport()). Score is deliberately mid-range so the demo shows
// both the ring and a meaningful recommendation list.
export const mockReadmeStudioScore = (owner, repo) => ({
    success: true,
    repo: `${owner}/${repo}`,
    hasReadme: true,
    hasLicense: true,
    report: {
        score: 72,
        summary: 'Good quality. A few improvements would make it great.',
        breakdown: { documentation: 24, community: 12, engineering: 16, polish: 10, trust: 10 },
        patterns: {
            hasInstallation: true,
            hasUsage: true,
            hasTests: true,
            hasCI: true,
            hasContributing: false,
            hasLicense: true,
            hasBadges: false,
            hasScreenshots: false,
            licenseDetected: { spdxId: 'MIT', confidence: 'high', matched: true },
            licenseMismatch: false,
            ciBadgeBroken: false,
            installMatchesStack: true,
        },
        recommendations: [
            { priority: 'medium', action: 'Add CONTRIBUTING.md for community guidelines' },
            { priority: 'low', action: 'Add status badges to README' },
            { priority: 'low', action: 'Add a screenshot or demo GIF near the top of the README' },
        ],
    },
});

// AI Image Generator — demo-mode capability + canvas-drawn simulated images.
// Shapes mirror server/routes/ai/images.js exactly (capability route +
// generate route + commit route). The generated PNG is drawn locally with a
// visible "SIMULATED" watermark so demo output can never be mistaken for a
// real provider image.
const IMAGE_PRESET_MOCKS = {
    social: { label: 'Social preview', dimensions: '1280x640', path: 'docs/images/social-preview.png', w: 1280, h: 640 },
    hero: { label: 'README hero', dimensions: '1200x400', path: 'docs/images/readme-hero.png', w: 1200, h: 400 },
    logo: { label: 'Logo draft', dimensions: '512x512', path: 'docs/images/logo-draft.png', w: 512, h: 512 },
};

export const mockImageCapability = () => ({
    available: true,
    provider: 'gemini',
    model: 'gemini-2.5-flash-image',
    reason: null,
    substitutedFrom: null,
    presets: Object.fromEntries(Object.entries(IMAGE_PRESET_MOCKS).map(([k, p]) => [
        k, { label: p.label, dimensions: p.dimensions, path: p.path, cost: { cents: 4, estimated: false } },
    ])),
});

export const mockGenerateImage = (repo, { preset = 'social' } = {}) => {
    const cfg = IMAGE_PRESET_MOCKS[preset] || IMAGE_PRESET_MOCKS.social;
    const canvas = document.createElement('canvas');
    canvas.width = cfg.w;
    canvas.height = cfg.h;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, cfg.w, cfg.h);
    grad.addColorStop(0, '#4f46e5');
    grad.addColorStop(1, '#0ea5e9');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cfg.w, cfg.h);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.arc((cfg.w / 6) * i + 80, cfg.h * ((i % 3) + 1) * 0.25, 60 + i * 18, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(cfg.h / 8)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    const name = (repo?.full_name || 'demo/repo').split('/')[1] || 'demo-repo';
    ctx.fillText(name, cfg.w / 2, cfg.h / 2);
    ctx.font = `${Math.round(cfg.h / 18)}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('SIMULATED — demo mode', cfg.w / 2, cfg.h / 2 + Math.round(cfg.h / 7));
    const base64 = canvas.toDataURL('image/png').split(',')[1];
    return {
        success: true,
        preset,
        path: cfg.path,
        dimensions: cfg.dimensions,
        base64,
        mimeType: 'image/png',
        provider: 'gemini',
        model: 'gemini-2.5-flash-image',
        costCents: 4,
    };
};

export const mockCommitImage = (repo, { preset = 'social' } = {}) => ({
    success: true,
    preset,
    path: (IMAGE_PRESET_MOCKS[preset] || IMAGE_PRESET_MOCKS.social).path,
    mode: 'direct',
    committed: true,
});
