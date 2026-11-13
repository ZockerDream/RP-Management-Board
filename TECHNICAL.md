# RP-Management-Board – Technische Sicht

Ergänzt [CONCEPT.md](CONCEPT.md) und beschreibt den implementierten Stand (Migration 023).

Die Oberfläche verwendet den Begriff „Konto“. API-Routen und Tabellen heißen aus Kompatibilitätsgründen weiterhin `/budgets`, `budgets` und `budget_id`. Das Ausgabenlimit „Budget“ der Oberfläche heißt technisch `spending_budgets`.

## 1. Stack

| Schicht | Wahl | Anmerkung |
|---|---|---|
| Datenbank | PostgreSQL 16 | `numeric` für Geld, CHECK-Constraints, `jsonb` |
| Backend | Node.js 22, Fastify 5, ESM-JavaScript | Validierung mit `zod` 4 (Teil-Updates und deutsche Meldungen in `validation.js`), SQL handgeschrieben über `pg` |
| Migrationen | Nummerierte SQL-Dateien | Laufen beim API-Start, je Datei in einer Transaktion, mit Advisory-Lock |
| Frontend | Vanilla-JS-Module ohne Build | Statisch aus `apps/web/public`, versioniert unter `/assets/<Hash>/`, Hash-Router, Seiten per dynamischem `import()` |
| Diagramme, Kalender | Eigene Module | `charts.js` (SVG), `calendar.js` |
| Jobs | `pg-boss` im Service `worker` | Keine zusätzliche Redis-Abhängigkeit |
| Auth | Argon2, JWT + Refresh-Token, TOTP (`otplib`) | siehe 6 |
| Sonstiges | `pdfkit`, `qrcode`, `nodemailer`, `date-holidays` | |
| Texterkennung | Tesseract 5 (Debian-Paket im Image, Deutsch und Englisch) | Aufruf als Prozess über stdin (`ocr.js`), keine Node-Bibliothek |
| Tests | `node --test` | Unit-Tests ohne Datenbank; End-to-End mit Playwright siehe 9 |

## 2. Repository-Struktur

```
RP-Management-Board/
├── docker-compose.yml, .env.example, .env-impressum.example
├── AGENTS.md, CLAUDE.md, CONCEPT.md, README.md, TECHNICAL.md
├── scripts/                 # gen-secrets.sh, update.sh
├── tests/e2e/               # API-, Auth- und Browser-Tests gegen einen Wegwerf-Stack
└── apps/
    ├── api/
    │   ├── Dockerfile, migrations/NNN_*.sql, test/
    │   └── src/
    │       ├── main.js, worker.js, jobs.js, config.js, db.js, seed.js, settings.js
    │       ├── authz.js, security.js, audit.js, mail.js, lib.js, backup.js
    │       ├── payroll.js, interest.js, forecast.js, scan.js, ocr.js, work-hours.js, work-split.js, periods.js, validation.js, static-assets.js, cli/backup.js
    │       ├── features.js, feature-guard.js
    │       ├── org.js, records.js, uploads.js
    │       └── routes/          # admin attachments auth calendar casefiles docs finance integrations licenses me
    │                            # notes objects public spending sport teams todos trainings vehicle-images work …
    └── web/public/
        ├── index.html, favicon.svg, css/
        └── js/                  # api app calendar charts editor gallery markdown md5 recurrence theme ui
            └── pages/           # eine Datei je Seite
```

## 3. Deployment

Der Service `api` liefert SPA und REST-API am selben Ursprung aus und veröffentlicht allein den App-Port. `worker` nutzt dasselbe Image ohne Port, `db` hängt nur im internen Netz. Container laufen mit `read_only`, `cap_drop: ALL`, `no-new-privileges` und Healthchecks. `uploads` und `backups` sind Volumes. Das Image wird im Netz des Hosts gebaut (`build.network: host`), weil `npm ci` auf einem Server mit firewalld über Dockers Bridge ohne Meldung hing; die Container selbst laufen in ihren eigenen Netzen. Beim Start wartet die API bis zu 60 Sekunden auf die Datenbank (`waitForDb`). Eine abgelehnte Anmeldung oder eine fehlende Datenbank bricht sofort ab und erklärt im Log, dass `DB_USER`, `DB_PASSWORD` und `DB_NAME` nur in ein leeres Volume übernommen werden (`dbStartError`). Das Impressum kommt per `env_file` aus `.env-impressum` (optional, nicht im Repository, nicht im Image; muss auf jedem Server einzeln gepflegt werden).

**Auslieferung statischer Dateien:** Beim Start berechnet die API einen Hash über alle Dateien in `apps/web/public` und schreibt die Pfade in `index.html` auf `assets/<Hash>/…` um. `/` und `/index.html` werden mit `no-cache` ausgeliefert, alles unter `/assets/<Hash>/` mit `max-age=31536000, immutable`. Nach einem Update ändern sich damit alle Adressen; neues HTML trifft nie auf altes JS oder CSS, auch nicht über Browser-Cache oder Proxy. Relative Modul-Imports bleiben automatisch in derselben Version. Ein Tab von vor einem Update findet nachzuladende Seiten nicht mehr (404) und lädt einmal neu (`reloadIfOutdated` in `app.js`, höchstens einmal in 30 Sekunden).

## 4. Datenmodell

Konventionen: UUID-Primärschlüssel, Geld als `numeric(14,2)`, Zeiten als `timestamptz`, Kalenderdaten als `date`. `pg` liefert `numeric` und `date` als Strings; Beträge nie als Float weiterrechnen. Das maßgebliche Schema steht in `apps/api/migrations/`; hier die Struktur im Überblick.

### 4.1 Identität und Rechte
```
users(id, email citext unique, password_hash, name, locale, currency, timezone, week_start,
      status[active|locked|invited|disabled], totp_secret_enc, totp_enabled, force_2fa,
      weekly_work_hours, daily_salary, hourly_bonus_percent, payroll_budget_id, payroll_start_date,
      gravatar_enabled default false, theme, accent, max_budgets, expires_at, last_login_at, deleted_at,
      ui_version[v1|v2] default v1, ui_prefs jsonb, background_key, background_updated_at,   -- 025
      ui_choice_seen default false)   -- 026: einmaliger Design-Dialog
recovery_codes, sessions, password_resets, invitations
roles(id, name, description, is_system, is_default, data_scope[all|groups|own], max_budgets)
permissions(id, key), role_permissions, user_roles, groups, group_members, group_roles
```

### 4.2 Organisationen und Finanzen
Die Oberfläche sagt „Organisation“, Code, API und Datenbank bleiben bei `team`.
```
teams(id, name, owner_id, status[active|archived])                 -- owner_id = Ersteller
team_members(team_id, user_id, is_owner, rank_id)                 -- Inhaber dürfen alles
team_ranks(id, team_id, name, position)                           -- höher = höherer Rang, (team_id, position) eindeutig, aufschiebbar
team_groups(id, team_id, name, description), team_group_members(group_id, team_id, user_id)
team_permissions(id, team_id, rank_id | group_id | user_id, module, scope_id, level 0..4)
invitations(…, team_id, rank_id)
budgets(id, name, type[solo|shared], owner_user_id, team_id, currency, period_type, period_start, period_end, limit_amount, archived,
        interest_rate numeric(8,4), interest_period[daily|weekly|monthly|yearly], interest_since)   -- alle drei gesetzt oder keins
interest_payments(id, budget_id, period_start, period_end, rate, period, average_balance, amount, transaction_id)   -- (budget_id, period_end) eindeutig
categories(id, budget_id, name, limit_amount, color)
transactions(id, budget_id, category_id, created_by, type[income|expense|deposit], amount, booked_at, title, note, tags,
             source[manual|recurring|asset|import|payroll|interest], recurring_id, asset_type, asset_id, goal_id, income_kind[other|salary])
recurring_rules(id, budget_id, category_id, created_by, name, type, amount, frequency, interval, start_date, end_date, next_run, active,
                recipient_user_id, recipient_budget_id, recipient_status, source, asset_type, asset_id, income_kind)
goals(id, budget_id, name, target_amount, target_date, installment_amount, installment_frequency, installment_interval)
attachments(id, transaction_id, storage_key, mime, size, sha256)
spending_budgets(id, owner_user_id, name, budget_id, category_id, limit_amount, period_type[daily|weekly|monthly|yearly])
```
Kontostand und Dashboard-Gesamtsaldo werden gleich berechnet: Einnahmen − Ausgaben mit `booked_at <= heute`; `deposit`-Buchungen bleiben außen vor. Das Dashboard begrenzt auch KPIs, Kategorien, Cashflow und letzte Buchungen per `to` auf heute. Sparziel-Fortschritt = Summe der `deposit`-Buchungen mit `goal_id`. Ein Budget zählt Ausgaben im aktuellen Zeitraum (`periodRange`), geschnitten mit den für den Benutzer zugänglichen Konten; die Woche beginnt am Montag. `GET /budgets` sortiert archivierte nach hinten, dann persönliche vor geteilten, dann nach Namen; die Oberfläche wählt überall das erste Konto vor (vorher stand `shared` alphabetisch vor `solo`).

