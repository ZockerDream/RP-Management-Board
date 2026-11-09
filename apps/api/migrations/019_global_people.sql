-- Personen sind global (Entscheidung des Auftraggebers vom 2026-11-09): Es gibt eine gemeinsame Liste für das ganze System.
-- Jeder mit „Personen lesen“ sieht alle Personen und kann sie in Schlüsseln, Häusern, Akten, Lizenzen und Schulungen
-- verwenden; Anlegen, Ändern und Löschen regeln allein die Rollenrechte person:create/update/delete.
-- Bisher waren Personen privat oder einer Organisation zugeordnet. Die Zuordnung entfällt, die Personen bleiben samt
-- allen Verweisen erhalten. Mit den Spalten verschwinden auch die Kaskaden: Löscht jemand sein Konto oder eine
-- Organisation, bleiben die Personen bestehen.
ALTER TABLE people DROP COLUMN owner_user_id, DROP COLUMN team_id;

-- Organisationen haben keine Funktion „Personen“ mehr
DELETE FROM team_permissions WHERE module = 'person';

-- Standard-Ränge einer neuen Organisation. Die Funktionen und Stufen müssen zu ORG_MODULES in src/org.js passen.
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
    ('key', 4, 4, 2), ('casefile', 4, 4, 2), ('training', 4, 4, 2), ('license', 4, 4, 2), ('doc', 4, 4, 2)
  ) d(module, lead, member, reader);
END
$$;
