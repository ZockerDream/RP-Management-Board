# RP-Management-Board – Technische Sicht

Ergänzt [CONCEPT.md](CONCEPT.md) und beschreibt den implementierten Stand (Migration 016).

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
    │       ├── payroll.js, work-hours.js, work-split.js, periods.js, validation.js, static-assets.js, cli/backup.js
    │       ├── org.js, records.js, uploads.js
    │       └── routes/          # admin attachments auth calendar casefiles docs finance integrations
    │                            # licenses me notes objects public spending sport teams todos trainings work
    └── web/public/
        ├── index.html, favicon.svg, css/
        └── js/                  # api app calendar charts markdown md5 recurrence theme ui
            └── pages/           # eine Datei je Seite
```

## 3. Deployment

Der Service `api` liefert SPA und REST-API am selben Ursprung aus und veröffentlicht allein den App-Port. `worker` nutzt dasselbe Image ohne Port, `db` hängt nur im internen Netz. Container laufen mit `read_only`, `cap_drop: ALL`, `no-new-privileges` und Healthchecks. `uploads` und `backups` sind Volumes. Das Impressum kommt per `env_file` aus `.env-impressum` (optional, nicht im Repository, nicht im Image; muss auf jedem Server einzeln gepflegt werden).

**Auslieferung statischer Dateien:** Beim Start berechnet die API einen Hash über alle Dateien in `apps/web/public` und schreibt die Pfade in `index.html` auf `assets/<Hash>/…` um. `/` und `/index.html` werden mit `no-cache` ausgeliefert, alles unter `/assets/<Hash>/` mit `max-age=31536000, immutable`. Nach einem Update ändern sich damit alle Adressen; neues HTML trifft nie auf altes JS oder CSS, auch nicht über Browser-Cache oder Proxy. Relative Modul-Imports bleiben automatisch in derselben Version. Ein Tab von vor einem Update findet nachzuladende Seiten nicht mehr (404) und lädt einmal neu (`reloadIfOutdated` in `app.js`, höchstens einmal in 30 Sekunden).

## 4. Datenmodell

Konventionen: UUID-Primärschlüssel, Geld als `numeric(14,2)`, Zeiten als `timestamptz`, Kalenderdaten als `date`. `pg` liefert `numeric` und `date` als Strings; Beträge nie als Float weiterrechnen. Das maßgebliche Schema steht in `apps/api/migrations/`; hier die Struktur im Überblick.

### 4.1 Identität und Rechte
```
users(id, email citext unique, password_hash, name, locale, currency, timezone, week_start,
      status[active|locked|invited|disabled], totp_secret_enc, totp_enabled, force_2fa,
      weekly_work_hours, daily_salary, hourly_bonus_percent, payroll_budget_id, payroll_start_date,
      gravatar_enabled default false, theme, accent, max_budgets, expires_at, last_login_at, deleted_at)
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
budgets(id, name, type[solo|shared], owner_user_id, team_id, currency, period_type, period_start, period_end, limit_amount, archived)
categories(id, budget_id, name, limit_amount, color)
transactions(id, budget_id, category_id, created_by, type[income|expense|deposit], amount, booked_at, title, note, tags,
             source[manual|recurring|asset|import|…], recurring_id, asset_type, asset_id, goal_id, income_kind[other|salary])
recurring_rules(id, budget_id, category_id, created_by, name, type, amount, frequency, interval, start_date, end_date, next_run, active,
                recipient_user_id, recipient_budget_id, recipient_status, source, asset_type, asset_id, income_kind)