**Zinsen (Migration 022):** Die Regeln stehen allein in `interest.js` (ohne Datenbank, `test/interest.test.js`): `interestPeriod` (Tag, Woche Mo–So, Kalendermonat, Kalenderjahr), `planInterest` plant ab `max(interest_since, letztes period_end + 1)` alle bis gestern abgeschlossenen Zeiträume. Je Zeitraum: Summe der Tagessalden in Cent (BigInt, negative Tage als 0) × Satz / (100 × Tage des ganzen Zeitraums), kaufmännisch gerundet; der erste Zeitraum zählt erst ab `interest_since`. Die Gutschrift wird am `period_end` gebucht und zählt ab dem nächsten Zeitraum mit (Zinseszins). Der Job `interest.run` liest Anfangssaldo und Tagesänderungen je Konto, reserviert jeden Zeitraum per `INSERT … ON CONFLICT (budget_id, period_end) DO NOTHING` in `interest_payments` (auch bei 0,00) und bucht nur dann `transactions(source='interest', type='income')`; `created_by` ist bei persönlichen Konten der Besitzer, sonst leer. Abgerechnete Zeiträume werden nie neu gerechnet, auch wenn die Buchung gelöscht oder Buchungen nachgetragen werden. `PATCH /budgets/:id` mit `interest_rate: null` schaltet ab; beim Einschalten setzt `interestValues` `interest_since` auf das heutige Datum in `TZ`, ein geänderter Satz oder Zeitraum behält es (gilt für alles noch nicht Gutgeschriebene) und schreibt `budget.interest_changed` ins Audit-Log. `PATCH /transactions/:id` lehnt Zinsbuchungen ab, `DELETE` erlaubt sie. Die Kontoliste liefert zusätzlich `interest_total`, `interest_last_on`, `interest_next_on`.

### 4.3 Zeiterfassung und Gehalt
```
work_projects(id, name, owner_user_id, team_id, active)
work_entries(id, user_id, project_id, work_date, hours, started_at, ended_at, break_minutes, note)
work_timers
payroll_payments(user_id, payroll_date, base_amount, overtime_hours, overtime_pay, …)   -- pro Tag eindeutig
```
`payroll.run` läuft stündlich und schreibt ab 03:45 Uhr den Vortag gut (`payrollCutoff`), frühestens ab `payroll_start_date`: jeden Tag `daily_salary`, unabhängig von den Stunden. Stunden über dem Wochen-Soll (Montag bis Sonntag) bringen zusätzlich je Stunde `daily_salary × hourly_bonus_percent / 100`. Die Regeln stehen allein in `planPayroll` (`payroll.js`). Innerhalb einer Woche zählt `Stunden über dem Soll − bereits vergütete Stunden`, nachgetragene Stunden kommen also mit der nächsten Gutschrift dazu; abgeschlossene Wochen bleiben unangetastet, damit ein geändertes Soll alte Wochen nicht neu bewertet. Fehlende Tage werden nachgeholt; `payroll_payments` macht den Lauf idempotent. `users.hourly_rate` ist seit Migration 015 ungenutzt; die Migration hat daraus `daily_salary` berechnet. Monats-Soll = Wochen-Soll × Kalendertage / 7. Der Monatsbericht zeigt tatsächlich gebuchte Beträge.

Schichten über Mitternacht: Ein Eintrag gehört immer zu genau einem Kalendertag. `work-split.js` teilt Timer (`splitTimer`, an Mitternacht in `TZ`, Sommer-/Winterzeit beachtet) und manuelle Einträge oder Bearbeitungen (`splitManualEntry`, Ende vor Beginn) in einen Eintrag je Tag. Manuell werden Stunden und Pause nach der Dauer vor und nach Mitternacht verteilt; beim Timer wird eine laufende Pause genau dort abgezogen, wo sie lag, frühere Pausen (nur als Summe bekannt) anteilig. `apportion` rundet kumulativ, die Summe bleibt exakt. Ende `00:00` heißt „bis Mitternacht“ und bleibt ein Eintrag. Läuft ein Timer, der vor weniger als 24 Stunden gestartet wurde, rechnet `payroll.run` nur bis zum Tag vor seinem Start ab; der Starttag folgt spätestens eine Stunde nach dem Ausstempeln. Timer über 24 Stunden Nettozeit lassen sich nicht stoppen (`DELETE /work-hours/timer` verwirft sie), vergessene Timer halten den Gehaltslauf also höchstens einen Tag auf. Einträge von vor dieser Regel wurden nicht umgerechnet; beim Bearbeiten teilt `PATCH /work-hours/:id` nur, wenn sich Datum, Zeiten, Stunden oder Pause ändern, damit eine geänderte Notiz keine Stunden in eine andere Woche verschiebt.

### 4.4 Sport
```
sport_routes(id, team_id, sport_type[run|swim|bike], name, checkpoints, laps, notes, created_by)
sport_scores(id, route_id, user_id, duration_ms, note, achieved_on)
```
Sortierung der Bestenliste: `duration_ms NULLS LAST, created_at`; `best_ms` ist die Zeit des Ersten. Format und Eingabe (MM:SS:hh, Millisekunden nur wenn gesetzt) stehen in `apps/web/public/js/sport-time.js` (Unit-Test `sport-time.test.js`), die Obergrenze von 24 Stunden steht zusätzlich in `routes/sport.js` (Migration 029 hat Punkte und Sekunden entfernt, 030 die erreichten Checkpoints, 031 die Distanz der Strecke zugunsten von `laps`). Rechte über die Funktion `sport` der Organisation (Lesen: ansehen und eigene Ergebnisse, Lesen & Schreiben: Strecken und fremde Ergebnisse).

### 4.5 Objekte
```
people(id, name, kind, function, phone, email, user_id, active, note)   -- global, ohne Bereich (Migration 019)
properties(id, name, type, address, responsible_person_id, maintenance_due, maintenance_note, door_pin_enc, note, owner_user_id, team_id, <cost>)
vehicles(id, plate, make_model, status[available|in_use|workshop|retired], owner_person_id → people (SET NULL), registered_owner,
         service_due, odometer_km, service_interval_km, service_due_km, first_aid_kit_expires_on, note, owner_user_id, team_id, <cost>)
         -- Kennzeichen eindeutig je Bereich nur unter status <> 'retired' (partielle Indizes, Migration 022)
vehicle_images(id, vehicle_id → vehicles (CASCADE), storage_key, original_name, mime[image/png|image/jpeg], size, sha256, caption, uploaded_by)
keys(id, code, label, kind, property_id, vehicle_id, copies, note, owner_user_id, team_id, <cost>)
key_assignments(id, key_id, person_id, copy_no, issued_at, due_at, returned_at, lost_at, issued_by_user_id, receipt_signed)
<cost> = cost_amount, cost_interval[once|daily|weekly|monthly|yearly|custom], cost_interval_count,
         cost_budget_id, cost_category_id, cost_tracking, cost_recurring_id
```
Personen sind global: Lesen, Anlegen, Ändern und Löschen prüft allein das Katalogrecht `person:*`, nicht `recordLevel`; die Organisationsfunktion `person` gibt es seit Migration 019 nicht mehr. Anlegen, Ändern und Löschen schreiben `people.created|updated|deleted` ins Audit-Log. CSV: `people.js` hält Schema, Export (`peopleCsv`) und Import (`readPeopleCsv` liest, `planPeopleImport` entscheidet anhand der vorhandenen Personen über Anlegen, Ändern, Unverändert, Übersprungen und Fehler); beides ohne Datenbank und in `test/people-csv.test.js` geprüft. `csv.js` enthält `toCsv`/`csvEscape` (aus `lib.js` weitergereicht) und den Parser `parseCsv` (Anführungszeichen, Umbrüche in Feldern, Trennzeichen aus der Kopfzeile); `csvUnguard` entfernt das `'`, mit dem der Export Formeln entschärft. Die Route liest alle Personen einmal, legt neue per `unnest` in einer Transaktion an und schreibt `people.imported` bzw. `people.exported` ins Audit-Log. `bodyLimit` der Import-Route 6 MB; der Browser liest die Datei als UTF-8 und fällt bei ungültigem UTF-8 auf Windows-1252 zurück. Fahrzeuge (Migration 022): `owner_person_id` prüft `assertPerson`; die Liste liefert `owner_person_name` und die Zahl der Bilder (`KINDS.vehicles.select/join` in `objects.js`) und stellt ausgemusterte nach hinten. Eine Verletzung der partiellen Kennzeichen-Indizes ergibt beim Anlegen und Ändern 400 mit `KINDS.vehicles.duplicate`. Ausgemusterte Fahrzeuge fehlen in Kalender (Service, Verbandskasten), `reminders` und dem Service-Hinweis von `/assets/overview`; das Dashboard filtert sie im Browser. Besitzer erscheinen in `GET /person-files/:id` als `owned_vehicles` (Bereich der Personenakte, `visibleSql('v', 'vehicle')`, nur mit `vehicle:read`) und in `GET /people/:id/record` als `vehicles` (alle sichtbaren); `personRecords` sperrt das Löschen solcher Personen. Bilder: `routes/vehicle-images.js` (`GET/POST /vehicles/:id/images`, `GET/PATCH/DELETE /vehicle-images/:id`), Stufe über `recordLevel(…, 'vehicle')` (sehen ab 2, ändern ab 3), höchstens 50 je Fahrzeug, Audit `vehicles.image_added|image_deleted`; `DELETE /vehicles/:id` entfernt die Dateien. Der Schlüsselstatus wird aus den Zuweisungen abgeleitet. Tür-PINs liegen verschlüsselt in `door_pin_enc`, erscheinen nie in regulären Antworten und sind nur über `/properties/:id/pin/reveal` nach Passwort- und ggf. 2FA-Prüfung erreichbar. Anzeigen, Ändern und Entfernen landen im Audit-Log; API-Keys haben keinen Zugriff.

