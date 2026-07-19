import { describe, it, expect } from 'vitest';
import { NEVER_INVENT_RULE, buildSuggestPrompt, buildReadmePrompt } from '../../lib/ai-features/grounded-prompts.js';

describe('NEVER_INVENT_RULE', () => {
    it('is a non-empty, reusable anti-hallucination instruction', () => {
        expect(typeof NEVER_INVENT_RULE).toBe('string');
        expect(NEVER_INVENT_RULE).toMatch(/never invent/i);
        expect(NEVER_INVENT_RULE).toMatch(/evidenced/i);
    });
});

describe('buildSuggestPrompt (/ai/suggest — P1.6)', () => {
    const safeRepo = {
        name: 'widgets',
        full_name: 'acme/widgets',
        description: 'A widget factory',
        language: 'JavaScript',
        topics: '',
        license: '',
        visibility: 'public',
        stargazers_count: 3,
        open_issues_count: 1,
    };

    it('embeds the sanitized repo metadata verbatim', () => {
        const prompt = buildSuggestPrompt(safeRepo);
        expect(prompt).toContain('"full_name": "acme/widgets"');
        expect(prompt).toContain('"stargazers_count": 3');
    });

    it('includes the shared never-invent guardrail', () => {
        expect(buildSuggestPrompt(safeRepo)).toContain(NEVER_INVENT_RULE);
    });

    it('requires each suggestion to cite the metadata field that motivated it', () => {
        const prompt = buildSuggestPrompt(safeRepo);
        expect(prompt).toMatch(/"basedOn"/);
        expect(prompt).toMatch(/cite|must name a real field/i);
    });

    it('still asks for the JSON schema the route expects to parse', () => {
        const prompt = buildSuggestPrompt(safeRepo);
        expect(prompt).toMatch(/"suggestions"/);
        expect(prompt).toMatch(/"analysis"/);
        expect(prompt).toMatch(/raw JSON/i);
    });
});

describe('buildReadmePrompt (/ai/readme — P1.6)', () => {
    const meta = { name: 'widgets', description: 'A widget factory', language: 'Python', topics: 'cli, tools' };

    it('embeds the provided metadata', () => {
        const prompt = buildReadmePrompt(meta);
        expect(prompt).toContain('widgets');
        expect(prompt).toContain('A widget factory');
        expect(prompt).toContain('Python');
        expect(prompt).toContain('cli, tools');
    });

    it('instructs a language-appropriate TODO placeholder for install/usage, never a concrete invented command', () => {
        const prompt = buildReadmePrompt(meta);
        expect(prompt).toMatch(/Python-appropriate placeholder command/);
        expect(prompt).toMatch(/TODO/);
        expect(prompt).toMatch(/never a concrete invented command/i);
        expect(prompt).toMatch(/never an invented code example/i);
    });

    it('does not ask for a "Key Features" section or invented badges (the guaranteed-hallucination sections)', () => {
        const prompt = buildReadmePrompt(meta);
        expect(prompt).not.toMatch(/key features/i);
        expect(prompt).toMatch(/[Nn]ever invent badges/);
    });

    it('forbids hype language instead of asking the model to "sound exciting"', () => {
        const prompt = buildReadmePrompt(meta);
        expect(prompt).not.toMatch(/sound exciting/i);
        expect(prompt).toMatch(/no hype/i);
    });

    it('includes the shared never-invent guardrail', () => {
        expect(buildReadmePrompt(meta)).toContain(NEVER_INVENT_RULE);
    });

    it('falls back to honest placeholders when description/language/topics are missing', () => {
        const prompt = buildReadmePrompt({ name: 'bare-repo' });
        expect(prompt).toContain('No description provided.');
        expect(prompt).toContain('Not specified');
        expect(prompt).toContain('None');
        // Falls back to a generic "the project" language label rather than crashing.
        expect(prompt).toMatch(/the project-appropriate placeholder command/);
    });
});
