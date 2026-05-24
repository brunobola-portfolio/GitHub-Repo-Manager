-- 003-migration-tagging.sql
-- Adds migration_marks table + tagging_policy column to migration_plans.
-- Idempotent: safe to run on databases at any earlier state.

CREATE TABLE IF NOT EXISTS migration_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL,
  task_id INTEGER,
  scope TEXT NOT NULL,                -- 'source' | 'destination' | 'git-tag'
  target_kind TEXT NOT NULL,          -- 'github-topic' | 'github-description' | 'github-custom-property'
                                      -- | 'azure-project-property' | 'azure-repo-description' | 'git-annotated-tag'
  target_id TEXT NOT NULL,            -- repo full_name, project id, or tag name
  payload TEXT NOT NULL,              -- JSON of what was written
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'written' | 'skipped' | 'failed'
  skip_reason TEXT,
  error_message TEXT,
  written_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (plan_id) REFERENCES migration_plans(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id) REFERENCES migration_tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_marks_plan ON migration_marks(plan_id);
CREATE INDEX IF NOT EXISTS idx_marks_status ON migration_marks(status);
CREATE INDEX IF NOT EXISTS idx_marks_target ON migration_marks(target_kind, target_id);

-- tagging_policy column added at runtime by db.js (idempotent ALTER TABLE)
