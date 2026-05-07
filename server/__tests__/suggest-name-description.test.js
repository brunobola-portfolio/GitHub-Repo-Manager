import { describe, it, expect } from 'vitest';
import { generateDeterministic } from '../lib/suggest-name-description.js';

describe('generateDeterministic', () => {
    it('keeps name when already kebab-case', () => {
        const out = generateDeterministic({
            name: 'my-cool-repo',
            description: '',
            language: 'JavaScript',
            topics: [],
            readmeExcerpt: '',
            aiMetadata: null,
        });
        expect(out.proposed.name).toBe('my-cool-repo');
        expect(out.noChange.name).toBe(true);
    });

    it('slugifies a name with spaces, underscores and capitals', () => {
        const out = generateDeterministic({
            name: 'APOS POS_System',
            description: '',
            language: 'C#',
            topics: [],
            readmeExcerpt: '',
            aiMetadata: null,
        });
        expect(out.proposed.name).toBe('apos-pos-system');
        expect(out.noChange.name).toBe(false);
    });

    it('strips non-alphanumeric and collapses dashes', () => {
        const out = generateDeterministic({
            name: '!!my  __weird---name??',
            description: '',
            language: null,
            topics: [],
            readmeExcerpt: '',
            aiMetadata: null,
        });
        expect(out.proposed.name).toBe('my-weird-name');
    });

    it('description prefers ai_metadata summary over README and templates', () => {
        const out = generateDeterministic({
            name: 'foo',
            description: '',
            language: 'Python',
            topics: ['ml'],
            readmeExcerpt: '# Foo\n\nA tool.',
            aiMetadata: { summary: 'High-throughput tokenizer for ML pipelines and batch jobs.' },
        });
        expect(out.proposed.description).toBe(
            'High-throughput tokenizer for ML pipelines and batch jobs.',
        );
    });

    it('description ignores ai_metadata summary that starts with "Imported from"', () => {
        const out = generateDeterministic({
            name: 'foo',
            description: '',
            language: 'Python',
            topics: ['ml'],
            readmeExcerpt: '',
            aiMetadata: { summary: 'Imported from https://dev.azure.com/...' },
        });
        expect(out.proposed.description).toBe('Python project for ml');
    });

    it('description falls back to README h1 + first sentence', () => {
        const out = generateDeterministic({
            name: 'foo',
            description: '',
            language: 'JavaScript',
            topics: [],
            readmeExcerpt: '# Foo\n\nA dashboard for monitoring servers and alerts in real time.',
            aiMetadata: null,
        });
        expect(out.proposed.description).toBe(
            'Foo: A dashboard for monitoring servers and alerts in real time.',
        );
    });

    it('description falls back to language + topics template', () => {
        const out = generateDeterministic({
            name: 'foo',
            description: '',
            language: 'Go',
            topics: ['cli', 'logging'],
            readmeExcerpt: '',
            aiMetadata: null,
        });
        expect(out.proposed.description).toBe('Go project for cli and logging');
    });

    it('description final fallback is "<Language> repository"', () => {
        const out = generateDeterministic({
            name: 'foo',
            description: '',
            language: 'Rust',
            topics: [],
            readmeExcerpt: '',
            aiMetadata: null,
        });
        expect(out.proposed.description).toBe('Rust repository');
    });

    it('treats current description starting with "Imported from " as empty', () => {
        const out = generateDeterministic({
            name: 'foo',
            description: 'Imported from https://example.com/bar.git',
            language: 'Go',
            topics: ['cli'],
            readmeExcerpt: '',
            aiMetadata: null,
        });
        expect(out.proposed.description).toBe('Go project for cli');
        expect(out.noChange.description).toBe(false);
    });

    it('keeps current description when good and no better candidate exists', () => {
        const out = generateDeterministic({
            name: 'foo',
            description: 'Mature production-grade utility used by 50 teams.',
            language: 'Go',
            topics: [],
            readmeExcerpt: '',
            aiMetadata: null,
        });
        expect(out.proposed.description).toBe('Mature production-grade utility used by 50 teams.');
        expect(out.noChange.description).toBe(true);
    });

    it('rationale references the sources actually used', () => {
        const out = generateDeterministic({
            name: 'foo',
            description: '',
            language: 'Python',
            topics: ['ml'],
            readmeExcerpt: '# Foo\n\nA tool to do things efficiently and quickly.',
            aiMetadata: null,
        });
        expect(out.rationale).toMatch(/README/i);
    });

    // ---------------------------------------------------------------------
    // README sanitisation — these are the regression cases that motivated
    // adding `stripReadmeNoise`. Before the fix, a README that opened with
    // an HTML <img> banner would yield "<img src=...>" as the description.
    // ---------------------------------------------------------------------

    it('strips leading HTML <img> banners from README before extraction', () => {
        const readme = '# Gestao-Projetos-Reclamo2000\n\n<img src="public_html/backoffice/template/img/logo.png" />\n\nPortal de gestao de projetos com ligacao ao ERP da Primavera para acompanhar tarefas e horas faturadas.';
        const out = generateDeterministic({
            name: 'gestao-projetos-reclamo2000',
            description: '',
            language: 'PHP',
            topics: [],
            readmeExcerpt: readme,
            aiMetadata: null,
        });
        expect(out.proposed.description).not.toContain('<img');
        expect(out.proposed.description).not.toContain('src=');
        expect(out.proposed.description).toMatch(/portal de gestao/i);
    });

    it('skips shields.io / markdown badge lines', () => {
        const readme = '# MyLib\n\n[![CI](https://img.shields.io/badge/ci-passing-green)](https://example.com) [![npm](https://img.shields.io/npm/v/mylib)](https://npmjs.com)\n\nA tiny utility that turns date ranges into human-readable strings for dashboards.';
        const out = generateDeterministic({
            name: 'mylib',
            description: '',
            language: 'TypeScript',
            topics: [],
            readmeExcerpt: readme,
            aiMetadata: null,
        });
        expect(out.proposed.description).not.toMatch(/shields|img\.shields|badge/i);
        expect(out.proposed.description).toMatch(/turns date ranges/i);
    });

    it('skips fenced code blocks that come before the first prose paragraph', () => {
        const readme = '# Tool\n\n```bash\nnpm install tool\ntool run --watch\n```\n\nThe primary purpose is to migrate legacy CSV exports to JSON for downstream pipelines.';
        const out = generateDeterministic({
            name: 'tool',
            description: '',
            language: 'JavaScript',
            topics: [],
            readmeExcerpt: readme,
            aiMetadata: null,
        });
        expect(out.proposed.description).not.toMatch(/npm install|--watch|```/);
        expect(out.proposed.description).toMatch(/migrate legacy CSV/i);
    });

    it('keeps markdown link labels but drops their URLs', () => {
        const readme = '# Tool\n\nA library that wraps the [Stripe API](https://stripe.com/docs) for consistent billing reports across teams.';
        const out = generateDeterministic({
            name: 'tool',
            description: '',
            language: 'TypeScript',
            topics: [],
            readmeExcerpt: readme,
            aiMetadata: null,
        });
        expect(out.proposed.description).toContain('Stripe API');
        expect(out.proposed.description).not.toMatch(/https?:\/\//);
    });

    it('falls back to language template when README contains only HTML / markup', () => {
        const readme = '# Project\n\n<div><img src="logo.png"/></div>\n<table><tr><td>x</td></tr></table>';
        const out = generateDeterministic({
            name: 'project',
            description: '',
            language: 'PHP',
            topics: [],
            readmeExcerpt: readme,
            aiMetadata: null,
        });
        expect(out.proposed.description).toBe('PHP repository');
    });
});
