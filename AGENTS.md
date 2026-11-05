# Budget Manager – Anleitung für KI-Assistenten

Diese Datei gilt für jede KI, die an diesem Projekt weiterarbeitet (`CLAUDE.md` verweist nur hierher). Sie ist die maßgebliche Quelle für Anforderungen, Regeln und Testablauf; halte sie bei jeder Änderung aktuell.

## Einstieg in eine neue Sitzung

1. Diese Datei ganz lesen, danach bei Bedarf [CONCEPT.md](CONCEPT.md) und [TECHNICAL.md](TECHNICAL.md).
2. `git status -sb`, `git log --oneline -5` und `git branch -a` prüfen: Es kann unfertige Arbeit oder ein offener Feature-Branch existieren.
3. Prüfen, welchen Stand die laufenden Container haben: `docker exec budget-manager-api-1 ls /app/migrations | tail -1` mit `ls apps/api/migrations | tail -1` vergleichen.
4. Die Punkte unter „Offene Punkte“ am Ende kennen, bevor du dort etwas änderst oder neu erfindest.
5. Vor dem Abschluss einer Änderung: Tests laufen lassen (siehe „Testen“) und Doku mitpflegen. Ergebnisse ehrlich berichten, auch Fehlschläge und Nicht-Getestetes.

Selbst gehostete deutschsprachige Web-App: Finanzen, Zeiterfassung, Sport, Objekte (Fahrzeuge, Häuser, Personen, Schlüssel), Teams, Kalender und Administration. Betrieb per Docker Compose.

Die Anforderungen wurden aus Code, Doku und Git-Historie abgeleitet (Stand 2026-11-05, Migration 013); die frühen Originalgespräche mit dem Auftraggeber lagen nicht vor. Im Zweifel beim Auftraggeber nachfragen und hier ergänzen. Fachliche Details: [CONCEPT.md](CONCEPT.md), Technik: [TECHNICAL.md](TECHNICAL.md), Betrieb: [README.md](README.md).

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
- **Admin-IP-Allowlist:** Wird nur gespeichert, wenn die eigene IP enthalten ist. Ausgesperrt? Direkt in der DB: `DELETE FROM settings WHERE key='security.admin_ip_allowlist'`.
- **Letzter Admin:** Status, Rollen und Ablaufdatum des letzten aktiven Admins sind per `lastAdminGuard` geschützt; neue Felder, die den Zugang entziehen können, dort mit absichern.
- **Kalender rendert beim Filtern neu:** Element-Referenzen in Tests werden dabei ungültig; Elemente jedes Mal neu suchen.

## Testen

Nie gegen die laufende Instanz `budget-manager` testen, dort liegen echte Daten. Einen VS-Code-Browser braucht es nicht: Die Skripte in [tests/e2e/](tests/e2e/) steuern echtes Chromium im Playwright-Container und erzeugen Screenshots. Ablauf und Befehle stehen in [tests/e2e/README.md](tests/e2e/README.md).

| Stufe | Prüft |
|---|---|
| `npm test` in `apps/api` | Unit-Tests ohne Datenbank |
| `api.mjs` | Alle API-Bereiche, Rollen, IDOR, ungültige Eingaben; jede 5xx-Antwort ist ein Fehler |
| `auth.mjs` | Refresh-Rotation, 2FA, Recovery-Codes, Passwort, Reset, Einladung |
| `browser.mjs` | Geführte Abläufe im Browser, Mobilbreite, Konsole |
| `crawl.mjs` | Klickt jede Aktionsart auf jeder Seite als Viewer, Owner, Admin, danach destruktiv |

Zusätzlich vor einem Release von Hand: Migrationen auf einer Wegwerf-Kopie des aktuellen Stands, alle Worker-Jobs mit Daten (`runJob`), Restore bei laufendem Stack und in eine leere DB. Der Test-Stack braucht ein eigenes `APP_VERSION`, sonst wird das produktive Image-Tag überschrieben.

Die Meldungen von `crawl.mjs` sind Hinweise, keine Urteile: Abgelehnte Testeingaben, nicht konfiguriertes OAuth, QR-Scan ohne `BarcodeDetector` in Headless-Chromium, deaktivierte Blätter-Knöpfe und neu gerenderte Kalender-Elemente sind normal. Verdachtsfälle gezielt nachprüfen; nur 5xx, JS-Fehler und Textfehler sind immer echte Fehler.

## Anforderungen

### Allgemein
- Einziger Einstieg ist `api` auf einem Port (UI und API, gleicher Ursprung). Kein mitgelieferter Reverse-Proxy; `db` nur im internen Netz.
- App-Name zentral in den Einstellungen änderbar; wirkt in Seitenleiste, Login, Titel und Rechtsseiten.
- Navigation: **Finanzen** (Dashboard, Transaktionen, Stundenzettel, Konten, Budgets, Daueraufträge, Sparziele, Berichte), **Zusammenarbeit** (Teams, Kalender), **Sport** (Laufen, Schwimmen, Biken), **Object Management** (Fahrzeuge, Häuser, Personen, Schlüssel, Verwaltung), **Administration** (User-Management, Server-Management, Tickets – nur Admins; Hilfe und Fehler melden für alle), dazu Impressum und Datenschutz.
- Alte Links (`#/assets?tab=…`, `#/admin`, QR-Codes) müssen weiter funktionieren.

### Konten und Buchungen
- Konten sind persönlich oder geteilt (Team) und zeigen Kontostand, Einkommen und Ausgaben. **Kein Limit und kein Zeitraum im Kontoformular**; Limits gehören zu den Budgets. Kategorien dürfen weiter eigene Limits haben.
- Buchungstypen: Einnahme, Ausgabe, Einzahlung auf ein Sparziel. Viewer dürfen nicht buchen. CSV-Export, Belege.
- **Kontostand und Dashboard zeigen nur, was wirklich auf dem Konto ist** (Entscheidung des Auftraggebers): Einnahmen minus Ausgaben bis heute. Sparziel-Einzahlungen bleiben auf dem Konto und ändern den Saldo nicht; Buchungen mit Datum in der Zukunft zählen erst ab diesem Datum. KPIs, Cashflow und letzte Buchungen im Dashboard folgen derselben Regel; die Transaktionsliste und Berichte zeigen weiter auch Zukünftiges.

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

- **Dashboard „Konto-Auslastung“** zeigt 0 %, weil neue Konten kein Limit mehr haben; Karte entfernen oder auf Budgets umstellen.
- **`npm audit`:** `zod` (hoch, Fix erst mit Major-Update auf v4), `@fastify/static`/`glob`/`minimatch` (mittel), `date-holidays` (niedrig).
- **Viewer sehen „Bearbeiten“** an Team-Objekten und erhalten erst beim Speichern eine klare Absage; das Ausblenden braucht die Teamrolle in den Listen-Antworten.
- **Ablaufdatum von Benutzern:** „Zugang läuft ab“ mit dem heutigen Datum sperrt sofort, der Tag zählt nicht mit.
- **Validierungsmeldungen** von `zod` sind englisch und nennen Feldschlüssel (z. B. `recipients.0: Invalid email`).
- **Rate-Limit** zählt statische Dateien mit; hinter einem Proxy ohne `TRUST_PROXY` teilen sich alle Nutzer eine IP.
- Nicht enthalten: SSO/OIDC, LDAP, Bankanbindung, MT940, S3/SFTP-Backupziele, E-Mail-Bestätigung bei Registrierung, Restore in der Oberfläche.
