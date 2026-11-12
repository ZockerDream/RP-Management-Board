-- Indizes für häufige Abfragen (2026-11-12): Fremdschlüssel, nach denen Listen, Rechteprüfungen und Löschkaskaden
-- filtern, hatten bisher keinen eigenen Index. Bei kleinen Tabellen liest PostgreSQL trotzdem die ganze Tabelle;
-- die Indizes greifen, sobald die Daten wachsen.

-- „Meine Organisationen“ (team_id IN (SELECT team_id FROM team_members WHERE user_id=…)) steht in fast jeder Liste;
-- der Primärschlüssel beginnt mit team_id und hilft dabei nicht
CREATE INDEX IF NOT EXISTS team_members_user_id_idx ON team_members (user_id);
CREATE INDEX IF NOT EXISTS invitations_team_id_idx ON invitations (team_id);

-- Sichtbarkeit Solo/Organisation (visibleSql: owner_user_id bzw. team_id)
CREATE INDEX IF NOT EXISTS calendar_events_team_id_idx ON calendar_events (team_id) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS license_types_owner_user_id_idx ON license_types (owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS license_types_team_id_idx ON license_types (team_id) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS trainings_owner_user_id_idx ON trainings (owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS trainings_team_id_idx ON trainings (team_id) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS doc_categories_owner_user_id_idx ON doc_categories (owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS doc_categories_team_id_idx ON doc_categories (team_id) WHERE team_id IS NOT NULL;

-- Finanzen: Listen und Auswertungen je Konto
CREATE INDEX IF NOT EXISTS goals_budget_id_idx ON goals (budget_id);
CREATE INDEX IF NOT EXISTS recurring_rules_budget_id_idx ON recurring_rules (budget_id);
CREATE INDEX IF NOT EXISTS recurring_rules_recipient_budget_id_idx ON recurring_rules (recipient_budget_id) WHERE recipient_budget_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS spending_budgets_budget_id_idx ON spending_budgets (budget_id) WHERE budget_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS transfers_from_budget_id_idx ON transfers (from_budget_id);
CREATE INDEX IF NOT EXISTS transfers_to_budget_id_idx ON transfers (to_budget_id);
CREATE INDEX IF NOT EXISTS attachments_transaction_id_idx ON attachments (transaction_id);
CREATE INDEX IF NOT EXISTS payroll_payments_budget_id_idx ON payroll_payments (budget_id);

-- Objekte, Akten, Schulungen, Lizenzen: Detailansichten und Personenübersicht
CREATE INDEX IF NOT EXISTS keys_vehicle_id_idx ON keys (vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS keys_property_id_idx ON keys (property_id) WHERE property_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS key_assignments_person_id_idx ON key_assignments (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS licenses_type_id_idx ON licenses (type_id);
CREATE INDEX IF NOT EXISTS work_entries_project_id_idx ON work_entries (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS case_file_links_linked_id_idx ON case_file_links (linked_id);
CREATE INDEX IF NOT EXISTS case_file_access_user_id_idx ON case_file_access (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS training_attempts_user_id_idx ON training_attempts (user_id);

-- Rechte und Anmeldung
CREATE INDEX IF NOT EXISTS group_members_user_id_idx ON group_members (user_id);
CREATE INDEX IF NOT EXISTS user_roles_role_id_idx ON user_roles (role_id);
CREATE INDEX IF NOT EXISTS role_permissions_permission_id_idx ON role_permissions (permission_id);
CREATE INDEX IF NOT EXISTS recovery_codes_user_id_idx ON recovery_codes (user_id);
CREATE INDEX IF NOT EXISTS password_resets_user_id_idx ON password_resets (user_id);