### 4.6 Kalender, Benachrichtigungen, System
```
calendar_events(id, owner_id, team_id, type[team|personal], title, date, start_time, end_time, all_day, repeat, repeat_interval, remind, last_reminded, amount, note)
notifications(id, user_id, kind, title, body, dedupe_key, read_at), notification_prefs(user_id, kind, in_app, email)
saved_reports, api_keys, webhooks, bug_reports, settings(key, value jsonb), audit_log, backups, job_runs, schema_migrations
```
Automatische Termine werden beim Abruf aus den Quelltabellen abgeleitet, nicht dupliziert.

### 4.7 Notizen, ToDos, Ticket-Kommentare
```
notes(id, owner_user_id, team_id, title, body, pinned, created_by, updated_by, created_at, updated_at, archived_at, archived_by)   -- Archiv seit Migration 023
todos(id, owner_user_id, team_id, title, note, due_date, done_at, done_by, last_reminder, created_by, created_at, updated_at)
bug_report_comments(id, report_id, user_id, body, created_at)
note_tags(id, name, color[neutral|primary|ok|warn|bad], position, created_at)   -- systemweit, Name eindeutig ohne Groß-/Kleinschreibung (Migration 023, vorgegeben BLOCKED, INVALID, DONE, WIP)
note_tag_links(note_id, tag_id)                                                  -- beide ON DELETE CASCADE
```
Archiv: `PATCH /notes/:id` mit `archived: true|false` setzt bzw. leert `archived_at`/`archived_by`; erneutes Archivieren behält Zeitpunkt und Namen. Archivieren setzt `pinned` auf `false`, `pinned: true` auf einer archivierten Notiz ergibt 400; wie Anheften ändert es weder `updated_at` noch `updated_by`. `GET /notes` liefert `archived_at` und `archived_by_name`, offene Notizen zuerst (Grenze 1000), gefiltert wird im Browser (`#n-state`). Notiz-Tags: `GET /note-tags` liefert allen angemeldeten Benutzern die Liste (nach `position`), `GET /notes` je Notiz `tag_ids` in derselben Reihenfolge. `POST /notes` und `PATCH /notes/:id` nehmen `tag_ids` (höchstens 50, Doppelte fallen weg) und ersetzen damit alle Tags der Notiz; ohne das Feld bleiben sie unverändert. Unbekannte IDs ergeben 400; eingefügt wird per `SELECT … FROM note_tags`, ein gleichzeitig gelöschter Tag fällt also weg. Wie Anheften ändern Tags weder `updated_at` noch `updated_by`. Verwaltung in `admin.js` unter `/admin/note-tags` (`settings:read` lesen samt Zahl der Notizen, `settings:update` für `POST`, `PATCH`, `DELETE` und `POST …/:id/move` mit `direction: up|down`, das die Reihenfolge lückenlos neu nummeriert und mit dem Nachbarn tauscht); doppelte Namen ergeben 400, Audit `note_tag.created|updated|deleted`. Frontend: `pages/notes.js` (Abzeichen, Knopf „Tags“, Feld im Formular, Filter `#n-tag`), Tab „Notiz-Tags“ in `pages/admin.js`, Farben in `NOTE_TAG_COLORS`/`noteTagHtml` (`pages/common.js`).
### 4.8 Akten, Lizenzen, Schulungen, Dokumentationen (Migration 017, Aktenarten und Beschränkung 018, Aktensystem 020, Test im Tool 021, Einträge in Personenakten 024)
```
case_files(id, owner_user_id, team_id, type_id, restricted, file_number, title, description, status[open|dormant|closed], opened_on, closed_on, …)   -- Aktenzeichen eindeutig je Bereich
case_file_types(id, owner_user_id, team_id, name)                -- Name eindeutig je Bereich, benutzte Arten lassen sich nicht löschen
case_file_access(id, case_file_id, rank_id | group_id | user_id) -- nur bei restricted; Rang zählt samt allen höheren
case_file_people(case_file_id, person_id, role), case_file_entries(id, case_file_id, entry_date, kind, body, person_id, …)
case_file_attachments(id, case_file_id, storage_key, original_name, mime, size, sha256, uploaded_by, caption)   -- PNG/JPEG = Bilder der Akte (Migration 022)
-- Aktensystem (Migration 020); case_files zusätzlich priority[low|normal|high|urgent], location, incident_at, lead_user_id
case_file_links(case_file_id, linked_id, note)                      -- je Richtung eine Zeile, nur im selben Bereich
case_file_vehicles(id, case_file_id, plate, description, role, owner_person_id, note)
report_templates(id, owner_user_id, team_id, name, body, sort)      -- Name eindeutig je Bereich; Standardsätze in src/report-templates.js
case_file_reports(id, case_file_id, number, kind, title, body, occurred_at, status[draft|submitted|approved], amends_report_id, author_id,
                  review_note, submitted_at, approved_by, approved_at), case_file_report_people(report_id, person_id)
penal_codes(id, owner_user_id, team_id, code, title, category, fine, jail, points, description, active)   -- Paragraph eindeutig je Bereich
case_file_charges(id, case_file_id, person_id, penal_code_id, code, title, count, fine, jail, points, status[open|convicted|dropped|acquitted], note, decided_at, decided_by)
case_file_evidence(id, case_file_id, number, description, kind, storage, found_at, found_where, person_id, status[secured|analysis|stored|released|destroyed], note)
case_file_evidence_log(id, evidence_id, at, action, note, user_id)  -- nur anfügen
warrants(id, case_file_id, kind[arrest|search|wanted|vehicle], person_id, plate, reason, issued_on, valid_until, status[active|executed|revoked], close_note, closed_at, closed_by)
person_files(id, owner_user_id, team_id, person_id, warnings text[], notes, blood_type, allergies, conditions, medications, emergency_contact)  -- eine je Bereich und Person
person_file_entries(id, person_id, owner_user_id | team_id, entry_date, kind, body, created_by, updated_by, …)   -- Migration 024, Einträge ohne Fallakte je Bereich
people zusätzlich: birth_date, gender, address, nationality, height_cm, features, aliases, photo_key, photo_mime
license_types(id, owner_user_id, team_id, name, description, validity_months)
licenses(id, type_id, person_id, number, issued_on, valid_until, issuer, status[valid|suspended|revoked], status_reason, note)
trainings(id, owner_user_id, team_id, name, description, validity_months, active)
training_sessions(id, training_id, session_date, start_time, end_time, location, instructor, note)
training_records(id, training_id, session_id, user_id | person_id, result[registered|passed|failed|absent], completed_on, valid_until, instructor, note)
-- Test im Tool (Migration 021); trainings zusätzlich exam_required, exam_pass_percent, exam_time_limit, exam_max_attempts, exam_shuffle, exam_after_session
training_questions(id, training_id, sort, kind[single|multiple], text, options jsonb [{id, text, correct}], points, explanation)
training_attempts(id, training_id, user_id, status[open|submitted|expired], started_at, deadline, submitted_at, layout jsonb, answers jsonb,
                  score, max_score, percent, passed, counted, record_id)   -- höchstens ein offener Versuch je Schulung und Benutzer
doc_categories(id, owner_user_id, team_id, name, sort), doc_pages(id, category_id, title, body, pinned, created_by, updated_by, …)
```
Bereich (`owner_user_id` xor `team_id`) haben nur die Kopftabellen; Einträge, Lizenzen, Termine, Nachweise und Seiten erben ihn. Er wird beim Anlegen gesetzt und bleibt fest. Zugriff: Katalogrecht (`casefile|license|training|doc:read|create|update|delete`) und die Stufe in der Organisation (`recordLevel`/`recordOwner`, Akten über `case_file_level`). Personen sind global: `assertPerson` (`records.js`) prüft nur, dass es sie gibt; Benutzer als Teilnehmer müssen im selben Bereich liegen (`assertUserInScope`). `personJoin` zeigt den Namen jedem, der den Datensatz sieht. `DELETE /people/:id` lehnt Personen mit Akten, Personenakten (samt Einträgen), Lizenzen, Nachweisen oder Fahrzeugen ab. Die Fremdschlüssel auf `people` kaskadieren (Einträge: `SET NULL`); das stammt aus der Zeit, als Personen mit ihrem Team gelöscht wurden, und schadet nicht. Anhänge laufen wie Belege über `uploads.js` (PDF, PNG, JPEG, Magic Bytes, Größenlimit); beim Löschen einer Akte werden die Dateien entfernt. Aktensystem: `casefile-access.js` hält `loadFile` (404 unsichtbar, 403 zu wenig Rechte), `loadChild` für alles mit `case_file_id`, `assertInvolved` und den Bereich (`area`, `areaRecord`, `sameArea`) für Strafkatalog, Vorlagen und Personenakten; Routen in `case-records.js` (Fahrzeuge, Verknüpfungen, Beweismittel, Strafkatalog, Anklagen, Fahndungen), `case-reports.js` (Vorlagen, Berichte mit Freigabe) und `person-files.js` (Personenakten, Einträge, Foto). Einträge der Personenakte prüfen den Bereich wie `person_files` (`area` beim Anlegen, `areaRecord` beim Ändern und Löschen; fremde 404, ohne Schreibrecht 403). Fahrzeuge (Besitzer) und Schlüssel liest `GET /person-files/:personId` bereichsübergreifend mit `visibleSql` und `team_name`, weil sie der Objektverwaltung gehören; nur Akten-Teile hängen am gewählten Bereich.

