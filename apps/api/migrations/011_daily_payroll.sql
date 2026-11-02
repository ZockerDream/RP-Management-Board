ALTER TABLE users
  ADD COLUMN payroll_budget_id uuid REFERENCES budgets ON DELETE SET NULL,
  ADD COLUMN payroll_start_date date;

ALTER TABLE transactions DROP CONSTRAINT transactions_source_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_source_check
  CHECK (source IN ('manual', 'recurring', 'asset', 'import', 'payroll'));

CREATE TABLE payroll_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  payroll_date date NOT NULL,
  budget_id uuid REFERENCES budgets ON DELETE SET NULL,
  transaction_id uuid REFERENCES transactions ON DELETE SET NULL,
  base_amount numeric(14, 2) NOT NULL CHECK (base_amount >= 0),
  overtime_hours numeric(8, 2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0),
  overtime_pay numeric(14, 2) NOT NULL DEFAULT 0 CHECK (overtime_pay >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, payroll_date)
);
