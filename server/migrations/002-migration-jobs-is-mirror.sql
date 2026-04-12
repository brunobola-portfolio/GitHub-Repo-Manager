-- Add is_mirror flag and index to migration_jobs
ALTER TABLE migration_jobs ADD COLUMN is_mirror INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_migration_jobs_mirror
  ON migration_jobs(target_owner, target_repo, is_mirror);
