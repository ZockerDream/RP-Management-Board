-- Blitzer (Wunsch des Auftraggebers vom 2026-11-13): Standorte bekommen ein Bild, die Blitzer-Rechnungen entfallen
-- samt Akteneintrag-Knopf. Bereits erzeugte Einträge in Personenakten bleiben (sie gehören der Personenakte).
DROP TABLE speed_tickets;
DROP SEQUENCE speed_ticket_seq;
ALTER TABLE speed_cameras ADD COLUMN photo_key text, ADD COLUMN photo_mime text,
  ADD CONSTRAINT speed_cameras_photo CHECK ((photo_key IS NULL) = (photo_mime IS NULL));
