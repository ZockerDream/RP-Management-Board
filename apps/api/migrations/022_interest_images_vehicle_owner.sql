-- Wünsche des Auftraggebers vom 2026-11-10: Zinsen für Konten, Bilder zu Fahrzeugen und Akten, Fahrzeugbesitzer als Person,
-- Kennzeichen ausgemusterter Fahrzeuge wieder verwendbar.

-- ---------- Zinsen (optional je Konto)
-- Zinssatz in Prozent je Zeitraum; gutgeschrieben wird am Ende jedes Zeitraums auf den durchschnittlichen Tagessaldo.
-- interest_since: ab diesem Tag zählt der Saldo (beim Einschalten gesetzt).
ALTER TABLE budgets
  ADD COLUMN interest_rate numeric(8,4) CHECK (interest_rate > 0 AND interest_rate <= 100),
  ADD COLUMN interest_period text CHECK (interest_period IN ('daily', 'weekly', 'monthly', 'yearly')),
  ADD COLUMN interest_since date,
  ADD CONSTRAINT budgets_interest_complete CHECK ((interest_rate IS NULL) = (interest_period IS NULL) AND (interest_rate IS NULL) = (interest_since IS NULL));

-- Je Konto und Zeitraumende genau eine Gutschrift; macht den Job idempotent, auch wenn die Buchung später gelöscht wird
CREATE TABLE interest_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES budgets ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  rate numeric(8,4) NOT NULL,
  period text NOT NULL,
  average_balance numeric(16,2) NOT NULL,
  amount numeric(14,2) NOT NULL,
  transaction_id uuid REFERENCES transactions ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (budget_id, period_end)
);

ALTER TABLE transactions DROP CONSTRAINT transactions_source_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_source_check
  CHECK (source IN ('manual', 'recurring', 'asset', 'import', 'payroll', 'interest'));

-- ---------- Fahrzeuge
-- Besitzer als Person aus der globalen Liste; der Freitext bleibt für Besitzer ohne Personeneintrag
ALTER TABLE vehicles ADD COLUMN owner_person_id uuid REFERENCES people ON DELETE SET NULL;
CREATE INDEX ON vehicles (owner_person_id);
-- Bestehende Angaben übernehmen, wenn der Name genau eine Person trifft (ohne Groß-/Kleinschreibung)
UPDATE vehicles v SET owner_person_id = m.id, registered_owner = ''
FROM (
  SELECT lower(trim(name)) n, min(id::text)::uuid id FROM people GROUP BY lower(trim(name)) HAVING count(*) = 1
) m
WHERE trim(v.registered_owner) <> '' AND lower(trim(v.registered_owner)) = m.n;

-- Ein ausgemustertes Fahrzeug gibt sein Kennzeichen frei
DROP INDEX vehicles_plate_user_unique;
DROP INDEX vehicles_plate_team_unique;
CREATE UNIQUE INDEX vehicles_plate_user_unique ON vehicles(plate, owner_user_id) WHERE owner_user_id IS NOT NULL AND status <> 'retired';
CREATE UNIQUE INDEX vehicles_plate_team_unique ON vehicles(plate, team_id) WHERE team_id IS NOT NULL AND status <> 'retired';

-- ---------- Bilder
CREATE TABLE vehicle_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles ON DELETE CASCADE,
  storage_key text NOT NULL,
  original_name text NOT NULL,
  mime text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg')),
  size int NOT NULL,
  sha256 text NOT NULL,
  caption text NOT NULL DEFAULT '' CHECK (length(caption) <= 200),
  uploaded_by uuid REFERENCES users ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON vehicle_images (vehicle_id, created_at);

-- Bilder einer Akte sind Anhänge vom Typ PNG/JPEG; sie bekommen eine Bildunterschrift
ALTER TABLE case_file_attachments ADD COLUMN caption text NOT NULL DEFAULT '' CHECK (length(caption) <= 200);
