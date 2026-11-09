-- Organisationen (in Code und Datenbank weiter "team"): Ränge mit Reihenfolge, Gruppen und Rechte pro Funktion.
-- Recht eines Mitglieds in einer Funktion: Inhaber dürfen alles. Sonst gilt ein persönlich gesetztes Recht genau so,
-- ohne persönliches Recht das höchste aus Rang und Gruppen. Je Rang, Gruppe oder Benutzer geht eine Zeile für eine
-- Aktenart oder Doku-Kategorie (scope_id) der Zeile für die ganze Funktion vor.
-- Stufen: 0 kein Zugriff, 1 teilnehmen, 2 lesen, 3 lesen und schreiben, 4 verwalten.

CREATE TABLE team_ranks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, id),
  UNIQUE (team_id, name),
  -- Tauschen zweier Ränge in einer Transaktion
  CONSTRAINT team_ranks_position UNIQUE (team_id, position) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE team_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, id),
  UNIQUE (team_id, name)
);

-- Ein gelöschter Rang darf das Mitglied nicht mitnehmen; die API lehnt das Löschen benutzter Ränge ohnehin ab
ALTER TABLE team_members
  ADD COLUMN is_owner boolean NOT NULL DEFAULT false,
  ADD COLUMN rank_id uuid,
  ADD CONSTRAINT team_members_rank FOREIGN KEY (team_id, rank_id) REFERENCES team_ranks (team_id, id) ON DELETE SET NULL (rank_id);

CREATE TABLE team_group_members (
  group_id uuid NOT NULL,
  team_id uuid NOT NULL,
  user_id uuid NOT NULL,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (team_id, group_id) REFERENCES team_groups (team_id, id) ON DELETE CASCADE,
  FOREIGN KEY (team_id, user_id) REFERENCES team_members (team_id, user_id) ON DELETE CASCADE
);
CREATE INDEX ON team_group_members (team_id, user_id);

CREATE TABLE team_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  rank_id uuid,
  group_id uuid,
  user_id uuid,
  module text NOT NULL CHECK (length(module) BETWEEN 1 AND 40),
  scope_id uuid,
  level smallint NOT NULL CHECK (level BETWEEN 0 AND 4),
  CHECK (num_nonnulls(rank_id, group_id, user_id) = 1),
  FOREIGN KEY (team_id, rank_id) REFERENCES team_ranks (team_id, id) ON DELETE CASCADE,
  FOREIGN KEY (team_id, group_id) REFERENCES team_groups (team_id, id) ON DELETE CASCADE,
  FOREIGN KEY (team_id, user_id) REFERENCES team_members (team_id, user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX team_permissions_rank ON team_permissions (rank_id, module, scope_id) NULLS NOT DISTINCT WHERE rank_id IS NOT NULL;
CREATE UNIQUE INDEX team_permissions_group ON team_permissions (group_id, module, scope_id) NULLS NOT DISTINCT WHERE group_id IS NOT NULL;
CREATE UNIQUE INDEX team_permissions_user ON team_permissions (team_id, user_id, module, scope_id) NULLS NOT DISTINCT WHERE user_id IS NOT NULL;
CREATE INDEX ON team_permissions (team_id, module);

-- Aktenarten: Rechte pro Art, Akten einer Art lassen sich nicht ohne Art weiterführen
CREATE TABLE case_file_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users ON DELETE CASCADE,
  team_id uuid REFERENCES teams ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NOT NULL) <> (team_id IS NOT NULL))
);
CREATE UNIQUE INDEX case_file_types_team_name ON case_file_types (team_id, lower(name)) WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX case_file_types_owner_name ON case_file_types (owner_user_id, lower(name)) WHERE owner_user_id IS NOT NULL;

-- Kaskade nur für das Löschen einer ganzen Organisation; eine benutzte Aktenart lehnt die API ab
ALTER TABLE case_files
  ADD COLUMN type_id uuid REFERENCES case_file_types ON DELETE CASCADE,
  ADD COLUMN restricted boolean NOT NULL DEFAULT false;
CREATE INDEX ON case_files (type_id) WHERE type_id IS NOT NULL;

-- Beschränkte Akte: sichtbar nur für diese Ränge (und alle höheren), Gruppen und Benutzer, dazu Inhaber und Ersteller.
-- Fällt ein Rang oder eine Gruppe weg, bleibt die Akte beschränkt (restricted) und wird nicht plötzlich für alle sichtbar.
CREATE TABLE case_file_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_file_id uuid NOT NULL REFERENCES case_files ON DELETE CASCADE,
  rank_id uuid REFERENCES team_ranks ON DELETE CASCADE,
  group_id uuid REFERENCES team_groups ON DELETE CASCADE,
  user_id uuid REFERENCES users ON DELETE CASCADE,
  CHECK (num_nonnulls(rank_id, group_id, user_id) = 1)
);
CREATE INDEX ON case_file_access (case_file_id);