**Schalter des Aktensystems:** Die Einstellungen `casefiles.files|wanted|penal_codes|report_templates|types` (Standard `true`) ergeben in `caseFeatures` (`features.js`, ohne Datenbank, `test/features.test.js`) die wirksamen Teile `files`, `wanted`, `codes`, `charges`, `templates`, `types` samt Abhängigkeiten. `guardRoutes` (`feature-guard.js`) hängt per `onRoute` an jede Route, die `featureForRoute` einem Teil zuordnet, eine Prüfung hinter die übrigen `preHandler` (erst anmelden, dann prüfen) und antwortet ausgeschaltet mit 403 `disabled`. `GET /me` liefert `features.casefiles`; das Frontend fragt `caseFeature(key)` (`app.js`) und blendet Tabs und Abschnitte aus. `GET /person-files/:personId` liefert ausgeschaltete Teile als `null`, die Liste `files`, `wanted`, `convictions` als `null`. `POST`/`PATCH /case-files` lehnen ohne Aktenarten eine Art ab. Neue Akten-Routen fallen über ihren Pfad automatisch unter einen Schalter; neue Pfade außerhalb von `/case-file*`, `/warrants`, `/penal-codes`, `/report-templates` in `RULES` ergänzen. Laufende Nummern (Berichte, Beweismittel) unter einer Zeilensperre auf die Akte. Der CSV-Import des Strafkatalogs liest `penal.js` (ohne Datenbank, `test/penal.test.js`). Test im Tool: Regeln für Fragen, Mischen und Bewertung stehen in `exam.js` (ohne Datenbank, `test/exam.test.js`), die Routen in `training-exams.js`. `layout` hält je Versuch die Reihenfolge von Fragen und Antworten (`crypto.randomInt`); `publicQuestions` liefert Fragen ohne `correct`, bewertet wird nur gegen die gespeicherten Fragen. Die Frist rechnet die Datenbank (`now() + Minuten`), Abgaben bis 30 Sekunden danach zählen noch. `applyResult` trägt das Ergebnis in derselben Transaktion in `training_records` ein; `examBlocksManualPass` verhindert, dass Benutzer bei Schulungen mit Test von Hand bestehen. `examInfo` hängt an `GET /trainings/:id` die Angaben für die Karte „Test im Tool“ (`exam`, `null` ohne Test). Frontend: `pages/training-exam.js` (Karte, Fragen, Test mit Countdown nach Serverzeit, Antworten zwischengespeichert in `localStorage` unter `exam:<Versuch>`). Fotos: nur PNG/JPEG (`receiveUpload(req, { images: true })`); das Frontend lädt sie per `api.blob` und zeigt sie als `data:`-URL, weil `img src` kein Token mitschickt und die CSP `blob:` nicht erlaubt. Bilder zu Fahrzeugen und Akten (Migration 022): `receiveUpload` liefert zusätzlich `caption` aus einem Formularfeld, das im FormData **vor** der Datei stehen muss (`part.fields`). Akten-Bilder sind Anhänge mit PNG/JPEG; `POST /case-files/:id/attachments?images=1` nimmt nur Bilder an, `PATCH /case-file-attachments/:id` ändert die Bildunterschrift. Frontend: `js/gallery.js` (Raster `galleryHtml`, Vorschau `fillGallery` mit Cache, Großansicht, Upload- und Beschriftungsformular, `openGalleryModal` für Fahrzeuge); in der Akte trennt der Tab „Bilder“ die Bilder von „Anhänge“ und lädt Vorschauen erst beim Öffnen des Tabs. Frontend: `pages/casefiles.js` (Tabs, Liste, Akte), `pages/case-parts.js` (Abschnitte und Formulare der Akte), `pages/person-files.js`, `pages/case-admin.js` (Fahndung, Strafkatalog, Vorlagen); Drucken über `printArea` (`ui.js`) und Druck-CSS. Zustände `expiring` (≤ 30 Tage) und `expired` werden beim Abruf berechnet. Dokumentationen, Notizen, Sachverhalte und Einträge von Akten, Schulungsbeschreibungen, ToDo-Notizen, Streckennotizen, Lizenzart-Beschreibungen und Tickets rendert das Frontend mit `markdown.js` (`markdownBlock`, einzeilig `renderInline`), einem eigenen Parser für CommonMark mit GitHub-Erweiterungen (Tabellen, Aufgabenlisten, Durchstreichen, automatische Links, Fußnoten, Hinweis-Kästen), ohne fremde Bibliothek und ohne DOM (Tests in `apps/api/test/markdown.test.js`). Sicherheit: Jeder Text läuft durch `escapeHtml`, fertige Stücke werden als Platzhalter (`\uE000n\uE001`) gehalten; HTML aus der Eingabe bleibt Text bis auf wenige Tags ohne Attribute (schließende nur zu geöffneten). Links nur `http(s)`, `mailto`, `tel` und `#/…` (App-Seiten, ohne neuen Tab), Bilder nur als `data:image/(png|jpeg|gif|webp)`; externe Bilder werden Links, weil die CSP (`img-src`) fremde Server bewusst ausschließt. Fußnoten springen per `<button data-md-fn>` und einem globalen Klick-Listener, denn ein `#`-Link würde den Hash-Router auslösen. Zeilenumbrüche im Absatz bleiben `<br>` (wie GitHub-Kommentare), Überschriften stehen eine Stufe tiefer (`#` → `h2`). Bearbeitet wird mit `editor.js`: `openForm` richtet für Felder mit `markdown: true` die Werkzeugleiste ein (`markdownEditors`), sonst `textarea[data-md]` plus `markdownEditors(container)`; `data-md="lazy"` erst beim ersten Fokus (Ticket-Kommentare). Änderungen laufen über `execCommand('insertText')`, damit Strg+Z sie zurücknimmt. Gespeichert wird der Rohtext.

Bei `notes` und `todos` ist genau eines von `owner_user_id` und `team_id` gesetzt. Rechte hängen an Eigentum und der Stufe in der Organisation (`recordLevel`, `recordOwner` in `org.js`), nicht am RBAC-Katalog; ohne Schreibrecht gibt es beim Ändern 403, Fremde bekommen 404. Listen liefern `level`, damit die Oberfläche Aktionen ausblendet.

### 4.8a Fuhrpark (Migration 027) und Umbuchungen (Migration 028)

- `fleet_groups` (team_id, name, show_model, sort), `fleet_vehicles` (team_id, group_id, plate, model, note, sort, active; Kennzeichen eindeutig je Organisation nur unter aktiven), `fleet_checks` (team_id, checked_on, done, done_at, done_by), `fleet_check_items` (Kopie von Gruppe, Kennzeichen, Modell und Sortierung je Runde, dazu odometer_km, last_service_on, first_aid_kit_until, accessories_complete, note). Markdown erzeugt `fleetMarkdown` (`src/fleet-markdown.js`, ohne DB, Unit-Test mit der Vorlage des Auftraggebers). Funktion `fleet` in `ORG_MODULES`, Katalogrecht `fleet:*`; Migration 027 gibt es auch eigenen Rollen.
- `transfers` (from_budget_id, to_budget_id, to_user_id, to_team_id, amount, currency, title, note, category_id, status pending/accepted/declined/revoked, decline_reason, created_by, decided_by). Buchungen nur über `bookTransfer` (`routes/transfers.js`): Ausgabe und Einnahme mit `source='transfer'` und `transactions.transfer_id`. Regeln „sofort oder Annahme“ in `planTransfer` (`src/transfers.js`, ohne DB).

