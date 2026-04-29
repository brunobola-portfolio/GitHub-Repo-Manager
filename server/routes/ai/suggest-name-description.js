import express from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate-request.js';
import { checkUsageLimit, incrementUsage } from '../../lib/usage-meter.js';
import { auditLog } from '../../lib/audit.js';
import { githubApi } from '../../lib/github-api.js';
import { safeJsonParse } from '../../lib/utils.js';
import { requireAI } from './shared.js';
import { generateDeterministic } from '../../lib/suggest-name-description.js';

const router = express.Router();

const bodySchema = z.object({
    repoId: z.coerce.number().int().positive(),
});

const README_PATH_CANDIDATES = ['README.md', 'README', 'readme.md'];
const README_EXCERPT_BYTES = 1500;

async function fetchRepoMetadata(repoId, accessToken) {
    const { data } = await githubApi(`/repositories/${repoId}`, accessToken);
    return data;
}

async function fetchReadmeExcerpt(owner, name, accessToken) {
    for (const path of README_PATH_CANDIDATES) {
        try {
            const { data } = await githubApi(`/repos/${owner}/${name}/contents/${path}`, accessToken);
            if (data?.content && data?.encoding === 'base64') {
                const decoded = Buffer.from(data.content, 'base64').toString('utf8');
                return decoded.slice(0, README_EXCERPT_BYTES);
            }
        } catch {
            // try the next candidate path
        }
    }
    return '';
}

function buildAIPrompt({ name, description, language, isPrivate, topics, readmeExcerpt }) {
    return [
        'You are renaming a GitHub repo. Given the metadata below, propose:',
        '- name: kebab-case, 3-5 words, descriptive of WHAT it does (not generic).',
        "  Keep current name if already good (don't rename for the sake of it).",
        '- description: ONE sentence, max 120 chars, no marketing fluff,',
        '  starts with a verb or noun (not "A repo that…").',
        '- rationale: 1 sentence explaining what signals you used.',
        '',
        'Return JSON only: { "name": "...", "description": "...", "rationale": "..." }',
        '',
        `Repo: ${name} (${language || 'unknown'}, ${isPrivate ? 'private' : 'public'})`,
        `Current description: ${description || 'none'}`,
        `Topics: ${topics?.length ? topics.join(', ') : 'none'}`,
        `README excerpt: ${readmeExcerpt || 'none'}`,
    ].join('\n');
}

function clampString(s, max) {
    if (typeof s !== 'string') return '';
    const t = s.trim();
    return t.length > max ? t.slice(0, max) : t;
}

function shapeResponse({ source, current, generated }) {
    const proposedName = clampString(generated.proposed.name || current.name, 100);
    const proposedDesc = clampString(generated.proposed.description ?? '', 500);
    return {
        source,
        current: { name: current.name, description: current.description || '' },
        proposed: { name: proposedName, description: proposedDesc },
        rationale: clampString(generated.rationale || 'Suggestion generated.', 280),
        noChange: {
            name: proposedName === current.name,
            description: (proposedDesc || '') === (current.description || ''),
        },
    };
}

router.post(
    '/ai/suggest-name-description',
    requireAuth,
    requireAI,
    validateBody(bodySchema),
    async (req, res) => {
        const userId = req.session.userId;
        const quota = checkUsageLimit(userId, 'ai_queries');
        if (!quota.allowed) {
            return res.status(429).json({
                error: 'AI query limit exceeded',
                limit: quota.limit,
                current: quota.current,
                upgradeUrl: '/pricing',
            });
        }

        const { repoId } = req.validatedBody;
        let repo;
        try {
            repo = await fetchRepoMetadata(repoId, req.session.accessToken);
        } catch (error) {
            const status = error.status || 500;
            req.log.warn({ err: error, repoId }, 'suggest-name-description: repo lookup failed');
            return res.status(status === 404 ? 404 : 500).json({
                error: status === 404 ? 'Repository not found or no access.' : 'Failed to load repository.',
            });
        }

        const owner = repo.owner?.login;
        const name = repo.name;
        const readmeExcerpt = await fetchReadmeExcerpt(owner, name, req.session.accessToken).catch(() => '');

        const generatorInput = {
            name,
            description: repo.description || '',
            language: repo.language || null,
            topics: Array.isArray(repo.topics) ? repo.topics : [],
            readmeExcerpt,
            aiMetadata: null,
        };

        let source = 'deterministic';
        let generated = generateDeterministic(generatorInput);

        try {
            const prompt = buildAIPrompt({
                name,
                description: repo.description,
                language: repo.language,
                isPrivate: !!repo.private,
                topics: generatorInput.topics,
                readmeExcerpt,
            });
            const { text } = await req.aiProvider.generate({ prompt, maxTokens: 200 });
            const parsed = safeJsonParse(text);
            if (
                parsed &&
                typeof parsed.name === 'string' &&
                typeof parsed.description === 'string' &&
                typeof parsed.rationale === 'string'
            ) {
                source = 'ai';
                generated = {
                    proposed: { name: parsed.name, description: parsed.description },
                    rationale: parsed.rationale,
                    // noChange computed downstream in shapeResponse
                    noChange: { name: false, description: false },
                };
            } else {
                req.log.warn({ repoId }, 'suggest-name-description: AI response invalid, using deterministic');
            }
        } catch (error) {
            req.log.warn({ err: error, repoId }, 'suggest-name-description: AI failed, using deterministic');
        }

        incrementUsage(userId, 'ai_queries');
        const body = shapeResponse({
            source,
            current: { name, description: repo.description || '' },
            generated,
        });
        auditLog(req, 'ai.suggest_name_description', 'repo', `${owner}/${name}`, { source });
        return res.json(body);
    },
);

export default router;
