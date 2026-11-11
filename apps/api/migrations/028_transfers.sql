-- Umbuchungen (Wunsch des Auftraggebers vom 2026-11-11): vom eigenen Konto auf eigene Konten, Konten der eigenen
-- Organisationen und an beliebige Benutzer. Fremde Ziele nehmen an; gebucht wird erst dann, als normale Ausgabe auf
-- dem Quellkonto und Einnahme auf dem Zielkonto (zählen voll in allen Auswertungen).
CREATE TABLE transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_budget_id uuid REFERENCES budgets ON DELETE SET NULL,
  to_budget_id uuid REFERENCES budgets ON DELETE SET NULL,
  to_user_id uuid REFERENCES users ON DELETE SET NULL,
  to_team_id uuid REFERENCES teams ON DELETE SET NULL,
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  category_id uuid REFERENCES categories ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  decline_reason text NOT NULL DEFAULT '' CHECK (length(decline_reason) <= 300),
  created_by uuid REFERENCES users ON DELETE SET NULL,
  decided_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE INDEX transfers_pending_user ON transfers (to_user_id) WHERE status = 'pending';
CREATE INDEX transfers_pending_team ON transfers (to_team_id) WHERE status = 'pending';
CREATE INDEX ON transfers (created_by, created_at DESC);

ALTER TABLE transactions DROP CONSTRAINT transactions_source_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_source_check
  CHECK (source IN ('manual', 'recurring', 'asset', 'import', 'payroll', 'interest', 'transfer'));
ALTER TABLE transactions ADD COLUMN transfer_id uuid REFERENCES transfers ON DELETE SET NULL;
CREATE INDEX ON transactions (transfer_id) WHERE transfer_id IS NOT NULL;
