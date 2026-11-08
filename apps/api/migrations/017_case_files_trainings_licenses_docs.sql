-- Akten, Schulungen, Lizenzen und Dokumentationen. Jeder Datensatz ist privat oder gehört einem Team;
-- Personen, Termine, Einträge und Nachweise erben die Sichtbarkeit ihrer Akte, Schulung oder Lizenzart.
-- Eine einzelne Person mit Akten, Lizenzen oder Schulungsnachweisen lehnt die API beim Löschen ab. Wird dagegen ein ganzes
-- Team gelöscht, gehen seine Personen samt Verweisen mit; deshalb kaskadieren die Verweise auf people (Einträge verlieren nur den Bezug).

-- ---------- Akten
CREATE TABLE case_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users ON DELETE CASCADE,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  file_number text NOT NULL CHECK (length(file_number) BETWEEN 1 AND 40),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 20000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dormant', 'closed')),
  opened_on date NOT NULL DEFAULT CURRENT_DATE,
  closed_on date,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NOT NULL) <> (team_id IS NOT NULL)),
  CHECK (closed_on IS NULL OR closed_on >= opened_on)
);
CREATE UNIQUE INDEX case_files_team_number ON case_files (team_id, file_number) WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX case_files_owner_number ON case_files (owner_user_id, file_number) WHERE owner_user_id IS NOT NULL;

CREATE TABLE case_file_people (
  case_file_id uuid NOT NULL REFERENCES case_files ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people ON DELETE CASCADE,
  role text NOT NULL DEFAULT '' CHECK (length(role) <= 60),
  PRIMARY KEY (case_file_id, person_id)
);
CREATE INDEX ON case_file_people (person_id);

CREATE TABLE case_file_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_file_id uuid NOT NULL REFERENCES case_files ON DELETE CASCADE,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  kind text NOT NULL DEFAULT '' CHECK (length(kind) <= 60),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  person_id uuid REFERENCES people ON DELETE SET NULL,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  updated_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON case_file_entries (case_file_id, entry_date DESC);
CREATE INDEX ON case_file_entries (person_id) WHERE person_id IS NOT NULL;

CREATE TABLE case_file_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_file_id uuid NOT NULL REFERENCES case_files ON DELETE CASCADE,
  storage_key text NOT NULL,
  original_name text NOT NULL,
  mime text NOT NULL,
  size int NOT NULL,
  sha256 text NOT NULL,
  uploaded_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON case_file_attachments (case_file_id);

-- ---------- Lizenzen
CREATE TABLE license_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users ON DELETE CASCADE,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  validity_months integer CHECK (validity_months BETWEEN 1 AND 1200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NOT NULL) <> (team_id IS NOT NULL))
);

CREATE TABLE licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type_id uuid NOT NULL REFERENCES license_types ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people ON DELETE CASCADE,
  number text NOT NULL DEFAULT '' CHECK (length(number) <= 60),
  issued_on date NOT NULL DEFAULT CURRENT_DATE,
  valid_until date,
  issuer text NOT NULL DEFAULT '' CHECK (length(issuer) <= 100),
  status text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'suspended', 'revoked')),
  status_reason text NOT NULL DEFAULT '' CHECK (length(status_reason) <= 500),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR valid_until >= issued_on)
);
CREATE INDEX ON licenses (person_id);
CREATE INDEX ON licenses (valid_until) WHERE status = 'valid' AND valid_until IS NOT NULL;

-- ---------- Schulungen
CREATE TABLE trainings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users ON DELETE CASCADE,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 150),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 20000),
  validity_months integer CHECK (validity_months BETWEEN 1 AND 1200),
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NOT NULL) <> (team_id IS NOT NULL))
);

CREATE TABLE training_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_id uuid NOT NULL REFERENCES trainings ON DELETE CASCADE,
  session_date date NOT NULL,
  start_time time,
  end_time time,
  location text NOT NULL DEFAULT '' CHECK (length(location) <= 200),
  instructor text NOT NULL DEFAULT '' CHECK (length(instructor) <= 100),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON training_sessions (training_id, session_date);

-- Teilnahme und Nachweis: Teilnehmer ist ein Benutzer oder eine Person
CREATE TABLE training_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_id uuid NOT NULL REFERENCES trainings ON DELETE CASCADE,
  session_id uuid REFERENCES training_sessions ON DELETE SET NULL,
  user_id uuid REFERENCES users ON DELETE CASCADE,
  person_id uuid REFERENCES people ON DELETE CASCADE,
  result text NOT NULL DEFAULT 'registered' CHECK (result IN ('registered', 'passed', 'failed', 'absent')),
  completed_on date,
  valid_until date,
  instructor text NOT NULL DEFAULT '' CHECK (length(instructor) <= 100),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NOT NULL) <> (person_id IS NOT NULL)),
  CHECK (valid_until IS NULL OR completed_on IS NULL OR valid_until >= completed_on)
);
CREATE INDEX ON training_records (training_id);
CREATE INDEX ON training_records (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX ON training_records (user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX training_records_session_user ON training_records (session_id, user_id) WHERE session_id IS NOT NULL AND user_id IS NOT NULL;
CREATE UNIQUE INDEX training_records_session_person ON training_records (session_id, person_id) WHERE session_id IS NOT NULL AND person_id IS NOT NULL;

-- ---------- Dokumentationen
CREATE TABLE doc_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users ON DELETE CASCADE,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NOT NULL) <> (team_id IS NOT NULL))
);

CREATE TABLE doc_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES doc_categories ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 200000),
  pinned boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  updated_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON doc_pages (category_id);
