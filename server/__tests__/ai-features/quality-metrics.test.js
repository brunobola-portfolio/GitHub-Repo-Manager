import { describe, it, expect } from 'vitest';
import {
    detectPatterns,
    calculateQualityMetrics,
    generateQualityReport,
    getScoreSummary,
} from '../../lib/ai-features/quality-metrics.js';

describe('ai-features/quality-metrics.detectPatterns', () => {
    it('flags common README + project signals (happy path)', () => {
        const readme = '## Installation\nnpm install foo\n## Usage\n```js\nfoo()\n```\n';
        const files = [
            { name: 'package.json', type: 'file' },
            { name: 'README.md', type: 'file' },
            { name: 'LICENSE.md', type: 'file' },
            { name: 'tests', type: 'dir' },
            { name: '.github', type: 'dir' },
        ];
        const p = detectPatterns(readme, files);
        expect(p.hasInstallation).toBe(true);
        expect(p.hasUsage).toBe(true);
        expect(p.hasExamples).toBe(true);
        expect(p.hasLicense).toBe(true);
        expect(p.hasTests).toBe(true);
        expect(p.hasCI).toBe(true);
        expect(p.isNodeProject).toBe(true);
    });

    it('returns safe defaults for empty input (error path / defensive)', () => {
        const p = detectPatterns(null, null);
        expect(p.hasInstallation).toBe(false);
        expect(p.hasTests).toBe(false);
        expect(p.isNodeProject).toBe(false);
    });
});

describe('ai-features/quality-metrics.calculateQualityMetrics', () => {
    it('produces a bounded score and breakdown', () => {
        const patterns = detectPatterns('## Installation\n## Usage\n', [{ name: 'package.json' }]);
        const q = calculateQualityMetrics(patterns, { description: 'x', stargazers_count: 0 });
        expect(q.overall).toBeGreaterThanOrEqual(0);
        expect(q.overall).toBeLessThanOrEqual(100);
        expect(q.breakdown.documentation).toBeGreaterThanOrEqual(0);
        expect(q.patterns).toEqual(patterns);
    });
});

describe('ai-features/quality-metrics.generateQualityReport', () => {
    it('sorts recommendations high → medium → low', () => {
        const report = generateQualityReport({ description: '', topics: [] }, '', []);
        const priorities = report.recommendations.map(r => r.priority);
        const order = { high: 0, medium: 1, low: 2 };
        for (let i = 1; i < priorities.length; i++) {
            expect(order[priorities[i]]).toBeGreaterThanOrEqual(order[priorities[i - 1]]);
        }
        expect(report.summary).toEqual(getScoreSummary(report.score));
    });
});
