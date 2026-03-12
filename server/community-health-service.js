import db from './db.js';
import { githubApi } from './lib/github-api.js';

class CommunityHealthService {
    /**
     * Analyze repository community health
     */
    async analyzeRepository(owner, repo, token) {
        const repoData = await this.fetchRepoData(owner, repo, token);
        const files = await this.checkCommunityFiles(owner, repo, token);
        const activity = await this.getActivityMetrics(owner, repo, token);
        
        const metrics = {
            files,
            activity,
            healthScore: this.calculateHealthScore(files, activity, repoData)
        };
        
        const recommendations = this.generateRecommendations(files, activity);
        
        return { metrics, recommendations, analyzedAt: new Date().toISOString() };
    }

    async fetchRepoData(owner, repo, token) {
        const { data } = await githubApi(`/repos/${owner}/${repo}`, token);
        return data;
    }

    async checkCommunityFiles(owner, repo, token) {
        const filesToCheck = [
            'README.md', 'LICENSE', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md',
            'SECURITY.md', '.github/ISSUE_TEMPLATE', '.github/PULL_REQUEST_TEMPLATE.md'
        ];

        const results = {};

        for (const file of filesToCheck) {
            try {
                const { data } = await githubApi(`/repos/${owner}/${repo}/contents/${file}`, token);
                results[file] = { exists: true, size: data.size || 0 };
            } catch {
                results[file] = { exists: false, size: 0 };
            }
        }

        return results;
    }

    async getActivityMetrics(owner, repo, token) {
        let contributors = [];
        try {
            const result = await githubApi(`/repos/${owner}/${repo}/contributors?per_page=100`, token);
            contributors = result.data;
        } catch { /* empty */ }

        let commits = [];
        try {
            const since = new Date();
            since.setDate(since.getDate() - 30);
            const result = await githubApi(`/repos/${owner}/${repo}/commits?since=${since.toISOString()}&per_page=100`, token);
            commits = result.data;
        } catch { /* empty */ }

        let issues = [];
        try {
            const result = await githubApi(`/repos/${owner}/${repo}/issues?state=all&per_page=100`, token);
            issues = result.data;
        } catch { /* empty */ }

        return {
            contributorCount: Array.isArray(contributors) ? contributors.length : 0,
            commitsLast30Days: Array.isArray(commits) ? commits.length : 0,
            openIssues: Array.isArray(issues) ? issues.filter(i => i.state === 'open' && !i.pull_request).length : 0,
            closedIssues: Array.isArray(issues) ? issues.filter(i => i.state === 'closed' && !i.pull_request).length : 0
        };
    }

    calculateHealthScore(files, activity, repoData) {
        let score = 50; // Base score
        
        // Documentation (30 points)
        if (files['README.md']?.exists) score += 10;
        if (files['README.md']?.size > 1000) score += 5; // Quality bonus
        if (files['CONTRIBUTING.md']?.exists) score += 8;
        if (files['CODE_OF_CONDUCT.md']?.exists) score += 7;
        
        // Legal & Security (15 points)
        if (files['LICENSE']?.exists) score += 10;
        if (files['SECURITY.md']?.exists) score += 5;
        
        // Templates (10 points)
        if (files['.github/ISSUE_TEMPLATE']?.exists) score += 5;
        if (files['.github/PULL_REQUEST_TEMPLATE.md']?.exists) score += 5;
        
        // Activity (25 points)
        if (activity.contributorCount > 0) score += Math.min(activity.contributorCount * 2, 10);
        if (activity.commitsLast30Days > 0) score += Math.min(activity.commitsLast30Days / 5, 10);
        
        const issueTotal = activity.openIssues + activity.closedIssues;
        const closeRate = issueTotal > 0 ? activity.closedIssues / issueTotal : 0;
        score += closeRate * 5;
        
        // Engagement (20 points)
        if (repoData.description) score += 3;
        if (repoData.topics && repoData.topics.length > 0) score += 5;
        if (repoData.stargazers_count > 10) score += Math.min(repoData.stargazers_count / 10, 5);
        if (repoData.forks_count > 5) score += Math.min(repoData.forks_count / 5, 5);
        if (repoData.has_wiki) score += 2;
        
        return Math.min(Math.round(score), 100);
    }

    generateRecommendations(files, activity) {
        const recommendations = [];
        
        if (!files['README.md']?.exists) {
            recommendations.push({ priority: 'high', action: 'Add a README.md file', category: 'documentation' });
        } else if (files['README.md'].size < 500) {
            recommendations.push({ priority: 'medium', action: 'Improve README with more details', category: 'documentation' });
        }
        
        if (!files['LICENSE']?.exists) {
            recommendations.push({ priority: 'high', action: 'Add a LICENSE file', category: 'legal' });
        }
        
        if (!files['CONTRIBUTING.md']?.exists) {
            recommendations.push({ priority: 'medium', action: 'Add CONTRIBUTING.md for community guidelines', category: 'documentation' });
        }
        
        if (!files['CODE_OF_CONDUCT.md']?.exists) {
            recommendations.push({ priority: 'medium', action: 'Add CODE_OF_CONDUCT.md', category: 'community' });
        }
        
        if (!files['SECURITY.md']?.exists) {
            recommendations.push({ priority: 'high', action: 'Add SECURITY.md for vulnerability reporting', category: 'security' });
        }
        
        if (!files['.github/ISSUE_TEMPLATE']?.exists) {
            recommendations.push({ priority: 'low', action: 'Add issue templates', category: 'templates' });
        }
        
        if (!files['.github/PULL_REQUEST_TEMPLATE.md']?.exists) {
            recommendations.push({ priority: 'low', action: 'Add PR template', category: 'templates' });
        }
        
        if (activity.contributorCount < 3) {
            recommendations.push({ priority: 'medium', action: 'Encourage more contributors', category: 'community' });
        }
        
        if (activity.commitsLast30Days < 5) {
            recommendations.push({ priority: 'low', action: 'Increase commit frequency', category: 'activity' });
        }
        
        return recommendations.sort((a, b) => {
            const order = { high: 0, medium: 1, low: 2 };
            return order[a.priority] - order[b.priority];
        });
    }

    /**
     * Cache results in database
     */
    cacheResults(repoId, metrics, recommendations) {
        const stmt = db.prepare(`
            INSERT INTO community_health_cache (
                repo_id, health_score, metrics, recommendations, analyzed_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(repo_id) DO UPDATE SET
                health_score = excluded.health_score,
                metrics = excluded.metrics,
                recommendations = excluded.recommendations,
                analyzed_at = excluded.analyzed_at
        `);
        
        stmt.run(
            repoId,
            metrics.healthScore,
            JSON.stringify(metrics),
            JSON.stringify(recommendations),
            new Date().toISOString()
        );
    }
}

export const communityHealthService = new CommunityHealthService();