goals(id, budget_id, name, target_amount, target_date, installment_amount, installment_frequency, installment_interval)
attachments(id, transaction_id, storage_key, mime, size, sha256)
spending_budgets(id, owner_user_id, name, budget_id, category_id, limit_amount, period_type[daily|weekly|monthly|yearly])
```
Kontostand und Dashboard-Gesamtsaldo werden gleich berechnet: Einnahmen − Ausgaben mit `booked_at <= heute`; `deposit`-Buchungen bleiben außen vor. Das Dashboard begrenzt auch KPIs, Kategorien, Cashflow und letzte Buchungen per `to` auf heute. Sparziel-Fortschritt = Summe der `deposit`-Buchungen mit `goal_id`. Ein Budget zählt Ausgaben im aktuellen Zeitraum (`periodRange`), geschnitten mit den für den Benutzer zugänglichen Konten; die Woche beginnt am Montag.

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
sport_routes(id, team_id, sport_type[run|swim|bike], name, checkpoints, distance_km, notes, created_by)
sport_scores(id, route_id, user_id, score, duration_seconds, checkpoints_reached, note, achieved_on)
```
Sortierung der Bestenliste: `score DESC, duration_seconds NULLS LAST, created_at`. Rechte über die Funktion `sport` der Organisation (Lesen: ansehen und eigene Ergebnisse, Lesen & Schreiben: Strecken und fremde Ergebnisse).

### 4.5 Objekte
```
people(id, name, kind, function, phone, email, user_id, active, note, owner_user_id, team_id)
properties(id, name, type, address, responsible_person_id, maintenance_due, maintenance_note, door_pin_enc, note, owner_user_id, team_id, <cost>)
vehicles(id, plate, make_model, status, registered_owner, service_due, odometer_km, service_interval_km, service_due_km,
         first_aid_kit_expires_on, note, owner_user_id, team_id, <cost>)
keys(id, code, label, kind, property_id, vehicle_id, copies, note, owner_user_id, team_id, <cost>)
key_assignments(id, key_id, person_id, copy_no, issued_at, due_at, returned_at, lost_at, issued_by_user_id, receipt_signed)
<cost> = cost_amount, cost_interval[once|daily|weekly|monthly|yearly|custom], cost_interval_count,
         cost_budget_id, cost_category_id, cost_tracking, cost_recurring_id
```
Der Schlüsselstatus wird aus den Zuweisungen abgeleitet. Tür-PINs liegen verschlüsselt in `door_pin_enc`, erscheinen nie in regulären Antworten und sind nur über `/properties/:id/pin/reveal` nach Passwort- und ggf. 2FA-Prüfung erreichbar. Anzeigen, Ändern und Entfernen landen im Audit-Log; API-Keys haben keinen Zugriff.

### 4.6 Kalender, Benachrichtigungen, System
```
calendar_events(id, owner_id, team_id, type[team|personal], title, date, start_time, end_time, all_day, repeat, repeat_interval, remind, last_reminded, amount, note)
notifications(id, user_id, kind, title, body, dedupe_key, read_at), notification_prefs(user_id, kind, in_app, email)
saved_reports, api_keys, webhooks, bug_reports, settings(key, value jsonb), audit_log, backups, job_runs, schema_migrations
```
Automatische Termine werden beim Abruf aus den Quelltabellen abgeleitet, nicht dupliziert.

