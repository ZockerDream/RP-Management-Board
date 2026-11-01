ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_cost_interval_check;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_cost_interval_check
  CHECK (cost_interval IN ('once', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'));

CREATE TABLE bug_reports (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 5 AND 120),
  description text NOT NULL CHECK (length(description) BETWEEN 20 AND 10000),
  steps text NOT NULL DEFAULT '' CHECK (length(steps) <= 5000),
  github_issue_number integer UNIQUE,
  github_url text,
  github_sync_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bug_reports_user_created_idx ON bug_reports (user_id, created_at DESC);
