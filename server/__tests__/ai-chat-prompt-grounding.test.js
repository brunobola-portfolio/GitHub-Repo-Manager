// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildChatPrompt } from '../lib/ai-chat-prompt.js';

describe('buildChatPrompt error grounding', () => {
    it('injects a Known issue block when the message matches a KB entry', () => {
        const p = buildChatPrompt({ message: 'migration failed: unknown unit: "m"' });
        expect(p).toMatch(/Known issue/i);
        expect(p).toMatch(/git[- ]lfs/i);
    });

    it('injects a Known issue block when context.errorCode matches', () => {
        const p = buildChatPrompt({ message: 'help', context: { errorCode: 'OVERSIZED_FILES' } });
        expect(p).toMatch(/Known issue/i);
        expect(p).toMatch(/100 ?MiB/i);
    });

    it('injects nothing when no KB entry matches', () => {
        const p = buildChatPrompt({ message: 'how do I change my theme?' });
        expect(p).not.toMatch(/Known issue/i);
    });
});
