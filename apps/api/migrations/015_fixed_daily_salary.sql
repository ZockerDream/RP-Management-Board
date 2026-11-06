-- Gehalt: festes Tagesgehalt, dazu je Stunde über dem Wochen-Soll ein Bonus in Prozent des Festgehalts.
-- hourly_rate wird nicht mehr genutzt; die Spalte bleibt, damit der alte Wert nachvollziehbar ist.
ALTER TABLE users ADD COLUMN daily_salary numeric(12, 2) NOT NULL DEFAULT 0 CHECK (daily_salary >= 0);
UPDATE users SET daily_salary = round(weekly_work_hours * hourly_rate / 7, 2);
ALTER TABLE users RENAME COLUMN overtime_surcharge_percent TO hourly_bonus_percent;

-- Der E-Mail-Schalter wirkte bisher nur bei Terminen, war aber überall vorausgewählt.
-- Jetzt wirkt er bei allen Arten, deshalb beginnen die übrigen wieder ohne Mail.
UPDATE notification_prefs SET email = false WHERE kind NOT IN ('calendar', 'todo_due', 'ticket_comment');
