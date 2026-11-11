# Umbuchungen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Geld vom eigenen Konto auf eigene Konten, Organisationskonten (eigener Organisationen) und an beliebige Benutzer umbuchen; fremde Ziele nehmen an, erst dann wird gebucht.

**Architecture:** Tabelle `transfers` (Migration 028) hält jede Umbuchung mit Status. Direkte Umbuchungen und Annahmen erzeugen in einer DB-Transaktion zwei normale Buchungen (`expense` + `income`, `source='transfer'`, `transfer_id`). Regeln für „direkt oder Annahme“ in einer reinen Funktion `planTransfer` (`src/transfers.js`, Unit-Test), Routen in `src/routes/transfers.js`.

**Tech Stack:** Node 22, Fastify 5, zod, pg, Vanilla-JS.

**Spec:** `docs/superpowers/specs/2026-11-11-fuhrpark-umbuchungen-akten-pdf-design.md` Abschnitt 2

## Global Constraints

- Umbuchungen zählen **voll** als Einnahme/Ausgabe in KPIs, Kategorien, Budgets, Prognose, Berichten – keine Sonderfilter in Auswertungen.
- Abgebucht wird **erst beim Annehmen**; beide Buchungen entstehen zugleich mit `booked_at = today()` (Tag der Annahme bzw. der direkten Umbuchung).
- Quelle und Ziel: gleiche Währung, keine Umrechnung. Keine Deckungsprüfung.
- Ziele: eigene persönliche Konten (direkt); Konten von Organisationen, in denen man Mitglied ist (`budget` ≥ 3 auf Ziel → direkt, sonst Annahme durch Mitglieder mit `budget` ≥ 3 auf dem Zielkonto); jeder aktive Benutzer außer man selbst (Annahme, Empfänger wählt eigenes persönliches Konto gleicher Währung).
- Quelle braucht `budget` ≥ 3 (`budgetAccess(user, id, true)`), Katalogrecht `transaction:create`.
- Umbuchungsbuchungen sind nicht änderbar und nicht löschbar.
- Benutzersuche gibt nur `id` und `name` zurück, nie E-Mail.
- Geldbeträge als Strings aus `numeric`, nie Float.
- Alle Regeln aus `AGENTS.md`; Tests auf `bm-check`.

## Review Focus

- Empfänger nimmt an, aber Quellkonto ist inzwischen archiviert/gelöscht oder Absender hat kein Schreibrecht mehr → Annahme scheitert mit Meldung, Umbuchung wird `declined` (System), keine Buchung.
- Zwei Mitglieder einer Organisation nehmen gleichzeitig an → genau einmal gebucht (`UPDATE … WHERE status='pending' RETURNING` in der Transaktion).
- Empfänger hat kein persönliches Konto in passender Währung → Annehmen-Dialog erklärt, was zu tun ist; API 400 „Du brauchst ein persönliches Konto in <Währung>“.
- Konto mit offenen Umbuchungen wird gelöscht → ausgehende und an dieses Konto adressierte offene Umbuchungen werden `revoked`, keine 500 durch Fremdschlüssel.
- Umbuchung auf dasselbe Konto oder Betrag ≤ 0 → 400.

---

### Task 1: Regeln als reine Funktion

**Files:**
- Create: `apps/api/src/transfers.js`
- Test: `apps/api/test/transfers.test.js`

**Interfaces:**
- Produces: `planTransfer({ me: uuid, from: { id, currency, archived }, target: { kind: 'own'|'team'|'user', budget?: { id, currency, type: 'solo'|'team', owner_user_id, team_id, archived, level: 0..4 }, isMember?: boolean, user?: { id, active: boolean } } }) => { mode: 'direct'|'pending' }`; wirft `HttpError` (400) mit deutschen Meldungen: „Quell- und Zielkonto sind gleich“, „Beide Konten brauchen dieselbe Währung“, „Zielkonto ist archiviert“, „Das ist nicht dein persönliches Konto“, „Du bist in dieser Organisation kein Mitglied“, „Benutzer nicht gefunden“, „An dich selbst bitte als eigenes Konto umbuchen“.
  - `own`: `budget.type==='solo' && owner_user_id===me` → `direct`.
  - `team`: `isMember` nötig; `level >= 3` → `direct`, sonst `pending`.
  - `user`: aktiv, `id !== me` → `pending` (Währung wird erst beim Annehmen geprüft).

- [ ] **Step 1: Failing tests** – je Zweig ein Test mit den Meldungen oben; `team` mit `level: 2` → `pending`, `level: 3` → `direct`; Währung EUR→USD bei `own` → wirft.
- [ ] **Step 2:** `node --test test/transfers.test.js` → FAIL.
- [ ] **Step 3:** Implementieren (nur `HttpError`/`bad` aus `authz.js` importieren – `authz.js` importiert DB; falls der Test dadurch DB braucht, `bad` lokal definieren wie in `features.js`).
- [ ] **Step 4:** PASS, `npm test` grün.
- [ ] **Step 5:** Commit `feat(transfers): Regeln für Umbuchungen`.

