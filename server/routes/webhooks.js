import express from 'express';
import logger from '../lib/logger.js';
import { actionsService } from '../actions-service.js';
import { verifyWebhookSignature, errorResponse } from '../middleware/auth.js';

const router = express.Router();

/**
 * Webhook handler for GitHub Actions events.
 * Expects raw body (Buffer) for correct HMAC signature verification.
 * Mounted directly on the app BEFORE express.json() in index.js.
 */
export async function actionsWebhookHandler(req, res) {
    try {
        // Verify webhook signature against raw body (before JSON parsing)
        const signature = req.headers['x-hub-signature-256'];
        if (!verifyWebhookSignature(req.body, signature)) {
            return errorResponse(res, 401, 'Invalid webhook signature');
        }

        // Parse raw body after signature verification
        let payload;
        try {
            payload = JSON.parse(req.body);
        } catch {
            return errorResponse(res, 400, 'Invalid JSON payload');
        }

        if (payload.action && payload.workflow_run) {
            if (!payload.repository?.id || !payload.workflow_run?.workflow_id) {
                return errorResponse(res, 400, 'Invalid webhook payload: missing repository or workflow data');
            }
            // Propagate persistence failures. GitHub will retry on 5xx which
            // is what we want — silently returning 200 on DB failure previously
            // caused events to be lost with no replay path.
            actionsService.storeWorkflowRun(payload.workflow_run);
            actionsService.updateWorkflowMeta(
                payload.repository.id,
                payload.workflow_run.workflow_id
            );
        }

        res.json({ success: true });
    } catch (error) {
        logger.error({ err: error }, 'Webhook processing failed');
        errorResponse(res, 500, 'Webhook processing failed');
    }
}

export default router;
