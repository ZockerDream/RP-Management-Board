ALTER TABLE properties ADD COLUMN door_pin text NOT NULL DEFAULT '' CHECK (length(door_pin) <= 80);

ALTER TABLE vehicles ADD COLUMN registered_owner text NOT NULL DEFAULT '' CHECK (length(registered_owner) <= 100);
ALTER TABLE vehicles ADD COLUMN first_aid_kit_expires_on date;
ALTER TABLE vehicles DROP COLUMN insurance_from;

ALTER TABLE recurring_rules DROP CONSTRAINT IF EXISTS recurring_rules_frequency_check;
ALTER TABLE recurring_rules ADD CONSTRAINT recurring_rules_frequency_check
  CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly', 'custom'));
ALTER TABLE recurring_rules DROP CONSTRAINT IF EXISTS recurring_rules_interval_check;
ALTER TABLE recurring_rules ADD CONSTRAINT recurring_rules_interval_check CHECK (interval BETWEEN 1 AND 3650);
