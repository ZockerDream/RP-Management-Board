# Budget Manager – Technische Sicht

Ergänzt [CONCEPT.md](CONCEPT.md). Der Stack ist ein Vorschlag, die offene Entscheidung steht in Abschnitt 14.

## 1. Stack

| Schicht | Wahl | Begründung |
|---|---|---|
| Datenbank | PostgreSQL 16 | `numeric` für Geld, CHECK-Constraints, `jsonb`, Row-Level-Security möglich |
| Backend | Node.js 22, NestJS, TypeScript | Module, Guards und DI passen zu RBAC; ein Typsystem bis ins Frontend |
| ORM/Migrationen | Prisma (Alternative: Drizzle) | Typisierte Queries, versionierte Migrationen |
| Validierung | zod bzw. class-validator, OpenAPI aus den Schemas | Ein Vertrag für Frontend und API |
| Frontend | React + Vite + TypeScript, TanStack Query, React Router | SPA wie im Mockup, Hash-Router wird zu History-Router |
| Diagramme | Eigene SVG-Komponenten aus dem Mockup (`charts.js`) oder ECharts | Mockup kommt ohne Bibliothek aus |
| Kalender | Eigene Komponente (Logik aus `calendar.js`), `rrule` für Serien | Ansichten sind schon gebaut |
| Jobs | `pg-boss` (Queue in PostgreSQL) im Service `worker` | Keine zusätzliche Redis-Abhängigkeit, Locking inklusive |
| Auth | Argon2id, kurzlebiges JWT + Refresh-Token, TOTP (`otplib`) | siehe 6 |
| Einstieg | Fastify (`api`) | Liefert SPA und REST-API direkt auf demselben Port; kein Reverse-Proxy erforderlich |
| Tests | Vitest/Jest, Supertest, Testcontainers (echtes Postgres), Playwright (E2E) | |

## 2. Repository-Struktur

```
budget-manager/
├── docker-compose.yml
├── docker-compose.override.yml      # Dev: Hot-Reload, exponierte Ports
├── .env.example
├── apps/
│   ├── api/                         # Fastify API und Worker
│   │   ├── prisma/schema.prisma, migrations/
│   │   └── src/
│   │       ├── auth/ users/ roles/ groups/ teams/
│   │       ├── budgets/ transactions/ recurring/ goals/ reports/
│   │       ├── people/ properties/ vehicles/ keys/ costs/
│   │       ├── calendar/ notifications/ admin/ audit/
│   │       ├── common/ (guards, decorators, money, pagination)
│   │       ├── worker.ts            # startet nur Jobs, keine HTTP-Routen
│   │       └── main.ts
│   └── web/public/                  # Statische SPA, direkt von der API ausgeliefert
├── packages/shared/                 # Typen, Permission-Keys, zod-Schemas
└── docs: CONCEPT.md, TECHNICAL.md
```

## 3. Deployment (Docker Compose)

Die konkrete Konfiguration steht in `docker-compose.yml`. Der Service `api` liefert die statische SPA aus `apps/web/public` sowie die REST-API am selben Ursprung aus und veröffentlicht allein den App-Port. Ein Reverse-Proxy ist optional und wird nicht mitgeliefert. `db` hängt in einem internen Netz.
- `worker` verwendet dasselbe API-Image, hat aber keinen veröffentlichten Port.
- `uploads` (Belege) ist ein Volume, später S3-kompatibel austauschbar.
- Migrationen laufen beim Start der API. Bei mehreren API-Instanzen vorher einen separaten Migrations-Job einsetzen.
- `.env.example` enthält `DATABASE_URL`, `JWT_SECRET`, `APP_URL`, SMTP-Daten und optional `TRUST_PROXY`. Echte Werte nie ins Repository.

## 4. Datenmodell

Konventionen: UUID-Primärschlüssel, `created_at`/`updated_at` überall, Geld als `numeric(14,2)`, Zeiten als `timestamptz` in UTC, Soft-Delete (`deleted_at`) wo Auditierbarkeit nötig ist.

