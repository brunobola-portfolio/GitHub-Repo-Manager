import { GoogleGenerativeAI } from '@google/generative-ai';
import db from './db.js';

/**
 * Sanitize user-controlled text before interpolation into AI prompts.
 * Truncates to maxLen, strips null bytes, and returns empty string for falsy input.
 * @param {string} text
 * @param {number} maxLen
 * @returns {string}
 */
function sanitizeForPrompt(text, maxLen = 5000) {
    if (!text) return '';
    const cleaned = String(text).replace(/\0/g, '');
    return cleaned.slice(0, maxLen);
}

class AIService {
    constructor() {
        this.genAI = null;
        this.model = null;
        this.embeddingModel = null;
    }

    initialize(apiKey, modelName = null) {
        if (!apiKey) {
            console.warn('AI Service: No API key provided.');
            return;
        }
        
        try {
            this.genAI = new GoogleGenerativeAI(apiKey);
            
            // Use model from env or default to gemini-2.5-flash (stable)
            const model = modelName || process.env.GEMINI_MODEL || "gemini-2.5-flash";
            
            // Initialize models with error handling
            try {
                this.model = this.genAI.getGenerativeModel({ model });
                console.log(`✓ AI Service: Initialized with model: ${model}`);
            } catch (modelError) {
                console.error(`✗ AI Service: Failed to initialize model "${model}":`, modelError.message);
                console.warn(`  Suggestion: Verify GEMINI_MODEL in .env or try: gemini-2.0-flash-exp, gemini-1.5-flash, gemini-1.5-pro`);
                this.model = null;
            }
            
            // Initialize embedding model (separate from main model)
            try {
                const embeddingModel = process.env.GEMINI_EMBEDDING_MODEL || "text-embedding-004";
                this.embeddingModel = this.genAI.getGenerativeModel({ model: embeddingModel });
                console.log(`✓ AI Service: Embedding model initialized (${embeddingModel})`);
            } catch (embedError) {
                console.error(`✗ AI Service: Failed to initialize embedding model:`, embedError.message);
                console.warn(`  Suggestion: Verify GEMINI_EMBEDDING_MODEL in .env or try: text-embedding-004, embedding-001`);
                this.embeddingModel = null;
            }
        } catch (error) {
            console.error('✗ AI Service: Initialization failed:', error.message);
            this.genAI = null;
            this.model = null;
            this.embeddingModel = null;
        }
    }

