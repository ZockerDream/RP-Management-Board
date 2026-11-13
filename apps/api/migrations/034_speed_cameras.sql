-- Blitzer (Wunsch des Auftraggebers vom 2026-11-13): systemweit, Rechte allein über die Rollenrechte speedcam:*.
-- Standorte fester und mobiler Blitzer, Blitzer-Rechnungen mit Kennzeichen und Halter (globale Person); aus einer
-- Rechnung entsteht auf Knopfdruck ein Eintrag in der Personenakte des Halters (person_file_entries).
CREATE TABLE speed_cameras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  location text NOT NULL DEFAULT '' CHECK (length(location) <= 200),
  kind text NOT NULL DEFAULT 'fixed' CHECK (kind IN ('fixed', 'mobile')),
  speed_limit integer NOT NULL CHECK (speed_limit BETWEEN 1 AND 400),
  active boolean NOT NULL DEFAULT true,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX speed_cameras_name ON speed_cameras (lower(name));

CREATE SEQUENCE speed_ticket_seq;
CREATE TABLE speed_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number text NOT NULL UNIQUE,
  -- Standorte mit Rechnungen lassen sich nicht löschen, nur abschalten
  camera_id uuid NOT NULL REFERENCES speed_cameras ON DELETE RESTRICT,
  measured_at timestamptz NOT NULL,
  plate text NOT NULL CHECK (length(plate) BETWEEN 1 AND 20),
  vehicle_id uuid REFERENCES vehicles ON DELETE SET NULL,
  person_id uuid REFERENCES people ON DELETE RESTRICT,
  -- Kopie vom Standort zum Zeitpunkt der Messung, ein späterer Wechsel ändert alte Rechnungen nicht
  speed_limit integer NOT NULL CHECK (speed_limit BETWEEN 1 AND 400),
  measured_kmh integer NOT NULL CHECK (measured_kmh BETWEEN 1 AND 1000),
  tolerance_kmh integer NOT NULL DEFAULT 0 CHECK (tolerance_kmh BETWEEN 0 AND 100),
  amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  person_file_entry_id uuid REFERENCES person_file_entries ON DELETE SET NULL,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  updated_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON speed_tickets (measured_at DESC);
CREATE INDEX ON speed_tickets (camera_id);
CREATE INDEX ON speed_tickets (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX ON speed_tickets (lower(plate));
