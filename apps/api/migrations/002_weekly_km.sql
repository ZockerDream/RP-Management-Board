ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_cost_interval_check;
ALTER TABLE properties ADD CONSTRAINT properties_cost_interval_check CHECK (cost_interval IN ('once', 'weekly', 'monthly', 'quarterly', 'yearly'));
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_cost_interval_check;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_cost_interval_check CHECK (cost_interval IN ('once', 'weekly', 'monthly', 'quarterly', 'yearly'));
ALTER TABLE keys DROP CONSTRAINT IF EXISTS keys_cost_interval_check;
ALTER TABLE keys ADD CONSTRAINT keys_cost_interval_check CHECK (cost_interval IN ('once', 'weekly', 'monthly', 'quarterly', 'yearly'));
ALTER TABLE vehicles ADD COLUMN odometer_km integer CHECK (odometer_km >= 0);
ALTER TABLE vehicles ADD COLUMN service_interval_km integer CHECK (service_interval_km > 0);
ALTER TABLE vehicles ADD COLUMN service_due_km integer CHECK (service_due_km >= 0);