    /**
     * Detect README sections and project characteristics
     * @param {string} readmeContent - Raw README markdown
     * @param {Array} fileStructure - Top-level files/dirs
     * @returns {object} Detected patterns
     */
    detectPatterns(readmeContent, fileStructure) {
        const readme = (readmeContent || '').toLowerCase();
        const files = (fileStructure || []).map(f => f.name?.toLowerCase() || '');
        const dirs = fileStructure?.filter(f => f.type === 'dir').map(f => f.name?.toLowerCase()) || [];

        return {
            // README sections
            hasInstallation: /## install|## setup|npm install|yarn add|pip install/.test(readme),
            hasUsage: /## usage|## getting started|## how to use/.test(readme),
            hasExamples: /## example|```/.test(readme),
            hasContributing: /## contribut|contributing\.md/.test(readme) || files.includes('contributing.md'),
            hasLicense: /## license|license\.md|mit license|apache/.test(readme) || files.includes('license') || files.includes('license.md'),
            hasAPI: /## api|## endpoints|## methods/.test(readme),
            hasBadges: /\[!\[|shields\.io|badge/.test(readme),
            hasTableOfContents: /## table of contents|\* \[/.test(readme),

            // Project characteristics
            hasCI: files.some(f => f.includes('workflow') || f === '.travis.yml' || f === '.circleci') || dirs.includes('.github'),
            hasTests: dirs.some(d => ['test', 'tests', '__tests__', 'spec'].includes(d)) || files.some(f => f.includes('.test.') || f.includes('.spec.')),
            hasDocs: dirs.includes('docs') || dirs.includes('documentation'),
            hasDocker: files.includes('dockerfile') || files.includes('docker-compose.yml') || files.includes('docker-compose.yaml'),
            hasConfig: files.some(f => f.includes('config') || f.endsWith('.json') || f.endsWith('.yaml') || f.endsWith('.yml')),

            // Project type hints
            isNodeProject: files.includes('package.json'),
            isPythonProject: files.includes('requirements.txt') || files.includes('setup.py') || files.includes('pyproject.toml'),
            isRustProject: files.includes('cargo.toml'),
            isGoProject: files.includes('go.mod'),
            isJavaProject: files.includes('pom.xml') || files.includes('build.gradle'),
        };
    }

    /**
     * Calculate quality metrics from detected patterns
     * @param {object} patterns - Output from detectPatterns
     * @param {object} repoData - GitHub repo metadata
     * @returns {object} Quality metrics
     */
    calculateQualityMetrics(patterns, repoData) {
        let score = 50; // Base score
        const breakdown = {};

        // Documentation (30 points max)
        let docScore = 0;
        if (patterns.hasInstallation) docScore += 8;
        if (patterns.hasUsage) docScore += 8;
        if (patterns.hasExamples) docScore += 7;
        if (patterns.hasAPI) docScore += 7;
        breakdown.documentation = Math.min(docScore, 30);
        score += breakdown.documentation;

        // Community Standards (20 points max)
        let communityScore = 0;
        if (patterns.hasContributing) communityScore += 7;
        if (patterns.hasLicense) communityScore += 7;
        if (repoData?.description) communityScore += 6;
        breakdown.community = Math.min(communityScore, 20);
        score += breakdown.community - 10; // Adjust base

        // Engineering (20 points max)
        let engScore = 0;
        if (patterns.hasCI) engScore += 10;
        if (patterns.hasTests) engScore += 10;
        breakdown.engineering = Math.min(engScore, 20);
        score += breakdown.engineering;

        // Polish (10 points max)
        let polishScore = 0;
        if (patterns.hasBadges) polishScore += 5;
        if (patterns.hasTableOfContents) polishScore += 5;
        breakdown.polish = Math.min(polishScore, 10);
        score += breakdown.polish;

        return {
            overall: Math.max(0, Math.min(100, score)),
            breakdown,
            patterns
        };
    }

    /**
     * Generate an embedding for a given text.
     * @param {string} text
     * @returns {Promise<number[]>} Vector array
     */
    async embedText(text) {
        if (!this.embeddingModel) {
            throw new Error('AI embedding model not initialized. Please check GEMINI_API_KEY configuration.');
        }

        try {
            const result = await this.embeddingModel.embedContent(text);
            return result.embedding.values;
        } catch (error) {
            console.error('Embedding generation failed:', error);
            if (error.message?.includes('not found') || error.status === 404) {
                const embeddingModel = process.env.GEMINI_EMBEDDING_MODEL || "text-embedding-004";
                throw new Error(`Embedding model "${embeddingModel}" is not available. Please verify your API access and GEMINI_EMBEDDING_MODEL configuration.`);
            }
            throw error;
        }
    }

    /**
     * Calculate Cosine Similarity between two vectors
     * @param {number[]} vecA 
     * @param {number[]} vecB 
     * @returns {number} similarity score (-1 to 1)
     */
    cosineSimilarity(vecA, vecB) {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Search usage natural language
     * @param {string} query
     * @param {number} limit
     * @param {number} [userId] - Tenant user ID to scope results (omit for all)
     */
    async semanticSearch(query, limit = 5, userId) {
        if (!this.embeddingModel) return [];

        // 1. Embed the query
        const queryEmbedding = await this.embedText(query);

        // 2. Fetch repo embeddings scoped by user (multi-tenancy)
        // Note: For large datasets, this is inefficient. optimize with FAISS or vector DB.
        let rows;
        if (userId !== undefined && userId !== null) {
            rows = db.prepare('SELECT repo_id, embedding FROM repo_embeddings WHERE user_id = ?').all(userId);
        } else {
            rows = db.prepare('SELECT repo_id, embedding FROM repo_embeddings').all();
        }

        // 3. Rank by similarity
        const results = rows.map(row => {
            const embedding = JSON.parse(row.embedding);
            const score = this.cosineSimilarity(queryEmbedding, embedding);
            return { repo_id: row.repo_id, score };
        });

        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    /**
     * Generate a summary and insights for a repository (enhanced version)
     * @param {object} repoData - GitHub repo object
     * @param {string} readmeContent - Raw README text
     * @param {object} fileStructure - truncated file tree
     */
    async analyzeRepo(repoData, readmeContent, fileStructure) {
        if (!this.model) {
            throw new Error('AI model not initialized. Please check GEMINI_API_KEY and GEMINI_MODEL configuration.');
        }

        // Detect patterns first
        const patterns = this.detectPatterns(readmeContent, fileStructure);
        const quality = this.calculateQualityMetrics(patterns, repoData);

        const prompt = `
            Analyze this GitHub repository and provide insights.

            Name: ${sanitizeForPrompt(repoData.name, 200)}
            Description: ${sanitizeForPrompt(repoData.description, 500) || 'None'}
            Language: ${sanitizeForPrompt(repoData.language, 100) || 'Not specified'}
            Topics: ${sanitizeForPrompt(repoData.topics?.join(', '), 500) || 'None'}
            Stars: ${repoData.stargazers_count || 0}
            Forks: ${repoData.forks_count || 0}
            Open Issues: ${repoData.open_issues_count || 0}

            README (Excerpt):
            ${sanitizeForPrompt(readmeContent, 2500) || 'No README found'}

            File Structure:
            ${sanitizeForPrompt(JSON.stringify(fileStructure || [], null, 2), 3000)}

            Detected Patterns:
            - Has installation docs: ${patterns.hasInstallation}
            - Has usage examples: ${patterns.hasUsage}
            - Has CI/CD: ${patterns.hasCI}
            - Has tests: ${patterns.hasTests}
            - Has contributing guide: ${patterns.hasContributing}
            - Has license: ${patterns.hasLicense}

            Provide a JSON response with:
            1. "summary": TL;DR (2 sentences max, focus on what it does and who it's for)
            2. "project_type": One of [library, framework, application, tool, template, documentation, other]
            3. "suggested_topics": Array of 3-5 relevant tags not already in topics
            4. "improvements": Array of 3-4 specific, actionable improvements based on what's missing
            5. "readme_suggestions": Array of specific README sections to add (if any are missing)
            6. "highlights": Array of 2-3 positive aspects of the project

            Return ONLY valid JSON (no markdown, no explanation):
        `;

        try {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
            const aiAnalysis = JSON.parse(text);

            // Merge AI analysis with computed metrics
            return {
                ...aiAnalysis,
                health_score: quality.overall,
                quality_breakdown: quality.breakdown,
                patterns: quality.patterns
            };
        } catch (error) {
            console.error('Repository analysis failed:', error);
            if (error.message?.includes('not found') || error.status === 404) {
                throw new Error(`AI model not available. Please verify GEMINI_MODEL configuration in .env file.`);
            }
            throw error;
        }
    }

    /**
     * Enhance an existing README with AI suggestions
     * @param {string} currentReadme - Current README content
     * @param {object} repoData - Repository metadata
     * @param {object} fileStructure - File tree
     */
    async enhanceReadme(currentReadme, repoData, fileStructure) {
        if (!this.model) {
            throw new Error('AI model not initialized. Please check GEMINI_API_KEY and GEMINI_MODEL configuration.');
        }

        const patterns = this.detectPatterns(currentReadme, fileStructure);
        const missingSections = [];
        if (!patterns.hasInstallation) missingSections.push('Installation');
        if (!patterns.hasUsage) missingSections.push('Usage');
        if (!patterns.hasExamples) missingSections.push('Examples');
        if (!patterns.hasContributing) missingSections.push('Contributing');
        if (!patterns.hasLicense) missingSections.push('License');
        if (!patterns.hasAPI && repoData.language) missingSections.push('API Reference');

        const prompt = `
            You are a technical writer improving a GitHub README.

            Project: ${sanitizeForPrompt(repoData.name, 200)}
            Language: ${sanitizeForPrompt(repoData.language, 100) || 'Not specified'}
            Description: ${sanitizeForPrompt(repoData.description, 500) || 'None provided'}

            Current README:
            ${sanitizeForPrompt(currentReadme, 3000) || 'Empty README'}

            Missing Sections: ${missingSections.join(', ') || 'None detected'}

            Task: Generate ONLY the missing sections as markdown.
            - Use professional, clear language
            - Include placeholder examples where appropriate
            - Make installation instructions specific to ${sanitizeForPrompt(repoData.language, 100) || 'the project'}
            - Each section should start with ## heading

            Return ONLY the markdown for missing sections (no existing content, no JSON wrapper).
        `;

        try {
            const result = await this.model.generateContent(prompt);
            return {
                enhancement: result.response.text(),
                missingSections,
                patterns
            };
        } catch (error) {
            console.error('README enhancement failed:', error);
            if (error.message?.includes('not found') || error.status === 404) {
                throw new Error(`AI model not available. Please verify GEMINI_MODEL configuration in .env file.`);
            }
            throw error;
        }
    }

    /**
     * Generate a comprehensive quality report
     * @param {object} repoData - Repository data with extended info
     * @param {string} readmeContent - README content
     * @param {Array} fileStructure - File tree
     * @param {object} extraData - CI status, issues, etc.
     */
    async generateQualityReport(repoData, readmeContent, fileStructure, _extraData = {}) {
        const patterns = this.detectPatterns(readmeContent, fileStructure);
        const quality = this.calculateQualityMetrics(patterns, repoData);

        // Build recommendations based on what's missing
        const recommendations = [];
        if (!patterns.hasInstallation) recommendations.push({ priority: 'high', action: 'Add installation instructions to README' });
        if (!patterns.hasUsage) recommendations.push({ priority: 'high', action: 'Add usage examples to README' });
        if (!patterns.hasTests) recommendations.push({ priority: 'high', action: 'Add unit tests to improve reliability' });
        if (!patterns.hasCI) recommendations.push({ priority: 'medium', action: 'Set up CI/CD with GitHub Actions' });
        if (!patterns.hasContributing) recommendations.push({ priority: 'medium', action: 'Add CONTRIBUTING.md for community guidelines' });
        if (!patterns.hasLicense) recommendations.push({ priority: 'high', action: 'Add a LICENSE file' });
        if (!patterns.hasBadges) recommendations.push({ priority: 'low', action: 'Add status badges to README' });
        if (!repoData.description) recommendations.push({ priority: 'high', action: 'Add a repository description' });
        if (!repoData.topics?.length) recommendations.push({ priority: 'medium', action: 'Add topics/tags for discoverability' });

        return {
            score: quality.overall,
            breakdown: quality.breakdown,
            patterns,
            recommendations: recommendations.sort((a, b) => {
                const order = { high: 0, medium: 1, low: 2 };
                return order[a.priority] - order[b.priority];
            }),
            summary: this.getScoreSummary(quality.overall)
        };
    }

    getScoreSummary(score) {
        if (score >= 90) return 'Excellent! This repository follows best practices.';
        if (score >= 75) return 'Good quality. A few improvements would make it great.';
        if (score >= 50) return 'Decent foundation. Consider adding documentation and tests.';
        return 'Needs attention. Focus on documentation and community standards.';
    }
}

export const aiService = new AIService();
