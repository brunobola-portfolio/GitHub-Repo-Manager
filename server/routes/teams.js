import express from 'express';
import db from '../db.js';
import { githubApi } from '../lib/github-api.js';
import { requireAuth, safeError, errorResponse } from '../middleware/auth.js';
import { validate, teamCreateSchema, teamMemberSchema, teamRepoSchema } from '../lib/validators.js';

const router = express.Router();

// List my teams
router.get('/', requireAuth, (req, res) => {
    try {
        const teams = db.prepare(`
            SELECT t.*, tm.role,
            (SELECT COUNT(*) FROM team_members WHERE team_id = t.id) as member_count,
            (SELECT COUNT(*) FROM repo_assignments WHERE team_id = t.id) as repo_count
            FROM teams t
            JOIN team_members tm ON t.id = tm.team_id
            WHERE tm.user_id = ?
            ORDER BY t.created_at DESC
        `).all(req.session.userId);
        res.json(teams);
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Operation failed'));
    }
});

// Create a team
router.post('/', requireAuth, validate(teamCreateSchema), (req, res) => {
    const { name, description } = req.body;

    try {
        const result = db.transaction(() => {
            const insertTeam = db.prepare('INSERT INTO teams (name, description, owner_id) VALUES (?, ?, ?)');
            const info = insertTeam.run(name, description, req.session.userId);
            const teamId = info.lastInsertRowid;

            const insertMember = db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)');
            insertMember.run(teamId, req.session.userId, 'owner');
            return teamId;
        })();

        res.json({ success: true, teamId: result });
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Operation failed'));
    }
});

// Update a team
router.put('/:id', requireAuth, validate(teamCreateSchema), (req, res) => {
    const { name, description } = req.body;
    const { id } = req.params;

    try {
        // Verify ownership/admin
        const membership = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(id, req.session.userId);
        if (!membership || membership.role === 'member') return errorResponse(res, 403, 'Admin access required', 'FORBIDDEN');

        const updateKey = db.prepare('UPDATE teams SET name = ?, description = ? WHERE id = ?');
        const info = updateKey.run(name, description, id);

        if (info.changes === 0) return errorResponse(res, 404, 'Team not found', 'NOT_FOUND');
        res.json({ success: true });
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Operation failed'));
    }
});

// Delete a team
router.delete('/:id', requireAuth, (req, res) => {
    const { id } = req.params;

    try {
        // Verify ownership (only owner can delete)
        const membership = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(id, req.session.userId);
        if (!membership || membership.role !== 'owner') return errorResponse(res, 403, 'Owner access required', 'FORBIDDEN');

        // Capture team name before deletion for audit log
        const team = db.prepare('SELECT name FROM teams WHERE id = ?').get(id);

        const result = db.transaction(() => {
            db.prepare('DELETE FROM team_members WHERE team_id = ?').run(id);
            db.prepare('DELETE FROM repo_assignments WHERE team_id = ?').run(id);
            const info = db.prepare('DELETE FROM teams WHERE id = ?').run(id);
            return info;
        })();

        if (result.changes === 0) return errorResponse(res, 404, 'Team not found', 'NOT_FOUND');
        res.json({ success: true });

        // Audit log: record team deletion
        try {
            db.prepare('INSERT INTO audit_log (user_id, action, target, details) VALUES (?, ?, ?, ?)').run(
                req.session.userId, 'TEAM_DELETE', id, JSON.stringify({ name: team?.name })
            );
        } catch (auditErr) {
            req.log?.error?.({ err: auditErr }, 'Audit log write failed');
        }
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Operation failed'));
    }
});

// Get team details (members & repos)
router.get('/:id', requireAuth, (req, res) => {
    try {
        // Verify membership
        const membership = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!membership) return errorResponse(res, 403, 'Access denied', 'FORBIDDEN');

        const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(req.params.id);
        const members = db.prepare(`
            SELECT u.id, u.username, u.avatar_url, tm.role, tm.joined_at
            FROM team_members tm
            JOIN users u ON tm.user_id = u.id
            WHERE tm.team_id = ?
        `).all(req.params.id);

        const repos = db.prepare(`
            SELECT * FROM repo_assignments WHERE team_id = ?
        `).all(req.params.id);

        res.json({ team, members, repos, currentUserRole: membership.role });
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Operation failed'));
    }
});

