import logger from '../lib/logger.js';

export function createAIProcessor(aiService) {
    return async function processAIJob(job) {
        const { type, data } = job.data;
        logger.info({ type, jobId: job.id }, 'AI worker processing job');

        switch (type) {
            case 'index-repo':
                await aiService.indexRepository(data.repoId, data.repoData);
                break;
            case 'batch-index':
                for (const repo of data.repos) {
                    await aiService.indexRepository(repo.id, repo);
                    if (job.updateProgress) {
                        await job.updateProgress(repo.progress || 0);
                    }
                }
                break;
            default:
                logger.warn({ type }, 'Unknown AI job type');
        }
    };
}
