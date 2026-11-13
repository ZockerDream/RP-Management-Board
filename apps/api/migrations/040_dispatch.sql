-- Einsätze & Funk (Wünsche des Auftraggebers vom 2026-11-13): frei angelegte Einheiten je Organisation (Rufname,
-- Besatzung, optional Fuhrpark-Fahrzeug) mit Status 1–6, Einsätze mit beteiligten Einheiten und Verlauf, Funkbuch.
-- Funktion „dispatch“ steht schon in Migration 038.
CREATE TABLE dispatch_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  callsign text NOT NULL CHECK (length(callsign) BETWEEN 1 AND 40),
  kind text NOT NULL DEFAULT '' CHECK (length(kind) <= 40),
  fleet_vehicle_id uuid REFERENCES fleet_vehicles ON DELETE SET NULL,
  crew uuid[] NOT NULL DEFAULT '{}',
  status smallint NOT NULL DEFAULT 2 CHECK (status BETWEEN 1 AND 6),
  status_note text NOT NULL DEFAULT '' CHECK (length(status_note) <= 200),
  status_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX dispatch_units_callsign ON dispatch_units (team_id, lower(callsign));

CREATE SEQUENCE incident_seq;
CREATE TABLE incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  number text NOT NULL UNIQUE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  kind text NOT NULL DEFAULT '' CHECK (length(kind) <= 60),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  location text NOT NULL DEFAULT '' CHECK (length(location) <= 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 20000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  close_note text NOT NULL DEFAULT '' CHECK (length(close_note) <= 2000),
  case_file_id uuid REFERENCES case_files ON DELETE SET NULL,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  closed_by uuid REFERENCES users ON DELETE SET NULL
);
CREATE INDEX ON incidents (team_id, status, started_at DESC);

CREATE TABLE incident_units (
  incident_id uuid NOT NULL REFERENCES incidents ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES dispatch_units ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  PRIMARY KEY (incident_id, unit_id)
);
-- Eine Einheit ist höchstens in einem laufenden Einsatz
CREATE UNIQUE INDEX incident_units_open ON incident_units (unit_id) WHERE released_at IS NULL;

-- Funkbuch: Statuswechsel, Funksprüche und Einsatzverlauf
CREATE TABLE dispatch_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  unit_id uuid REFERENCES dispatch_units ON DELETE SET NULL,
  incident_id uuid REFERENCES incidents ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('status', 'message', 'incident')),
  status smallint CHECK (status BETWEEN 1 AND 6),
  text text NOT NULL DEFAULT '' CHECK (length(text) <= 2000),
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON dispatch_log (team_id, created_at DESC);
CREATE INDEX ON dispatch_log (incident_id, created_at) WHERE incident_id IS NOT NULL;
