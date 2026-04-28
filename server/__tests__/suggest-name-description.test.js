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
});
