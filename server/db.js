import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Import better-sqlite3 with helpful error handling for version mismatches
let Database;
try {
    Database = (await import('better-sqlite3')).default;
} catch (error) {
    if (error.code === 'ERR_DLOPEN_FAILED' && error.message.includes('NODE_MODULE_VERSION')) {
        const match = error.message.match(/NODE_MODULE_VERSION (\d+).*NODE_MODULE_VERSION (\d+)/);
        const compiledFor = match ? match[1] : 'unknown';
        const required = match ? match[2] : process.versions.modules;

        console.error('\n' + '='.repeat(70));
        console.error('❌ NATIVE MODULE VERSION MISMATCH');
        console.error('='.repeat(70));
        console.error(`\nThe better-sqlite3 module was compiled for a different Node.js version.`);
        console.error(`  • Compiled for: NODE_MODULE_VERSION ${compiledFor}`);
        console.error(`  • Required:     NODE_MODULE_VERSION ${required} (Node.js ${process.version})`);
        console.error(`\n📋 How to fix:`);
        console.error(`   1. Run: npm rebuild better-sqlite3`);
        console.error(`   2. Or run: node server/check-native-modules.js --fix`);
        console.error(`   3. Or clean reinstall: rm -rf node_modules && npm install`);
        console.error('\n' + '='.repeat(70) + '\n');
        process.exit(1);
    }
    throw error;
}

const dbPath = path.join(dataDir, 'manager.db');
const db = new Database(dbPath, {
    verbose: process.env.NODE_ENV === 'development' ? console.log : undefined
});

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Enable WAL mode for better concurrency and performance
db.pragma('journal_mode = WAL');

// Performance optimizations
db.pragma('cache_size = 32000');      // 32MB cache (negative values are in KB, positive in pages)
db.pragma('synchronous = NORMAL');    // Balance between safety and speed (safer than OFF, faster than FULL)
db.pragma('temp_store = MEMORY');     // Store temporary tables in RAM for faster operations

export function initDB() {
    const transactions = db.transaction(() => {
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
                repo_id INTEGER PRIMARY KEY,
                summary TEXT,
                topics TEXT, -- JSON array
                health_score INTEGER,
                last_indexed TEXT
            )
        `);

        // Vector Embeddings Table
        // We store the embedding as a JSON string for simplicity in SQLite 
        // (For production with millions of rows, use a vector extension or specialized DB)
        db.exec(`
            CREATE TABLE IF NOT EXISTS repo_embeddings (
                repo_id INTEGER PRIMARY KEY,
                embedding TEXT NOT NULL, -- JSON string of float array
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Actions Statistics Tables
        db.exec(`
            CREATE TABLE IF NOT EXISTS workflow_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                github_run_id INTEGER UNIQUE NOT NULL,
                repo_id INTEGER NOT NULL,
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
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (repo_id) REFERENCES repo_metadata(repo_id)
            )
        `);

        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_repo ON workflow_runs(repo_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_conclusion ON workflow_runs(conclusion)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_date ON workflow_runs(started_at)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflows_meta_repo ON workflows_meta(repo_id)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_workflows_meta_state ON workflows_meta(state)`);

        // Community Health Cache
        db.exec(`
            CREATE TABLE IF NOT EXISTS community_health_cache (
                repo_id INTEGER PRIMARY KEY,
                health_score INTEGER NOT NULL,
                metrics TEXT NOT NULL,
                recommendations TEXT NOT NULL,
                analyzed_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (repo_id) REFERENCES repo_metadata(repo_id)
            )
        `);

        db.exec(`CREATE INDEX IF NOT EXISTS idx_community_health_score ON community_health_cache(health_score DESC)`);

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
    console.log('✅ SQLite Database initialized successfully');
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
        console.log('📦 Mock data already exists, skipping seed');
        return;
    }

    console.log('🌱 Seeding mock data for demo mode...');

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
            db.prepare('INSERT OR REPLACE INTO repo_metadata (repo_id, summary, topics, health_score, last_indexed) VALUES (?, ?, ?, ?, ?)').run(
                meta.repoId, meta.summary, meta.topics, meta.healthScore, new Date().toISOString()
            );
        });
    });

    seedTransaction();
    console.log('✅ Mock data seeded successfully');
}

export default db;