### 4.1 Identität und Rechte
```
users(id, email citext unique, password_hash, name, locale, currency, timezone,
      week_start, status[active|locked|invited|disabled], totp_secret_enc NULL,
      totp_enabled, gravatar_enabled, theme, accent, theme_auto, last_login_at, deleted_at)
recovery_codes(id, user_id, code_hash, used_at)
sessions(id, user_id, refresh_hash, user_agent, ip, created_at, last_seen_at, revoked_at)
roles(id, name unique, description, is_system, is_default, data_scope[all|groups|own], max_budgets NULL)
permissions(id, key unique)                    -- 'budget:read', 'key:assign', ...
role_permissions(role_id, permission_id)
groups(id, name, description, auto_domain NULL, leader_can_manage)
group_members(group_id, user_id, is_leader)
user_roles(user_id, role_id)
group_roles(group_id, role_id)
invitations(id, email, role_id, team_id NULL, token_hash, invited_by, expires_at, accepted_at)
```

### 4.2 Teams und Budgets
```
teams(id, name, owner_id, status[active|archived], created_at)
team_members(team_id, user_id, team_role[owner|editor|viewer])

budgets(id, name, type[solo|shared], owner_user_id NULL, team_id NULL, currency,
        period_type[monthly|yearly|custom|goal], period_start, period_end, limit_amount, archived)
  CHECK ((type='solo'   AND owner_user_id IS NOT NULL AND team_id IS NULL)
      OR (type='shared' AND team_id IS NOT NULL AND owner_user_id IS NULL))
categories(id, budget_id, name, limit_amount NULL, color)
transactions(id, budget_id, category_id, created_by, type[income|expense|deposit],
             amount numeric(14,2) CHECK (amount > 0), booked_at date, note, tags text[],
             source[manual|recurring|asset|import], recurring_id NULL, asset_type NULL, asset_id NULL,
             goal_id NULL)
recurring_rules(id, budget_id, category_id, created_by, type, amount, frequency, interval,
                start_date, end_date NULL, next_run, active,
                source[manual|asset], asset_type NULL, asset_id NULL)
goals(id, budget_id, name, target_amount, target_date, monthly_amount NULL)
attachments(id, transaction_id, storage_key, mime, size, sha256)
```
Der Saldo wird aus `transactions` berechnet, nicht gespeichert. Sparziel-Fortschritt = Summe der `deposit`-Buchungen mit `goal_id`.

### 4.3 Objekte
```
people(id, name, kind[employee|external|family], function, phone, email,
       user_id NULL REFERENCES users, active, note)      -- NULL = kein Panel-Zugang
properties(id, name, type[home|office|storage|holiday], address, responsible_person_id, note, <cost>)
vehicles(id, plate unique, make_model, status[available|in_use|workshop|retired],
         service_due date NULL, insurance_from date NULL, note, <cost>)
keys(id, label, kind, property_id NULL, vehicle_id NULL, copies int, note, <cost>)
  CHECK (property_id IS NOT NULL OR vehicle_id IS NOT NULL)
key_assignments(id, key_id, person_id, copy_no, issued_at, due_at NULL, returned_at NULL,
                lost_at NULL, issued_by_user_id, receipt_signed bool)
  UNIQUE (key_id, copy_no) WHERE returned_at IS NULL AND lost_at IS NULL

<cost> = cost_amount numeric(14,2) NULL, cost_interval[once|monthly|quarterly|yearly] NULL,
         cost_budget_id NULL, cost_category_id NULL, cost_tracking bool default true,
         cost_recurring_id NULL (vom System verwaltet)
  CHECK (cost_amount IS NULL OR (cost_interval IS NOT NULL AND cost_budget_id IS NOT NULL))
```
Der Schlüsselstatus wird aus den Zuweisungen abgeleitet: ausgegeben (offene Zuweisung), überfällig (`due_at < now()`), verloren (`lost_at`), sonst im Safe. Fahrzeuge haben bewusst kein Standort- und kein Fahrerfeld.

