/*
 * GitHub Repo Manager - AI Routes
 *
 * Handles all /api/ai/* endpoints including:
 * - Chat with AI assistant
 * - Repository suggestions
 * - README generation and enhancement
 * - Repository indexing and semantic search
 * - Quality reports
 * - Batch indexing
 * - AI metadata retrieval
 *
 * Also handles /api/config/ai-status
 *
 * Copyright (c) 2025 Bruno Marques - Bola Labs, Inc.
 */

import express from 'express';
import db from '../db.js';
import { githubApi } from '../lib/github-api.js';
import { requireAuth, createRequireAI, safeError } from '../middleware/auth.js';
import { aiService } from '../ai-service.js';

const router = express.Router();

// Create requireAI middleware from the factory
const requireAI = createRequireAI(aiService);

// ------------------------------------------------------------------
// AI Configuration Status
// ------------------------------------------------------------------

// Check AI Configuration Status (mounted at /config/ai-status from index.js)
// Note: This is also available via the router's own mount point
router.get('/config/ai-status', (req, res) => {
    const configured = !!process.env.GEMINI_API_KEY || !!aiService.model;
    res.json({ configured, provider: configured ? 'gemini' : null });
});

// ------------------------------------------------------------------
// AI Chat
// ------------------------------------------------------------------

