-- Einmalige Auswahl des Designs nach dem Login (Wunsch des Auftraggebers vom 2026-11-11): Jeder Benutzer sieht beim
-- nächsten Login einmal den Dialog V1/V2. Wer schon auf V2 umgestellt hat, hat bereits gewählt.
ALTER TABLE users ADD COLUMN ui_choice_seen boolean NOT NULL DEFAULT false;
UPDATE users SET ui_choice_seen = true WHERE ui_version = 'v2';
