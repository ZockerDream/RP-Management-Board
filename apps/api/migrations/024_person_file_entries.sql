-- Einträge direkt in der Personenakte (Wunsch des Auftraggebers vom 2026-11-10): chronologische Einträge zu einer
-- Person ohne Fallakte. Sie gehören wie person_files einem Bereich (Organisation oder privat) und folgen dessen Recht
-- für Akten; andere Bereiche sehen sie nicht.
CREATE TABLE person_file_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES people ON DELETE CASCADE,
  owner_user_id uuid REFERENCES users ON DELETE CASCADE,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  kind text NOT NULL DEFAULT '' CHECK (length(kind) <= 60),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  created_by uuid REFERENCES users ON DELETE SET NULL,
  updated_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NOT NULL) <> (team_id IS NOT NULL))
);
CREATE INDEX ON person_file_entries (person_id, entry_date DESC);
CREATE INDEX ON person_file_entries (team_id) WHERE team_id IS NOT NULL;
CREATE INDEX ON person_file_entries (owner_user_id) WHERE owner_user_id IS NOT NULL;
