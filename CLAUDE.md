# Budget Manager – Projektwissen für Claude

Selbst gehostete deutschsprachige Web-App: Finanzen, Zeiterfassung, Sport, Objekte (Fahrzeuge, Häuser, Personen, Schlüssel), Teams, Kalender und Administration. Betrieb per Docker Compose.

Diese Datei wurde aus Code, Doku und Git-Historie abgeleitet (Stand 2026-11-05, Migration 013); die Originalgespräche mit dem Auftraggeber lagen nicht vor. Fachliche Details: [CONCEPT.md](CONCEPT.md), Technik: [TECHNICAL.md](TECHNICAL.md), Betrieb: [README.md](README.md).

## Arbeitsweise

- Mit dem Auftraggeber **auf Deutsch** kommunizieren. UI, Hilfe, Fehlermeldungen und Doku sind deutsch (echte Umlaute, Du-Form).
- Fachbegriffe sauber trennen: **Konto** = Finanzbereich mit Kontostand (Code/DB/API: `budgets`, `budget_id`). **Budget** = Ausgabenlimit pro Zeitraum (`spending_budgets`). Die Namen im Code nicht „korrigieren“.
- Bei Funktionsänderungen immer mitpflegen: [help.js](apps/web/public/js/pages/help.js), `CONCEPT.md`, `TECHNICAL.md`, `README.md`, bei neuen personenbezogenen Daten auch [privacy.js](apps/web/public/js/pages/privacy.js), und diese Datei.
- Commit und Push nur auf Anweisung. Hauptbranch ist `develop` (der lokale Branch `main` trackt `origin/develop`); Änderungen über `feature/*`-Branches und Pull Requests. Remote: `git@github.com:ZockerDream/budget-manager.git`.
- `.env` und `.env-impressum` enthalten Secrets bzw. private Daten und werden nie committet. Änderungen nur in `.env.example` / `.env-impressum.example` mit Platzhaltern.

## Stack

Node 22, Fastify 5, reines ESM-JavaScript, `zod`, `pg` mit handgeschriebenem SQL, `pg-boss`, PostgreSQL 16. Frontend ohne Build und ohne Framework: statische Vanilla-JS-Module in `apps/web/public`, die `api` selbst ausliefert. Keine neuen Frameworks, ORMs oder Build-Schritte einführen.

| Pfad | Inhalt |
|---|---|
| `apps/api/src/main.js` | Fastify, Security-Header, Rate-Limit, Fehler-Handler, Liste der Routen-Module |
| `apps/api/src/routes/*.js` | REST-Routen unter `/api` |
| `apps/api/src/authz.js` | Rechte-Katalog, `authz()`, `requireAuth`, `budgetAccess`, `accessibleBudgetIds` |
| `apps/api/src/jobs.js`, `worker.js` | Hintergrundjobs und Zeitpläne |
| `apps/api/migrations/NNN_*.sql` | Vorwärts-Migrationen, laufen beim API-Start |
| `apps/web/public/js/app.js` | Hash-Router (`PAGES`), Login, Navigation |
| `apps/web/public/js/pages/*.js` | Seiten; jede exportiert `render(view, params, …)` |

## Fallstricke (alle schon einmal aufgetreten)

- **`ownerSql(alias)` nutzt standardmäßig `$1`.** Steht die Benutzer-ID an anderer Stelle, den Parameter angeben: `ownerSql('p', '$2')`.
- **Jeder übergebene SQL-Parameter muss im Text vorkommen**, sonst scheitert die Abfrage mit „could not determine data type“. Betrifft vor allem Jobs, die nur zur Laufzeit auffallen.
- **Strikte CSP:** kein Inline-JavaScript und keine `on*`-Attribute. Inline-`style` ist erlaubt.
- **`.chip` ist doppelt belegt:** `calendar.css` definiert es global als Block; Chip-Listen brauchen den Container `.chips`.
- **Restore:** `src/cli/backup.js` filtert `pgboss` aus der Inhaltsliste des Dumps. `--exclude-schema` reicht nicht: Es würde das Schema trotzdem droppen; die partitionierten Tabellen scheitern ohnehin an `--clean`.
- **Datumsangaben** kommen als Strings aus der DB (Typ-Parser in `db.js`); Geldbeträge sind Strings aus `numeric`, nie als Float rechnen.
- **Globales Rate-Limit:** 300 Anfragen/Minute pro IP, auch für statische Dateien. Automatisierte Tests müssen drosseln oder zwischendurch die API neu starten.
- **Laufende Instanz:** Vor Tests prüfen, welchen Code die Container wirklich enthalten; das Image wird nicht automatisch neu gebaut.

