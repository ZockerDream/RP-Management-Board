CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE settings (key text PRIMARY KEY, value jsonb NOT NULL);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  password_hash text,
  name text NOT NULL,
  locale text NOT NULL DEFAULT 'de',
  currency text NOT NULL DEFAULT 'EUR',
  timezone text NOT NULL DEFAULT 'Europe/Berlin',
  week_start int NOT NULL DEFAULT 1 CHECK (week_start IN (0, 1)),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked', 'invited', 'disabled')),
  totp_secret_enc text,
  totp_enabled boolean NOT NULL DEFAULT false,
  gravatar_enabled boolean NOT NULL DEFAULT true,
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  accent text NOT NULL DEFAULT 'indigo',
  failed_logins int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  force_2fa boolean NOT NULL DEFAULT false,
  expires_at date,
  max_budgets int,
  ical_token text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  refresh_hash text NOT NULL UNIQUE,
  user_agent text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  is_system boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  data_scope text NOT NULL DEFAULT 'all' CHECK (data_scope IN ('all', 'groups', 'own')),
  max_budgets int
);
CREATE TABLE permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL UNIQUE);
CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);
CREATE TABLE groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  auto_domain text,
  leader_can_manage boolean NOT NULL DEFAULT false
);
CREATE TABLE group_members (
  group_id uuid NOT NULL REFERENCES groups ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  is_leader boolean NOT NULL DEFAULT false,
  PRIMARY KEY (group_id, user_id)
);
CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
CREATE TABLE group_roles (
  group_id uuid NOT NULL REFERENCES groups ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles ON DELETE CASCADE,
  PRIMARY KEY (group_id, role_id)
);

CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid NOT NULL REFERENCES users,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE team_members (
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  team_role text NOT NULL CHECK (team_role IN ('owner', 'editor', 'viewer')),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL,
  role_id uuid REFERENCES roles ON DELETE SET NULL,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  team_role text NOT NULL DEFAULT 'viewer',
  token_hash text NOT NULL UNIQUE,
  invited_by uuid REFERENCES users ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('solo', 'shared')),
  owner_user_id uuid REFERENCES users ON DELETE CASCADE,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'EUR',
  period_type text NOT NULL DEFAULT 'monthly' CHECK (period_type IN ('monthly', 'yearly', 'custom', 'goal')),
  period_start date,
  period_end date,
  limit_amount numeric(14, 2) NOT NULL DEFAULT 0 CHECK (limit_amount >= 0),
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'solo' AND owner_user_id IS NOT NULL AND team_id IS NULL)
      OR (type = 'shared' AND team_id IS NOT NULL AND owner_user_id IS NULL))
);
CREATE INDEX ON budgets (owner_user_id);
CREATE INDEX ON budgets (team_id);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES budgets ON DELETE CASCADE,
  name text NOT NULL,
  limit_amount numeric(14, 2) CHECK (limit_amount IS NULL OR limit_amount >= 0),
  color text,
  UNIQUE (budget_id, name)
);

CREATE TABLE goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES budgets ON DELETE CASCADE,
  name text NOT NULL,
  target_amount numeric(14, 2) NOT NULL CHECK (target_amount > 0),
  target_date date,
  monthly_amount numeric(14, 2),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recurring_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  budget_id uuid NOT NULL REFERENCES budgets ON DELETE CASCADE,
  category_id uuid REFERENCES categories ON DELETE SET NULL,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('income', 'expense')),
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  interval int NOT NULL DEFAULT 1 CHECK (interval BETWEEN 1 AND 60),
  start_date date NOT NULL,
  end_date date,
  next_run date NOT NULL,
  active boolean NOT NULL DEFAULT true,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'asset')),
  asset_type text,
  asset_id uuid
);
CREATE INDEX ON recurring_rules (next_run) WHERE active;

CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES budgets ON DELETE CASCADE,
  category_id uuid REFERENCES categories ON DELETE SET NULL,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('income', 'expense', 'deposit')),
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  booked_at date NOT NULL,
  title text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'recurring', 'asset', 'import')),
  recurring_id uuid REFERENCES recurring_rules ON DELETE SET NULL,
  asset_type text,
  asset_id uuid,
  goal_id uuid REFERENCES goals ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON transactions (budget_id, booked_at);
CREATE INDEX ON transactions (category_id);
CREATE INDEX ON transactions (goal_id) WHERE goal_id IS NOT NULL;
CREATE UNIQUE INDEX ON transactions (recurring_id, booked_at) WHERE recurring_id IS NOT NULL;

CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions ON DELETE CASCADE,
  storage_key text NOT NULL,
  original_name text NOT NULL,
  mime text NOT NULL,
  size int NOT NULL,
  sha256 text NOT NULL
);

CREATE TABLE idempotency_keys (
  key text NOT NULL,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'employee' CHECK (kind IN ('employee', 'external', 'family')),
  function text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  user_id uuid REFERENCES users ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  note text NOT NULL DEFAULT ''
);

