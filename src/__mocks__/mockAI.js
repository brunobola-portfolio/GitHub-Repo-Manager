/*
 * GitHub Repo Manager
 * Mock AI factories — DEV ONLY (see mockRepos.js header).
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 * Licensed under the Apache License 2.0 (SPDX: Apache-2.0). See LICENSE in the project root.
 */

import { mockRepoAt } from './mockRepos.js'

// api/ai.js's mock branch for GET metadata only has a repo *id* to work
// with (the real endpoint would look the row up server-side), so it
// synthesizes a placeholder `{ id, name: 'project-<id>', language:
// 'JavaScript' }` and hands that to mockAnalysis(). Left alone, that leaked
// straight into the AI Insights summary — "project-1 is a JavaScript
// project" for whatever repo the user actually opened (e.g.
// fintech-dashboard), while the modal header (driven by the real repo prop)
// named the right one. mockRepoAt() uses the exact same id = index + 1
// scheme mockRepos.js hands out everywhere else, so the placeholder is
// resolvable back to the real seeded repo without touching the caller.
function resolvePlaceholderRepo(repo) {
  const looksLikePlaceholder = repo && !repo.full_name && !repo.description && /^project-\d+$/.test(repo.name || '')
  if (!looksLikePlaceholder) return repo
  const id = Number(repo.id)
  if (!Number.isInteger(id) || id < 1) return repo
  try {
    return mockRepoAt(id - 1)
  } catch {
    return repo
  }
}

export const mockAnalysis = (repo) => {
  const r = resolvePlaceholderRepo(repo)
  return {
    summary: `${r.name} is a ${r.language || 'multi-language'} project focused on ${r.description || 'software development'}.`,
    health_score: Math.floor(Math.random() * 30) + 65,
    project_type: 'application',
    suggested_topics: ['open-source', r.language?.toLowerCase() || 'code', 'development'].filter(Boolean),
    improvements: [
      'Add comprehensive documentation with examples',
      'Set up automated testing with CI/CD pipeline',
      'Include contribution guidelines (CONTRIBUTING.md)',
      'Add status badges to README',
    ],
    readme_suggestions: ['Installation', 'Usage Examples', 'API Reference'],
    highlights: [`Active ${r.language || 'multi-language'} project`, 'Well-structured codebase'],
    quality_breakdown: { documentation: 15, community: 10, engineering: 12, polish: 5 },
    patterns: { hasInstallation: true, hasUsage: false, hasTests: true, hasCI: true, hasLicense: true },
  }
}

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
    grad.addColorStop(0, '#3f7d12');
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
    branch: 'main',
});

// ---------------------------------------------------------------------------
// Wave-6 generation features — demo-mode content.
// The global "Demo mode — data and AI responses are simulated" banner supplies
// the honesty context, so these return realistic generated output (no `mock`
// flag) rather than an unconfigured placeholder — otherwise the flagship WOW
// features would render an error/"connect a provider" state in the demo that
// every community visitor sees first. Shapes mirror the real endpoints exactly.
// ---------------------------------------------------------------------------

const repoSlug = (repo) => (repo?.full_name || 'dev-user/demo-repo').split('/')[1] || 'demo-repo';

// README Studio improve: fills the sections the score flagged missing
// (Contributing, badges) as an additive "missing-sections" patch with the demo
// README as the diff base.
export const mockReadmeStudioImprove = (repo, config = {}) => {
    const name = repoSlug(repo);
    const mode = config.mode === 'full-rewrite' ? 'full-rewrite' : 'missing-sections';
    const additions = [
        '## Contributing',
        '',
        'Contributions are welcome. Open an issue to discuss anything larger than a',
        'typo fix, then submit a pull request against `main`. Run the test suite and',
        'make sure the linter is clean before pushing.',
        '',
        '## Badges',
        '',
        '![CI](https://img.shields.io/badge/CI-passing-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue)',
        '',
        '## Screenshots',
        '',
        '<!-- Add a screenshot or short demo GIF here to help newcomers grasp the',
        'project at a glance. Recommended path: docs/images/' + name + '-demo.png -->',
    ].join('\n');
    const full = '# ' + name + '\n\nMachine learning pipeline for predictive customer behavior analysis.\n\n' + additions;
    return {
        success: true,
        mode,
        markdown: mode === 'full-rewrite' ? full : additions,
        currentReadme: '# Demo Repository\n\nMachine learning pipeline for predictive customer behavior analysis.\n\n## Quick start\n\n```bash\nnpm install\nnpm run dev\n```\n',
        confidence: 'high',
        warnings: [],
        missingSections: ['Contributing', 'Badges', 'Screenshots'],
    };
};

export const mockReadmeStudioDeterministic = (repo, config = {}) => ({
    ...mockReadmeStudioImprove(repo, config),
    deterministic: true,
    confidence: 'medium',
});

