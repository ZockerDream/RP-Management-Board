-- Musik (Wunsch des Auftraggebers vom 2026-11-13): Spotify-Steuerung über die offizielle Web-API. Jeder Benutzer
-- verbindet sein eigenes Konto; die Tokens liegen verschlüsselt in provider_connections wie bei Google/Microsoft.
-- Musik vom Server braucht keine Tabelle, die Dateien liegen im Verzeichnis MUSIC_DIR.
ALTER TABLE provider_connections DROP CONSTRAINT IF EXISTS provider_connections_provider_check;
ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_provider_check CHECK (provider IN ('google', 'microsoft', 'spotify'));
ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_provider_check;
ALTER TABLE oauth_states ADD CONSTRAINT oauth_states_provider_check CHECK (provider IN ('google', 'microsoft', 'spotify'));
