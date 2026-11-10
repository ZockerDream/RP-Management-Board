-- Notiz-Tags und Archiv (Wünsche des Auftraggebers vom 2026-11-10)
-- Tags: systemweit im Server-Management verwaltet, beliebig viele je Notiz, reine Markierung mit Filter.
CREATE TABLE note_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 30 AND name = btrim(name)),
  color text NOT NULL DEFAULT 'neutral' CHECK (color IN ('neutral', 'primary', 'ok', 'warn', 'bad')),
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX note_tags_name_unique ON note_tags (lower(name));

CREATE TABLE note_tag_links (
  note_id uuid NOT NULL REFERENCES notes ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES note_tags ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);
CREATE INDEX ON note_tag_links (tag_id);

INSERT INTO note_tags (name, color, position) VALUES
  ('BLOCKED', 'bad', 1),
  ('INVALID', 'neutral', 2),
  ('DONE', 'ok', 3),
  ('WIP', 'primary', 4);

-- Archiv: eigener Knopf statt Tag; archivierte Notizen stehen nur in der Ansicht „Archiv“ bzw. „Alle“
-- und gelten für alle, die die Notiz sehen.
ALTER TABLE notes
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid REFERENCES users ON DELETE SET NULL;
