-- Fuhrpark (Wunsch des Auftraggebers vom 2026-11-11): Fahrzeuge einer Organisation in Gruppen, gespeicherte
-- Kontrollrunden mit „Erledigt“ und Markdown-Ausgabe. Unabhängig vom Objekt-Management (vehicles).
CREATE TABLE fleet_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  show_model boolean NOT NULL DEFAULT false,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX fleet_groups_team_name ON fleet_groups (team_id, lower(name));

CREATE TABLE fleet_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES fleet_groups ON DELETE RESTRICT,
  plate text NOT NULL CHECK (length(plate) BETWEEN 1 AND 20),
  model text NOT NULL DEFAULT '' CHECK (length(model) <= 100),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  sort integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Kennzeichen nur unter aktiven Fahrzeugen eindeutig, ausgemusterte geben es frei
CREATE UNIQUE INDEX fleet_vehicles_team_plate ON fleet_vehicles (team_id, lower(plate)) WHERE active;
CREATE INDEX ON fleet_vehicles (group_id);

CREATE TABLE fleet_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  checked_on date NOT NULL,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  done_by uuid REFERENCES users ON DELETE SET NULL,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON fleet_checks (team_id, checked_on DESC);

-- Gruppe, Kennzeichen und Modell sind Kopien vom Tag der Runde: alte Listen ändern sich nicht mit den Stammdaten
CREATE TABLE fleet_check_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id uuid NOT NULL REFERENCES fleet_checks ON DELETE CASCADE,
  vehicle_id uuid REFERENCES fleet_vehicles ON DELETE SET NULL,
  group_name text NOT NULL,
  group_sort integer NOT NULL DEFAULT 0,
  show_model boolean NOT NULL DEFAULT false,
  plate text NOT NULL,
  model text NOT NULL DEFAULT '',
  vehicle_sort integer NOT NULL DEFAULT 0,
  odometer_km integer CHECK (odometer_km >= 0),
  last_service_on date,
  first_aid_kit_until date,
  accessories_complete boolean NOT NULL DEFAULT false,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  UNIQUE (check_id, vehicle_id)
);
CREATE INDEX ON fleet_check_items (vehicle_id);

-- Standard-Ränge einer neuen Organisation. Die Funktionen und Stufen müssen zu ORG_MODULES in src/org.js passen.
-- Fuhrpark: Kontrollieren soll nur das Team des Fuhrparkmanagers (Gruppe der Organisation), deshalb Mitglied nur Lesen.
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
    ('fleet', 4, 2, 2)
  ) d(module, lead, member, reader);
END
$$;

-- Bestehende Organisationen: der höchste Rang verwaltet den Fuhrpark, alle anderen lesen
INSERT INTO team_permissions (team_id, rank_id, module, level)
SELECT r.team_id, r.id, 'fleet',
  CASE WHEN r.position = (SELECT max(x.position) FROM team_ranks x WHERE x.team_id = r.team_id) THEN 4 ELSE 2 END
FROM team_ranks r
ON CONFLICT DO NOTHING;

-- Eigene Rollen bekommen neue Katalogrechte sonst nicht; Admin und User setzt seed.js beim Start
INSERT INTO permissions (key) VALUES ('fleet:read'), ('fleet:create'), ('fleet:update'), ('fleet:delete') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT ro.id, p.id FROM roles ro CROSS JOIN permissions p
WHERE NOT ro.is_system AND p.key IN ('fleet:read', 'fleet:create', 'fleet:update', 'fleet:delete')
ON CONFLICT DO NOTHING;
