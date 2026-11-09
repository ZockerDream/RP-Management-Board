-- Aktensystem wie bei Polizei, Rettungsdienst und Co. (Wunsch des Auftraggebers vom 2026-11-09):
-- Fallakten mit Priorität, Ort, Zeit und Sachbearbeitung, Berichte mit Vorlagen und Freigabe, Strafkatalog und
-- Anklagepunkte, Beweismittel mit Übergabekette, Fahrzeuge, verknüpfte Akten, Fahndungen und Personenakten je Bereich.
-- Alles, was an einer Akte hängt, erbt deren Sichtbarkeit (case_file_level). Strafkatalog, Berichtsvorlagen und
-- Personenakten gehören wie Aktenarten einer Person (privat) oder einer Organisation und folgen dort dem Recht für Akten.

-- ---------- Personen: Stammdaten, global wie die Person selbst
ALTER TABLE people
  ADD COLUMN birth_date date,
  ADD COLUMN gender text NOT NULL DEFAULT '' CHECK (length(gender) <= 30),
  ADD COLUMN address text NOT NULL DEFAULT '' CHECK (length(address) <= 300),
  ADD COLUMN nationality text NOT NULL DEFAULT '' CHECK (length(nationality) <= 60),
  ADD COLUMN height_cm smallint CHECK (height_cm BETWEEN 30 AND 260),
  ADD COLUMN features text NOT NULL DEFAULT '' CHECK (length(features) <= 1000),
  ADD COLUMN aliases text NOT NULL DEFAULT '' CHECK (length(aliases) <= 300),
  ADD COLUMN photo_key text,
  ADD COLUMN photo_mime text;

-- ---------- Fallakte
ALTER TABLE case_files
  ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  ADD COLUMN location text NOT NULL DEFAULT '' CHECK (length(location) <= 200),
  ADD COLUMN incident_at timestamptz,
  ADD COLUMN lead_user_id uuid REFERENCES users ON DELETE SET NULL;

-- Verknüpfte Akten, je Richtung eine Zeile; nur innerhalb desselben Bereichs (prüft die API)
CREATE TABLE case_file_links (
  case_file_id uuid NOT NULL REFERENCES case_files ON DELETE CASCADE,
  linked_id uuid NOT NULL REFERENCES case_files ON DELETE CASCADE,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (case_file_id, linked_id),
  CHECK (case_file_id <> linked_id)
);

-- Fahrzeuge in einer Akte: frei per Kennzeichen, nicht an die Fahrzeugverwaltung gebunden
CREATE TABLE case_file_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_file_id uuid NOT NULL REFERENCES case_files ON DELETE CASCADE,
  plate text NOT NULL DEFAULT '' CHECK (length(plate) <= 20),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 200),
  role text NOT NULL DEFAULT '' CHECK (length(role) <= 60),
  owner_person_id uuid REFERENCES people ON DELETE CASCADE,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (plate <> '' OR description <> '')
);
CREATE INDEX ON case_file_vehicles (case_file_id);
CREATE INDEX ON case_file_vehicles (lower(plate)) WHERE plate <> '';
CREATE INDEX ON case_file_vehicles (owner_person_id) WHERE owner_person_id IS NOT NULL;

-- ---------- Berichte: Entwurf → eingereicht → freigegeben; Freigegebenes ist unveränderlich, Korrekturen als Nachtrag
CREATE TABLE report_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users ON DELETE CASCADE,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NOT NULL) <> (team_id IS NOT NULL))
);
CREATE UNIQUE INDEX report_templates_team_name ON report_templates (team_id, lower(name)) WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX report_templates_owner_name ON report_templates (owner_user_id, lower(name)) WHERE owner_user_id IS NOT NULL;

CREATE TABLE case_file_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_file_id uuid NOT NULL REFERENCES case_files ON DELETE CASCADE,
  number integer NOT NULL,
  kind text NOT NULL DEFAULT '' CHECK (length(kind) <= 100),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 50000),
  occurred_at timestamptz,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved')),
  amends_report_id uuid REFERENCES case_file_reports ON DELETE SET NULL,
  author_id uuid REFERENCES users ON DELETE SET NULL,
  review_note text NOT NULL DEFAULT '' CHECK (length(review_note) <= 2000),
  submitted_at timestamptz,
  approved_by uuid REFERENCES users ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_file_id, number)
);
CREATE INDEX ON case_file_reports (status) WHERE status = 'submitted';

CREATE TABLE case_file_report_people (
  report_id uuid NOT NULL REFERENCES case_file_reports ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people ON DELETE CASCADE,
  PRIMARY KEY (report_id, person_id)
);
CREATE INDEX ON case_file_report_people (person_id);

