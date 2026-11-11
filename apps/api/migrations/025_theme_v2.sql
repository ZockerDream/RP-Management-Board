-- Darstellung V2 (Wunsch des Auftraggebers vom 2026-11-11): Jeder Benutzer wählt zwischen V1 (klassisch) und V2 (Glas-Panels
-- über einem Hintergrund). ui_prefs hält Hintergrund-Vorlage, Unschärfe, Deckkraft, Abdunkeln, den Handy-Modus und das eigene
-- Dashboard-Layout (Regeln in src/ui-prefs.js). Ein eigenes Hintergrundbild liegt im Upload-Volume unter background_key.
ALTER TABLE users
  ADD COLUMN ui_version text NOT NULL DEFAULT 'v1' CHECK (ui_version IN ('v1', 'v2')),
  ADD COLUMN ui_prefs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(ui_prefs) = 'object'),
  ADD COLUMN background_key text,
  ADD COLUMN background_updated_at timestamptz;
