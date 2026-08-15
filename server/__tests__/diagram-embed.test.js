// SPDX-License-Identifier: Apache-2.0
// @vitest-environment node
//
// Coverage for server/lib/ai-features/diagram-embed.js — the pure marker
// insert/replace/malformed/placement matrix, the deterministic fallback
// diagram builder, and the server-side SVG sanitizer (Addendum 6b.1,
// docs/specs/2026-07-18-community-wow-wave6.md).

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-at-least-32-chars-long';

import { describe, it, expect } from 'vitest';
import {
    markerStart, markerEnd, buildMermaidEmbedBlock, buildSvgRefEmbedBlock,
    findMarkerBlock, insertOrReplaceBlock, buildDeterministicDiagram, sanitizeSvg,
    MAX_SVG_BYTES,
} from '../lib/ai-features/diagram-embed.js';

describe('markers', () => {
    it('emits the documented marker comment shape', () => {
        expect(markerStart('architecture')).toBe('<!-- repo-manager:diagram:architecture:start -->');
        expect(markerEnd('architecture')).toBe('<!-- repo-manager:diagram:architecture:end -->');
    });
});

describe('buildMermaidEmbedBlock', () => {
    it('wraps a fenced mermaid block in the marker pair', () => {
        const block = buildMermaidEmbedBlock({ type: 'architecture', mermaid: 'graph TD\n  A --> B' });
        expect(block).toContain(markerStart('architecture'));
        expect(block).toContain(markerEnd('architecture'));
        expect(block).toContain('```mermaid\ngraph TD\n  A --> B\n```');
    });

    it('adds a partial-tree note when truncated', () => {
        const block = buildMermaidEmbedBlock({ type: 'architecture', mermaid: 'graph TD', truncated: true });
        expect(block).toMatch(/partial \(truncated\) file tree/);
    });
});

describe('buildSvgRefEmbedBlock', () => {
    it('wraps a markdown image reference in the marker pair', () => {
        const block = buildSvgRefEmbedBlock({ type: 'architecture', svgPath: 'docs/diagrams/architecture.svg', label: 'Architecture diagram' });
        expect(block).toContain(markerStart('architecture'));
        expect(block).toContain('![Architecture diagram](docs/diagrams/architecture.svg)');
        expect(block).toContain(markerEnd('architecture'));
    });
});

describe('findMarkerBlock', () => {
    it('reports absent when neither marker is present', () => {
        expect(findMarkerBlock('# Hello\n\nSome text.', 'architecture').state).toBe('absent');
    });

    it('reports absent for empty/non-string content', () => {
        expect(findMarkerBlock('', 'architecture').state).toBe('absent');
        expect(findMarkerBlock(undefined, 'architecture').state).toBe('absent');
    });

    it('reports valid when both markers are present in order', () => {
        const content = `# Hello\n\n${markerStart('architecture')}\nx\n${markerEnd('architecture')}\n\nMore.`;
        const result = findMarkerBlock(content, 'architecture');
        expect(result.state).toBe('valid');
        expect(result.startIdx).toBeGreaterThan(0);
        expect(result.endIdx).toBeGreaterThan(result.startIdx);
    });

    it('reports malformed when only the start marker is present', () => {
        const content = `# Hello\n\n${markerStart('architecture')}\nx\n`;
        expect(findMarkerBlock(content, 'architecture').state).toBe('malformed');
    });

    it('reports malformed when only the end marker is present', () => {
        const content = `# Hello\n\nx\n${markerEnd('architecture')}\n`;
        expect(findMarkerBlock(content, 'architecture').state).toBe('malformed');
    });

    it('reports malformed when the end marker precedes the start marker', () => {
        const content = `${markerEnd('architecture')}\nx\n${markerStart('architecture')}`;
        expect(findMarkerBlock(content, 'architecture').state).toBe('malformed');
    });

    it('is scoped to the given diagram type — a different type\'s markers do not match', () => {
        const content = `${markerStart('sequence')}\nx\n${markerEnd('sequence')}`;
        expect(findMarkerBlock(content, 'architecture').state).toBe('absent');
    });
});

