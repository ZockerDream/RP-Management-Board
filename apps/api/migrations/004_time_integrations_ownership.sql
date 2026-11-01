ALTER TABLE work_entries ADD COLUMN project_id uuid;
ALTER TABLE work_entries ADD COLUMN started_at time;
ALTER TABLE work_entries ADD COLUMN ended_at time;
ALTER TABLE work_entries ADD COLUMN break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes >= 0);

CREATE TABLE work_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  owner_user_id uuid REFERENCES users ON DELETE CASCADE,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NOT NULL) <> (team_id IS NOT NULL))
);
ALTER TABLE work_entries ADD CONSTRAINT work_entries_project_id_fkey FOREIGN KEY (project_id) REFERENCES work_projects ON DELETE SET NULL;

CREATE TABLE work_timers (
  user_id uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  project_id uuid REFERENCES work_projects ON DELETE SET NULL,
  started_at timestamptz NOT NULL,
  paused_at timestamptz,
  paused_seconds integer NOT NULL DEFAULT 0 CHECK (paused_seconds >= 0),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500)
);

ALTER TABLE properties ADD COLUMN owner_user_id uuid REFERENCES users ON DELETE CASCADE;
ALTER TABLE properties ADD COLUMN team_id uuid REFERENCES teams ON DELETE CASCADE;
ALTER TABLE vehicles ADD COLUMN owner_user_id uuid REFERENCES users ON DELETE CASCADE;
ALTER TABLE vehicles ADD COLUMN team_id uuid REFERENCES teams ON DELETE CASCADE;
ALTER TABLE keys ADD COLUMN owner_user_id uuid REFERENCES users ON DELETE CASCADE;
ALTER TABLE keys ADD COLUMN team_id uuid REFERENCES teams ON DELETE CASCADE;
ALTER TABLE people ADD COLUMN owner_user_id uuid REFERENCES users ON DELETE CASCADE;
ALTER TABLE people ADD COLUMN team_id uuid REFERENCES teams ON DELETE CASCADE;

DO $$
DECLARE admin_id uuid;
BEGIN
  SELECT u.id INTO admin_id
    FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
    WHERE r.name='Admin' ORDER BY u.created_at LIMIT 1;
  IF admin_id IS NULL THEN
    SELECT id INTO admin_id FROM users ORDER BY created_at LIMIT 1;
  END IF;
  IF admin_id IS NOT NULL THEN
    UPDATE properties SET owner_user_id=admin_id WHERE owner_user_id IS NULL AND team_id IS NULL;
    UPDATE vehicles SET owner_user_id=admin_id WHERE owner_user_id IS NULL AND team_id IS NULL;
    UPDATE keys SET owner_user_id=admin_id WHERE owner_user_id IS NULL AND team_id IS NULL;
    UPDATE people SET owner_user_id=admin_id WHERE owner_user_id IS NULL AND team_id IS NULL;
  END IF;
END $$;

ALTER TABLE properties ADD CONSTRAINT properties_owner_scope_check CHECK ((owner_user_id IS NOT NULL) <> (team_id IS NOT NULL));
ALTER TABLE vehicles ADD CONSTRAINT vehicles_owner_scope_check CHECK ((owner_user_id IS NOT NULL) <> (team_id IS NOT NULL));
ALTER TABLE keys ADD CONSTRAINT keys_owner_scope_check CHECK ((owner_user_id IS NOT NULL) <> (team_id IS NOT NULL));
ALTER TABLE people ADD CONSTRAINT people_owner_scope_check CHECK ((owner_user_id IS NOT NULL) <> (team_id IS NOT NULL));

ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_plate_key;
ALTER TABLE keys DROP CONSTRAINT IF EXISTS keys_code_key;
CREATE UNIQUE INDEX vehicles_plate_user_unique ON vehicles(plate,owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE UNIQUE INDEX vehicles_plate_team_unique ON vehicles(plate,team_id) WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX keys_code_user_unique ON keys(code,owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE UNIQUE INDEX keys_code_team_unique ON keys(code,team_id) WHERE team_id IS NOT NULL;

CREATE INDEX properties_owner_user_idx ON properties(owner_user_id);
CREATE INDEX properties_team_idx ON properties(team_id);
CREATE INDEX vehicles_owner_user_idx ON vehicles(owner_user_id);
CREATE INDEX vehicles_team_idx ON vehicles(team_id);
CREATE INDEX keys_owner_user_idx ON keys(owner_user_id);
CREATE INDEX keys_team_idx ON keys(team_id);
CREATE INDEX people_owner_user_idx ON people(owner_user_id);
CREATE INDEX people_team_idx ON people(team_id);
CREATE INDEX work_projects_owner_idx ON work_projects(owner_user_id);
CREATE INDEX work_projects_team_idx ON work_projects(team_id);

CREATE TABLE oauth_states (
  state_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  expires_at timestamptz NOT NULL
);
CREATE TABLE provider_connections (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  email text NOT NULL DEFAULT '',
  access_token_enc text NOT NULL,
  refresh_token_enc text NOT NULL,
  expires_at timestamptz NOT NULL,
  last_sync_at timestamptz,
  PRIMARY KEY (user_id, provider)
);
CREATE TABLE synced_contacts (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  external_id text NOT NULL,
  name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider, external_id)
);
CREATE TABLE synced_calendar_events (
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  external_id text NOT NULL,
  title text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider, external_id)
);