CREATE TABLE properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'home' CHECK (type IN ('home', 'office', 'storage', 'holiday')),
  address text NOT NULL DEFAULT '',
  responsible_person_id uuid REFERENCES people ON DELETE SET NULL,
  maintenance_due date,
  maintenance_note text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  cost_amount numeric(14, 2),
  cost_interval text CHECK (cost_interval IN ('once', 'monthly', 'quarterly', 'yearly')),
  cost_budget_id uuid REFERENCES budgets ON DELETE SET NULL,
  cost_category_id uuid REFERENCES categories ON DELETE SET NULL,
  cost_tracking boolean NOT NULL DEFAULT true,
  cost_recurring_id uuid REFERENCES recurring_rules ON DELETE SET NULL,
  CHECK (cost_amount IS NULL OR (cost_interval IS NOT NULL AND cost_budget_id IS NOT NULL))
);

CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate text NOT NULL UNIQUE,
  make_model text NOT NULL,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'in_use', 'workshop', 'retired')),
  service_due date,
  insurance_from date,
  note text NOT NULL DEFAULT '',
  cost_amount numeric(14, 2),
  cost_interval text CHECK (cost_interval IN ('once', 'monthly', 'quarterly', 'yearly')),
  cost_budget_id uuid REFERENCES budgets ON DELETE SET NULL,
  cost_category_id uuid REFERENCES categories ON DELETE SET NULL,
  cost_tracking boolean NOT NULL DEFAULT true,
  cost_recurring_id uuid REFERENCES recurring_rules ON DELETE SET NULL,
  CHECK (cost_amount IS NULL OR (cost_interval IS NOT NULL AND cost_budget_id IS NOT NULL))
);

CREATE TABLE keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  kind text NOT NULL DEFAULT 'Haustür',
  property_id uuid REFERENCES properties ON DELETE CASCADE,
  vehicle_id uuid REFERENCES vehicles ON DELETE CASCADE,
  copies int NOT NULL DEFAULT 1 CHECK (copies BETWEEN 1 AND 99),
  note text NOT NULL DEFAULT '',
  cost_amount numeric(14, 2),
  cost_interval text CHECK (cost_interval IN ('once', 'monthly', 'quarterly', 'yearly')),
  cost_budget_id uuid REFERENCES budgets ON DELETE SET NULL,
  cost_category_id uuid REFERENCES categories ON DELETE SET NULL,
  cost_tracking boolean NOT NULL DEFAULT true,
  cost_recurring_id uuid REFERENCES recurring_rules ON DELETE SET NULL,
  CHECK (property_id IS NOT NULL OR vehicle_id IS NOT NULL),
  CHECK (cost_amount IS NULL OR (cost_interval IS NOT NULL AND cost_budget_id IS NOT NULL))
);

CREATE TABLE key_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id uuid NOT NULL REFERENCES keys ON DELETE CASCADE,
  person_id uuid REFERENCES people ON DELETE SET NULL,
  copy_no int NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_at date,
  returned_at timestamptz,
  lost_at timestamptz,
  issued_by_user_id uuid REFERENCES users ON DELETE SET NULL,
  receipt_signed boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX ON key_assignments (key_id, copy_no) WHERE returned_at IS NULL AND lost_at IS NULL;
CREATE INDEX ON key_assignments (key_id) WHERE returned_at IS NULL;

CREATE TABLE calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('team', 'personal')),
  title text NOT NULL,
  date date NOT NULL,
  start_time time,
  end_time time,
  all_day boolean NOT NULL DEFAULT false,
  repeat text NOT NULL DEFAULT 'none' CHECK (repeat IN ('none', 'weekly', 'monthly', 'yearly')),
  remind text NOT NULL DEFAULT 'none' CHECK (remind IN ('none', '1d', '3d', '7d', '14d')),
  amount numeric(14, 2),
  note text NOT NULL DEFAULT '',
  last_reminded date
);
CREATE INDEX ON calendar_events (owner_id, date);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON notifications (user_id, created_at DESC);
CREATE UNIQUE INDEX ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE notification_prefs (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL,
  in_app boolean NOT NULL DEFAULT true,
  email boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE saved_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('monthly', 'categories', 'costs')),
  rhythm text NOT NULL CHECK (rhythm IN ('weekly', 'monthly', 'quarterly')),
  recipients text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  last_run date
);

CREATE TABLE api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  prefix text NOT NULL UNIQUE,
  key_hash text NOT NULL,
  scope text NOT NULL DEFAULT 'read' CHECK (scope IN ('read', 'write')),
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  events text[] NOT NULL DEFAULT '{}',
  secret_enc text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid,
  user_name text,
  action text NOT NULL,
  entity text,
  entity_id text,
  ip text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (created_at);

CREATE TABLE backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL UNIQUE,
  size bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'failed')),
  error text,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE job_runs (
  name text PRIMARY KEY,
  last_run timestamptz,
  last_status text,
  last_duration_ms int,
  last_error text
);
