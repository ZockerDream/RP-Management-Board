-- Musik (Wünsche des Auftraggebers vom 2026-11-13): Jeder meldet sich selbst mit seinem Spotify-Konto an, deshalb
-- PKCE (kein Client-Secret nötig) und optional eine eigene Spotify-App je Benutzer; die Musik vom Server bekommt einen
-- Upload. Hochgeladene Dateien liegen im Upload-Volume (Unterordner music) unter zufälligem Namen.
ALTER TABLE oauth_states ADD COLUMN code_verifier text, ADD COLUMN client_id text;
ALTER TABLE provider_connections ADD COLUMN client_id text;
ALTER TABLE users ADD COLUMN spotify_client_id text CHECK (spotify_client_id ~ '^[0-9a-zA-Z]{20,64}$');

CREATE TABLE music_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key text NOT NULL UNIQUE,
  folder text NOT NULL CHECK (length(folder) BETWEEN 1 AND 100),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  original_name text NOT NULL DEFAULT '',
  mime text NOT NULL,
  size bigint NOT NULL CHECK (size > 0),
  uploaded_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON music_files (lower(folder), lower(title));