### 4.8b Musik (Migration 033) und Blitzer (Migration 034)

- Spotify nutzt `provider_connections`/`oauth_states` mit `provider='spotify'` (Spalte `email` hält den Spotify-Anzeigenamen, `client_id` die verwendete App). Anmeldung per PKCE (Migration 035: `oauth_states.code_verifier` verschlüsselt, `client_id`), Client-ID aus `users.spotify_client_id`, sonst Einstellung `music.spotify_client_id`, sonst `SPOTIFY_CLIENT_ID`; kein Secret. Redirect aus `spotifyRedirect` (`src/music.js`). Tokens verschlüsselt, Erneuern in `routes/music.js`; der Browser spricht nur mit `/api/music/spotify/*`. Musik vom Server ohne Tabelle: `src/music.js` (ohne DB, Unit-Test) liest `MUSIC_ROOT` (im Container `/data/music`, Bind-Mount von `MUSIC_DIR`, nur lesend), prüft Pfade (`resolveTrack`: kein `..`, keine versteckten Dateien, nur Audioformate, Symlinks nur innerhalb) und Range-Anfragen (`parseRange`). Das `<audio>`-Element kann keinen Authorization-Header senden: `POST /music/local/token` gibt einen JWT `typ: 'music'` (6 Stunden), der Stream prüft dazu Benutzer und `music:read` bei jedem Aufruf. Eingebetteter Player und Suche: `GET /music/spotify/catalog` mit Client-Credentials-Token der Server-App (im Speicher bis kurz vor Ablauf), Secret verschlüsselt in `music.spotify_client_secret` (nie in `GET /admin/settings`, nur `spotify_secret_set`); CSP `frame-src https://open.spotify.com`. Empfehlungen: `music_recommendations` (kind, spotify_id, title, note, size compact/large, sort; Link geprüft mit `parseSpotifyLink`, Titel über oEmbed). Uploads: `music_files` (storage_key, folder, title, original_name, mime, size, uploaded_by), Dateien unter `UPLOAD_DIR/music/<uuid>`, Inhalt per `sniffAudio` geprüft, Größe `MUSIC_UPLOAD_MB`. Frontend: ein Player für die ganze App in `js/music-player.js` (Titel mit `path` oder `id`).
- `speed_cameras` (name eindeutig ohne Groß-/Kleinschreibung, location, kind fixed/mobile, speed_limit, active, note) und `speed_tickets` (number aus `speed_ticket_seq`, camera_id RESTRICT, measured_at, plate, vehicle_id SET NULL, person_id RESTRICT, speed_limit als Kopie, measured_kmh, tolerance_kmh, amount, status open/paid/cancelled, note, person_file_entry_id SET NULL). Text des Akteneintrags aus `ticketEntryBody` (`src/speedcam.js`, ohne DB, Unit-Test). Systemweit, keine Funktion in `ORG_MODULES`.

### 4.9 Rechte in Organisationen (Migration 018)
Stufen: 0 kein Zugriff, 1 teilnehmen, 2 lesen, 3 lesen und schreiben, 4 verwalten. Die Funktionen stehen in `ORG_MODULES` (`org.js`) mit erlaubten Stufen und Hinweistexten; `GET /teams/catalog` liefert sie der Oberfläche. Ausgerechnet wird die Stufe in der Datenbank, damit Listen und Einzelprüfungen dieselbe Regel nutzen:

- `team_level(team, user, module, scope)`: kein Mitglied → 0, Inhaber → 4. Sonst je Rang, Gruppe oder Benutzer die Zeile für den Bereich (`scope_id`) vor der Zeile für die Funktion; gibt es eine persönliche Zeile, gilt sie, sonst das Maximum aus Rang und Gruppen, sonst 0.
- `case_file_level(file, user)`: privat nur der Besitzer; sonst `team_level(…, 'casefile', type_id)`, bei `restricted` nur für Inhaber, Ersteller und freigegebene Ränge (samt höheren), Gruppen und Benutzer.
- `seed_team_ranks(team)`: Leitung (30), Mitglied (20), Leser (10) mit Standardrechten; `POST /teams` ruft sie auf, Migration 018 hat damit die bestehenden Teams übernommen (owner → Inhaber und Leitung, editor → Mitglied, viewer → Leser, Einladungen ebenso).

In JS: `levelSql(alias, modul, n, scope)` und `visibleSql(…)` für Listen (Alias mit `owner_user_id`/`team_id`), `teamIdsSql` für Tabellen nur mit `team_id`, `recordLevel(user, row, modul, { need, see, scope })` (404 unter `see`, 403 unter `need`), `recordOwner(user, team, modul, need)`, `teamLevel`, `levelsFor`, `teamUsers(team, modul)` für Erinnerungen. Verwaltung (`routes/teams.js`): Nicht-Inhaber brauchen bei `members` 3 (Mitglieder, Ränge und Gruppen zuweisen) bzw. 4 (Ränge, Gruppen, Rechte), handeln nur unter dem eigenen Rang und vergeben nie mehr, als sie selbst haben (`assertWithin` vergleicht jede gestiegene Stufe je Funktion und Bereich; Ränge und Gruppen beim Zuweisen ganz). Bereichszeilen haben keinen Fremdschlüssel; `DELETE` von Aktenart oder Doku-Kategorie löscht sie mit. Die Rang-Spalte in `team_members` nutzt `ON DELETE SET NULL (rank_id)`, damit das Löschen einer Organisation nicht an der Reihenfolge der Kaskaden scheitert; benutzte Ränge lehnt die API ab. `todos.last_reminder` hält `<Deadline>:<Stufe>` der letzten Erinnerung. Tickets löschen die Kommentare per Kaskade.

## 5. API (REST unter `/api`)