### Task 2: Migration und API

**Files:**
- Create: `apps/api/migrations/028_transfers.sql`, `apps/api/src/routes/transfers.js`
- Modify: `apps/api/src/main.js` (Routen-Modul), `apps/api/src/routes/finance.js` (PATCH/DELETE `/transactions/:id` lehnen `source='transfer'` ab: „Umbuchungen lassen sich nicht ändern oder löschen – buche zurück“; `DELETE /budgets/:id` setzt vorher offene Umbuchungen mit `from_budget_id` oder `to_budget_id` = Konto auf `revoked`), `apps/api/src/settings.js` (`KINDS`: `transfer_received` „Umbuchung erhalten“, `transfer_decided` „Umbuchung angenommen oder abgelehnt“), `apps/web/public/js/pages/settings.js` (`KINDS` ebenso), `apps/api/src/validation.js` (`LABELS`: `from_budget_id` „Von Konto“, `to_budget_id` „Zielkonto“, `to_user_id` „Empfänger“, `target` „Ziel“)
- Test: `tests/e2e/api.mjs` (Abschnitt „Umbuchungen“)

**Interfaces:**
- Consumes: `planTransfer` (Task 1), `budgetAccess`, `teamUsers`, `notify`, `audit`, `tx` aus `db.js`, `today()` aus `lib.js`.
- Produces:
  - Migration: `transactions_source_check` um `'transfer'` erweitern; `ALTER TABLE transactions ADD COLUMN transfer_id uuid` (FK auf `transfers` ON DELETE SET NULL, Index). Tabelle `transfers(id, from_budget_id → budgets ON DELETE SET NULL, to_budget_id → budgets ON DELETE SET NULL, to_user_id → users ON DELETE SET NULL, to_team_id → teams ON DELETE SET NULL, amount numeric(14,2) > 0, currency text, title text 1..200, note text ≤2000 default '', category_id → categories SET NULL, status text CHECK IN ('pending','accepted','declined','revoked'), created_by → users SET NULL, decided_by → users SET NULL, created_at, decided_at, decline_reason text default '')`, Index `(to_user_id) WHERE status='pending'`, `(to_team_id) WHERE status='pending'`.
  - `GET /transfers/targets` (`transaction:create`) → `{ own: [{id,name,currency}], teams: [{ team_id, team_name, budgets: [{ id, name, currency, direct: boolean }] }] }` (Organisationskonten nur aus eigenen Mitgliedschaften, nicht archiviert, ohne Saldo).
  - `GET /transfers/users?q=` (`transaction:create`) → `[{ id, name }]`, mind. 2 Zeichen, max. 20, aktiv, ohne mich.
  - `POST /transfers` (`transaction:create`) `{ from_budget_id, target: 'own'|'team'|'user', to_budget_id?, to_user_id?, amount, title, note?, category_id? }` → `{ id, status: 'accepted'|'pending' }`. Direkt: Status `accepted`, Buchungen sofort. Pending: Benachrichtigung `transfer_received` an `to_user_id` bzw. `teamUsers(team, 'budget', 3)`; Audit `transfer.created`.
  - `GET /transfers` (`transaction:read`) → `{ incoming: [...pending für mich oder Organisationskonten mit Stufe ≥3], outgoing: [...pending, created_by = ich] }` mit `from_name` (Absender), Organisations-/Kontoname, Betrag, Währung, Titel.
  - `POST /transfers/:id/accept` `{ budget_id? }` (Benutzer: Pflicht, eigenes Solo-Konto gleicher Währung; Organisation: Stufe ≥3 auf `to_budget_id`). Prüft Quelle erneut (`budgetAccess(created_by, from_budget_id, true)`), bei Fehler: Status `declined`, `decline_reason`, 400 „Das Quellkonto ist nicht mehr verfügbar – Umbuchung abgelehnt“. Sonst in `tx`: Status-Update `WHERE status='pending' RETURNING`, zwei `transactions` (Ausgabe auf Quelle mit `category_id`, Einnahme auf Ziel ohne Kategorie, Titel `Umbuchung: <title>`, `source='transfer'`, `transfer_id`, `created_by` = Absender bzw. Annehmender). Benachrichtigung `transfer_decided` an Absender.
  - `POST /transfers/:id/decline` (Empfänger/berechtigte Mitglieder) und `POST /transfers/:id/revoke` (nur Absender), jeweils nur aus `pending`; `decline` benachrichtigt Absender.
  - Direkte Umbuchungen buchen genauso (gleiche Hilfsfunktion `bookTransfer(client, transfer, toBudgetId, acceptedBy)`).

