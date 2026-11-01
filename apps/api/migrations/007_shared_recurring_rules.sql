ALTER TABLE recurring_rules
  ADD COLUMN recipient_user_id uuid REFERENCES users ON DELETE SET NULL,
  ADD COLUMN recipient_budget_id uuid REFERENCES budgets ON DELETE SET NULL,
  ADD COLUMN recipient_status text CHECK (recipient_status IN ('pending', 'accepted', 'declined', 'revoked'));

ALTER TABLE recurring_rules
  ADD CONSTRAINT recurring_rules_recipient_state_check
  CHECK (
    (recipient_user_id IS NULL AND recipient_budget_id IS NULL)
    OR (recipient_user_id IS NOT NULL AND recipient_status IS NOT NULL)
  );
CREATE INDEX recurring_rules_pending_recipient_idx
  ON recurring_rules (recipient_user_id)
  WHERE recipient_user_id IS NOT NULL AND recipient_status = 'pending';

DROP INDEX IF EXISTS transactions_recurring_id_booked_at_idx;
CREATE UNIQUE INDEX transactions_recurring_budget_date_idx
  ON transactions (recurring_id, budget_id, booked_at)
  WHERE recurring_id IS NOT NULL;
