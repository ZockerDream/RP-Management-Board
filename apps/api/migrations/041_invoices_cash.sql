-- Rechnungen, Angebote und Kasse (Wünsche des Auftraggebers vom 2026-11-13). Rechnungen werden nur „bezahlt“
-- markiert; dann entsteht die Einnahme auf einem Konto der Organisation. Eine Kasse ist ein Konto der Organisation, der
-- Tagesabschluss bucht eine Differenz. Funktionen „invoices“ und „cash“ stehen schon in Migration 038.
ALTER TABLE transactions DROP CONSTRAINT transactions_source_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_source_check
  CHECK (source IN ('manual', 'recurring', 'asset', 'import', 'payroll', 'interest', 'transfer', 'invoice', 'cash'));

CREATE SEQUENCE invoice_seq;
CREATE SEQUENCE offer_seq;
CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('invoice', 'offer')),
  number text NOT NULL UNIQUE,
  recipient_kind text NOT NULL CHECK (recipient_kind IN ('person', 'team', 'text')),
  recipient_person_id uuid REFERENCES people ON DELETE SET NULL,
  recipient_team_id uuid REFERENCES teams ON DELETE SET NULL,
  -- Name und Anschrift als Kopie vom Ausstellungstag
  recipient_name text NOT NULL CHECK (length(recipient_name) BETWEEN 1 AND 200),
  recipient_address text NOT NULL DEFAULT '' CHECK (length(recipient_address) <= 500),
  items jsonb NOT NULL,
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  currency text NOT NULL DEFAULT 'EUR',
  issued_on date NOT NULL DEFAULT CURRENT_DATE,
  due_on date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'paid', 'cancelled', 'accepted', 'declined')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
  paid_at timestamptz,
  paid_budget_id uuid REFERENCES budgets ON DELETE SET NULL,
  transaction_id uuid REFERENCES transactions ON DELETE SET NULL,
  offer_id uuid REFERENCES invoices ON DELETE SET NULL,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON invoices (team_id, kind, status, issued_on DESC);

CREATE TABLE cash_registers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  budget_id uuid NOT NULL REFERENCES budgets ON DELETE CASCADE,
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cash_registers_budget ON cash_registers (budget_id);

CREATE TABLE cash_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  register_id uuid NOT NULL REFERENCES cash_registers ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams ON DELETE CASCADE,
  closed_on date NOT NULL,
  expected numeric(14,2) NOT NULL,
  counted numeric(14,2) NOT NULL CHECK (counted >= 0),
  difference numeric(14,2) NOT NULL,
  transaction_id uuid REFERENCES transactions ON DELETE SET NULL,
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  created_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON cash_closings (register_id, closed_on DESC);