// Add Member (Simulated Invite by Username)
router.post('/:id/members', requireAuth, validate(teamMemberSchema), async (req, res) => {
    const { username } = req.body;

    try {
        // Check Admin/Owner permission
        const membership = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!membership || membership.role === 'member') return errorResponse(res, 403, 'Admin access required', 'FORBIDDEN');

        // Check if user exists in our local DB
        // If not, we could search GitHub and add to cache, but for now strict local check or partial add
        let user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

        // If user not found locally, try to fetch from GitHub to "cache" them
        if (!user) {
            try {
                const { data: ghUser } = await githubApi(`/users/${username}`, req.session.accessToken);
                db.prepare(`
                    INSERT INTO users (id, username, avatar_url, email)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET username=excluded.username
                `).run(ghUser.id, ghUser.login, ghUser.avatar_url, ghUser.email);
                user = { id: ghUser.id };
            } catch (e) {
                return errorResponse(res, 404, 'User not found on GitHub', 'USER_NOT_FOUND');
            }
        }

        // Add to team
        db.prepare(`
            INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, 'member')
        `).run(req.params.id, user.id);

        res.json({ success: true });

        // Audit log: record member addition
        try {
            db.prepare('INSERT INTO audit_log (user_id, action, target, details) VALUES (?, ?, ?, ?)').run(
                req.session.userId, 'TEAM_MEMBER_ADD', req.params.id, JSON.stringify({ username, role: 'member' })
            );
        } catch (auditErr) {
            req.log?.error?.({ err: auditErr }, 'Audit log write failed');
        }
    } catch (error) {
        if (error.message.includes('UNIQUE constraint failed')) {
            return errorResponse(res, 400, 'User is already a member', 'DUPLICATE_MEMBER');
        }
        errorResponse(res, 500, safeError(error, 'Operation failed'));
    }
});

// Update Member Role
router.put('/:id/members/:userId', requireAuth, (req, res) => {
    const { role } = req.body;
    if (!['admin', 'member'].includes(role)) return errorResponse(res, 400, 'Invalid role', 'INVALID_ROLE');

    try {
        // Check requester permissions (must be owner or admin)
        const requester = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
            return errorResponse(res, 403, 'Permission denied', 'FORBIDDEN');
        }

        // Prevent changing owner's role
        const target = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(req.params.id, req.params.userId);
        if (target && target.role === 'owner') return errorResponse(res, 403, 'Cannot change owner role', 'FORBIDDEN');

        db.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?')
            .run(role, req.params.id, req.params.userId);

        res.json({ success: true });
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Operation failed'));
    }
});

// Remove Member
router.delete('/:id/members/:userId', requireAuth, (req, res) => {
    try {
        // Check requester permissions
        const requester = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!requester || (requester.role !== 'owner' && requester.role !== 'admin')) {
            return errorResponse(res, 403, 'Permission denied', 'FORBIDDEN');
        }

        // Prevent removing owner
        const target = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(req.params.id, req.params.userId);
        if (target && target.role === 'owner') return errorResponse(res, 403, 'Cannot remove owner', 'FORBIDDEN');

        // Check if removing self (leave team) vs removing others
        if (req.params.userId != req.session.userId) {
            if (requester.role === 'member') return errorResponse(res, 403, 'Cannot remove others', 'FORBIDDEN');
        }

        db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?')
            .run(req.params.id, req.params.userId);

        res.json({ success: true });

        // Audit log: record member removal
        try {
            db.prepare('INSERT INTO audit_log (user_id, action, target, details) VALUES (?, ?, ?, ?)').run(
                req.session.userId, 'TEAM_MEMBER_REMOVE', req.params.id, JSON.stringify({ userId: req.params.userId })
            );
        } catch (auditErr) {
            req.log?.error?.({ err: auditErr }, 'Audit log write failed');
        }
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Operation failed'));
    }
});

// Assign Repo to Team
router.post('/:id/repos', requireAuth, validate(teamRepoSchema), (req, res) => {
    const { repoFullName, repoId } = req.body;
    try {
        // Verify membership and admin/owner role
        const membership = db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').get(req.params.id, req.session.userId);
        if (!membership) return errorResponse(res, 403, 'Access denied', 'FORBIDDEN');
        if (membership.role === 'member') return errorResponse(res, 403, 'Admin access required to assign repositories', 'FORBIDDEN');

        db.prepare(`
            INSERT INTO repo_assignments (team_id, repo_full_name, repo_id, assigned_by)
            VALUES (?, ?, ?, ?)
        `).run(req.params.id, repoFullName, repoId, req.session.userId);

        res.json({ success: true });
    } catch (error) {
        errorResponse(res, 500, safeError(error, 'Operation failed'));
    }
});

export default router;
