-- Erreichte Checkpoints entfallen (Wunsch des Auftraggebers vom 2026-11-12): Eine Zeit gilt nur mit allen Checkpoints
-- der Strecke, die Bestenliste sortiert allein nach der Zeit. Die Anzahl Checkpoints der Strecke bleibt.
ALTER TABLE sport_scores DROP COLUMN checkpoints_reached;
