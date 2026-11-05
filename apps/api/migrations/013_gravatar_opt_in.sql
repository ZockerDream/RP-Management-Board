-- Gravatar sendet einen E-Mail-Hash an Dritte und darf nur mit Einwilligung genutzt werden.
ALTER TABLE users ALTER COLUMN gravatar_enabled SET DEFAULT false;
UPDATE users SET gravatar_enabled = false;