### 4.4 Kalender, Benachrichtigungen, System
```
calendar_events(id, owner_id, team_id NULL, type[team|personal], title, starts_at, ends_at,
                all_day, rrule NULL, remind_before interval NULL, amount NULL, note)
calendar_exceptions(event_id, original_date, cancelled bool, override jsonb NULL)  -- optional, Phase 2
notifications(id, user_id, kind, payload jsonb, read_at, created_at)
notification_prefs(user_id, kind, in_app, email)
saved_reports(id, owner_id, kind, params jsonb, cron NULL, recipients text[], active)
api_keys(id, name, prefix, key_hash, scopes text[], last_used_at, revoked_at, created_by)
webhooks(id, url, events text[], secret_enc, active)
settings(key primary key, value jsonb)               -- Branding, Richtlinien, SMTP, Funktionsschalter
audit_log(id, user_id, action, entity, entity_id, ip, created_at, details jsonb)  -- append-only
```
`calendar_events` enthält nur eigene Termine. Automatische Termine (Zahlungen, Service, Schlüsselfristen, Wartungen) werden nicht dupliziert, sondern beim Abruf aus Quelltabellen erzeugt (siehe 7).

Indizes: `transactions(budget_id, booked_at)`, `transactions(category_id)`, `recurring_rules(next_run) WHERE active`, `key_assignments(key_id) WHERE returned_at IS NULL`, `audit_log(created_at)`, `calendar_events(owner_id, starts_at)`.

## 5. API (REST, `/api/v1`, OpenAPI unter `/api/docs`)

| Bereich | Endpunkte |
|---|---|
| Auth | `POST /auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/2fa/setup`, `/auth/2fa/verify`, `/auth/password` |
| Konto | `GET/PATCH /me`, `/me/sessions`, `/me/export`, `DELETE /me` |
| Admin | `/admin/users`, `/admin/roles`, `/admin/permissions`, `/admin/groups`, `/admin/teams`, `/admin/settings`, `/admin/api-keys`, `/admin/webhooks`, `/admin/backups`, `/admin/audit`, `/admin/stats` |
| Teams | `/teams`, `/teams/{id}/members`, `/invitations` |
| Finanzen | `/budgets`, `/budgets/{id}/categories`, `/transactions`, `/recurring-rules`, `/goals` |
| Auswertung | `/stats/overview`, `/stats/by-category`, `/stats/timeline`, `/reports`, `/reports/{id}/run` |
| Objekte | `/people`, `/properties`, `/vehicles`, `/keys`, `/keys/{id}/assignments`, `/costs` |
| Kalender | `GET /calendar/events?from=&to=&types=`, `POST/PATCH/DELETE /calendar/events/{id}`, `GET /calendar/feed.ics?token=` |

Regeln: Cursor-Pagination (`?cursor=&limit=`), Filter per Query, einheitliches Fehlerformat `{ code, message, details }`, Idempotency-Key für Buchungen, Beträge als String im JSON.

`GET /calendar/events` liefert eine einheitliche Liste `{ id, source, type, title, date, start?, end?, allDay, amount?, readonly }`. `source` ist `own|recurring|vehicle|key|property|holiday`.

## 6. Sicherheit

