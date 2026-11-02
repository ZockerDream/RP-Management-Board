ALTER TABLE users ADD COLUMN hourly_rate numeric(10, 2) NOT NULL DEFAULT 0
  CHECK (hourly_rate BETWEEN 0 AND 99999999.99);
ALTER TABLE users ADD COLUMN overtime_surcharge_percent numeric(6, 2) NOT NULL DEFAULT 0
  CHECK (overtime_surcharge_percent BETWEEN 0 AND 1000);

DELETE FROM recurring_rules r
WHERE r.source = 'asset'
  AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.cost_recurring_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.cost_recurring_id = r.id)
  AND NOT EXISTS (SELECT 1 FROM keys k WHERE k.cost_recurring_id = r.id);
