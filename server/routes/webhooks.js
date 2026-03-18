import express from 'express';
import logger from '../lib/logger.js';
import { actionsService } from '../actions-service.js';
import { verifyWebhookSignature, errorResponse } from '../middleware/auth.js';

const router = express.Router();

// Webhook receiver for GitHub Actions events
// NOTE: This route does NOT use requireAuth - it is authenticated via webhook signature
router.post('/webhooks/actions', async (req, res) => {
    try {
        // Validate Content-Type
        if (!req.is('application/json') && !req.is('json')) {
            return errorResponse(res, 415, 'Content-Type must be application/json');
        }

        // Verify webhook signature if secret is configured
        const signature = req.headers['x-hub-signature-256'];
        if (!verifyWebhookSignature(req.body, signature)) {
            return errorResponse(res, 401, 'Invalid webhook signature');
        }

        const payload = req.body;

        if (payload.action && payload.workflow_run) {
            if (!payload.repository?.id || !payload.workflow_run?.workflow_id) {
                return errorResponse(res, 400, 'Invalid webhook payload: missing repository or workflow data');
            }
            try {
                actionsService.storeWorkflowRun(payload.workflow_run);
                actionsService.updateWorkflowMeta(
                    payload.repository.id,
                    payload.workflow_run.workflow_id
                );
            } catch (serviceError) {
                logger.error({ err: serviceError }, 'Webhook service processing failed');
                // Still return success to GitHub so it doesn't retry
            }
        }

        res.json({ success: true });
    } catch (error) {
        logger.error({ err: error }, 'Webhook processing failed');
        errorResponse(res, 500, 'Webhook processing failed');
    }
});

export default router;