- **Passwörter:** Argon2id, Richtlinie aus `settings` (Länge, Komplexität, Historie, Ablauf), Leak-Check per HIBP k-Anonymität (nur 5 Zeichen des SHA-1 verlassen den Server).
- **Tokens:** Access-JWT (15 Min), Refresh-Token als httpOnly-, Secure-, SameSite=Strict-Cookie, serverseitig als Hash in `sessions` mit Rotation. Beenden von Sitzungen setzt `revoked_at`.
- **2FA:** TOTP (RFC 6238), Secret verschlüsselt (AES-GCM, Schlüssel aus Secret), 8 einmalige Wiederherstellungscodes nur als Hash. Pflicht per Admin-Einstellung (alle oder nur Admin-Rollen).
- **Gesperrt nach Fehlversuchen** und Rate-Limit pro IP und pro Account. Admin-Bereich optional per IP-Allowlist.
- **Rechteprüfung:** Guard `@RequirePermission('budget:update')` plus Objektprüfung im Service (Solo-Budget nur Besitzer, Shared nur Teammitglieder gemäß Teamrolle, Datenbereich der Rolle). Effektive Rechte = Vereinigung aus Rollen und Gruppenrollen, im Cache mit Invalidierung bei Änderung.
- **Gravatar:** Der MD5-Hash wird im Browser gebildet, das Backend speichert nur den Schalter. Admin kann Gravatar global abschalten. Hinweis: `d=404` sorgt dafür, dass ohne Gravatar die Initialen bleiben.
- **Eingaben/Ausgaben:** Validierung aller Eingaben am Rand, parametrisierte Queries, Output-Escaping im Frontend (die Mockup-Kalenderkomponente escaped bereits), CSP-Header, kein Inline-Skript im Produktivbuild.
- **Uploads:** Typ- und Größenprüfung (max. 10 MB), Dateiname wird ersetzt, Ablage außerhalb des Web-Roots, Auslieferung nur über die API mit Rechteprüfung.
- **API-Keys:** Anzeige nur einmalig, gespeichert als Hash mit Prefix `bm_live_`, Scopes `read`/`write`. Webhooks werden mit HMAC-Signatur versendet.
- **Audit:** Rechteänderungen, Admin-Aktionen, Schlüsselausgaben und Löschungen in `audit_log`. Die Tabelle ist append-only (Rechte des DB-Users).
- **Geheimnisse:** Docker Secrets bzw. `.env` außerhalb von Git, nicht im Image.

## 7. Fachlogik

### 7.1 Kosten-Tracking für Objekte
Beim Speichern von Haus, Fahrzeug oder Schlüssel in einer Transaktion:
1. Kein `cost_amount` oder `cost_tracking = false`: bestehende `recurring_rule` deaktivieren, keine Buchung.
2. `cost_interval = once`: genau eine `transaction` (`source = asset`, `asset_type`, `asset_id`) anlegen. Bei Änderung die bestehende Buchung aktualisieren statt neu anlegen.
3. Sonst: `recurring_rule` (`source = asset`) anlegen oder aktualisieren; `cost_recurring_id` verweist darauf. Der Scheduler bucht ab dem nächsten Fälligkeitstag.
4. Änderungen am Budget oder an der Kategorie wirken nur auf künftige Buchungen.

### 7.2 Scheduler (Service `worker`, pg-boss)
| Job | Takt | Aufgabe |
|---|---|---|
| `recurring.run` | stündlich | Fällige `recurring_rules` buchen (`next_run <= now()`), `next_run` fortschreiben, alles in einer Transaktion mit `FOR UPDATE SKIP LOCKED` |
| `reminders` | täglich | Erinnerungen aus Kalender, Schlüsselfristen, Service-Terminen und Budgetgrenzen als `notifications` und E-Mail |
| `budget.watch` | nach jeder Buchung | Schwellen 80 % und 100 % prüfen, Benachrichtigung und Webhook `budget.exceeded` |
| `reports.run` | per Cron je Bericht | Berichte rendern und versenden |
| `backup` | täglich 03:00 | `pg_dump`, verschlüsseln, Ziel lokal, S3 oder SFTP, Aufbewahrung bereinigen |
| `retention` | täglich | Audit-Log und inaktive Accounts gemäß DSGVO-Einstellung bereinigen |

Wiederholte Ausführung ist idempotent: Eindeutigkeit über `(recurring_id, booked_at)`.

### 7.3 Kalender
- Der Server liefert für `[from, to]` die Vereinigung aus: eigene Termine (RRULE expandiert), fällige `recurring_rules`, Fahrzeugfristen (`service_due`, `insurance_from`), offene Schlüsselzuweisungen mit `due_at`, Wartungstermine von Häusern und Feiertagen (Bibliothek `date-holidays`, Bundesland einstellbar).
- Berechtigung: Nur Quellen, die der User lesen darf, erscheinen im Kalender. Die Filter der Seitenleiste sind rein clientseitig.
- Mockup-Verhalten, das übernommen wird: Wiederholung wöchentlich/monatlich/jährlich, Ganztags- und Zeitraster (07–20 Uhr), Jetzt-Linie, „+n weitere“ im Monatsraster, Zahlungssaldo des Monats aus den Beträgen der sichtbaren Termine.
- Bekannte Lücke im Mockup: Änderungen gelten für die ganze Serie. Produktiv braucht es „nur dieser Termin / ab diesem Termin“ (`calendar_exceptions`). Monatliche Wiederholung am 29.–31. muss auf den letzten Tag des Monats einrasten.
- Der iCal-Feed ist ein signierter, widerrufbarer Token pro User und liefert nur Termine im Rechtebereich des Users.