describe('insertOrReplaceBlock — placement (no existing markers)', () => {
    const block = '<!-- repo-manager:diagram:architecture:start -->\n```mermaid\ngraph TD\n```\n<!-- repo-manager:diagram:architecture:end -->';

    it('placement "top" inserts before everything else', () => {
        const readme = '# My Project\n\nAn intro paragraph.\n\n## Installation\n\nnpm install';
        const { content, action, notice } = insertOrReplaceBlock(readme, 'architecture', block, { placement: 'top' });
        expect(action).toBe('inserted');
        expect(notice).toBeNull();
        expect(content.indexOf(markerStart('architecture'))).toBeLessThan(content.indexOf('# My Project'));
    });

    it('placement "end" appends after everything else', () => {
        const readme = '# My Project\n\nAn intro paragraph.\n\n## Installation\n\nnpm install';
        const { content, action } = insertOrReplaceBlock(readme, 'architecture', block, { placement: 'end' });
        expect(action).toBe('inserted');
        expect(content.indexOf('## Installation')).toBeLessThan(content.indexOf(markerStart('architecture')));
    });

    it('placement "after-intro" (default) inserts after the H1 + intro paragraph, before the next heading', () => {
        const readme = '# My Project\n\nAn intro paragraph describing the project.\n\n## Installation\n\nnpm install';
        const { content, action } = insertOrReplaceBlock(readme, 'architecture', block, {});
        expect(action).toBe('inserted');
        const introIdx = content.indexOf('An intro paragraph');
        const installIdx = content.indexOf('## Installation');
        const markerIdx = content.indexOf(markerStart('architecture'));
        expect(markerIdx).toBeGreaterThan(introIdx);
        expect(markerIdx).toBeLessThan(installIdx);
    });

    it('placement "after-intro" falls back to "after first paragraph" when there is no H1', () => {
        const readme = 'Just a plain intro paragraph, no heading.\n\n## Usage\n\ndetails';
        const { content } = insertOrReplaceBlock(readme, 'architecture', block, {});
        const markerIdx = content.indexOf(markerStart('architecture'));
        expect(markerIdx).toBeGreaterThan(content.indexOf('plain intro paragraph'));
        expect(markerIdx).toBeLessThan(content.indexOf('## Usage'));
    });

    it('placement "custom" inserts after the first line containing the anchor text', () => {
        const readme = '# Title\n\nIntro\n\n## Anchor Heading\n\nSection body\n\n## Next\n\nmore';
        const { content, action, notice } = insertOrReplaceBlock(readme, 'architecture', block, { placement: 'custom', customAnchor: '## Anchor Heading' });
        expect(action).toBe('inserted');
        expect(notice).toBeNull();
        const anchorIdx = content.indexOf('## Anchor Heading');
        const markerIdx = content.indexOf(markerStart('architecture'));
        expect(markerIdx).toBeGreaterThan(anchorIdx);
        expect(markerIdx).toBeLessThan(content.indexOf('## Next'));
    });

    it('placement "custom" falls back to the end with a notice when the anchor is not found', () => {
        const readme = '# Title\n\nIntro\n\n## Usage\n\nbody';
        const { content, action, notice } = insertOrReplaceBlock(readme, 'architecture', block, { placement: 'custom', customAnchor: '## Does Not Exist' });
        expect(action).toBe('inserted');
        expect(notice).toMatch(/was not found/i);
        expect(content.indexOf('## Usage')).toBeLessThan(content.indexOf(markerStart('architecture')));
    });

    it('handles an empty README by placing the block at (or effectively at) the top', () => {
        const { content, action } = insertOrReplaceBlock('', 'architecture', block, {});
        expect(action).toBe('inserted');
        expect(content).toContain(markerStart('architecture'));
    });
});