// A valid, repo-flavoured architecture graph so the Mermaid render pipeline
// produces a real diagram in the demo (not a fallback message).
const mockArchitectureMermaid = (repo) => {
    const name = repoSlug(repo);
    const id = name.replace(/[^a-zA-Z0-9]/g, '_');
    return [
        'flowchart TD',
        '    subgraph ' + id + '["' + name + '"]',
        '        A[Client / CLI] --> B[API Gateway]',
        '        B --> C{Router}',
        '        C -->|ingest| D[Ingestion Worker]',
        '        C -->|score| E[Scoring Service]',
        '        D --> F[(Feature Store)]',
        '        E --> F',
        '        E --> G[(Model Registry)]',
        '        F --> H[Analytics DB]',
        '    end',
        '    B -.-> I[Auth / Session]',
    ].join('\n');
};

export const mockDiagramGenerate = (repo, config = {}) => ({
    success: true,
    mermaid: mockArchitectureMermaid(repo),
    diagramType: config.diagramType || 'architecture',
    truncated: false,
});

export const mockDiagramDeterministic = (repo, config = {}) => ({
    success: true,
    mermaid: [
        'flowchart TD',
        '    root[repo root] --> src[src/]',
        '    root --> server[server/]',
        '    root --> tests[tests/]',
        '    root --> docs[docs/]',
        '    src --> components[components/]',
        '    src --> hooks[hooks/]',
    ].join('\n'),
    diagramType: config.diagramType || 'architecture',
    truncated: false,
    deterministic: true,
});

export const mockDiagramEmbedPreview = (payload = {}) => {
    const type = payload.diagramType || 'architecture';
    const target = payload.target || 'readme-mermaid';
    if (target === 'svg-file') {
        return {
            target,
            svg: { path: 'docs/diagrams/' + type + '.svg', content: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="100" height="40" fill="#3f7d12"/></svg>', commitMessage: 'docs: add ' + type + ' diagram SVG' },
            readme: { path: 'README.md', before: '# Demo Repository\n', after: '# Demo Repository\n\n![' + type + ' diagram](docs/diagrams/' + type + '.svg)\n', action: 'append', commitMessage: 'docs: reference ' + type + ' diagram in README' },
            readmeTruncated: false,
        };
    }
    const block = '<!-- repo-manager:diagram:' + type + ':start -->\n```mermaid\n' + mockArchitectureMermaid(payload.repo) + '\n```\n<!-- repo-manager:diagram:' + type + ':end -->';
    return {
        target,
        readme: {
            path: 'README.md',
            before: '# Demo Repository\n\nMachine learning pipeline for predictive customer behavior analysis.\n',
            after: '# Demo Repository\n\nMachine learning pipeline for predictive customer behavior analysis.\n\n' + block + '\n',
            action: 'append',
            notice: null,
            commitMessage: 'docs: embed ' + type + ' diagram in README',
        },
        readmeTruncated: false,
    };
};

export const mockDiagramEmbedCommit = (payload = {}) => {
    const mode = payload.mode || 'direct';
    const branch = mode === 'pr' ? 'repo-manager/diagram-embed' : 'main';
    const target = payload.target || 'readme-mermaid';
    const out = { success: true, target, mode };
    if (payload.readme) out.readme = { mode, branch, committed: mode !== 'pr' };
    if (payload.svg) out.svg = { mode, branch, committed: mode !== 'pr' };
    // readme-mermaid always writes the README; svg-file writes both
    if (!payload.readme && !payload.svg) out.readme = { mode, branch, committed: mode !== 'pr' };
    return out;
};

// Agent Rules: real AGENTS.md + CLAUDE.md generated from the (mock) repo signals.
export const mockAgentRulesGenerate = (owner, repo, config = {}) => {
    const name = repo || 'demo-repo';
    const wantBoth = config.target === 'both' || !config.target;
    const wantClaude = wantBoth || config.target === 'claude';
    const wantAgents = wantBoth || config.target === 'agents';
    const agents = [
        '# AGENTS.md',
        '',
        'Agent instructions for ' + owner + '/' + name + '. The README is for humans; this file is for coding agents.',
        '',
        '## Setup commands',
        '',
        '- Install: `npm install`',
        '- Dev: `npm run dev`',
        '- Build: `npm run build`',
        '',
        '## Testing instructions',
        '',
        '- Run tests: `npm test`',
        '- Lint: `npm run lint`',
        '',
        '## Code style',
        '',
        '- Follow the existing linter/formatter configuration in the repo.',
        '- Keep changes focused; match the surrounding code.',
        '',
        '## PR instructions',
        '',
        '- Conventional Commits; ensure CI (build, lint, tests) is green before merge.',
    ].join('\n');
    const claude = ['@AGENTS.md', '', '# CLAUDE.md addendum', '', 'Everything in AGENTS.md applies. Claude-specific notes below.', '', '- Read files before editing.', '- Never add AI attribution to commits or PRs.'].join('\n');
    const files = {};
    if (wantAgents) files['AGENTS.md'] = agents;
    if (wantClaude) files['CLAUDE.md'] = claude;
    return {
        success: true,
        deterministic: false,
        reason: null,
        files,
        existing: {},
        notes: config.strictness === 'strict'
            ? ['Test command inferred from package.json scripts.test — verify it matches your runner.']
            : [],
    };
};

export const mockAgentRulesCommit = (owner, repo, { mode = 'direct' } = {}) => ({
    success: true,
    mode,
    committed: true,
});