### 7.4 Teams und Ausgleich
Rolle bestimmt Rechte im Team (Owner: alles, Editor: Buchungen, Viewer: lesen). Ausgaben-Ausgleich: pro Buchung optionaler Zahler und Anteile, Salden je Mitglied aus der Summe der Anteile minus Zahlungen, Vorschlag minimaler Ausgleichszahlungen. Nur aktiv, wenn die Admin-Richtlinie es erlaubt.

### 7.5 Statistik
Aggregation in SQL (`date_trunc`, `GROUP BY category`), nie im Client. Vormonatsvergleich und Sparquote werden serverseitig berechnet. Optional später Materialized Views oder Monatsaggregate bei großen Datenmengen. Filter Solo/Team/Gesamt entspricht einer Menge von `budget_id`s, die der User sehen darf.

## 8. Frontend

- Route-Struktur: `/dashboard`, `/transactions`, `/budgets`, `/recurring`, `/goals`, `/reports`, `/teams`, `/calendar`, `/assets/{overview|keys|houses|vehicles|people|costs|log}`, `/admin/{overview|users|roles|groups|teams|security|system|integrations|data|audit}`, `/settings/{profile|security|appearance|notify}`.
- Navigation und Seiten werden anhand der Permissions des Users gerendert (`/me` liefert die effektiven Rechte). Das Backend prüft unabhängig davon.
- Theme: `data-theme` (`light|dark`) und `data-accent` auf `<html>` steuern CSS-Variablen. Ein Inline-Skript im `<head>` setzt beide vor dem ersten Rendern (kein Flackern). Modus `system` nutzt `prefers-color-scheme`. Auswahl wird im Profil gespeichert und lokal gecacht, Admin-Standard und Sperre aus `settings`.
- Diagramme lesen ihre Farben aus CSS-Variablen (`--c1..5`), damit sie mit dem Theme wechseln, und zeichnen bei Größenänderung neu.
- Formulare mit gemeinsamer Validierung aus `packages/shared`. Geldbeträge werden als Strings geführt und erst zur Anzeige formatiert (`Intl.NumberFormat`).
- Zugänglichkeit: Fokusreihenfolge in Dialogen, Escape schließt, Tastaturbedienung für Kalender und Tabs, Kontrast in allen zwölf Theme-Varianten prüfen.

### Mockup → App
| Mockup | Umsetzung |
|---|---|
| `views/*.html` | React-Seiten je Route |
| `views/modals.html` | Dialog-Komponenten je Formular |
| `js/charts.js` | Chart-Komponenten (SVG) |
| `js/calendar.js` | Kalender-Komponente, Datenquelle `/calendar/events` |
| `js/data.js` | entfällt, Daten kommen aus `/stats/*` |
| `views/login.html`, `bm-session` | Demo-Login nur im Browser; produktive Anmeldung ausschließlich über Backend-Auth |
| `css/theme.css`, `components.css` | Design-Tokens und Basiskomponenten bleiben fast unverändert |
| `localStorage`-Zustand (Theme, 2FA, Gravatar) | `/me`-Einstellungen |

## 9. Betrieb

- **Health:** `/health` (Liveness) und `/ready` (DB erreichbar, Migrationen aktuell). Healthchecks in Compose.
- **Logging:** JSON-Logs mit Request-ID auf stdout, keine Passwörter oder Tokens in Logs.
- **Metriken:** optional Prometheus-Endpunkt `/metrics` hinter dem Proxy.
- **Backups:** Dump täglich, verschlüsselt, Test-Restore regelmäßig. Die Wiederherstellung im Admin-UI ist ein Admin-Recht mit Bestätigung und Audit-Eintrag.
- **Updates:** Images versionieren, Migrationen vorwärtskompatibel (erst Spalte hinzufügen, dann Code, dann entfernen). Wartungsmodus aus dem Admin.
- **Skalierung:** API zustandslos, mehrere Instanzen möglich; `worker` einmal betreiben, pg-boss verhindert Doppelausführung auch bei mehreren.

