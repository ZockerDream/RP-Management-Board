-- Musik-Empfehlungen (Wunsch des Auftraggebers vom 2026-11-13): ein kleines Dashboard auf der Musikseite mit
-- eingebetteten Spotify-Playlists, -Alben und -Titeln, gepflegt mit music:update (Rolle „User“ hat es nicht).
CREATE TABLE music_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('playlist', 'album', 'track', 'artist', 'episode', 'show')),
  spotify_id text NOT NULL CHECK (spotify_id ~ '^[0-9A-Za-z]{10,40}$'),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  size text NOT NULL DEFAULT 'compact' CHECK (size IN ('compact', 'large')),
  sort integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX music_recommendations_item ON music_recommendations (kind, spotify_id);
