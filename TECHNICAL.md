# Budget Manager – Technische Sicht

Ergänzt [CONCEPT.md](CONCEPT.md) und beschreibt den implementierten Stand (Migration 013).

Die Oberfläche verwendet den Begriff „Konto“. API-Routen und Tabellen heißen aus Kompatibilitätsgründen weiterhin `/budgets`, `budgets` und `budget_id`. Das Ausgabenlimit „Budget“ der Oberfläche heißt technisch `spending_budgets`.

## 1. Stack

| Schicht | Wahl | Anmerkung |
|---|---|---|
| Datenbank | PostgreSQL 16 | `numeric` für Geld, CHECK-Constraints, `jsonb` |
| Backend | Node.js 22, Fastify 5, ESM-JavaScript | Validierung mit `zod`, SQL handgeschrieben über `pg` |
| Migrationen | Nummerierte SQL-Dateien | Laufen beim API-Start, je Datei in einer Transaktion, mit Advisory-Lock |
| Frontend | Vanilla-JS-Module ohne Build | Statisch aus `apps/web/public`, Hash-Router, Seiten per dynamischem `import()` |
| Diagramme, Kalender | Eigene Module | `charts.js` (SVG), `calendar.js` |
| Jobs | `pg-boss` im Service `worker` | Keine zusätzliche Redis-Abhängigkeit |
| Auth | Argon2, JWT + Refresh-Token, TOTP (`otplib`) | siehe 6 |
| Sonstiges | `pdfkit`, `qrcode`, `nodemailer`, `date-holidays` | |
| Tests | `node --test` | Unit-Tests ohne Datenbank; End-to-End siehe 9 |

## 2. Repository-Struktur

```
budget-manager/
├── docker-compose.yml, .env.example, .env-impressum.example
├── CLAUDE.md, CONCEPT.md, README.md, TECHNICAL.md
├── scripts/                 # gen-secrets.sh, update.sh
└── apps/
    ├── api/
    │   ├── Dockerfile, migrations/NNN_*.sql, test/
    │   └── src/
    │       ├── main.js, worker.js, jobs.js, config.js, db.js, seed.js, settings.js
    │       ├── authz.js, security.js, audit.js, mail.js, lib.js, backup.js
    │       ├── payroll.js, work-hours.js, cli/backup.js
    │       └── routes/          # admin attachments auth calendar finance integrations
    │                            # me objects public spending sport teams work
    └── web/public/
        ├── index.html, favicon.svg, css/
        └── js/                  # api app calendar charts md5 recurrence theme ui
            └── pages/           # eine Datei je Seite
```

## 3. Deployment

Der Service `api` liefert SPA und REST-API am selben Ursprung aus und veröffentlicht allein den App-Port. `worker` nutzt dasselbe Image ohne Port, `db` hängt nur im internen Netz. Container laufen mit `read_only`, `cap_drop: ALL`, `no-new-privileges` und Healthchecks. `uploads` und `backups` sind Volumes. Das Impressum kommt per `env_file` aus `.env-impressum` (optional, nicht im Repository, nicht im Image).

## 4. Datenmodell

Konventionen: UUID-Primärschlüssel, Geld als `numeric(14,2)`, Zeiten als `timestamptz`, Kalenderdaten als `date`. `pg` liefert `numeric` und `date` als Strings; Beträge nie als Float weiterrechnen. Das maßgebliche Schema steht in `apps/api/migrations/`; hier die Struktur im Überblick.

### 4.1 Identität und Rechte
```
users(id, email citext unique, password_hash, name, locale, currency, timezone, week_start,
      status[active|locked|invited|disabled], totp_secret_enc, totp_enabled, force_2fa,
      weekly_work_hours, hourly_rate, overtime_surcharge_percent, payroll_budget_id, payroll_start_date,
      gravatar_enabled default false, theme, accent, max_budgets, expires_at, last_login_at, deleted_at)
recovery_codes, sessions, password_resets, invitations
roles(id, name, description, is_system, is_default, data_scope[all|groups|own], max_budgets)
permissions(id, key), role_permissions, user_roles, groups, group_members, group_roles
```

