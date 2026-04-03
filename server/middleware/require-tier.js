import db from '../db.js';
import { getTierOrder } from '../lib/feature-flags.js';

export function getUserTier(userId) {
    if (!userId) return 'free';
    const row = db.prepare(
        'SELECT tier FROM user_subscriptions WHERE user_id = ? AND status = ?'
    ).get(userId, 'active');
    return row?.tier || 'free';
}

export function requireTier(minTier) {
    const minOrder = getTierOrder(minTier);
    return (req, res, next) => {
        const userTier = getUserTier(req.session?.userId || req.tenantId);
        req.userTier = userTier;
        if (getTierOrder(userTier) >= minOrder) return next();
        return res.status(403).json({
            error: 'upgrade_required',
            message: `This feature requires the ${minTier} plan`,
            currentTier: userTier,
            requiredTier: minTier,
        });
    };
}

export function attachTier(req, res, next) {
    req.userTier = getUserTier(req.session?.userId || req.tenantId);
    next();
}