| Bereich | Endpunkte |
|---|---|
| Auth | `POST /auth/login`, `/auth/2fa/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot`, `/auth/reset`, `/auth/register`, `/auth/invite/:token`; `GET /auth/config` |
| Konto | `GET/PATCH /me` (auch `ui_version`, `ui_prefs`, `ui_choice_seen: true`; eine Wahl von `ui_version` setzt `ui_choice_seen` mit), `PUT/GET/DELETE /me/background` (eigenes Hintergrundbild, nur PNG/JPEG), `/me/password`, `/me/2fa/*`, `/me/sessions`, `/me/export`, `/me/notification-prefs`, `/me/api-keys`, `/me/ical`, `/notifications` |
| Admin | `/admin/users`, `/roles`, `/groups`, `/teams`, `/settings`, `/system`, `/overview`, `/audit`, `/api-keys`, `/webhooks`, `/backups`, `/bug-reports` |
| Organisationen | `GET/POST /teams`, `GET /teams/catalog`, `PATCH/DELETE /teams/:id`, `POST /teams/:id/members` (`rank_id`), `PATCH/DELETE /teams/:id/members/:uid` (`rank_id`, `is_owner`, `group_ids`), `GET /teams/:id/members/:uid/levels`, `DELETE /teams/:id/invitations/:iid`, `POST /teams/:id/ranks`, `PATCH/DELETE /team-ranks/:id` (`name`, `move: up\|down`), `POST /teams/:id/groups`, `PATCH/DELETE /team-groups/:id`, `GET/PUT /teams/:id/permissions` (`subject`, `subject_id`, `module`, `scope_id`, `level` oder `null`) |
| Finanzen | `/budgets` (mit `interest_rate`, `interest_period`), `/budgets/:id/categories`, `/categories/:id`, `/transactions`, `/transactions/export.csv`, `POST /transactions/scan` (Bild als Multipart, `?today=`; liefert `items`, `text`), `POST /transactions/import` (`{ budget_id, items }`, höchstens 100, Quelle `import`), `/recurring`, `/goals`, `/spending-budgets` |
| Auswertung | `/stats/overview`, `/stats/by-category`, `/stats/timeline?granularity=day\|week\|month&periods=&week_start=&to=`, `/stats/forecast?scope=&week_start=&today=` (zwei Wochen mit `income`/`expense` je `booked`, `planned`, `recurring`, `salary`, `estimate`, `total`), `/reports/costs`, `/reports/saved`. Standard `month` liefert `month`, sonst `bucket` (Tag bzw. Wochenbeginn) |
| Zeiterfassung | `/work-projects`, `/work-hours`, `/work-hours/timer/*`, `DELETE /work-hours/timer` (verwerfen), `/work-hours/monthly`, `/work-hours/monthly.pdf`, `/work-hours/export.csv`, `/work-hours/team/*` |
| Sport | `GET/POST /sport/routes`, `PATCH/DELETE /sport/routes/:id`, `POST /sport/routes/:id/scores`, `DELETE /sport/scores/:id` |
| Notizblock, ToDos | `GET/POST /notes` (mit `tag_ids`), `PATCH/DELETE /notes/:id` (mit `archived`), `GET /note-tags`, `GET/POST /admin/note-tags`, `PATCH/DELETE /admin/note-tags/:id`, `POST /admin/note-tags/:id/move`, `GET/POST /todos`, `PATCH/DELETE /todos/:id` (mit `done`) |
| Tickets | `GET/POST /bug-reports`, `DELETE /bug-reports/:id`, `POST /bug-reports/:id/comments`, `DELETE /bug-reports/:id/comments/:commentId`; dieselben unter `/admin/bug-reports` für alle Tickets. Getrennte Pfade, damit die Admin-IP-Allowlist greift |
| Akten | `GET/POST /case-files` (`?status=&type_id=&q=`), `GET/POST /case-file-types`, `PATCH/DELETE /case-file-types/:id`, `GET /case-files/:id/access-options`, `PUT /case-files/:id/access`, `GET/PATCH/DELETE /case-files/:id`, `POST /case-files/:id/people`, `DELETE /case-files/:id/people/:personId`, `POST /case-files/:id/entries`, `PATCH/DELETE /case-file-entries/:id`, `POST /case-files/:id/attachments` (`?images=1` nur Bilder, Feld `caption`), `GET/PATCH/DELETE /case-file-attachments/:id`, `GET /people/:id/record` (Personenübersicht) |
| Aktensystem | `POST /case-files/:id/vehicles`, `PATCH/DELETE /case-file-vehicles/:id`, `POST /case-files/:id/links`, `DELETE /case-files/:id/links/:linkedId`, `POST /case-files/:id/evidence`, `PATCH/DELETE /case-file-evidence/:id`, `POST /case-file-evidence/:id/log`, `GET/POST /penal-codes` (`?team_id=&private=1`), `PATCH/DELETE /penal-codes/:id`, `POST /penal-codes/import`, `POST /case-files/:id/charges`, `PATCH/DELETE /case-file-charges/:id`, `POST /case-file-charges/:id/decision`, `POST /case-files/:id/warrants`, `GET /warrants` (`?status=&q=&team_id=`), `POST /warrants/:id/close`, `DELETE /warrants/:id`, `GET/POST /report-templates`, `POST /report-templates/defaults`, `PATCH/DELETE /report-templates/:id`, `POST /case-files/:id/reports`, `PATCH/DELETE /case-file-reports/:id`, `POST /case-file-reports/:id/submit`, `POST /case-file-reports/:id/review`, `GET /case-file-reports/pending`, `GET /person-files` (`?team_id=&q=&only=records|wanted|warnings|inactive`, bis 2000 Zeilen, mit `kind`, `function`, `keys`), `GET/PUT /person-files/:personId` (mit `own_entries`), `POST /person-files/:personId/entries`, `PATCH/DELETE /person-file-entries/:id`, `POST/GET/DELETE /people/:id/photo`. Ausgeschaltete Teile (Abschnitt 4.8) antworten mit 403 `disabled` |
| Fuhrpark | `GET /fleet/teams`, `GET/POST /fleet/groups` (`?team_id=`), `PATCH/DELETE /fleet/groups/:id`, `GET/POST /fleet/vehicles` (`?team_id=&all=1`), `PATCH/DELETE /fleet/vehicles/:id`, `PUT /fleet/vehicles/order`, `GET/POST /fleet/checks`, `GET/PATCH/DELETE /fleet/checks/:id` (`items`, `done`), `GET /fleet/checks/:id/markdown` |
| Umbuchungen | `GET /transfers` (`incoming`, `outgoing`), `GET /transfers/targets`, `GET /transfers/users?q=` (nur id und Name), `POST /transfers`, `POST /transfers/:id/accept` (`budget_id`), `/decline`, `/revoke` |
| Akten-PDF | `GET /case-files/:id/pdf?parts=people,vehicles,links,entries,reports,charges,evidence,warrants,images,attachments`, `GET /case-file-reports/:id/pdf` (`src/casefile-pdf.js`, Markdown über `md-pdf.js`, Schriften DejaVu aus dem Image, `PDF_FONT_DIR`) |
| Musik | `GET /music/spotify` (`configured`, `server_app`, `own_app`, `connected`, `account`, `redirect_uri`, `redirect_problem`), `PUT /music/spotify/app` (`client_id` oder `null`), `GET /music/spotify/connect`, `GET /music/spotify/callback` (ohne Anmeldung, einmaliger `state`), `DELETE /music/spotify`, `GET /music/spotify/player` (`null`, wenn nichts läuft), `PUT /music/spotify/player` (`action`: play mit `uri`/`context_uri`/`device_id`, pause, next, previous, volume, shuffle, repeat, seek, transfer), `GET /music/spotify/devices`, `/playlists`, `/search?q=`, `GET /music/local` (`configured`, `tracks` mit `src` server/upload, `can_upload`, `max_upload_mb`), `POST /music/files` (Multipart, Feld `folder` vor der Datei), `PATCH/DELETE /music/files/:id`, `POST /music/local/token`, `GET /music/local/stream?path=|id=&t=` (Range). `GET /music/spotify/catalog?q=` (Suche, 409 `search_unavailable` ohne Secret), `GET/POST /music/recommendations` (`url`, `title`, `note`, `size`), `PATCH/DELETE /music/recommendations/:id`, `POST /music/recommendations/:id/move` (`dir`). Spotify-App des Servers: `PUT /admin/music/spotify` (`client_id`, optional `client_secret`, leer = entfernen). Fehler von Spotify: 409 `no_device`/`spotify_reconnect`/`spotify_not_connected`, 403 `premium_required` |
| Blitzer | `GET/POST /speed-cameras`, `PATCH/DELETE /speed-cameras/:id`, `GET /speed-tickets` (`?status=&camera_id=&q=&person_id=`, mit `over_kmh`, `has_person`, `has_entry`), `GET /speed-tickets/lookup?plate=`, `POST /speed-tickets`, `PATCH/DELETE /speed-tickets/:id`, `POST /speed-tickets/:id/file-entry` (`team_id`) |
| Lizenzen | `GET/POST /license-types`, `PATCH/DELETE /license-types/:id`, `GET/POST /licenses` (`?state=&type_id=&person_id=&q=`), `PATCH/DELETE /licenses/:id`, `POST /licenses/:id/renew` |
| Schulungen | `GET/POST /trainings`, `GET /trainings/overview`, `GET/PATCH/DELETE /trainings/:id`, `GET /trainings/:id/candidates`, `POST /trainings/:id/sessions`, `POST/DELETE /training-sessions/:id/enroll` (selbst an- und abmelden), `PATCH/DELETE /training-sessions/:id`, `POST /trainings/:id/records`, `PATCH/DELETE /training-records/:id`; Test: `GET/POST /trainings/:id/questions`, `PATCH/DELETE /training-questions/:id`, `POST /trainings/:id/exam/start`, `POST /trainings/:id/exam/reset`, `POST /training-attempts/:id/submit`, `GET /training-attempts/:id` |
| Dokumentationen | `GET/POST /doc-categories`, `PATCH/DELETE /doc-categories/:id`, `GET/POST /doc-pages` (`?category_id=&q=`), `GET/PATCH/DELETE /doc-pages/:id` |
| Objekte | `/people`, `GET /people/export.csv`, `POST /people/import` (`{ csv, preview }`), `/properties`, `/properties/:id/pin`, `/vehicles` (`owner_person_id`), `GET/POST /vehicles/:id/images`, `GET/PATCH/DELETE /vehicle-images/:id`, `/keys`, `/keys/:id/assign`, `/keys/:id/qr`, `/assignments/:id/return`, `/assignments/:id/lost`, `/assets/overview`, `/assets/costs`, `/assets/log` |
| Kalender | `GET /calendar?from=&to=`, `POST/PUT/DELETE /calendar/events`, `GET /calendar/ical/:token.ics` |
| Sonstiges | `/integrations/:provider/*`, `/attachments/:id`, `GET /public/imprint` |

Fehlerformat: `{ error, message }`. Validierungsfehler und von PostgreSQL abgelehnte Werte (keine gültige UUID, nicht existierendes Datum, Null-Byte im Text) ergeben 400. Meldungen sind deutsch und nennen das Feld verständlich (`validationMessage`). Fremde Datensätze ergeben 404 oder eine leere Liste; fehlt in der Organisation die nötige Stufe, gibt es 403 mit der fehlenden Stufe im Text. Listen liefern `level` (0–4), damit die Oberfläche Aktionen ausblendet; `/teams` liefert je Organisation `levels` je Funktion. Beträge werden als String ausgegeben.

## 6. Sicherheit

