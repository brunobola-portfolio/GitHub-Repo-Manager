import express from 'express';
import { actionsService } from '../actions-service.js';
import { verifyWebhookSignature } from '../middleware/auth.js';

const router = express.Router();

// Webhook receiver for GitHub Actions events
// NOTE: This route does NOT use requireAuth - it is authenticated via webhook signature
router.post('/webhooks/actions', async (req, res) => {
    try {
        // Verify webhook signature if secret is configured
        const signature = req.headers['x-hub-signature-256'];
        if (!verifyWebhookSignature(req.body, signature)) {
            return res.status(401).json({ error: 'Invalid webhook signature' });
        }

        const payload = req.body;

        if (payload.action && payload.workflow_run) {
            actionsService.storeWorkflowRun(payload.workflow_run);
            actionsService.updateWorkflowMeta(
                payload.repository.id,
                payload.workflow_run.workflow_id
            );
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Webhook Processing Error:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

export default router;
