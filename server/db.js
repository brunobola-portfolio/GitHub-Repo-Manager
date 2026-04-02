import { createDatabaseAdapter } from './lib/db-adapter.js';

// ---------------------------------------------------------------------------
// Initialise the database adapter.
//
// For SQLite (the default), this creates a thin wrapper around better-sqlite3
// that preserves the synchronous `db.prepare('SQL').get/all/run()` API used
// by every route in the codebase.
//
// For PostgreSQL (when DATABASE_URL is set), the adapter uses node-postgres
// and exposes the same interface with async methods.
//
// Top-level await is supported because the project uses ESM ("type": "module").
// ---------------------------------------------------------------------------
const db = await createDatabaseAdapter();

export function initDB() {
    const transactions = db.transaction(() => {
        // Multi-tenancy migration: add user_id to tables that need it
        // If tables exist without user_id, drop and recreate them
        const tablesNeedingUserId = ['repo_metadata', 'repo_embeddings', 'community_health_cache', 'workflow_runs', 'workflows_meta'];
        for (const table of tablesNeedingUserId) {
            const cols = db.prepare(`PRAGMA table_info(${table})`).all();
            const hasUserId = cols.some(c => c.name === 'user_id');
            if (!hasUserId && cols.length > 0) {
                // Table exists but lacks user_id - recreate
                db.exec(`DROP TABLE IF EXISTS ${table}`);
            }
        }
        // Users Table (Local cache of GitHub users)
        db.exec(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY, -- GitHub ID
                username TEXT NOT NULL,
                avatar_url TEXT,
                email TEXT,
                last_login TEXT DEFAULT CURRENT_TIMESTAMP,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Teams Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS teams (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                owner_id INTEGER NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Team Members Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS team_members (
                team_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                role TEXT CHECK(role IN ('owner', 'admin', 'member')) DEFAULT 'member',
                joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (team_id, user_id),
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Repo Assignments Table
        db.exec(`
            CREATE TABLE IF NOT EXISTS repo_assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                team_id INTEGER NOT NULL,
                repo_full_name TEXT NOT NULL, -- e.g. "owner/repo"
                repo_id INTEGER NOT NULL,      -- GitHub Repo ID
                assigned_by INTEGER NOT NULL,
                assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
                FOREIGN KEY (assigned_by) REFERENCES users(id)
            )
        `);

        // System Meta Table (For Setup Tracking)
        db.exec(`
            CREATE TABLE IF NOT EXISTS system_meta (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // AI Metadata Table (Cache for summarization)
        // Note: No foreign key - we can index any repo, not just assigned ones
        db.exec(`
            CREATE TABLE IF NOT EXISTS repo_metadata (
                repo_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL DEFAULT 0,
                summary TEXT,
                topics TEXT, -- JSON array
                health_score INTEGER,
                last_indexed TEXT,
                PRIMARY KEY (user_id, repo_id)
            )
        `);

        // Vector Embeddings Table
        // We store the embedding as a JSON string for simplicity in SQLite
        // (For production with millions of rows, use a vector extension or specialized DB)
        db.exec(`
            CREATE TABLE IF NOT EXISTS repo_embeddings (
                repo_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL DEFAULT 0,
                embedding TEXT NOT NULL, -- JSON string of float array
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, repo_id)
            )
        `);

        // Actions Statistics Tables
        db.exec(`
            CREATE TABLE IF NOT EXISTS workflow_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                github_run_id INTEGER UNIQUE NOT NULL,
                repo_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL DEFAULT 0,
                workflow_id INTEGER NOT NULL,
                workflow_name TEXT NOT NULL,
                run_number INTEGER NOT NULL,
                status TEXT NOT NULL,
                conclusion TEXT,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                duration_seconds INTEGER,
                commit_sha TEXT,
                branch TEXT,
                event_type TEXT,
                actor_login TEXT,
                html_url TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        db.exec(`
            CREATE TABLE IF NOT EXISTS workflows_meta (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                repo_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL DEFAULT 0,
                github_workflow_id INTEGER UNIQUE NOT NULL,
                name TEXT NOT NULL,
                path TEXT,
                state TEXT DEFAULT 'active',
                last_run_at TEXT,
                total_runs INTEGER DEFAULT 0,
                success_count INTEGER DEFAULT 0,
                failure_count INTEGER DEFAULT 0,
                avg_duration_seconds INTEGER DEFAULT 0,
                last_success_at TEXT,
                last_failure_at TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_repo ON workflow_runs(repo_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_user ON workflow_runs(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_conclusion ON workflow_runs(conclusion)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_date ON workflow_runs(started_at)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflows_meta_repo ON workflows_meta(repo_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflows_meta_user ON workflows_meta(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflows_meta_state ON workflows_meta(state)`);

        // Community Health Cache
        db.exec(`
            CREATE TABLE IF NOT EXISTS community_health_cache (
                repo_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL DEFAULT 0,
                health_score INTEGER NOT NULL,
                metrics TEXT NOT NULL,
                recommendations TEXT NOT NULL,
                analyzed_at TEXT DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, repo_id)
            )
        `);

        db.exec(`CREATE INDEX IF NOT EXISTS idx_community_health_score ON community_health_cache(health_score DESC)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_community_health_user ON community_health_cache(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_repo_metadata_user ON repo_metadata(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_repo_embeddings_user ON repo_embeddings(user_id)`);

        // Migration jobs table for import tracking
        db.exec(`
            CREATE TABLE IF NOT EXISTS migration_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                source_type TEXT NOT NULL,
                source_url TEXT NOT NULL,
                source_name TEXT NOT NULL,
                target_owner TEXT NOT NULL,
                target_repo TEXT NOT NULL,
                target_full_name TEXT,
                status TEXT DEFAULT 'pending',
                progress_pct INTEGER DEFAULT 0,
                progress_message TEXT,
                error_message TEXT,
                started_at TEXT DEFAULT CURRENT_TIMESTAMP,
                completed_at TEXT,
                metadata TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_mig_user ON migration_jobs(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_mig_status ON migration_jobs(status)`);

        // Migration plans table (enhanced migration engine)
        db.exec(`
            CREATE TABLE IF NOT EXISTS migration_plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                source_type TEXT NOT NULL DEFAULT 'azure',
                source_org TEXT NOT NULL,
                source_project TEXT NOT NULL,
                target_org TEXT,
                is_dry_run INTEGER NOT NULL DEFAULT 0,
                scheduled_at TEXT,
                credentials_enc TEXT,
                started_at TEXT,
                completed_at TEXT,
                ai_analysis TEXT,
                summary TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        db.exec(`CREATE INDEX IF NOT EXISTS idx_plan_user ON migration_plans(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_plan_status ON migration_plans(status)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_plan_scheduled ON migration_plans(scheduled_at) WHERE status = 'scheduled'`);

        // Migration tasks table (individual items within a plan)
        db.exec(`
            CREATE TABLE IF NOT EXISTS migration_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                execution_order INTEGER NOT NULL DEFAULT 0,
                source_ref TEXT NOT NULL,
                target_ref TEXT,
                config TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                progress_pct INTEGER NOT NULL DEFAULT 0,
                progress_message TEXT,
                error_message TEXT,
                retries INTEGER NOT NULL DEFAULT 0,
                max_retries INTEGER NOT NULL DEFAULT 3,
                started_at TEXT,
                completed_at TEXT,
                metadata TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (plan_id) REFERENCES migration_plans(id) ON DELETE CASCADE
            )
        `);

        db.exec(`CREATE INDEX IF NOT EXISTS idx_task_plan ON migration_tasks(plan_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_task_status ON migration_tasks(status)`);

        // Audit log for destructive operations
        db.exec(`
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                action TEXT NOT NULL,
                target TEXT NOT NULL,
                details TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)`);

        // Indexes for performance
        db.exec(`CREATE INDEX IF NOT EXISTS idx_members_user ON team_members(user_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_repos_team ON repo_assignments(team_id)`);

        // Additional optimized indexes for frequent queries
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_repo_created ON workflow_runs(repo_id, created_at DESC)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_team_members_user_team ON team_members(user_id, team_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_repo_assignments_repo ON repo_assignments(repo_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_repo_metadata_repo ON repo_metadata(repo_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_repo_embeddings_repo ON repo_embeddings(repo_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_community_health_repo ON community_health_cache(repo_id)`);
    });

    transactions();
    console.log('SQLite Database initialized successfully');
}

/**
 * Seed mock data for development/demo mode
 * Only runs if MOCK_MODE is enabled and no teams exist for the mock user
 */
export function seedMockData() {
    const MOCK_USER_ID = 999999;

    // Check if mock user exists
    const existingUser = db.prepare('SELECT id FROM users WHERE id = ?').get(MOCK_USER_ID);
    if (!existingUser) {
        db.prepare('INSERT OR IGNORE INTO users (id, username, avatar_url) VALUES (?, ?, ?)').run(
            MOCK_USER_ID, 'dev-user', 'https://github.com/ghost.png'
        );
    }

    // Check if mock teams already exist
    const existingTeams = db.prepare('SELECT COUNT(*) as count FROM teams WHERE owner_id = ?').get(MOCK_USER_ID);
    if (existingTeams.count > 0) {
        console.log('Mock data already exists, skipping seed');
        return;
    }

    console.log('Seeding mock data for demo mode...');

    const seedTransaction = db.transaction(() => {
        // Create mock teams
        const teams = [
            { name: 'Frontend Team', description: 'React, Vue, and Angular projects' },
            { name: 'Backend Team', description: 'Node.js, Python, and Go services' },
            { name: 'DevOps', description: 'Infrastructure and CI/CD pipelines' }
        ];

        teams.forEach((team, index) => {
            const insertTeam = db.prepare('INSERT INTO teams (name, description, owner_id) VALUES (?, ?, ?)');
            const info = insertTeam.run(team.name, team.description, MOCK_USER_ID);
            const teamId = info.lastInsertRowid;

            // Add mock user as owner
            db.prepare('INSERT INTO team_members (team_id, user_id, role) VALUES (?, ?, ?)').run(
                teamId, MOCK_USER_ID, 'owner'
            );

            // Assign some mock repos to each team
            const repoAssignments = [
                { repoId: index * 3 + 1, repoFullName: `dev-user/project-${index * 3 + 1}` },
                { repoId: index * 3 + 2, repoFullName: `dev-user/project-${index * 3 + 2}` },
                { repoId: index * 3 + 3, repoFullName: `dev-user/project-${index * 3 + 3}` }
            ];

            repoAssignments.forEach(repo => {
                db.prepare('INSERT INTO repo_assignments (team_id, repo_full_name, repo_id, assigned_by) VALUES (?, ?, ?, ?)').run(
                    teamId, repo.repoFullName, repo.repoId, MOCK_USER_ID
                );
            });
        });

        // Seed some mock AI metadata for repos
        const mockMetadata = [
            { repoId: 1, summary: 'A modern React dashboard with TypeScript and TailwindCSS', topics: '["react","typescript","dashboard"]', healthScore: 85 },
            { repoId: 2, summary: 'REST API built with Express.js and PostgreSQL', topics: '["nodejs","express","api"]', healthScore: 72 },
            { repoId: 3, summary: 'Python machine learning utilities and notebooks', topics: '["python","ml","data-science"]', healthScore: 68 }
        ];

        mockMetadata.forEach(meta => {
            db.prepare('INSERT OR REPLACE INTO repo_metadata (repo_id, user_id, summary, topics, health_score, last_indexed) VALUES (?, ?, ?, ?, ?, ?)').run(
                meta.repoId, MOCK_USER_ID, meta.summary, meta.topics, meta.healthScore, new Date().toISOString()
            );
        });
    });

    seedTransaction();
    console.log('Mock data seeded successfully');
}

export default db;