- **Passwörter:** Argon2, Mindestlänge aus `settings`, optionaler Leak-Check per HIBP k-Anonymität.
- **Tokens:** kurzlebiges Access-JWT nur im Speicher; Refresh-Token als httpOnly-, SameSite=Strict-Cookie (`Secure` bei HTTPS), als Hash in `sessions`, mit Rotation.
- **2FA:** TOTP, Secret mit AES-256-GCM verschlüsselt, 8 einmalige Recovery-Codes als Hash. Global (`security.force_2fa`) oder pro Benutzer erzwingbar.
- **Sperren:** Login-Sperre nach Fehlversuchen; optionale Admin-IP-Allowlist. Rate-Limits nur an Routen, die Passwörter oder Codes prüfen oder Mails auslösen, pro IP: Login, 2FA, Passwort vergessen und zurücksetzen, Einladung, Registrierung und die Passwort- und 2FA-Aktionen unter `/me` je 10/Minute, Tür-PIN 5/Minute. Es gibt bewusst kein allgemeines Limit; `/auth/refresh` ist frei, weil jedes Neuladen es aufruft und das Token nicht erratbar ist. Ein abgelaufener Zugang (`users.expires_at`, gilt bis einschließlich zu diesem Tag in `TZ`) endet bei Login, Refresh und jeder Anfrage. Ohne `TRUST_PROXY` hinter einem Proxy warnen Log und Admin-Einstellungen.
- **Rechteprüfung:** `authz('budget:update')` plus Objektprüfung (`budgetAccess`, `recordLevel`, `team_level`; Abschnitt 4.9). Effektive Rechte = Vereinigung aus Rollen und Gruppenrollen, Cache 15 Sekunden.
- **Gravatar:** Standard aus; der MD5-Hash wird im Browser gebildet, das Backend speichert nur den Schalter.
- **Eingaben/Ausgaben:** `zod` am Rand, parametrisierte Queries, Escaping im Frontend, strikte CSP (`script-src 'self'`), `frame-ancestors 'none'`.
- **Uploads:** Größenlimit, Ablage außerhalb des Web-Roots, Auslieferung nur über die API mit Rechteprüfung.
- **API-Keys:** einmalige Anzeige, Hash mit Prefix `bm_live_`, Scope `read` oder `write`. Webhooks mit HMAC-Signatur.
- **Geheimnisse:** `.env` und `.env-impressum` außerhalb von Git und außerhalb des Images.

## 7. Fachlogik

### 7.1 Kosten-Tracking für Objekte
Beim Speichern von Haus, Fahrzeug oder Schlüssel in einer Transaktion:
1. Kein Betrag oder Tracking aus: verknüpften Auftrag entfernen; historische Buchungen bleiben.
2. `once`: genau eine Buchung (`source = asset`); bei Änderung aktualisieren statt neu anlegen.
3. Sonst: Dauerauftrag (`source = asset`) anlegen oder aktualisieren; `cost_recurring_id` verweist darauf.

### 7.2 Jobs (Service `worker`, pg-boss)
| Job | Takt | Aufgabe |
|---|---|---|
| `recurring.run` | alle 15 Minuten | Fällige Daueraufträge buchen, `next_run` fortschreiben |
| `interest.run` | stündlich zur Minute 20, auch beim Worker-Start | Zinsen aller Konten mit Zinssatz für jeden bis gestern (`TZ`) abgeschlossenen Zeitraum gutschreiben, siehe 4.2 |
| `payroll.run` | stündlich zur Minute 45, auch beim Worker-Start und beim Setzen des Gehaltskontos | Festgehalt und Bonus buchen; der Vortag ab 03:45, ein Tag mit offener Schicht nach dem Ausstempeln |
| `reminders` | täglich 07:00 | Benachrichtigungen zu Terminen, Service, Verbandskasten, Schlüsselrückgaben, ablaufenden Lizenzen (`license_expiry`) und Schulungsnachweisen (`training_expiry`, nur der neueste je Teilnehmer): 30 Tage vorher und nach dem Ablauf |
| `todos.remind` | stündlich 07:05–20:05 | ToDo-Deadlines: morgen, heute, überfällig. Stündlich, damit auch ein heute angelegtes ToDo noch erinnert; nachts still. `last_reminder` verhindert Wiederholungen, auch nachdem alte Benachrichtigungen bereinigt wurden |
| `reports.run` | täglich 06:00 | Fällige geplante Berichte versenden |
| `backup` | täglich `BACKUP_HOUR` | `pg_dump`, verschlüsseln, Aufbewahrung bereinigen |
| `retention` | täglich 04:30 | Audit-Log, Benachrichtigungen, Sitzungen nach Frist bereinigen |

Status und letzte Fehler stehen in `job_runs` und unter *Server-Management → System & Backups*. Wiederholte Läufe sind idempotent.

Benachrichtigungen: Alles läuft über `notify()` (`lib.js`). Die Zeile in `notifications` entsteht immer und verhindert über `dedupe_key` doppelte Mails; ist „In der App“ aus, blendet `/notifications` die Art aus. Eine Mail geht nur bei ausdrücklich gewähltem „E-Mail“ raus, nur beim ersten Mal und im Hintergrund, damit SMTP keine Anfrage aufhält. Ohne gespeicherte Einstellung gilt: in der App ja, E-Mail nein. Migration 015 hat die E-Mail-Wahl außer bei Terminen zurückgesetzt, weil sie vorher nichts bewirkte, aber überall vorausgewählt war. Ticket-Kommentare benachrichtigen die jeweils andere Seite: Kommentiert der Melder, alle aktiven Benutzer mit `admin:access`, sonst den Melder.

### 7.3 Intervalle
`interval` ist bei täglichen, wöchentlichen, monatlichen und jährlichen Serien der Abstand in der jeweiligen Einheit, bei `custom` in Tagen. Monats- und Jahresserien bleiben am ursprünglichen Tag verankert und werden in kürzeren Monaten auf deren letzten Tag gesetzt. `addInterval` und `nthOccurrence` stehen ohne Datenbank in `periods.js` (`lib.js` exportiert sie weiter).

### 7.5 Wochenprognose
`forecast.js` (ohne Datenbank, `test/forecast.test.js`) rechnet in Cent als BigInt: `weekOf` (Wochenstart 0/1), `ruleOccurrences` (Ausführungen ab `next_run`, bis `end_date`), `salaryDays` (Tage ab `payroll_start_date` ohne `payroll_payments`), `historyWeeks` (Wochen seit der Woche der ersten Buchung, höchstens 8) und `planForecast`. Die Route `GET /stats/forecast` (`finance.js`) nutzt `statScope` wie das Dashboard und liefert nur Daten: Summen je Tag und Typ der beiden Wochen, aktive Daueraufträge mit Anzahl sichtbarer Seiten (`copies`, geteilte zählen beim Empfänger mit), das Festgehalt nur für ein gültiges Gehaltskonto im Umfang (wie `payrollRun`) und den Erfahrungswert ohne `recurring_id` und ohne Festgehalt (`amount - payroll_payments.base_amount` bei `source='payroll'`). `today` kommt vom Browser, weil der Server in UTC rechnet.

### 7.6 Screenshot-Scanning
Ablauf: `pages/transaction-scan.js` bereitet das Bild im Browser auf (`prepareImage`: Vergrößerung auf mindestens 1,5× bzw. ~1.800 px Breite, höchstens 3× und 8 Mio. Pixel; Graustufen; lokaler Kontrast mit 41×41-Mittel über laufende Summen, je nach Hintergrund nur dunklere bzw. hellere Punkte schwarz, damit keine Höfe entstehen) und schickt PNG (über 8 MB JPEG) an `POST /transactions/scan`. `ocr.js` startet `tesseract stdin stdout -l deu+eng --psm 6` (ein Block; `--psm 4` und `3` verloren rechtsbündige Beträge), höchstens zwei gleichzeitig, `OMP_THREAD_LIMIT=1`, 60 s Zeitlimit, Warteschlange bis 10 (sonst 429); fehlt das Programm, 503. Das Bild bleibt im Speicher und wird verworfen. `scan.js` (ohne Datenbank, `test/scan.test.js` mit echten Tesseract-Ausgaben) macht aus dem Text Vorschläge: `findDate` (Datum und Uhrzeit aus der Zeile), `findAmounts` (Betrag nur mit Währung, Vorzeichen direkt davor oder zwei Nachkommastellen; keine Prozente), `parseAmount` (Tausender nur in Dreiergruppen), Layout-Erkennung „Datum unter der Buchung“ gegen „Datum als Überschrift“, Text aus der Zeile oder einer Nachbarzeile, Art aus Vorzeichen oder Wörtern. Doppelte erkennt das Frontend über `GET /transactions?budget_id&from&to` (gleiches Datum, Typ, Betrag); gebucht wird über `POST /transactions/import` in einer Transaktion mit `source='import'`, Audit `transaction.imported`. Die Erkennung testet `browser.mjs` mit gerenderten Bank-Apps (hell, dunkel, Handy im Spielbild).

