-- Runden statt Distanz (Wunsch des Auftraggebers vom 2026-11-12): Eine Strecke hat Name, Checkpoints und Rundenanzahl.
-- Vorhandene Distanzen wandern in die Notizen der Strecke, damit nichts verloren geht.
ALTER TABLE sport_routes ADD COLUMN laps integer NOT NULL DEFAULT 1 CHECK (laps BETWEEN 1 AND 1000);
UPDATE sport_routes
   SET notes = CASE WHEN notes = '' THEN '' ELSE notes || E'\n\n' END
            || 'Distanz (vor der Umstellung auf Runden): ' || replace(trim(trailing '.' FROM trim(trailing '0' FROM distance_km::text)), '.', ',') || ' km'
 WHERE distance_km IS NOT NULL;
ALTER TABLE sport_routes DROP COLUMN distance_km;
