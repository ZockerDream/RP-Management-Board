ALTER TABLE properties ADD COLUMN cost_interval_count integer NOT NULL DEFAULT 1
  CHECK (cost_interval_count BETWEEN 1 AND 3650);
ALTER TABLE vehicles ADD COLUMN cost_interval_count integer NOT NULL DEFAULT 1
  CHECK (cost_interval_count BETWEEN 1 AND 3650);
ALTER TABLE keys ADD COLUMN cost_interval_count integer NOT NULL DEFAULT 1
  CHECK (cost_interval_count BETWEEN 1 AND 3650);

UPDATE properties SET cost_interval='monthly', cost_interval_count=3 WHERE cost_interval='quarterly';
UPDATE vehicles SET cost_interval='monthly', cost_interval_count=3 WHERE cost_interval='quarterly';
UPDATE keys SET cost_interval='monthly', cost_interval_count=3 WHERE cost_interval='quarterly';

ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_cost_interval_check;
ALTER TABLE properties ADD CONSTRAINT properties_cost_interval_check
  CHECK (cost_interval IN ('once', 'daily', 'weekly', 'monthly', 'yearly', 'custom'));
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_cost_interval_check;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_cost_interval_check
  CHECK (cost_interval IN ('once', 'daily', 'weekly', 'monthly', 'yearly', 'custom'));
ALTER TABLE keys DROP CONSTRAINT IF EXISTS keys_cost_interval_check;
ALTER TABLE keys ADD CONSTRAINT keys_cost_interval_check
  CHECK (cost_interval IN ('once', 'daily', 'weekly', 'monthly', 'yearly', 'custom'));

ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_installment_frequency_check;
ALTER TABLE goals ADD CONSTRAINT goals_installment_frequency_check
  CHECK (installment_frequency IN ('daily', 'weekly', 'monthly', 'yearly', 'custom'));
ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_installment_interval_check;
ALTER TABLE goals ADD CONSTRAINT goals_installment_interval_check
  CHECK (installment_interval BETWEEN 1 AND 3650);

ALTER TABLE calendar_events ADD COLUMN repeat_interval integer NOT NULL DEFAULT 1
  CHECK (repeat_interval BETWEEN 1 AND 3650);
ALTER TABLE calendar_events DROP CONSTRAINT IF EXISTS calendar_events_repeat_check;
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_repeat_check
  CHECK (repeat IN ('none', 'daily', 'weekly', 'monthly', 'yearly', 'custom'));

ALTER TABLE saved_reports DROP CONSTRAINT IF EXISTS saved_reports_rhythm_check;
ALTER TABLE saved_reports ADD COLUMN rhythm_interval integer NOT NULL DEFAULT 1
  CHECK (rhythm_interval BETWEEN 1 AND 3650);
UPDATE saved_reports SET rhythm='monthly', rhythm_interval=3 WHERE rhythm='quarterly';
ALTER TABLE saved_reports ADD CONSTRAINT saved_reports_rhythm_check
  CHECK (rhythm IN ('daily', 'weekly', 'monthly', 'yearly', 'custom'));
