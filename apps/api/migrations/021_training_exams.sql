-- Test im Tool für Schulungen (Wunsch des Auftraggebers vom 2026-11-09): pro Schulung abschaltbar. Mit Test bestehen Benutzer
-- nur über einen bestandenen Versuch; ohne Test reicht wie bisher Teilnahme und „bestanden“ durch den Ausbilder.
ALTER TABLE trainings
  ADD COLUMN exam_required boolean NOT NULL DEFAULT false,
  ADD COLUMN exam_pass_percent smallint NOT NULL DEFAULT 70 CHECK (exam_pass_percent BETWEEN 1 AND 100),
  ADD COLUMN exam_time_limit smallint CHECK (exam_time_limit BETWEEN 1 AND 600),
  ADD COLUMN exam_max_attempts smallint CHECK (exam_max_attempts BETWEEN 1 AND 100),
  ADD COLUMN exam_shuffle boolean NOT NULL DEFAULT true,
  ADD COLUMN exam_after_session boolean NOT NULL DEFAULT false;

-- Fragen: Einfach- oder Mehrfachauswahl; options = [{ "id": "o1", "text": "…", "correct": true }]
CREATE TABLE training_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_id uuid NOT NULL REFERENCES trainings ON DELETE CASCADE,
  sort integer NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'single' CHECK (kind IN ('single', 'multiple')),
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  options jsonb NOT NULL CHECK (jsonb_typeof(options) = 'array'),
  points smallint NOT NULL DEFAULT 1 CHECK (points BETWEEN 1 AND 100),
  explanation text NOT NULL DEFAULT '' CHECK (length(explanation) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON training_questions (training_id, sort);

-- Versuche: Reihenfolge der Fragen und Antworten je Versuch, Antworten als { frageId: [antwortId, …] }.
-- counted = false nach „Versuche zurücksetzen“ durch den Ausbilder; höchstens ein offener Versuch je Person und Schulung.
CREATE TABLE training_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_id uuid NOT NULL REFERENCES trainings ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted', 'expired')),
  started_at timestamptz NOT NULL DEFAULT now(),
  deadline timestamptz,
  submitted_at timestamptz,
  layout jsonb NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}',
  score integer,
  max_score integer,
  percent smallint,
  passed boolean,
  counted boolean NOT NULL DEFAULT true,
  record_id uuid REFERENCES training_records ON DELETE SET NULL
);
CREATE INDEX ON training_attempts (training_id, user_id);
CREATE UNIQUE INDEX training_attempts_open ON training_attempts (training_id, user_id) WHERE status = 'open';
