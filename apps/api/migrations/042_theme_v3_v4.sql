-- Designs V3 und V4 (Wunsch des Auftraggebers vom 2026-11-13): V3 „Modern“ (schlichte dunkle Flächen, Navigation oben als
-- Pillen) und V4 „Modern Glass“ (dasselbe Format mit Glas und Hintergrund wie V2), wählbar neben V1 und V2.
-- Der Auswahldialog erscheint für alle einmal neu beim ersten Login nach dem Update.
ALTER TABLE users DROP CONSTRAINT users_ui_version_check;
ALTER TABLE users ADD CONSTRAINT users_ui_version_check CHECK (ui_version IN ('v1', 'v2', 'v3', 'v4'));
UPDATE users SET ui_choice_seen = false;
