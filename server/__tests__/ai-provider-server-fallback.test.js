// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ai-provider.js imports the Gemini SDK at module load — stub it so tests don't
// need the real client. The server-wide fallback path is taken when the user
// has no BYOK config, so force getDecryptedConfig to return null.
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class {} }));
vi.mock('../lib/user-ai-config.js', () => ({ getDecryptedConfig: () => null }));

const ORIG = { ...process.env };
let createProviderForUser;

beforeEach(async () => {
    vi.resetModules();
    ({ createProviderForUser } = await import('../lib/ai-provider.js'));
});
afterEach(() => {
    process.env = { ...ORIG };
});

describe('createProviderForUser server fallback honors AI_PROVIDER', () => {
    it('returns a non-gemini provider when AI_PROVIDER=openai and its key is set', async () => {
        process.env.AI_PROVIDER = 'openai';
        process.env.OPENAI_API_KEY = 'sk-test';
        process.env.OPENAI_MODEL = 'gpt-4o-mini';
        delete process.env.GEMINI_API_KEY;
        const provider = await createProviderForUser(123, 'completion');
        expect(provider).toBeTruthy();
        expect(provider.constructor.name).toMatch(/OpenAI/);
    });

    it('still falls back to Gemini by default', async () => {
        delete process.env.AI_PROVIDER;
        process.env.GEMINI_API_KEY = 'g-test';
        const provider = await createProviderForUser(123, 'completion');
        expect(provider).toBeTruthy();
        expect(provider.constructor.name).toMatch(/Gemini/);
    });

    it('returns null when the configured provider has no key', async () => {
        process.env.AI_PROVIDER = 'anthropic';
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.GEMINI_API_KEY;
        const provider = await createProviderForUser(123, 'completion');
        expect(provider).toBeNull();
    });
});
