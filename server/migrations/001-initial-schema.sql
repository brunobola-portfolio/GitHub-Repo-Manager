-- 001-initial-schema.sql
--
-- Source-of-truth schema for the GitHub Repo Manager database.
-- Written in SQLite-compatible SQL.
--
-- A separate PostgreSQL equivalent (001-initial-schema.pg.sql) will be
-- provided when PostgreSQL support is fully enabled.  Key differences:
--   - INTEGER PRIMARY KEY AUTOINCREMENT  →  SERIAL PRIMARY KEY
--   - TEXT DEFAULT CURRENT_TIMESTAMP     →  TIMESTAMPTZ DEFAULT NOW()
--   - datetime('now')                    →  NOW()
--   - INSERT OR REPLACE / ON CONFLICT    →  INSERT … ON CONFLICT DO UPDATE
--   - INTEGER for booleans               →  BOOLEAN

-- =====================================================================
-- Users (local cache of GitHub users)
-- =====================================================================
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, -- GitHub ID
    username TEXT NOT NULL,
    avatar_url TEXT,
    email TEXT,
    last_login TEXT DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- Teams
-- =====================================================================
CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    owner_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================================================================
-- Team Members
-- =====================================================================
CREATE TABLE IF NOT EXISTS team_members (
    team_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT CHECK(role IN ('owner', 'admin', 'member')) DEFAULT 'member',
    joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (team_id, user_id),
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================================================================
-- Repo Assignments
-- =====================================================================
CREATE TABLE IF NOT EXISTS repo_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    repo_full_name TEXT NOT NULL, -- e.g. "owner/repo"
    repo_id INTEGER NOT NULL,      -- GitHub Repo ID
    assigned_by INTEGER NOT NULL,
    assigned_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_by) REFERENCES users(id)
);

-- =====================================================================
-- System Meta (setup tracking)
-- =====================================================================
CREATE TABLE IF NOT EXISTS system_meta (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- AI Metadata (repo summarization cache)
-- =====================================================================
CREATE TABLE IF NOT EXISTS repo_metadata (
    repo_id INTEGER PRIMARY KEY,
    summary TEXT,
    topics TEXT, -- JSON array
    health_score INTEGER,
    last_indexed TEXT
);

-- =====================================================================
-- Vector Embeddings
-- =====================================================================
CREATE TABLE IF NOT EXISTS repo_embeddings (
    repo_id INTEGER PRIMARY KEY,
    embedding TEXT NOT NULL, -- JSON string of float array
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- Workflow Runs (GitHub Actions)
-- =====================================================================
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
);

-- =====================================================================
-- Workflows Meta
-- =====================================================================
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
);

-- =====================================================================
-- Community Health Cache
-- =====================================================================
CREATE TABLE IF NOT EXISTS community_health_cache (
    repo_id INTEGER PRIMARY KEY,
    health_score INTEGER NOT NULL,
    metrics TEXT NOT NULL,
    recommendations TEXT NOT NULL,
    analyzed_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (repo_id) REFERENCES repo_metadata(repo_id)
);

-- =====================================================================
-- Migration Jobs (import tracking)
-- =====================================================================
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
);

-- =====================================================================
-- Migration Plans (enhanced migration engine)
-- =====================================================================
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
);

-- =====================================================================
-- Migration Tasks (individual items within a plan)
-- =====================================================================
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
);

-- =====================================================================
-- Audit Log
-- =====================================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    details TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================================
-- Indexes
-- =====================================================================

-- Workflow runs
CREATE INDEX IF NOT EXISTS idx_workflow_runs_repo ON workflow_runs(repo_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_conclusion ON workflow_runs(conclusion);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_date ON workflow_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_repo_created ON workflow_runs(repo_id, created_at DESC);

-- Workflows meta
CREATE INDEX IF NOT EXISTS idx_workflows_meta_repo ON workflows_meta(repo_id);
CREATE INDEX IF NOT EXISTS idx_workflows_meta_state ON workflows_meta(state);

-- Community health
CREATE INDEX IF NOT EXISTS idx_community_health_score ON community_health_cache(health_score DESC);
CREATE INDEX IF NOT EXISTS idx_community_health_repo ON community_health_cache(repo_id);

-- Migration jobs
CREATE INDEX IF NOT EXISTS idx_mig_user ON migration_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_mig_status ON migration_jobs(status);

-- Migration plans
CREATE INDEX IF NOT EXISTS idx_plan_user ON migration_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_status ON migration_plans(status);
CREATE INDEX IF NOT EXISTS idx_plan_scheduled ON migration_plans(scheduled_at) WHERE status = 'scheduled';

-- Migration tasks
CREATE INDEX IF NOT EXISTS idx_task_plan ON migration_tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_task_status ON migration_tasks(status);

-- Team members
CREATE INDEX IF NOT EXISTS idx_members_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_team ON team_members(user_id, team_id);

-- Repo assignments
CREATE INDEX IF NOT EXISTS idx_repos_team ON repo_assignments(team_id);
CREATE INDEX IF NOT EXISTS idx_repo_assignments_repo ON repo_assignments(repo_id);

-- Metadata / embeddings
CREATE INDEX IF NOT EXISTS idx_repo_metadata_repo ON repo_metadata(repo_id);
CREATE INDEX IF NOT EXISTS idx_repo_embeddings_repo ON repo_embeddings(repo_id);

-- Audit log
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
