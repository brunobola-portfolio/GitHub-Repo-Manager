import db from '../db.js';
import logger from './logger.js';

export function auditLog(req, action, resourceType, resourceId, details = {}) {
    try {
        db.prepare(`
            INSERT INTO audit_log_v2 (user_id, action, resource_type, resource_id, details, ip_address, user_agent, api_key_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            req.tenantId || req.session?.userId || 0,
            action,
            resourceType,
            String(resourceId || ''),
            JSON.stringify(details),
            req.ip || req.headers?.['x-forwarded-for'] || '',
            req.headers?.['user-agent'] || '',
            req.apiKeyId || null
        );
    } catch (err) {
        logger.error({ err, action, resourceType }, 'Failed to write audit log');
    }
}