describe('insertOrReplaceBlock — replace on regeneration (idempotency)', () => {
    it('replaces an existing valid block in place rather than duplicating it', () => {
        const oldBlock = `${markerStart('architecture')}\n\`\`\`mermaid\nold\n\`\`\`\n${markerEnd('architecture')}`;
        const readme = `# Title\n\nIntro\n\n${oldBlock}\n\n## Usage\n\nbody`;
        const newBlock = `${markerStart('architecture')}\n\`\`\`mermaid\nnew\n\`\`\`\n${markerEnd('architecture')}`;

        const { content, action, notice } = insertOrReplaceBlock(readme, 'architecture', newBlock, {});
        expect(action).toBe('replaced');
        expect(notice).toBeNull();
        expect(content).not.toContain('old');
        expect(content).toContain('new');
        // Only one marker pair survives — no duplication.
        expect(content.split(markerStart('architecture')).length - 1).toBe(1);
        expect(content).toContain('## Usage');
    });

    it('regenerating twice in a row still yields exactly one block', () => {
        const readme = '# Title\n\nIntro\n\n## Usage\n\nbody';
        const block1 = `${markerStart('architecture')}\n\`\`\`mermaid\nv1\n\`\`\`\n${markerEnd('architecture')}`;
        const first = insertOrReplaceBlock(readme, 'architecture', block1, {});
        const block2 = `${markerStart('architecture')}\n\`\`\`mermaid\nv2\n\`\`\`\n${markerEnd('architecture')}`;
        const second = insertOrReplaceBlock(first.content, 'architecture', block2, {});

        expect(second.action).toBe('replaced');
        expect(second.content.split(markerStart('architecture')).length - 1).toBe(1);
        expect(second.content).toContain('v2');
        expect(second.content).not.toContain('v1');
    });
});

describe('insertOrReplaceBlock — malformed markers treated as absent', () => {
    const block = `${markerStart('architecture')}\n\`\`\`mermaid\nnew\n\`\`\`\n${markerEnd('architecture')}`;

    it('appends fresh + surfaces a notice when only the start marker exists', () => {
        const readme = `# Title\n\nIntro\n\n${markerStart('architecture')}\nstray\n\n## Usage\n\nbody`;
        const { content, action, notice } = insertOrReplaceBlock(readme, 'architecture', block, {});
        expect(action).toBe('appended-malformed');
        expect(notice).toMatch(/malformed/i);
        expect(content).toContain('new');
        // Old stray marker text is left alone (not silently deleted).
        expect(content).toContain('stray');
    });

    it('appends fresh + surfaces a notice when only the end marker exists', () => {
        const readme = `# Title\n\nIntro\n\nstray\n${markerEnd('architecture')}\n\n## Usage`;
        const { action, notice } = insertOrReplaceBlock(readme, 'architecture', block, {});
        expect(action).toBe('appended-malformed');
        expect(notice).toMatch(/malformed/i);
    });
});

