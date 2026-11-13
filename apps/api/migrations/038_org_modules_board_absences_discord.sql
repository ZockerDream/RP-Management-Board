-- Neue Funktionen für Organisationen (Wünsche des Auftraggebers vom 2026-11-13). Hier stehen alle neuen Funktionen
-- samt Standardstufen, die Tabellen kommen je Block: Pinnwand (Ankündigungen, Umfragen), Abwesenheiten und Discord
-- jetzt; Dienstplan, Einsätze & Funk, Bewerbungen, Personalakte, Lager, Rechnungen und Kasse in den folgenden Migrationen.

CREATE OR REPLACE FUNCTION seed_team_ranks(p_team uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  lead_id uuid;
  member_id uuid;
  reader_id uuid;
BEGIN
  INSERT INTO team_ranks (team_id, name, position) VALUES (p_team, 'Leitung', 30) RETURNING id INTO lead_id;
  INSERT INTO team_ranks (team_id, name, position) VALUES (p_team, 'Mitglied', 20) RETURNING id INTO member_id;
  INSERT INTO team_ranks (team_id, name, position) VALUES (p_team, 'Leser', 10) RETURNING id INTO reader_id;
  INSERT INTO team_permissions (team_id, rank_id, module, level)
  SELECT p_team, r.id, d.module, CASE r.kind WHEN 'lead' THEN d.lead WHEN 'member' THEN d.member ELSE d.reader END
  FROM (VALUES (lead_id, 'lead'), (member_id, 'member'), (reader_id, 'reader')) r(id, kind)
  CROSS JOIN (VALUES
    ('members', 4, 2, 2), ('budget', 4, 3, 2), ('work', 4, 3, 1), ('calendar', 3, 3, 2), ('notes', 3, 3, 2),
    ('todos', 3, 3, 2), ('sport', 3, 3, 2), ('vehicle', 4, 4, 2), ('property', 4, 4, 2),
    ('key', 4, 4, 2), ('casefile', 4, 4, 2), ('training', 4, 4, 2), ('license', 4, 4, 2), ('doc', 4, 4, 2),
    ('fleet', 4, 2, 2),
    ('notices', 4, 2, 2), ('shifts', 4, 2, 2), ('absences', 4, 2, 0), ('dispatch', 4, 3, 2), ('recruiting', 4, 0, 0),
    ('personnel', 4, 0, 0), ('equipment', 4, 2, 2), ('invoices', 4, 3, 2), ('cash', 4, 3, 2)
  ) d(module, lead, member, reader);
END
$$;

-- Bestehende Organisationen: der höchste Rang verwaltet, die anderen wie ein neues „Mitglied“
INSERT INTO team_permissions (team_id, rank_id, module, level)
SELECT r.team_id, r.id, d.module,
  CASE WHEN r.position = (SELECT max(x.position) FROM team_ranks x WHERE x.team_id = r.team_id) THEN 4 ELSE d.member END
FROM team_ranks r
CROSS JOIN (VALUES ('notices', 2), ('shifts', 2), ('absences', 2), ('dispatch', 3), ('recruiting', 0), ('personnel', 0),
  ('equipment', 2), ('invoices', 3), ('cash', 3)) d(module, member)
ON CONFLICT DO NOTHING;

-- Eigene Rollen bekommen neue Katalogrechte sonst nicht; Admin und User setzt seed.js beim Start
INSERT INTO permissions (key)
SELECT r || ':' || a FROM unnest(ARRAY['notice', 'shift', 'absence', 'dispatch', 'recruit', 'personnel', 'equipment', 'invoice', 'cash']) r
CROSS JOIN unnest(ARRAY['read', 'create', 'update', 'delete']) a
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT ro.id, p.id FROM roles ro JOIN permissions p ON p.key ~ '^(notice|shift|absence|dispatch|recruit|personnel|equipment|invoice|cash):'
WHERE NOT ro.is_system
ON CONFLICT DO NOTHING;

-- ---------- Pinnwand: Ankündigungen an die ganze Organisation oder an Ränge (samt allen höheren), mit „gelesen von“
CREATE TABLE notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 20000),
  -- leer = alle Mitglieder; sonst diese Ränge und alle Ränge darüber
  rank_ids uuid[] NOT NULL DEFAULT '{}',
  pinned boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON notices (team_id, created_at DESC);
CREATE TABLE notice_reads (
  notice_id uuid NOT NULL REFERENCES notices ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, user_id)
);

-- ---------- Umfragen: eine oder mehrere Antworten, anonym (nur Zahlen) oder namentlich, optional mit Ende
CREATE TABLE polls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  question text NOT NULL CHECK (length(question) BETWEEN 1 AND 300),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
  options jsonb NOT NULL,
  multiple boolean NOT NULL DEFAULT false,
  anonymous boolean NOT NULL DEFAULT false,
  closes_at timestamptz,
  closed_at timestamptz,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON polls (team_id, created_at DESC);
CREATE TABLE poll_votes (
  poll_id uuid NOT NULL REFERENCES polls ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  option_ids text[] NOT NULL,
  voted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, user_id)
);

-- ---------- Abwesenheiten: Urlaub, krank, inaktiv, sonstiges; eigene meldet jedes Mitglied selbst
CREATE TABLE absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('vacation', 'sick', 'inactive', 'other')),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX ON absences (team_id, starts_on, ends_on);
CREATE INDEX ON absences (user_id);

-- ---------- Discord: Webhook je Organisation (verschlüsselt) und welche Ereignisse dorthin gehen
CREATE TABLE team_discord (
  team_id uuid PRIMARY KEY REFERENCES teams ON DELETE CASCADE,
  webhook_enc text NOT NULL,
  events text[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES users ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