### 4.7 Notizen, ToDos, Ticket-Kommentare
```
notes(id, owner_user_id, team_id, title, body, pinned, created_by, updated_by, created_at, updated_at)
todos(id, owner_user_id, team_id, title, note, due_date, done_at, done_by, last_reminder, created_by, created_at, updated_at)
bug_report_comments(id, report_id, user_id, body, created_at)
```
### 4.8 Akten, Lizenzen, Schulungen, Dokumentationen (Migration 017, Aktenarten und Beschränkung 018)
```
case_files(id, owner_user_id, team_id, type_id, restricted, file_number, title, description, status[open|dormant|closed], opened_on, closed_on, …)   -- Aktenzeichen eindeutig je Bereich
case_file_types(id, owner_user_id, team_id, name)                -- Name eindeutig je Bereich, benutzte Arten lassen sich nicht löschen
case_file_access(id, case_file_id, rank_id | group_id | user_id) -- nur bei restricted; Rang zählt samt allen höheren
case_file_people(case_file_id, person_id, role), case_file_entries(id, case_file_id, entry_date, kind, body, person_id, …)
case_file_attachments(id, case_file_id, storage_key, original_name, mime, size, sha256, uploaded_by)
license_types(id, owner_user_id, team_id, name, description, validity_months)
licenses(id, type_id, person_id, number, issued_on, valid_until, issuer, status[valid|suspended|revoked], status_reason, note)
trainings(id, owner_user_id, team_id, name, description, validity_months, active)
training_sessions(id, training_id, session_date, start_time, end_time, location, instructor, note)
training_records(id, training_id, session_id, user_id | person_id, result[registered|passed|failed|absent], completed_on, valid_until, instructor, note)
doc_categories(id, owner_user_id, team_id, name, sort), doc_pages(id, category_id, title, body, pinned, created_by, updated_by, …)
```
Bereich (`owner_user_id` xor `team_id`) haben nur die Kopftabellen; Einträge, Lizenzen, Termine, Nachweise und Seiten erben ihn. Er wird beim Anlegen gesetzt und bleibt fest. Zugriff: Katalogrecht (`casefile|license|training|doc:read|create|update|delete`) und die Stufe in der Organisation (`recordLevel`/`recordOwner`, Akten über `case_file_level`). Personen und Teilnehmer müssen im selben Bereich liegen (`assertPersonInScope`, `assertUserInScope` in `records.js`); Personennamen werden nur über `personJoin` gezeigt, also nur bei Zugriff auf die Person. `DELETE /people/:id` lehnt Personen mit Akten, Lizenzen oder Nachweisen ab, und solche Personen wechseln auch nicht den Bereich. Die Fremdschlüssel auf `people` kaskadieren trotzdem (Einträge: `SET NULL`), denn beim Löschen eines Teams prüft PostgreSQL die Verweise schon in der kaskadierenden Teil-Löschung der Personen, bevor die Akten des Teams entfernt sind. Anhänge laufen wie Belege über `uploads.js` (PDF, PNG, JPEG, Magic Bytes, Größenlimit); beim Löschen einer Akte werden die Dateien entfernt. Zustände `expiring` (≤ 30 Tage) und `expired` werden beim Abruf berechnet. Dokumentationen, Notizen, Sachverhalte und Einträge von Akten, Schulungsbeschreibungen, ToDo-Notizen, Streckennotizen, Lizenzart-Beschreibungen und Tickets rendert das Frontend mit `markdown.js` (`markdownBlock`, einzeilig `renderInline`): erst alles maskieren, dann wenige Auszeichnungen, Links nur `http(s)`. Gespeichert wird der Rohtext.

