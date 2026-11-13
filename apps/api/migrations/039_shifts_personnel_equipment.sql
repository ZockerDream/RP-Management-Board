-- Dienst Block B (Wünsche des Auftraggebers vom 2026-11-13): Dienstplan, Bewerbungen, Personalakte, Lager.
-- Funktionen und Stufen stehen schon in Migration 038 (shifts, recruiting, personnel, equipment).

-- ---------- Dienstplan: Vorlagen (Früh, Spät, Nacht …), Schichten mit Plätzen, Einteilungen
CREATE TABLE shift_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  starts time NOT NULL,
  ends time NOT NULL,
  slots integer NOT NULL DEFAULT 2 CHECK (slots BETWEEN 1 AND 100),
  color text NOT NULL DEFAULT 'primary' CHECK (color IN ('primary', 'ok', 'warn', 'bad', 'neutral')),
  sort integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX shift_templates_name ON shift_templates (team_id, lower(name));

CREATE TABLE shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  slots integer NOT NULL DEFAULT 1 CHECK (slots BETWEEN 1 AND 100),
  color text NOT NULL DEFAULT 'primary',
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  template_id uuid REFERENCES shift_templates ON DELETE SET NULL,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX ON shifts (team_id, starts_at);

-- assigned = eingeteilt, offered = zum Tausch angeboten (zählt weiter, bis jemand übernimmt), sick = krank gemeldet
-- (bleibt als Nachweis, gibt den Platz frei)
CREATE TABLE shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES shifts ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'offered', 'sick')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shift_id, user_id)
);
CREATE INDEX ON shift_assignments (user_id);

-- ---------- Bewerbungen: Mitglieder pflegen Bewerber; bei Annahme wird ein verknüpfter Benutzer Mitglied mit Rang
CREATE TABLE applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  contact text NOT NULL DEFAULT '' CHECK (length(contact) <= 200),
  user_id uuid REFERENCES users ON DELETE SET NULL,
  person_id uuid REFERENCES people ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'interview', 'accepted', 'rejected', 'withdrawn')),
  interview_at timestamptz,
  rank_id uuid REFERENCES team_ranks ON DELETE SET NULL,
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  decision_note text NOT NULL DEFAULT '' CHECK (length(decision_note) <= 2000),
  decided_by uuid REFERENCES users ON DELETE SET NULL,
  decided_at timestamptz,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON applications (team_id, status, created_at DESC);
CREATE TABLE application_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications ON DELETE CASCADE,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON application_notes (application_id, created_at);

-- ---------- Personalakte: Verlauf je Mitglied; Rang vorher/nachher als Text, damit spätere Umbenennungen nichts ändern
CREATE TABLE personnel_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('hired', 'promotion', 'demotion', 'commendation', 'warning', 'note', 'left')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 10000),
  rank_from text,
  rank_to text,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON personnel_entries (team_id, user_id, entry_date DESC);

-- ---------- Lager & Ausrüstung: Stücke mit Seriennummer, Ausgabe an Mitglieder mit Rückgabe
CREATE TABLE equipment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  category text NOT NULL DEFAULT '' CHECK (length(category) <= 60),
  serial text NOT NULL DEFAULT '' CHECK (length(serial) <= 60),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'issued', 'maintenance', 'lost', 'retired')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON equipment_items (team_id, category, name);
CREATE UNIQUE INDEX equipment_items_serial ON equipment_items (team_id, lower(serial)) WHERE serial <> '' AND status <> 'retired';
CREATE TABLE equipment_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES equipment_items ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid REFERENCES users ON DELETE SET NULL,
  due_on date,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  returned_at timestamptz,
  returned_by uuid REFERENCES users ON DELETE SET NULL,
  return_note text NOT NULL DEFAULT '' CHECK (length(return_note) <= 500)
);
-- Ein Stück ist höchstens einmal gleichzeitig ausgegeben
CREATE UNIQUE INDEX equipment_issues_open ON equipment_issues (item_id) WHERE returned_at IS NULL;
CREATE INDEX ON equipment_issues (user_id) WHERE returned_at IS NULL;