## 10. Qualität und Tests

- **Unit:** Rechteauflösung, Budget- und Saldologik, Kosten-Tracking (7.1), RRULE-Expansion inklusive Monatsende und Sommerzeit.
- **Integration:** API gegen echtes PostgreSQL (Testcontainers), CHECK-Constraints, Scheduler-Idempotenz, Schlüsselzuweisung ohne Doppelvergabe.
- **Sicherheit:** Tests, dass Solo-Budgets anderer User nie lesbar sind, dass IDOR über alle ID-Routen scheitert und dass Rate-Limits und 2FA-Pflicht greifen.
- **E2E (Playwright):** Login mit 2FA, Buchung anlegen, Objekt mit Preis anlegen und Buchung prüfen, Kalender-Termin anlegen, Theme-Wechsel.
- **CI:** Lint, Typecheck, Tests, Image-Build, `npm audit`/Trivy; Migrationen werden gegen leere und gefüllte DB geprüft.

## 11. Nicht-funktionale Ziele

| Ziel | Wert |
|---|---|
| Antwortzeit API (p95) | unter 300 ms für Listen und Statistik bei 1 Mio. Buchungen |
| Verfügbarkeit | Single-Host, Neustart-Policy `unless-stopped` |
| Datenverlust | maximal 24 Stunden (RPO), optional WAL-Archivierung für weniger |
| Sprache | Deutsch und Englisch (i18n-Schlüssel), Währung je Budget |
| Browser | aktuelle Versionen von Chrome, Firefox, Safari, Edge |

## 12. Umsetzungsreihenfolge

1. Compose-Gerüst mit `db`, `api` (Health-Endpoint), `web` (leere SPA), CI.
2. Auth, Users, Rollen, Gruppen, Audit, Theme-Einstellungen, Admin-Grundgerüst.
3. Budgets, Kategorien, Transaktionen, Dashboard-Statistik.
4. Teams, Einladungen, geteilte Budgets, Sparziele.
5. Daueraufträge und Worker.
6. Personen, Häuser, Fahrzeuge, Schlüssel, Kosten-Tracking.
7. Kalender mit Quellen, Erinnerungen, iCal.
8. Berichte, Import/Export, Backups, SSO, Härtung.

## 13. Risiken

| Risiko | Gegenmaßnahme |
|---|---|
| Rechtelogik wird inkonsistent | Eine zentrale Policy-Schicht, Tests gegen alle ID-Routen |
| Doppelte Buchungen durch Scheduler | Eindeutigkeit `(recurring_id, booked_at)`, `SKIP LOCKED` |
| Kosten-Tracking driftet von Objektdaten | Systemverwaltete Regel, Änderung nur über den Objekt-Endpunkt |
| Kalenderserien (Zeitzonen, Monatsende) | Bewährte `rrule`-Bibliothek, Zeiten in UTC, Anzeige in der User-Zeitzone |
| Datenschutz (Personen ohne Konto, Gravatar) | Hinweis im UI, Löschfunktion für Personen, Gravatar global abschaltbar |
| Backups nicht wiederherstellbar | Regelmäßiger automatisierter Test-Restore |

## 14. Offene Entscheidungen
- **Stack:** NestJS/Prisma wie vorgeschlagen oder Python/FastAPI mit SQLAlchemy/Alembic. Der Rest des Dokuments gilt für beide, nur Abschnitte 1, 2 und 6 (Bibliotheken) ändern sich.
- **Mandantenfähigkeit:** eine Installation pro Organisation (einfach, so geplant) oder mehrere Organisationen in einer Installation (benötigt `org_id` überall).
- **Selbstregistrierung, Mehrwährung, Ausgaben-Ausgleich, Bankimport:** siehe CONCEPT.md, Abschnitt 11.