-- ---------- Strafkatalog und Anklagepunkte; ein Anklagepunkt hält den Stand des Katalogs beim Erfassen fest
CREATE TABLE penal_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users ON DELETE CASCADE,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 40),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  category text NOT NULL DEFAULT '' CHECK (length(category) <= 60),
  fine numeric(12,2) NOT NULL DEFAULT 0 CHECK (fine >= 0),
  jail integer NOT NULL DEFAULT 0 CHECK (jail BETWEEN 0 AND 100000),
  points smallint NOT NULL DEFAULT 0 CHECK (points BETWEEN 0 AND 100),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NOT NULL) <> (team_id IS NOT NULL))
);
CREATE UNIQUE INDEX penal_codes_team_code ON penal_codes (team_id, lower(code)) WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX penal_codes_owner_code ON penal_codes (owner_user_id, lower(code)) WHERE owner_user_id IS NOT NULL;

CREATE TABLE case_file_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_file_id uuid NOT NULL REFERENCES case_files ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people ON DELETE CASCADE,
  penal_code_id uuid REFERENCES penal_codes ON DELETE SET NULL,
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 40),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  count smallint NOT NULL DEFAULT 1 CHECK (count BETWEEN 1 AND 99),
  fine numeric(12,2) NOT NULL DEFAULT 0 CHECK (fine >= 0),
  jail integer NOT NULL DEFAULT 0 CHECK (jail BETWEEN 0 AND 100000),
  points smallint NOT NULL DEFAULT 0 CHECK (points BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'convicted', 'dropped', 'acquitted')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  decided_at timestamptz,
  decided_by uuid REFERENCES users ON DELETE SET NULL,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON case_file_charges (case_file_id);
CREATE INDEX ON case_file_charges (person_id);

-- ---------- Beweismittel mit Übergabekette (Protokoll ist nur fortzuschreiben, nicht zu ändern)
CREATE TABLE case_file_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_file_id uuid NOT NULL REFERENCES case_files ON DELETE CASCADE,
  number integer NOT NULL,
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
  kind text NOT NULL DEFAULT '' CHECK (length(kind) <= 60),
  storage text NOT NULL DEFAULT '' CHECK (length(storage) <= 200),
  found_at timestamptz,
  found_where text NOT NULL DEFAULT '' CHECK (length(found_where) <= 200),
  person_id uuid REFERENCES people ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'secured' CHECK (status IN ('secured', 'analysis', 'stored', 'released', 'destroyed')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_file_id, number)
);
CREATE INDEX ON case_file_evidence (person_id) WHERE person_id IS NOT NULL;

CREATE TABLE case_file_evidence_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES case_file_evidence ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 60),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  user_id uuid REFERENCES users ON DELETE SET NULL
);
CREATE INDEX ON case_file_evidence_log (evidence_id, at);

-- ---------- Fahndungen: Haftbefehl, Durchsuchung, Aufenthaltsermittlung (Person) oder Fahrzeugfahndung (Kennzeichen)
CREATE TABLE warrants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_file_id uuid NOT NULL REFERENCES case_files ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('arrest', 'search', 'wanted', 'vehicle')),
  person_id uuid REFERENCES people ON DELETE CASCADE,
  plate text NOT NULL DEFAULT '' CHECK (length(plate) <= 20),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  issued_on date NOT NULL DEFAULT CURRENT_DATE,
  valid_until date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'executed', 'revoked')),
  close_note text NOT NULL DEFAULT '' CHECK (length(close_note) <= 500),
  closed_at timestamptz,
  closed_by uuid REFERENCES users ON DELETE SET NULL,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'vehicle' AND plate <> '') OR (kind <> 'vehicle' AND person_id IS NOT NULL)),
  CHECK (valid_until IS NULL OR valid_until >= issued_on)
);
CREATE INDEX ON warrants (case_file_id);
CREATE INDEX ON warrants (person_id) WHERE status = 'active';

-- ---------- Personenakte: was ein Bereich über eine Person führt (Warnhinweise, Vermerke, medizinische Angaben)
CREATE TABLE person_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users ON DELETE CASCADE,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people ON DELETE CASCADE,
  warnings text[] NOT NULL DEFAULT '{}',
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 20000),
  blood_type text NOT NULL DEFAULT '' CHECK (length(blood_type) <= 10),
  allergies text NOT NULL DEFAULT '' CHECK (length(allergies) <= 1000),
  conditions text NOT NULL DEFAULT '' CHECK (length(conditions) <= 2000),
  medications text NOT NULL DEFAULT '' CHECK (length(medications) <= 1000),
  emergency_contact text NOT NULL DEFAULT '' CHECK (length(emergency_contact) <= 200),
  updated_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NOT NULL) <> (team_id IS NOT NULL))
);
CREATE UNIQUE INDEX person_files_team ON person_files (team_id, person_id) WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX person_files_owner ON person_files (owner_user_id, person_id) WHERE owner_user_id IS NOT NULL;