describe('buildDeterministicDiagram', () => {
    it('builds a flowchart from a file tree, capped at maxNodes, labelled as deterministic', () => {
        const treeEntries = [
            { path: 'src/components/Foo.jsx' },
            { path: 'src/hooks/useBar.js' },
            { path: 'server/routes/ai.js' },
        ];
        const diagram = buildDeterministicDiagram({ treeEntries, maxNodes: 40 });
        expect(diagram).toContain('flowchart TD');
        expect(diagram).toMatch(/Structure diagram \(deterministic/);
        expect(diagram).toContain('src');
        expect(diagram).toContain('server');
    });

    it('falls back to topLevel dirs when no tree entries are available', () => {
        const diagram = buildDeterministicDiagram({ topLevel: [{ name: 'src', type: 'dir' }, { name: 'README.md', type: 'file' }] });
        expect(diagram).toContain('src');
        expect(diagram).not.toContain('README.md');
    });

    it('never throws and always returns valid-looking mermaid text for an empty repo', () => {
        const diagram = buildDeterministicDiagram({ topLevel: [], treeEntries: [] });
        expect(diagram).toContain('flowchart TD');
        expect(diagram).toMatch(/not enough directory structure/);
    });

    it('adds a partial-tree note when truncated', () => {
        const diagram = buildDeterministicDiagram({ treeEntries: [{ path: 'a/b.js' }], truncated: true });
        expect(diagram).toMatch(/partial \(truncated\) file tree/);
    });

    it('respects the maxNodes cap on a large tree', () => {
        const treeEntries = Array.from({ length: 200 }, (_, i) => ({ path: `dir${i}/file.js` }));
        const diagram = buildDeterministicDiagram({ treeEntries, maxNodes: 10 });
        const nodeLines = diagram.split('\n').filter((l) => /^\s*n\d+\[/.test(l));
        expect(nodeLines.length).toBeLessThanOrEqual(10);
    });
});

describe('sanitizeSvg', () => {
    const clean = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="url(#g1)"/><defs><linearGradient id="g1"/></defs></svg>';

    it('accepts a clean minimal SVG unchanged in substance', () => {
        const result = sanitizeSvg(clean);
        expect(result.ok).toBe(true);
        expect(result.svg).toContain('<svg');
        expect(result.svg).toContain('</svg>');
    });

    it('rejects empty/non-string input', () => {
        expect(sanitizeSvg('').ok).toBe(false);
        expect(sanitizeSvg(null).ok).toBe(false);
        expect(sanitizeSvg(undefined).ok).toBe(false);
    });

    it('rejects content that is not an SVG root', () => {
        const result = sanitizeSvg('<div>not an svg</div>');
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('not_svg');
    });

    it('enforces the <500KB size guard', () => {
        const huge = `<svg xmlns="http://www.w3.org/2000/svg">${'x'.repeat(MAX_SVG_BYTES)}</svg>`;
        const result = sanitizeSvg(huge);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('too_large');
    });

    it('strips <script> elements', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>';
        const result = sanitizeSvg(svg);
        expect(result.ok).toBe(true);
        expect(result.svg).not.toContain('<script');
        expect(result.svg).not.toContain('alert');
    });

    it('strips <foreignObject> elements', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml">x</body></foreignObject></svg>';
        const result = sanitizeSvg(svg);
        expect(result.ok).toBe(true);
        expect(result.svg).not.toContain('foreignObject');
    });

    it('strips <iframe>/<embed>/<object>/SMIL animate elements', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"><iframe src="x"></iframe><embed src="y"/><object data="z"></object><animate attributeName="x"/><rect/></svg>';
        const result = sanitizeSvg(svg);
        expect(result.ok).toBe(true);
        for (const tag of ['iframe', 'embed', 'object', 'animate']) {
            expect(result.svg.toLowerCase()).not.toContain(`<${tag}`);
        }
    });

    it('strips on* event-handler attributes (quoted and unquoted)', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)" onmouseover=\'evil()\' width="1"/></svg>';
        const result = sanitizeSvg(svg);
        expect(result.ok).toBe(true);
        expect(result.svg).not.toMatch(/on\w+\s*=/i);
    });

    it('strips javascript: hrefs', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>';
        const result = sanitizeSvg(svg);
        expect(result.ok).toBe(true);
        expect(result.svg).not.toContain('javascript:');
    });

    it('strips external (absolute-URL) href/xlink:href references, keeping in-document fragments', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">'
            + '<a href="https://evil.example/track"><rect/></a>'
            + '<use xlink:href="#localId"/>'
            + '</svg>';
        const result = sanitizeSvg(svg);
        expect(result.ok).toBe(true);
        expect(result.svg).not.toContain('evil.example');
        expect(result.svg).toContain('xlink:href="#localId"');
    });

    it('strips DOCTYPE/ENTITY declarations (XXE defence)', () => {
        const svg = '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&xxe;</text></svg>';
        const result = sanitizeSvg(svg);
        expect(result.ok).toBe(true);
        expect(result.svg).not.toMatch(/<!DOCTYPE/i);
        expect(result.svg).not.toMatch(/<!ENTITY/i);
    });

    it('strips @import inside <style> blocks', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url("https://evil.example/x.css");</style></svg>';
        const result = sanitizeSvg(svg);
        expect(result.ok).toBe(true);
        expect(result.svg).not.toContain('@import');
    });

    it('rejects content that becomes empty/invalid once stripped', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)';
        const result = sanitizeSvg(svg);
        expect(result.ok).toBe(false);
    });
});