Bei `notes` und `todos` ist genau eines von `owner_user_id` und `team_id` gesetzt. Rechte hängen an Eigentum und der Stufe in der Organisation (`recordLevel`, `recordOwner` in `org.js`), nicht am RBAC-Katalog; ohne Schreibrecht gibt es beim Ändern 403, Fremde bekommen 404. Listen liefern `level`, damit die Oberfläche Aktionen ausblendet.

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
| Konto | `GET/PATCH /me`, `/me/password`, `/me/2fa/*`, `/me/sessions`, `/me/export`, `/me/notification-prefs`, `/me/api-keys`, `/me/ical`, `/notifications` |
| Admin | `/admin/users`, `/roles`, `/groups`, `/teams`, `/settings`, `/system`, `/overview`, `/audit`, `/api-keys`, `/webhooks`, `/backups`, `/bug-reports` |
| Organisationen | `GET/POST /teams`, `GET /teams/catalog`, `PATCH/DELETE /teams/:id`, `POST /teams/:id/members` (`rank_id`), `PATCH/DELETE /teams/:id/members/:uid` (`rank_id`, `is_owner`, `group_ids`), `GET /teams/:id/members/:uid/levels`, `DELETE /teams/:id/invitations/:iid`, `POST /teams/:id/ranks`, `PATCH/DELETE /team-ranks/:id` (`name`, `move: up\|down`), `POST /teams/:id/groups`, `PATCH/DELETE /team-groups/:id`, `GET/PUT /teams/:id/permissions` (`subject`, `subject_id`, `module`, `scope_id`, `level` oder `null`) |
| Finanzen | `/budgets`, `/budgets/:id/categories`, `/categories/:id`, `/transactions`, `/transactions/export.csv`, `/recurring`, `/goals`, `/spending-budgets` |
| Auswertung | `/stats/overview`, `/stats/by-category`, `/stats/timeline?granularity=day\|week\|month&periods=&week_start=&to=`, `/reports/costs`, `/reports/saved`. Standard `month` liefert `month`, sonst `bucket` (Tag bzw. Wochenbeginn) |
| Zeiterfassung | `/work-projects`, `/work-hours`, `/work-hours/timer/*`, `DELETE /work-hours/timer` (verwerfen), `/work-hours/monthly`, `/work-hours/monthly.pdf`, `/work-hours/export.csv`, `/work-hours/team/*` |
| Sport | `GET/POST /sport/routes`, `PATCH/DELETE /sport/routes/:id`, `POST /sport/routes/:id/scores`, `DELETE /sport/scores/:id` |
| Notizblock, ToDos | `GET/POST /notes`, `PATCH/DELETE /notes/:id`, `GET/POST /todos`, `PATCH/DELETE /todos/:id` (mit `done`) |
| Tickets | `GET/POST /bug-reports`, `DELETE /bug-reports/:id`, `POST /bug-reports/:id/comments`, `DELETE /bug-reports/:id/comments/:commentId`; dieselben unter `/admin/bug-reports` für alle Tickets. Getrennte Pfade, damit die Admin-IP-Allowlist greift |
| Akten | `GET/POST /case-files` (`?status=&type_id=&q=`), `GET/POST /case-file-types`, `PATCH/DELETE /case-file-types/:id`, `GET /case-files/:id/access-options`, `PUT /case-files/:id/access`, `GET/PATCH/DELETE /case-files/:id`, `POST /case-files/:id/people`, `DELETE /case-files/:id/people/:personId`, `POST /case-files/:id/entries`, `PATCH/DELETE /case-file-entries/:id`, `POST /case-files/:id/attachments`, `GET/DELETE /case-file-attachments/:id`, `GET /people/:id/record` (Personenübersicht) |
| Lizenzen | `GET/POST /license-types`, `PATCH/DELETE /license-types/:id`, `GET/POST /licenses` (`?state=&type_id=&person_id=&q=`), `PATCH/DELETE /licenses/:id`, `POST /licenses/:id/renew` |
| Schulungen | `GET/POST /trainings`, `GET /trainings/overview`, `GET/PATCH/DELETE /trainings/:id`, `GET /trainings/:id/candidates`, `POST /trainings/:id/sessions`, `POST/DELETE /training-sessions/:id/enroll` (selbst an- und abmelden), `PATCH/DELETE /training-sessions/:id`, `POST /trainings/:id/records`, `PATCH/DELETE /training-records/:id` |
| Dokumentationen | `GET/POST /doc-categories`, `PATCH/DELETE /doc-categories/:id`, `GET/POST /doc-pages` (`?category_id=&q=`), `GET/PATCH/DELETE /doc-pages/:id` |
| Objekte | `/people`, `/properties`, `/properties/:id/pin`, `/vehicles`, `/keys`, `/keys/:id/assign`, `/keys/:id/qr`, `/assignments/:id/return`, `/assignments/:id/lost`, `/assets/overview`, `/assets/costs`, `/assets/log` |
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
| `payroll.run` | stündlich zur Minute 45, auch beim Worker-Start und beim Setzen des Gehaltskontos | Festgehalt und Bonus buchen; der Vortag ab 03:45, ein Tag mit offener Schicht nach dem Ausstempeln |
| `reminders` | täglich 07:00 | Benachrichtigungen zu Terminen, Service, Verbandskasten, Schlüsselrückgaben, ablaufenden Lizenzen (`license_expiry`) und Schulungsnachweisen (`training_expiry`, nur der neueste je Teilnehmer): 30 Tage vorher und nach dem Ablauf |
| `todos.remind` | stündlich 07:05–20:05 | ToDo-Deadlines: morgen, heute, überfällig. Stündlich, damit auch ein heute angelegtes ToDo noch erinnert; nachts still. `last_reminder` verhindert Wiederholungen, auch nachdem alte Benachrichtigungen bereinigt wurden |
| `reports.run` | täglich 06:00 | Fällige geplante Berichte versenden |
| `backup` | täglich `BACKUP_HOUR` | `pg_dump`, verschlüsseln, Aufbewahrung bereinigen |
| `retention` | täglich 04:30 | Audit-Log, Benachrichtigungen, Sitzungen nach Frist bereinigen |

