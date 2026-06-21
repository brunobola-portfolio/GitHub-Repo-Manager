// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ai-service.js imports the Gemini SDK and the DB at load time; stub both so
// the test exercises initialize() in isolation (initialize never touches db).
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class {} }));
vi.mock('../db.js', () => ({ default: {} }));

const ORIG = { ...process.env };
let aiService;

beforeEach(async () => {
    vi.resetModules();
    ({ aiService } = await import('../ai-service.js'));
});
afterEach(() => {
    process.env = { ...ORIG };
});

describe('aiService.initialize honors AI_PROVIDER', () => {
    it('builds a non-gemini provider when AI_PROVIDER=openai', async () => {
        process.env.AI_PROVIDER = 'openai';
        process.env.OPENAI_API_KEY = 'sk-test';
        process.env.OPENAI_MODEL = 'gpt-4o-mini';
        await aiService.initialize();
        expect(aiService.provider).toBeTruthy();
        expect(aiService.provider.constructor.name).toMatch(/OpenAI/);
    });

    it('keeps the Gemini path when AI_PROVIDER is unset', async () => {
        delete process.env.AI_PROVIDER;
        await aiService.initialize('g-test');
        expect(aiService.provider).toBeTruthy();
        expect(aiService.provider.constructor.name).toMatch(/Gemini/);
    });
});