## Testen

Nie gegen die laufende Instanz `budget-manager` testen, dort liegen echte Daten. Stattdessen ein Wegwerf-Projekt mit eigener Env-Datei (eigene Secrets, `APP_URL=http://localhost:18088`, `HTTP_PORT=18088`, `BIND_ADDR=127.0.0.1`, **`APP_VERSION=e2e`**, damit das produktive Image-Tag unberührt bleibt, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `DB_PASSWORD`, `JWT_SECRET`, `ENCRYPTION_KEY`):

```bash
docker compose -p bm-e2e --env-file <test.env> up -d --build --wait
docker compose -p bm-e2e --env-file <test.env> down -v    # danach wieder entfernen
cd apps/api && npm test                                    # Unit-Tests (ohne DB)
```

Vor einem Release prüfen: Migrationen auf leerer DB und auf einer Kopie des aktuellen Stands, alle Rollen (Admin, Owner, Editor, Viewer, Fremder) inklusive IDOR, alle Worker-Jobs, 2FA, Restore, alle Seiten im Browser (Konsole frei, Mobilbreite 390 px). Browser-Tests laufen in `mcr.microsoft.com/playwright`; `waitForFunction` scheitert an der CSP, also per `page.evaluate` pollen. Es gibt noch keine Integrationstests im Repo.

## Anforderungen

### Allgemein
- Einziger Einstieg ist `api` auf einem Port (UI und API, gleicher Ursprung). Kein mitgelieferter Reverse-Proxy; `db` nur im internen Netz.
- App-Name zentral in den Einstellungen änderbar; wirkt in Seitenleiste, Login, Titel und Rechtsseiten.
- Navigation: **Finanzen** (Dashboard, Transaktionen, Stundenzettel, Konten, Budgets, Daueraufträge, Sparziele, Berichte), **Zusammenarbeit** (Teams, Kalender), **Sport** (Laufen, Schwimmen, Biken), **Object Management** (Fahrzeuge, Häuser, Personen, Schlüssel, Verwaltung), **Administration** (User-Management, Server-Management, Tickets – nur Admins; Hilfe und Fehler melden für alle), dazu Impressum und Datenschutz.
- Alte Links (`#/assets?tab=…`, `#/admin`, QR-Codes) müssen weiter funktionieren.

### Konten und Buchungen
- Konten sind persönlich oder geteilt (Team) und zeigen Kontostand, Einkommen und Ausgaben. **Kein Limit und kein Zeitraum im Kontoformular**; Limits gehören zu den Budgets. Kategorien dürfen weiter eigene Limits haben.
- Buchungstypen: Einnahme, Ausgabe, Einzahlung auf ein Sparziel. Viewer dürfen nicht buchen. CSV-Export, Belege.

### Budgets
- Ausgabenlimit mit Name, Betrag, Zeitraum (Tag, Woche, Monat, Jahr), optional auf Konto und/oder Kategorie begrenzt. Zeigt Verbrauch, Rest und Überschreitung. Privat pro Benutzer; Team-Ausgaben zählen nur für zugängliche Konten.

### Daueraufträge und Sparziele
- Intervalle täglich, wöchentlich, monatlich, jährlich, benutzerdefiniert in Tagen, jeweils mit Abstand. Monats-/Jahresserien rasten auf den letzten gültigen Tag ein.
- Teilen mit Teammitglied nach dessen Zustimmung: voller Betrag auch in dessen persönlichem Konto, gleiche Währung nötig.
- Objektkosten aktualisieren den verknüpften Auftrag, keine Duplikate. Sparziele mit Rate und Rhythmus.