- [ ] **Step 1: Failing e2e** in `api.mjs`: (a) Owner bucht 100 von persönlichem Konto A auf eigenes Konto B → zwei Buchungen, Salden −100/+100, Dashboard-Ausgaben enthalten die 100; (b) an Benutzer X (keine gemeinsame Organisation) → `pending`, Saldo A unverändert; X sieht sie in `incoming`; X nimmt mit eigenem Konto an → Saldo A −, X +; (c) erneutes `accept` → 400/404; (d) Organisationskonto, Mitglied mit `budget`=2 → `pending`, Mitglied mit 3 nimmt an; (e) Nicht-Mitglied versucht Organisationskonto → 400; (f) Währung USD-Konto als Ziel bei `accept` → 400; (g) Absender zieht pending zurück → `revoked`, `accept` danach scheitert; (h) Quellkonto nach Pending gelöscht → Umbuchung `revoked`; (i) `PATCH`/`DELETE` einer Umbuchungsbuchung → 400; (j) `GET /transfers/users?q=` enthält kein `email`-Feld; (k) Viewer ohne `transaction:create` → 403.
- [ ] **Step 2:** Auf `bm-check` → FAIL.
- [ ] **Step 3:** Migration und Routen implementieren.
- [ ] **Step 4:** `api.mjs` → PASS, keine 5xx; `npm test` grün.
- [ ] **Step 5:** `runJob` für Zinsen und Wochenprognose mit vorhandenen Umbuchungen auf `bm-check` → keine Fehler.
- [ ] **Step 6:** Commit `feat(transfers): Umbuchungen mit Annahme`.

### Task 3: Oberfläche

**Files:**
- Create: `apps/web/public/js/pages/transfer.js` (Dialog + Liste offener Umbuchungen, exportiert `openTransferDialog(budgets, defaults)` und `renderPendingTransfers(container, onChange)`)
- Modify: `apps/web/public/js/pages/budgets.js` (Knopf „Umbuchen“, Abschnitt „Offene Umbuchungen“ oben), `apps/web/public/js/pages/transactions.js` (Knopf „Umbuchen“, gleicher Abschnitt), Buchungsliste zeigt bei `source='transfer'` Tag „Umbuchung“ und keine Ändern/Löschen-Knöpfe
- Test: `tests/e2e/browser.mjs`

**Interfaces:**
- Consumes: Routen aus Task 2.

- [ ] **Step 1: Failing Browser-Test**: Konten → „Umbuchen“ → Ziel „Anderer Benutzer“, Suche „Vie“ zeigt Namen, Betrag 12,50 → gesendet; als Empfänger einloggen → Konten zeigt „Offene Umbuchungen“ mit Absender und Betrag → „Annehmen“ mit Kontoauswahl → Buchung in Transaktionen mit Tag „Umbuchung“, ohne Löschen-Knopf; Mobilbreite, keine Konsolenfehler.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Dialog: Von-Konto (Konten mit Schreibrecht, persönliche zuerst), Ziel-Art als Umschalter „Eigenes Konto | Organisation | Benutzer“, je nach Art Auswahl aus `/transfers/targets` bzw. Suchfeld (`debounce`) auf `/transfers/users`, Betrag (`parseAmount`), Verwendungszweck, optionale Kategorie. Hinweis im Dialog, wenn Annahme nötig: „Wird erst gebucht, wenn <Name/Organisation> annimmt.“ Annehmen-Dialog: nur persönliche Konten in passender Währung; keines vorhanden → Text „Lege zuerst ein persönliches Konto in <Währung> an“ und kein Annehmen-Knopf. Ausgehende offene mit „Zurückziehen“.
- [ ] **Step 4:** `npm test` (Frontend-Syntax) und `browser.mjs` → PASS; `crawl.mjs` über Konten/Transaktionen → keine 5xx/JS-Fehler.
- [ ] **Step 5:** Commit `feat(transfers): Umbuchen in Konten und Transaktionen`.

### Task 4: Dokumentation

**Files:**
- Modify: `changelog.js` (`UNRELEASED`), `pages/help.js`, `pages/privacy.js` (Name des Absenders/Empfängers für andere Benutzer sichtbar; Benutzersuche nach Namen), `CONCEPT.md`, `TECHNICAL.md` (Migration 028, Tabelle, Routen), `README.md`, `AGENTS.md` (Anforderung „Umbuchungen (Wunsch vom 2026-11-11)“, Fallstrick: Buchungen nur über `bookTransfer`, Umbuchungen zählen voll in Auswertungen)

- [ ] **Step 1:** Texte ergänzen.
- [ ] **Step 2:** `npm test` → PASS.
- [ ] **Step 3:** Commit `docs(transfers): Hilfe, Datenschutz, Changelog, Doku`.