Status und letzte Fehler stehen in `job_runs` und unter *Server-Management → System & Backups*. Wiederholte Läufe sind idempotent.

Benachrichtigungen: Alles läuft über `notify()` (`lib.js`). Die Zeile in `notifications` entsteht immer und verhindert über `dedupe_key` doppelte Mails; ist „In der App“ aus, blendet `/notifications` die Art aus. Eine Mail geht nur bei ausdrücklich gewähltem „E-Mail“ raus, nur beim ersten Mal und im Hintergrund, damit SMTP keine Anfrage aufhält. Ohne gespeicherte Einstellung gilt: in der App ja, E-Mail nein. Migration 015 hat die E-Mail-Wahl außer bei Terminen zurückgesetzt, weil sie vorher nichts bewirkte, aber überall vorausgewählt war. Ticket-Kommentare benachrichtigen die jeweils andere Seite: Kommentiert der Melder, alle aktiven Benutzer mit `admin:access`, sonst den Melder.

### 7.3 Intervalle
`interval` ist bei täglichen, wöchentlichen, monatlichen und jährlichen Serien der Abstand in der jeweiligen Einheit, bei `custom` in Tagen. Monats- und Jahresserien bleiben am ursprünglichen Tag verankert und werden in kürzeren Monaten auf deren letzten Tag gesetzt.

### 7.4 Kalender
Der Server liefert für `[from, to]` die Vereinigung aus eigenen Terminen und abgeleiteten Terminen, nur aus Quellen, die der Benutzer lesen darf. Der iCal-Feed nutzt einen widerrufbaren Token pro Benutzer.

## 8. Frontend

- Routen in `PAGES` (`app.js`), jeweils mit optionalem Recht. Seiten: `dashboard`, `transactions`, `work`, `budgets`, `spending`, `recurring`, `goals`, `reports`, `teams`, `calendar`, `notes`, `todos`, `sport-run|swim|bike`, `assets-vehicles|properties|people|keys|manage`, `casefiles`, `trainings`, `licenses`, `docs` (Direktlinks `?id=` bzw. `?page=`), `admin-users|server|tickets`, `help`, `bug-report`, `settings`, `impressum`, `datenschutz`. Alias: `assets`, `admin`.
- Bei jedem Seitenwechsel wird `#view` ersetzt; Listener an `view` stapeln sich daher nicht.
- Navigation wird anhand der Rechte aus `/me` ausgeblendet, Abschnittsüberschriften ohne sichtbaren Eintrag ebenso; das Backend prüft unabhängig davon.
- Theme: `data-theme` und `data-accent` auf `<html>` steuern CSS-Variablen.
- Geldbeträge werden als Strings geführt und erst zur Anzeige formatiert.

## 9. Betrieb und Tests

- **Health:** `/health` (Liveness), `/ready` (DB erreichbar).
- **Logging:** JSON auf stdout, keine Passwörter oder Tokens.
- **Backups:** verschlüsselter Dump; Wiederherstellung per `src/cli/backup.js restore` ohne das Schema `pgboss`, danach `docker compose restart api worker`.
- **Updates:** `./scripts/update.sh`; Migrationen vorwärtskompatibel halten. Kein Cache-Löschen nötig, siehe Abschnitt 3.
- **Tests:** `npm test` in `apps/api` (Unit). End-to-End immer in einem eigenen Compose-Projekt mit eigenen Volumes und eigenem `APP_VERSION`, nie gegen die produktive Instanz; siehe [tests/e2e/README.md](tests/e2e/README.md).

## 10. Grenzen

Eine Installation pro Organisation, `worker` einmal betreiben, ein Host. Offene Punkte stehen in [CONCEPT.md](CONCEPT.md), Abschnitt 14.
