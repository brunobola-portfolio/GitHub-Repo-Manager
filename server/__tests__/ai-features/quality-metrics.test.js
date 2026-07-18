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

// ---------------------------------------------------------------------------
// README Studio — deterministic dimensions (Wave 6, Feature 1)
// ---------------------------------------------------------------------------

const MIT_TEMPLATE = `MIT License

Copyright (c) 2024 Someone

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;

describe('ai-features/quality-metrics — README Studio dimensions', () => {
    describe('licenseMismatch / licenseDetected / licenseClaimed', () => {
        it('is null when no LICENSE file content is supplied (never guesses)', () => {
            const p = detectPatterns('## License\nMIT licensed.\n', []);
            expect(p.licenseDetected).toBeNull();
            expect(p.licenseMismatch).toBeNull();
            expect(p.licenseClaimed).toBe('MIT');
        });

        it('is false (matches) when the README claim agrees with the detected LICENSE file', () => {
            const readme = '## License\nThis project is MIT licensed.\n';
            const p = detectPatterns(readme, [], { licenseFileContent: MIT_TEMPLATE });
            expect(p.licenseDetected).toMatchObject({ spdxId: 'MIT', matched: true });
            expect(p.licenseMismatch).toBe(false);
        });

        it('is true when the README claims a different license than the LICENSE file', () => {
            const readme = '## License\nApache-2.0\n';
            const p = detectPatterns(readme, [], { licenseFileContent: MIT_TEMPLATE });
            expect(p.licenseDetected).toMatchObject({ spdxId: 'MIT', matched: true });
            expect(p.licenseMismatch).toBe(true);
        });

        it('surfaces an unmatched LICENSE file without guessing an id', () => {
            const p = detectPatterns('', [], { licenseFileContent: 'This is a totally custom license text.' });
            expect(p.licenseDetected).toEqual({ spdxId: null, matched: false });
        });
    });

    describe('ciBadgeBroken', () => {
        it('is false when there is no workflow badge at all', () => {
            const p = detectPatterns('# Project\nNo badges here.\n', []);
            expect(p.ciBadgeBroken).toBe(false);
        });

        it('is false when the referenced workflow file exists', () => {
            const readme = '![CI](https://img.shields.io/github/actions/workflow/status/acme/repo/ci.yml)';
            const p = detectPatterns(readme, [], { workflowFiles: ['ci.yml', 'release.yml'] });
            expect(p.ciBadgeBroken).toBe(false);
        });

        it('is true when the referenced workflow file no longer exists', () => {
            const readme = '![CI](https://img.shields.io/github/actions/workflow/status/acme/repo/ci.yml)';
            const p = detectPatterns(readme, [], { workflowFiles: ['release.yml'] });
            expect(p.ciBadgeBroken).toBe(true);
        });
    });

    describe('installMatchesStack', () => {
        it('is null when there is no README or no recognizable install command', () => {
            expect(detectPatterns('', [{ name: 'package.json', type: 'file' }]).installMatchesStack).toBeNull();
            expect(detectPatterns('## Install\nDo the thing.\n', [{ name: 'package.json', type: 'file' }]).installMatchesStack).toBeNull();
        });

        it('is true when the install command matches the detected stack', () => {
            const p = detectPatterns('## Install\nnpm install\n', [{ name: 'package.json', type: 'file' }]);
            expect(p.installMatchesStack).toBe(true);
        });

        it('is false when the install command matches only an undetected stack', () => {
            const p = detectPatterns('## Install\npip install foo\n', [{ name: 'package.json', type: 'file' }]);
            expect(p.installMatchesStack).toBe(false);
        });
    });

    describe('hasScreenshots', () => {
        it('is false with no images and no images/screenshots dir', () => {
            expect(detectPatterns('# Project\nNo pictures.\n', []).hasScreenshots).toBe(false);
        });

        it('is true for a non-badge image markdown link', () => {
            const readme = '# Project\n![Screenshot](./docs/screenshot.png)\n';
            expect(detectPatterns(readme, []).hasScreenshots).toBe(true);
        });

        it('ignores shields.io badge images', () => {
            const readme = '[![Build](https://img.shields.io/badge/build-passing-green)](x)';
            expect(detectPatterns(readme, []).hasScreenshots).toBe(false);
        });

        it('is true when an images/ directory is present', () => {
            expect(detectPatterns('', [{ name: 'images', type: 'dir' }]).hasScreenshots).toBe(true);
        });
    });

    describe('sectionOrderOk', () => {
        it('is true when sections are in standard order', () => {
            const readme = '# Title\n## Install\nx\n## Usage\nx\n## Contributing\nx\n## License\nx\n';
            expect(detectPatterns(readme, []).sectionOrderOk).toBe(true);
        });

        it('is false when License appears before Install', () => {
            const readme = '# Title\n## License\nx\n## Install\nx\n';
            expect(detectPatterns(readme, []).sectionOrderOk).toBe(false);
        });

        it('is true (nothing to invert) for an empty README', () => {
            expect(detectPatterns('', []).sectionOrderOk).toBe(true);
        });
    });

    describe('calculateQualityMetrics trust bucket', () => {
        it('awards points only for checks that actually verified something', () => {
            const readme = '## Install\nnpm install\n## Usage\nx\n## Contributing\nx\n## License\nMIT\n';
            const patterns = detectPatterns(readme, [{ name: 'package.json', type: 'file' }], { licenseFileContent: MIT_TEMPLATE });
            const q = calculateQualityMetrics(patterns, {});
            expect(q.breakdown.trust).toBe(10); // license match(3) + no broken badge(2) + install match(3) + order ok(2)
        });

        it('never penalizes an inconclusive (null) check', () => {
            const patterns = detectPatterns('', []); // no signals at all
            const q = calculateQualityMetrics(patterns, {});
            // licenseMismatch null (0), ciBadgeBroken false (+2), installMatchesStack null !== false (+3), sectionOrderOk true (+2)
            expect(q.breakdown.trust).toBe(7);
        });
    });

    describe('generateQualityReport recommendations', () => {
        it('flags a license mismatch as high priority with the detected id', () => {
            const readme = '## License\nApache-2.0\n';
            const report = generateQualityReport({ description: 'x', topics: ['x'] }, readme, [], { licenseFileContent: MIT_TEMPLATE });
            const rec = report.recommendations.find(r => r.action.includes("doesn't match the LICENSE file"));
            expect(rec).toMatchObject({ priority: 'high' });
            expect(rec.action).toContain('MIT');
        });

        it('does not recommend anything license-related when no LICENSE file was supplied', () => {
            const report = generateQualityReport({ description: 'x', topics: ['x'] }, '## License\nMIT\n', []);
            expect(report.recommendations.some(r => r.action.toLowerCase().includes('license file'))).toBe(false);
        });
    });
});