router.post('/ai/chat', requireAuth, requireAI, async (req, res) => {
    try {
        const { message, context } = req.body;

        if (!message || message.trim().length === 0) {
            return res.status(400).json({
                error: 'MESSAGE_REQUIRED',
                message: 'Please provide a message to send to the AI assistant.'
            });
        }

        // Use configured model from environment or default
        const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        let model;

        try {
            model = req.genAI.getGenerativeModel({ model: modelName });
        } catch (modelError) {
            console.error(`Failed to load model ${modelName}:`, modelError.message);
            return res.status(503).json({
                error: 'MODEL_UNAVAILABLE',
                message: `AI model "${modelName}" is not available. Please check your configuration.`,
                modelRequested: modelName
            });
        }

        const systemPrompt = `You are an expert GitHub Repository Manager Assistant.
    Your goal is to help users manage their repositories, analyze code, and suggest improvements.

    Current Context:
    ${JSON.stringify(context || {}, null, 2)}

    Be concise, professional, and helpful. Format your response in Markdown.`;

        const chat = model.startChat({
            history: [
                {
                    role: "user",
                    parts: [{ text: systemPrompt }],
                },
                {
                    role: "model",
                    parts: [{ text: "Understood. I am ready to assist with GitHub repository management tasks." }],
                },
            ],
        });

        const result = await chat.sendMessage(message);
        const response = await result.response;
        const text = response.text();

        res.json({ message: text });
    } catch (error) {
        console.error('AI Chat Error:', error);

        // User-friendly error handling
        if (error.message?.includes('not found') || error.status === 404) {
            return res.status(404).json({
                error: 'MODEL_NOT_FOUND',
                message: `The AI model "${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}" is not available. Please verify your GEMINI_MODEL configuration in .env file.`,
                suggestion: 'Try using: gemini-2.0-flash-exp, gemini-1.5-flash, or gemini-1.5-pro'
            });
        }

        if (error.message?.includes('API key') || error.status === 401) {
            return res.status(401).json({
                error: 'INVALID_API_KEY',
                message: 'Invalid or expired Gemini API key. Please check your GEMINI_API_KEY in .env file.'
            });
        }

        if (error.message?.includes('quota') || error.status === 429) {
            return res.status(429).json({
                error: 'QUOTA_EXCEEDED',
                message: 'API quota exceeded. Please try again later or check your Gemini API usage limits.'
            });
        }

        res.status(500).json({
            error: 'AI_REQUEST_FAILED',
            message: 'Failed to generate AI response. Please try again later.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ------------------------------------------------------------------
// AI Suggestions
// ------------------------------------------------------------------

router.post('/ai/suggest', requireAuth, requireAI, async (req, res) => {
    try {
        const { repo } = req.body;

        if (!repo) {
            return res.status(400).json({
                error: 'REPO_REQUIRED',
                message: 'Repository data is required for suggestions.'
            });
        }

        // Use configured model from environment or default
        const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
        let model;

        try {
            model = req.genAI.getGenerativeModel({ model: modelName });
        } catch (modelError) {
            console.error(`Failed to load model ${modelName}:`, modelError.message);
            return res.status(503).json({
                error: 'MODEL_UNAVAILABLE',
                message: `AI model "${modelName}" is not available. Please check your configuration.`,
                modelRequested: modelName
            });
        }

        const prompt = `Analyze this GitHub repository metadata and suggest 3 concrete improvements.
    Focus on: Description clarity, Topics (SEO), and Community standards (License, Contributing).

    Repository: ${JSON.stringify(repo, null, 2)}

    Return the response as a JSON object with this structure:
    {
      "suggestions": [
        { "title": "...", "description": "...", "type": "improvement" }
      ],
      "analysis": "Brief summary of the repo's current state"
    }
    Do not include markdown formatting in the JSON output, just raw JSON.`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().replace(/```json/g, '').replace(/```/g, '').trim();

        res.json(JSON.parse(text));
    } catch (error) {
        console.error('AI Suggest Error:', error);

        // User-friendly error handling
        if (error.message?.includes('not found') || error.status === 404) {
            return res.status(404).json({
                error: 'MODEL_NOT_FOUND',
                message: `The AI model "${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}" is not available. Please verify your GEMINI_MODEL configuration in .env file.`,
                suggestion: 'Try using: gemini-2.0-flash-exp, gemini-1.5-flash, or gemini-1.5-pro'
            });
        }

        if (error.message?.includes('API key') || error.status === 401) {
            return res.status(401).json({
                error: 'INVALID_API_KEY',
                message: 'Invalid or expired Gemini API key. Please check your GEMINI_API_KEY in .env file.'
            });
        }

        if (error.message?.includes('quota') || error.status === 429) {
            return res.status(429).json({
                error: 'QUOTA_EXCEEDED',
                message: 'API quota exceeded. Please try again later or check your Gemini API usage limits.'
            });
        }

        res.status(500).json({
            error: 'AI_REQUEST_FAILED',
            message: 'Failed to generate suggestions. Please try again later.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// ------------------------------------------------------------------
// AI README Generation
// ------------------------------------------------------------------

router.post('/ai/readme', requireAuth, requireAI, async (req, res) => {
    try {
        const { name, description, language, topics } = req.body;
        const prompt = `Generate a professional, high-quality README.md for a GitHub repository.

    Project Name: ${name}
    Description: ${description || 'No description provided.'}
    Primary Language: ${language || 'Not specified'}
    Topics: ${topics?.join(', ') || 'None'}

    Structure:
    1. Title & Badges
    2. Project Description (Expanded)
    3. Key Features
    4. Installation & Usage
    5. Contributing
    6. License

    Make it sound exciting and professional.`;

        const result = await aiService.model.generateContent(prompt);
        const text = result.response.text();

        res.json({ readme: text });
    } catch (error) {
        console.error('AI README Error:', error);
        res.status(500).json({ error: 'Failed to generate README' });
    }
});

// ------------------------------------------------------------------
// AI Indexing & Search
// ------------------------------------------------------------------

// Trigger Indexing (Summarize + Embed)
router.post('/ai/index', requireAuth, requireAI, async (req, res) => {
    const { repo } = req.body; // Full repo object from GitHub
    if (!repo) return res.status(400).json({ error: 'Repo data required' });

    try {
        console.log(`[AI Index] processing ${repo.full_name}...`);

        // 1. Fetch README
        let readmeContent = '';
        try {
            const { data } = await githubApi(`/repos/${repo.full_name}/readme`, req.session.accessToken);
            readmeContent = Buffer.from(data.content, 'base64').toString('utf-8');
        } catch (e) {
            console.warn(`No README for ${repo.full_name}`);
        }

        // 2. Fetch File Structure (Tree) -> getting top 20 items to save tokens
        let fileStructure = [];
        try {
            const { data } = await githubApi(`/repos/${repo.full_name}/contents`, req.session.accessToken);
            fileStructure = data.map(f => ({ name: f.name, type: f.type }));
        } catch (e) {
            console.warn(`Could not fetch contents for ${repo.full_name}`);
        }

        // 3. Generate Analysis (Summary, Health Score, Topics)
        const analysis = await aiService.analyzeRepo(repo, readmeContent, fileStructure);

        // 4. Generate Embedding (Description + Summary + Readme excerpt)
        const textToEmbed = `${repo.name} ${repo.description || ''} ${analysis.summary} ${analysis.suggested_topics.join(' ')}`;
        const embedding = await aiService.embedText(textToEmbed);

        // 5. Save to DB
        const stmtMeta = db.prepare(`
            INSERT INTO repo_metadata (repo_id, summary, topics, health_score, last_indexed)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(repo_id) DO UPDATE SET
                summary = excluded.summary,
                topics = excluded.topics,
                health_score = excluded.health_score,
                last_indexed = CURRENT_TIMESTAMP
        `);

        const stmtEmbed = db.prepare(`
            INSERT INTO repo_embeddings (repo_id, embedding, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(repo_id) DO UPDATE SET
                embedding = excluded.embedding,
                updated_at = CURRENT_TIMESTAMP
        `);

        db.transaction(() => {
            stmtMeta.run(repo.id, analysis.summary, JSON.stringify(analysis.suggested_topics), analysis.health_score);
            stmtEmbed.run(repo.id, JSON.stringify(embedding));
        })();

        res.json({ success: true, analysis });

    } catch (error) {
        console.error('Indexing failed:', error);
        res.status(500).json({ error: safeError(error, 'Indexing failed') });
    }
});

// Semantic Search Endpoint
router.get('/ai/search', requireAuth, requireAI, async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json([]);

    try {
        // Get generic results (repo_ids and scores)
        const results = await aiService.semanticSearch(q, 10);

        if (results.length === 0) return res.json([]);

        // Determine which IDs to fetch
        const repoIds = results.map(r => r.repo_id);

        const placeholders = repoIds.map(() => '?').join(',');
        const metas = db.prepare(`SELECT * FROM repo_metadata WHERE repo_id IN (${placeholders})`).all(...repoIds);

        // Merge score + metadata
        const enriched = results.map(r => {
            const meta = metas.find(m => m.repo_id === r.repo_id);
            return { ...r, ...meta };
        });

        res.json(enriched);

    } catch (error) {
        console.error('Semantic search failed:', error);
        res.status(500).json({ error: safeError(error, 'Search failed') });
    }
});

// Get Cached Metadata for a Repo
router.get('/ai/metadata/:repoId', requireAuth, (req, res) => {
    try {
        const meta = db.prepare('SELECT * FROM repo_metadata WHERE repo_id = ?').get(req.params.repoId);
        res.json(meta || null);
    } catch (error) {
        res.status(500).json({ error: safeError(error, 'Failed to fetch metadata') });
    }
});

// Enhanced README endpoint - Improve existing README
router.post('/ai/readme/enhance', requireAuth, requireAI, async (req, res) => {
    try {
        const { repo } = req.body;
        if (!repo) return res.status(400).json({ error: 'Repo data required' });

        // Fetch current README
        let readmeContent = '';
        try {
            const { data } = await githubApi(`/repos/${repo.full_name}/readme`, req.session.accessToken);
            readmeContent = Buffer.from(data.content, 'base64').toString('utf-8');
        } catch (e) {
            console.warn(`No README for ${repo.full_name}`);
        }

        // Fetch file structure
        let fileStructure = [];
        try {
            const { data } = await githubApi(`/repos/${repo.full_name}/contents`, req.session.accessToken);
            fileStructure = data.map(f => ({ name: f.name, type: f.type }));
        } catch (e) {
            console.warn(`Could not fetch contents for ${repo.full_name}`);
        }

        const result = await aiService.enhanceReadme(readmeContent, repo, fileStructure);
        res.json({ success: true, ...result, currentReadme: readmeContent });

    } catch (error) {
        console.error('README Enhancement Error:', error);
        res.status(500).json({ error: safeError(error, 'Failed to enhance README') });
    }
});

// Quality Report - Comprehensive repo health analysis
router.post('/ai/quality-report', requireAuth, requireAI, async (req, res) => {
    try {
        const { repo } = req.body;
        if (!repo) return res.status(400).json({ error: 'Repo data required' });

        // Fetch README
        let readmeContent = '';
        try {
            const { data } = await githubApi(`/repos/${repo.full_name}/readme`, req.session.accessToken);
            readmeContent = Buffer.from(data.content, 'base64').toString('utf-8');
        } catch (e) { /* No README */ }

        // Fetch file structure
        let fileStructure = [];
        try {
            const { data } = await githubApi(`/repos/${repo.full_name}/contents`, req.session.accessToken);
            fileStructure = data.map(f => ({ name: f.name, type: f.type }));
        } catch (e) { /* No contents */ }

        const report = await aiService.generateQualityReport(repo, readmeContent, fileStructure);
        res.json({ success: true, report, repo: repo.full_name });

    } catch (error) {
        console.error('Quality Report Error:', error);
        res.status(500).json({ error: safeError(error, 'Failed to generate quality report') });
    }
});

// Batch Index - Index multiple repos at once
router.post('/ai/batch-index', requireAuth, requireAI, async (req, res) => {
    const { repos } = req.body; // Array of repo objects
    if (!repos || !Array.isArray(repos)) {
        return res.status(400).json({ error: 'Array of repos required' });
    }

    const results = [];
    const limit = Math.min(repos.length, 10); // Max 10 at a time

    // Prepare statements outside the loop for better performance
    const insertMetadata = db.prepare(`
        INSERT INTO repo_metadata (repo_id, summary, topics, health_score, last_indexed)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(repo_id) DO UPDATE SET
            summary = excluded.summary, topics = excluded.topics,
            health_score = excluded.health_score, last_indexed = CURRENT_TIMESTAMP
    `);

    const insertEmbedding = db.prepare(`
        INSERT INTO repo_embeddings (repo_id, embedding, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(repo_id) DO UPDATE SET embedding = excluded.embedding, updated_at = CURRENT_TIMESTAMP
    `);

    // Transaction wrapper for batch inserts (100x faster than individual inserts)
    const batchInsertRepos = db.transaction((repoDataArray) => {
        for (const repoData of repoDataArray) {
            insertMetadata.run(
                repoData.repo.id,
                repoData.analysis.summary,
                JSON.stringify(repoData.analysis.suggested_topics),
                repoData.analysis.health_score
            );
            insertEmbedding.run(
                repoData.repo.id,
                JSON.stringify(repoData.embedding)
            );
        }
    });

    // Collect analyzed data for batch insert
    const analyzedRepos = [];

    for (let i = 0; i < limit; i++) {
        const repo = repos[i];
        try {
            // Fetch README
            let readmeContent = '';
            try {
                const { data } = await githubApi(`/repos/${repo.full_name}/readme`, req.session.accessToken);
                readmeContent = Buffer.from(data.content, 'base64').toString('utf-8');
            } catch (e) { /* No README */ }

            // Fetch file structure
            let fileStructure = [];
            try {
                const { data } = await githubApi(`/repos/${repo.full_name}/contents`, req.session.accessToken);
                fileStructure = data.map(f => ({ name: f.name, type: f.type }));
            } catch (e) { /* No contents */ }

            // Generate analysis
            const analysis = await aiService.analyzeRepo(repo, readmeContent, fileStructure);

            // Generate embedding
            const textToEmbed = `${repo.name} ${repo.description || ''} ${analysis.summary} ${analysis.suggested_topics?.join(' ') || ''}`;
            const embedding = await aiService.embedText(textToEmbed);

            // Store for batch insert
            analyzedRepos.push({ repo, analysis, embedding });
            results.push({ repo: repo.full_name, success: true, health_score: analysis.health_score });

        } catch (error) {
            console.error(`Batch index failed for ${repo.full_name}:`, error.message);
            results.push({ repo: repo.full_name, success: false, error: safeError(error, 'Analysis failed') });
        }
    }

    // Batch insert all successfully analyzed repos in a single transaction
    try {
        if (analyzedRepos.length > 0) {
            batchInsertRepos(analyzedRepos);
        }
    } catch (error) {
        console.error('Batch insert failed:', error);
        return res.status(500).json({ error: 'Failed to save indexed data' });
    }

    res.json({
        success: true,
        processed: results.length,
        results,
        skipped: repos.length > 10 ? repos.length - 10 : 0
    });
});

export default router;
