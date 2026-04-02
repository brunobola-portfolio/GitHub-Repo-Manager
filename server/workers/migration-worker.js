import logger from '../lib/logger.js';

export function createMigrationProcessor(migrationEngine) {
    return async function processMigrationJob(job) {
        const { planId, accessToken } = job.data;
        logger.info({ planId, jobId: job.id }, 'Migration worker processing plan');

        try {
            await migrationEngine.executePlan(planId, accessToken);
        } catch (err) {
            logger.error({ planId, err }, 'Migration worker failed');
            throw err;
        }
    };
}