-- ---------- Rechte berechnen
CREATE FUNCTION team_level(p_team uuid, p_user uuid, p_module text, p_scope uuid DEFAULT NULL) RETURNS smallint
LANGUAGE sql STABLE AS $$
  WITH member AS (
    SELECT is_owner, rank_id FROM team_members WHERE team_id = p_team AND user_id = p_user
  ), subject_rows AS (
    SELECT p.user_id IS NOT NULL AS personal, COALESCE(p.rank_id, p.group_id, p.user_id) AS subject, p.scope_id, p.level
    FROM team_permissions p
    WHERE p.team_id = p_team AND p.module = p_module AND (p.scope_id IS NULL OR p.scope_id = p_scope)
      AND (p.user_id = p_user
        OR p.rank_id = (SELECT rank_id FROM member)
        OR p.group_id IN (SELECT gm.group_id FROM team_group_members gm WHERE gm.team_id = p_team AND gm.user_id = p_user))
  ), per_subject AS (
    SELECT DISTINCT ON (subject) personal, level FROM subject_rows ORDER BY subject, scope_id IS NULL
  )
  SELECT (CASE
    WHEN NOT EXISTS (SELECT 1 FROM member) THEN 0
    WHEN (SELECT is_owner FROM member) THEN 4
    ELSE COALESCE((SELECT level FROM per_subject WHERE personal), (SELECT max(level) FROM per_subject WHERE NOT personal), 0)
  END)::smallint
$$;

-- Stufe für eine Akte: wie ihre Aktenart, bei einer beschränkten Akte nur für die freigegebenen Mitglieder
CREATE FUNCTION case_file_level(p_file uuid, p_user uuid) RETURNS smallint
LANGUAGE sql STABLE AS $$
  SELECT (CASE
    WHEN c.owner_user_id IS NOT NULL THEN CASE WHEN c.owner_user_id = p_user THEN 4 ELSE 0 END
    WHEN NOT c.restricted OR c.created_by = p_user
      OR EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = c.team_id AND tm.user_id = p_user AND tm.is_owner)
      OR EXISTS (SELECT 1 FROM case_file_access a WHERE a.case_file_id = c.id AND (
        a.user_id = p_user
        OR a.group_id IN (SELECT gm.group_id FROM team_group_members gm WHERE gm.team_id = c.team_id AND gm.user_id = p_user)
        OR a.rank_id IN (SELECT r.id FROM team_ranks r
          JOIN team_members tm ON tm.team_id = r.team_id AND tm.user_id = p_user
          JOIN team_ranks mine ON mine.id = tm.rank_id
          WHERE r.team_id = c.team_id AND r.position <= mine.position)))
    THEN team_level(c.team_id, p_user, 'casefile', c.type_id)
    ELSE 0
  END)::smallint
  FROM case_files c WHERE c.id = p_file
$$;

-- Standard-Ränge einer neuen Organisation. Die Funktionen und Stufen müssen zu ORG_MODULES in src/org.js passen.
CREATE FUNCTION seed_team_ranks(p_team uuid) RETURNS void LANGUAGE plpgsql AS $$
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
    ('todos', 3, 3, 2), ('sport', 3, 3, 2), ('vehicle', 4, 4, 2), ('property', 4, 4, 2), ('person', 4, 4, 2),
    ('key', 4, 4, 2), ('casefile', 4, 4, 2), ('training', 4, 4, 2), ('license', 4, 4, 2), ('doc', 4, 4, 2)
  ) d(module, lead, member, reader);
END
$$;

-- ---------- Bestehende Teams übernehmen: Owner werden Inhaber mit Rang Leitung, Editoren Mitglieder, Viewer Leser
SELECT seed_team_ranks(id) FROM teams;
UPDATE team_members tm SET is_owner = (tm.team_role = 'owner'),
  rank_id = (SELECT r.id FROM team_ranks r WHERE r.team_id = tm.team_id
    AND r.position = CASE tm.team_role WHEN 'owner' THEN 30 WHEN 'editor' THEN 20 ELSE 10 END);
ALTER TABLE team_members DROP COLUMN team_role;

ALTER TABLE invitations ADD COLUMN rank_id uuid REFERENCES team_ranks ON DELETE SET NULL;
UPDATE invitations i SET rank_id = (SELECT r.id FROM team_ranks r WHERE r.team_id = i.team_id
  AND r.position = CASE i.team_role WHEN 'editor' THEN 20 ELSE 10 END) WHERE i.team_id IS NOT NULL;
ALTER TABLE invitations DROP COLUMN team_role;