### 7.7 Darstellung V2 und Dashboard-Layout
`ui-prefs.js` (ohne Datenbank, `test/ui-prefs.test.js`): `uiPrefsSchema` prüft, was `PATCH /me` annimmt (immer das ganze Objekt, `strict`): `background` (`dusk|night|forest|none|custom`), `blur` 0–40, `opacity` 20–90, `dim` 0–70, `lite`, `dashboard` (`order`, `hidden`, `spans` mit 4/6/8/12) oder `null` für den Standard. `normalizeUiPrefs` liest Gespeichertes und lässt unbekannte oder doppelte Module fallen; `DASHBOARD_MODULES` muss zu `MODULES` in `pages/dashboard.js` passen. Das Hintergrundbild läuft über `receiveUpload` (`images: true`), alte Dateien löscht `PUT`/`DELETE /me/background` und das Löschen des Benutzers (`admin.js`); der Browser verkleinert vorher auf höchstens 2560 px als JPEG (`shrinkImage` in `settings.js`). Ausgeliefert wird es nur an den Besitzer und im Browser als `data:`-URL gezeigt (die CSP erlaubt kein `blob:`).

### 7.4 Kalender
Der Server liefert für `[from, to]` die Vereinigung aus eigenen Terminen und abgeleiteten Terminen, nur aus Quellen, die der Benutzer lesen darf. Der iCal-Feed nutzt einen widerrufbaren Token pro Benutzer. Seit Migration 022 gehören dazu offene ToDos mit Deadline (`todo:<id>`, Typ `todo`, `visibleSql('td', 'todos')`, Notiz = Organisation oder „Solo“) und keine Service-/Verbandskasten-Termine ausgemusterter Fahrzeuge.

## 8. Frontend

- Routen in `PAGES` (`app.js`), jeweils mit optionalem Recht. Seiten: `dashboard`, `transactions`, `work`, `budgets`, `spending`, `recurring`, `goals`, `reports`, `teams`, `calendar`, `notes`, `todos`, `sport-run|swim|bike`, `assets-vehicles|properties|keys|manage` (`assets-people` leitet zu `casefiles?tab=people` um), `casefiles`, `trainings`, `licenses`, `docs` (Direktlinks `?id=` bzw. `?page=`), `admin-users|server|tickets`, `help`, `changelog`, `bug-report`, `settings`, `impressum`, `datenschutz`. Alias: `assets`, `admin`.
- Changelog: Die Daten stehen in `js/changelog.js` (`CHANGELOG` neueste zuerst mit `version`, `date`, `migrations`, `title`, `changes: [[art, text]]`, dazu `UNRELEASED`), ohne DOM, damit `test/changelog.test.js` sie prüft: oberste Version = `package.json`, absteigende Versionen und Daten bis `0.0.0`, nur bekannte Arten, kein HTML. Die Seite `pages/changelog.js` filtert im Browser; die oberste Version gilt als installiert, weil Seite und Code aus demselben Build kommen.
- Bei jedem Seitenwechsel wird `#view` ersetzt; Listener an `view` stapeln sich daher nicht.
- Navigation wird anhand der Rechte aus `/me` ausgeblendet, Abschnittsüberschriften ohne sichtbaren Eintrag ebenso; das Backend prüft unabhängig davon.
- Theme: `data-theme` und `data-accent` auf `<html>` steuern CSS-Variablen.
- Design-Dialog: `boot` (`app.js`) ruft nach dem Login `chooseDesign` auf, solange `ui_choice_seen` falsch ist und keine 2FA-Einrichtung ansteht; Vorschau über `applyUi`, gespeichert wird beim Schließen (`openForm` mit `cancel`). Die E2E-Skripte schließen ihn beim Login mit „Später“, `browser.mjs` prüft ihn mit Dave.
- Design V2: `applyUi` (`app.js`) setzt `data-ui="v2"`, `data-bg`, `data-ui-lite` und `--v2-blur`/`--v2-alpha`/`--v2-dim` auf `<html>` und lädt ein eigenes Bild in `#bg-layer` (`index.html`); `theme.js` übernimmt die Werte aus `localStorage` (`bm-ui`) schon vor dem ersten Bild. Alles Aussehen steht in `css/theme-v2.css` (nach `theme.css` laden: gleiche Spezifität, spätere Regel gewinnt) und greift nur unter `[data-ui="v2"]`; Glas = `--surface` mit Alpha plus `backdrop-filter`, Karten in Karten ohne zweite Unschärfe. Vorlagen sind reines CSS (Verlauf plus `clip-path`-Berge), keine Bilddateien. Die Symbole der Navigation setzt `app.js` (`NAV_ICONS`), in V1 sind sie ausgeblendet.
- Dashboard (`pages/dashboard.js`): `MODULES` (Titel, nötige Daten, erlaubte Breiten, Recht, nur V2), `V1_LAYOUT` fest, `V2_LAYOUT` als Standard; `resolveLayout` bildet das gespeicherte Layout auf die verfügbaren Module ab (neue ans Ende). Geladen werden nur die Daten sichtbarer Module. Raster mit 12 Spalten (`.dash-grid`, `--span`), jedes Modul ist ein Container (`container-type: inline-size`), damit z. B. die Prognose schmal einspaltig wird.
- Handy: `labelTables` (`app.js`, über einen `MutationObserver`) schreibt die Spaltenüberschrift in `data-label` jeder Zelle und setzt `.stackable`; unter 640 px zeigt `layout.css` Tabellen als Karten. Ausgenommen: Tabellen in `.forecast-week` oder `.no-stack`.
- Geldbeträge werden als Strings geführt und erst zur Anzeige formatiert.
- Stundenzettel (`pages/work.js`): `shiftHours` setzt die Stunden bei jeder Änderung von Beginn, Ende oder Pause (Ende vor Beginn = über Mitternacht); `GET /work-hours/team/monthly` liefert die anfragende Person nicht mit, die Suche filtert den geladenen Bericht im Browser (`drawTeamHours`).

## 9. Betrieb und Tests

- **Health:** `/health` (Liveness), `/ready` (DB erreichbar).
- **Logging:** JSON auf stdout, keine Passwörter oder Tokens.
- **Backups:** verschlüsselter Dump; Wiederherstellung per `src/cli/backup.js restore` ohne das Schema `pgboss`, danach `docker compose restart api worker`.
- **Updates:** `./scripts/update.sh`; Migrationen vorwärtskompatibel halten. Kein Cache-Löschen nötig, siehe Abschnitt 3.
- **Tests:** `npm test` in `apps/api` (Unit). End-to-End immer in einem eigenen Compose-Projekt mit eigenen Volumes und eigenem `IMAGE_TAG`, nie gegen die produktive Instanz; siehe [tests/e2e/README.md](tests/e2e/README.md).

### 9.1 Performance (2026-11-12)

Gemessen mit `tests/e2e/perf.mjs` (Median über 30 Aufrufe auf `bm-check`, mit `PERF_SEED=1` zusätzlich 15 Organisationen und 30 Budgets): Fast alle Listen antworten in 3–8 ms. Die Ausreißer waren Abfragen je Datensatz (N+1):

- `GET /teams` stellte sechs Abfragen je Organisation (Rechte, eigene Gruppen, Ränge, Gruppen, Mitglieder, Einladungen); jetzt sieben für alle zusammen, die Rechte per `unnest` über Organisationen × Funktionen. `GET /teams?brief=1` liefert nur Kopf und `levels` (zwei Abfragen) und ist für Auswahllisten gedacht (`orgsWithLevel` und die Seiten Konten, Kalender, Stundenzettel, Akten, Objekte, Sport); nur die Seite „Organisationen“ lädt die volle Liste.
- `GET /spending-budgets` summierte je Budget einzeln; jetzt eine Abfrage über `unnest` der Zeiträume.
- `actorScopeLevels` (`teams.js`) fragt `team_level` für alle Aktenarten und Doku-Kategorien in einer Abfrage.
- `buildFeed` (Kalender) stellt seine elf unabhängigen Abfragen parallel; Feiertage berechnet `holidaysOf` einmal je Jahr und behält sie im Prozess.

Migration 032 ergänzt Indizes auf Fremdschlüsseln, nach denen Listen, Rechteprüfungen und Löschkaskaden filtern (vor allem `team_members(user_id)` für „meine Organisationen“). Bei den heutigen Datenmengen liest PostgreSQL kleine Tabellen trotzdem ganz; die Indizes greifen beim Wachsen.

Bewusst nicht (Entscheidung des Auftraggebers vom 2026-11-12): kein Redis und kein Cache für Rechte oder Geldbeträge, ein Cache dort könnte nach einer Rechteänderung alte Rechte liefern. Im Prozess zwischengespeichert sind nur Einstellungen (`allSettings`, 5 Sekunden, beim Speichern verworfen) und Feiertage. Optimistische Anzeige nur bei kleinen Schaltern: ToDo erledigt, Notiz anheften und archivieren, „Alle gelesen“ in der Glocke; lehnt der Server ab, springt die Anzeige zurück. Buchungen, Umbuchungen, Gehalt, Akten und Rechte warten auf den Server. Bilder in Galerien (Fahrzeuge, Akten) lädt `fillGallery` erst, wenn sie in die Nähe des sichtbaren Bereichs kommen (`IntersectionObserver`, 300 px Vorlauf).

## 10. Grenzen

Eine Installation pro Organisation, `worker` einmal betreiben, ein Host. Offene Punkte stehen in [CONCEPT.md](CONCEPT.md), Abschnitt 14.