### Stundenzettel und Gehalt
- Timer (Ein-/Ausstempeln, Pause) und manuelle Einträge, mit oder ohne Projekt; Pausen zählen nicht. Projekte privat oder im Team. Löschen von Teamprojekten nur durch Team-Owner.
- KPI „Wochen-Soll“. Monats-Soll = Wochen-Soll × Kalendertage / 7. PDF und CSV.
- Basisgehalt täglich um 03:45 inklusive Wochenende: Wochen-Soll × Stundenlohn, centgenau auf 7 Tage verteilt, unabhängig von Anwesenheit, auf ein eigenes persönliches Konto. Stunden über dem Wochen-Soll (Mo–So) zusätzlich mit Stundenlohn plus Zuschlag. Idempotent, Ausfälle werden nachgeholt.
- Team-Owner und -Editoren sehen und bearbeiten Zeiten und Mitarbeitereinstellungen ihres Teams.

### Sport
- Getrennte Seiten für Laufen, Schwimmen, Biken. Strecken gehören einem Team, mit Checkpoints, Distanz, Notizen. Bestenliste nach Punkten absteigend, dann Zeit.
- Owner/Editor verwalten Strecken. Jedes Mitglied, auch Viewer, trägt eigene Ergebnisse ein und löscht sie; Owner/Editor dürfen auch fremde löschen. Fremde sehen nichts.

### Objekte
- Objekte sind privat oder pro Datensatz im Team freigegeben. Fahrzeuge (Service nach Datum/km, Verbandskasten), Häuser (Wartung), Personen (auch ohne Login), Schlüssel (freie Art, Kopien, Ausgabe, Rückgabe, verloren, QR-Code, Inventur).
- Tür-PINs verschlüsselt, nie in Listen, nur nach Passwort und ggf. 2FA sichtbar, jeder Zugriff im Audit-Log.
- „Verwaltung“ bündelt Übersicht, Kosten, Protokoll und Auditlog (nur mit `audit:read`). Keine Versicherungsangabe an Fahrzeugen.

### Kalender und Benachrichtigungen
- Monat, Woche, Tag, Agenda; eigene Termine plus abgeleitete (Zahlungen, Service, Schlüsselfristen, Wartung, Feiertage); iCal-Abo. Glocke mit Zähler. Täglicher Job erinnert an Termine, Service, Verbandskasten und Schlüsselrückgaben.

### Administration
- User-Management: Benutzer, Rollen & Rechte, Gruppen, Teams. Server-Management: Übersicht, Sicherheit & Einstellungen, System & Backups, Integrationen, Audit-Log. Tickets: gemeldete Fehler (optional Abgleich mit GitHub Issues).
- Rechte als `ressource:aktion`, Systemrollen `Admin` und `User`, eigene Rollen frei. Jede Route prüft serverseitig, Frontend blendet nur aus.

### Sicherheit und Datenschutz
- Argon2, Login-Sperre, Rate-Limits, TOTP-2FA mit 8 Recovery-Codes, Refresh-Rotation im httpOnly-Cookie, Access-Token nur im Speicher, strikte CSP, verschlüsselte Backups, Audit-Log.
- **Gravatar nur mit Einwilligung**: Standard aus, Migration 013 hat alles zurückgesetzt. Keine Tracker oder Cookies über das technisch Nötige hinaus.
- Impressum aus eigener Datei `.env-impressum` (nur nicht-leere Felder anzeigen), Datenschutzseite öffentlich erreichbar.

## Offene Punkte

- **Salden uneinheitlich:** Dashboard-Gesamtsaldo zählt Sparziel-Einzahlungen als Plus, der Kontostand ignoriert sie. Fachliche Entscheidung des Auftraggebers steht aus.
- **Dashboard „Konto-Auslastung“** zeigt 0 %, weil neue Konten kein Limit mehr haben; Karte entfernen oder auf Budgets umstellen.
- **`npm audit`:** `zod` (hoch, Fix erst mit Major-Update auf v4), `@fastify/static`/`glob`/`minimatch` (mittel), `date-holidays` (niedrig).
- **Rate-Limit** zählt statische Dateien mit; hinter einem Proxy ohne `TRUST_PROXY` teilen sich alle Nutzer eine IP.
- Nicht enthalten: SSO/OIDC, LDAP, Bankanbindung, MT940, S3/SFTP-Backupziele, E-Mail-Bestätigung bei Registrierung, Restore in der Oberfläche.
