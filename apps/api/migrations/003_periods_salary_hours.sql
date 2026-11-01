ALTER TABLE budgets DROP CONSTRAINT IF EXISTS budgets_period_type_check;
ALTER TABLE budgets ADD CONSTRAINT budgets_period_type_check
  CHECK (period_type IN ('daily', 'weekly', 'monthly', 'yearly', 'custom', 'goal'));

ALTER TABLE goals RENAME COLUMN monthly_amount TO installment_amount;
ALTER TABLE goals ADD COLUMN installment_frequency text NOT NULL DEFAULT 'monthly'
  CHECK (installment_frequency IN ('daily', 'weekly', 'monthly', 'yearly'));
ALTER TABLE goals ADD COLUMN installment_interval integer NOT NULL DEFAULT 1
  CHECK (installment_interval BETWEEN 1 AND 60);

ALTER TABLE transactions ADD COLUMN income_kind text NOT NULL DEFAULT 'other'
  CHECK (income_kind IN ('other', 'salary'));
ALTER TABLE transactions ADD CONSTRAINT transactions_income_kind_type_check
  CHECK (type = 'income' OR income_kind = 'other');
ALTER TABLE recurring_rules ADD COLUMN income_kind text NOT NULL DEFAULT 'other'
  CHECK (income_kind IN ('other', 'salary'));
ALTER TABLE recurring_rules ADD CONSTRAINT recurring_income_kind_type_check
  CHECK (type = 'income' OR income_kind = 'other');

CREATE TABLE work_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  work_date date NOT NULL,
  hours numeric(5, 2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX work_entries_user_date_idx ON work_entries (user_id, work_date DESC);
