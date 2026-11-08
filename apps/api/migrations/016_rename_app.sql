-- Die App heißt jetzt RP-Management-Board. Ersetzt wird nur der gespeicherte alte Standardname,
-- ein selbst gewählter App-Name bleibt erhalten.
UPDATE settings SET value = to_jsonb('RP-Management-Board'::text)
 WHERE key = 'general.app_name' AND value = to_jsonb('Budget Manager'::text);
