-- Sport ohne Punkte (Wunsch des Auftraggebers vom 2026-11-12): Ergebnisse sind Zeiten im Format MM:SS:hh,
-- gespeichert in Millisekunden. Vorhandene Zeiten in Sekunden werden übernommen, die Punkte entfallen.
ALTER TABLE sport_scores ADD COLUMN duration_ms bigint CHECK (duration_ms >= 0);
UPDATE sport_scores SET duration_ms = duration_seconds::bigint * 1000 WHERE duration_seconds IS NOT NULL;
DROP INDEX IF EXISTS sport_scores_route_id_score_idx;
ALTER TABLE sport_scores DROP COLUMN score, DROP COLUMN duration_seconds;
CREATE INDEX ON sport_scores (route_id, duration_ms);