### 4.2 Teams und Finanzen
```
teams(id, name, owner_id, status[active|archived])
team_members(team_id, user_id, team_role[owner|editor|viewer])
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
Der Kontostand wird berechnet: `balance = Einnahmen − Ausgaben`. Das Dashboard berechnet seinen Gesamtsaldo getrennt und zählt Einzahlungen mit (siehe offene Punkte in CONCEPT.md). Sparziel-Fortschritt = Summe der `deposit`-Buchungen mit `goal_id`. Ein Budget zählt Ausgaben im aktuellen Zeitraum (`periodRange`), geschnitten mit den für den Benutzer zugänglichen Konten; die Woche beginnt am Montag.

### 4.3 Zeiterfassung und Gehalt
```
work_projects(id, name, owner_user_id, team_id, active)
work_entries(id, user_id, project_id, work_date, hours, started_at, ended_at, break_minutes, note)
work_timers
payroll_payments(user_id, payroll_date, base_amount, overtime_hours, overtime_pay, …)   -- pro Tag eindeutig
```
`payroll.run` schreibt täglich um 03:45 Uhr für den Vortag gut, frühestens ab `payroll_start_date`: Wochen-Soll × Stundenlohn wird centgenau auf sieben Kalendertage verteilt, unabhängig von Anwesenheit. Tatsächlich erfasste Stunden oberhalb des Montag-bis-Sonntag-Wochensolls werden zusätzlich mit Stundenlohn plus prozentualem Zuschlag vergütet. Fehlende Tage werden nachgeholt; `payroll_payments` macht den Lauf idempotent. Monats-Soll = Wochen-Soll × Kalendertage / 7. Der Monatsbericht zeigt tatsächlich gebuchte Beträge.

### 4.4 Sport
```
sport_routes(id, team_id, sport_type[run|swim|bike], name, checkpoints, distance_km, notes, created_by)
sport_scores(id, route_id, user_id, score, duration_seconds, checkpoints_reached, note, achieved_on)
```
Sortierung der Bestenliste: `score DESC, duration_seconds NULLS LAST, created_at`. Alle Rechte hängen an der Teamrolle, nicht am RBAC-Katalog.

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

## 5. API (REST unter `/api`)

| Bereich | Endpunkte |
|---|---|
| Auth | `POST /auth/login`, `/auth/2fa/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot`, `/auth/reset`, `/auth/register`, `/auth/invite/:token`; `GET /auth/config` |
| Konto | `GET/PATCH /me`, `/me/password`, `/me/2fa/*`, `/me/sessions`, `/me/export`, `/me/notification-prefs`, `/me/api-keys`, `/me/ical`, `/notifications` |
| Admin | `/admin/users`, `/roles`, `/groups`, `/teams`, `/settings`, `/system`, `/overview`, `/audit`, `/api-keys`, `/webhooks`, `/backups`, `/bug-reports` |
| Teams | `/teams`, `/teams/:id/members`, `/teams/:id/invitations/:iid` |
| Finanzen | `/budgets`, `/budgets/:id/categories`, `/categories/:id`, `/transactions`, `/transactions/export.csv`, `/recurring`, `/goals`, `/spending-budgets` |
| Auswertung | `/stats/overview`, `/stats/by-category`, `/stats/timeline`, `/reports/costs`, `/reports/saved` |
| Zeiterfassung | `/work-projects`, `/work-hours`, `/work-hours/timer/*`, `/work-hours/monthly`, `/work-hours/monthly.pdf`, `/work-hours/export.csv`, `/work-hours/team/*` |
| Sport | `GET/POST /sport/routes`, `PATCH/DELETE /sport/routes/:id`, `POST /sport/routes/:id/scores`, `DELETE /sport/scores/:id` |
| Objekte | `/people`, `/properties`, `/properties/:id/pin`, `/vehicles`, `/keys`, `/keys/:id/assign`, `/keys/:id/qr`, `/assignments/:id/return`, `/assignments/:id/lost`, `/assets/overview`, `/assets/costs`, `/assets/log` |
| Kalender | `GET /calendar?from=&to=`, `POST/PUT/DELETE /calendar/events`, `GET /calendar/ical/:token.ics` |
| Sonstiges | `/integrations/:provider/*`, `/bug-reports`, `/attachments/:id`, `GET /public/imprint` |

Fehlerformat: `{ error, message }`. Validierungsfehler und von PostgreSQL abgelehnte Werte (keine gültige UUID, nicht existierendes Datum) ergeben 400. Fremde Datensätze ergeben 404 oder eine leere Liste. Beträge werden als String ausgegeben.

## 6. Sicherheit

- **Passwörter:** Argon2, Mindestlänge aus `settings`, optionaler Leak-Check per HIBP k-Anonymität.
- **Tokens:** kurzlebiges Access-JWT nur im Speicher; Refresh-Token als httpOnly-, SameSite=Strict-Cookie (`Secure` bei HTTPS), als Hash in `sessions`, mit Rotation.
- **2FA:** TOTP, Secret mit AES-256-GCM verschlüsselt, 8 einmalige Recovery-Codes als Hash. Global (`security.force_2fa`) oder pro Benutzer erzwingbar.
- **Sperren:** Login-Sperre nach Fehlversuchen; globales Rate-Limit 300 Anfragen/Minute pro IP (auch statische Dateien), strengere Grenzen für Login und PIN; optionale Admin-IP-Allowlist.
- **Rechteprüfung:** `authz('budget:update')` plus Objektprüfung (`budgetAccess`, `assertOwner`, Teamrolle). Effektive Rechte = Vereinigung aus Rollen und Gruppenrollen, Cache 15 Sekunden.
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
| `payroll.run` | täglich 03:45, auch beim Worker-Start und beim Setzen des Gehaltskontos | Basisgehalt und Überstunden buchen |
| `reminders` | täglich 07:00 | Benachrichtigungen zu Terminen, Service, Verbandskasten, Schlüsselrückgaben |
| `reports.run` | täglich 06:00 | Fällige geplante Berichte versenden |
| `backup` | täglich `BACKUP_HOUR` | `pg_dump`, verschlüsseln, Aufbewahrung bereinigen |
| `retention` | täglich 04:30 | Audit-Log, Benachrichtigungen, Sitzungen nach Frist bereinigen |

Status und letzte Fehler stehen in `job_runs` und unter *Server-Management → System & Backups*. Wiederholte Läufe sind idempotent.

### 7.3 Intervalle
`interval` ist bei täglichen, wöchentlichen, monatlichen und jährlichen Serien der Abstand in der jeweiligen Einheit, bei `custom` in Tagen. Monats- und Jahresserien bleiben am ursprünglichen Tag verankert und werden in kürzeren Monaten auf deren letzten Tag gesetzt.

### 7.4 Kalender
Der Server liefert für `[from, to]` die Vereinigung aus eigenen Terminen und abgeleiteten Terminen, nur aus Quellen, die der Benutzer lesen darf. Der iCal-Feed nutzt einen widerrufbaren Token pro Benutzer.

## 8. Frontend

- Routen in `PAGES` (`app.js`), jeweils mit optionalem Recht. Seiten: `dashboard`, `transactions`, `work`, `budgets`, `spending`, `recurring`, `goals`, `reports`, `teams`, `calendar`, `sport-run|swim|bike`, `assets-vehicles|properties|people|keys|manage`, `admin-users|server|tickets`, `help`, `bug-report`, `settings`, `impressum`, `datenschutz`. Alias: `assets`, `admin`.
- Bei jedem Seitenwechsel wird `#view` ersetzt; Listener an `view` stapeln sich daher nicht.
- Navigation wird anhand der Rechte aus `/me` ausgeblendet; das Backend prüft unabhängig davon.
- Theme: `data-theme` und `data-accent` auf `<html>` steuern CSS-Variablen.
- Geldbeträge werden als Strings geführt und erst zur Anzeige formatiert.

## 9. Betrieb und Tests

- **Health:** `/health` (Liveness), `/ready` (DB erreichbar).
- **Logging:** JSON auf stdout, keine Passwörter oder Tokens.
- **Backups:** verschlüsselter Dump; Wiederherstellung per `src/cli/backup.js restore` ohne das Schema `pgboss`, danach `docker compose restart api worker`.
- **Updates:** `./scripts/update.sh`; Migrationen vorwärtskompatibel halten.
- **Tests:** `npm test` in `apps/api` (Unit). End-to-End immer in einem eigenen Compose-Projekt mit eigenen Volumes und eigenem `APP_VERSION`, nie gegen die produktive Instanz; siehe [CLAUDE.md](CLAUDE.md).

## 10. Grenzen

Eine Installation pro Organisation, `worker` einmal betreiben, ein Host. Offene Punkte stehen in [CONCEPT.md](CONCEPT.md), Abschnitt 12.
