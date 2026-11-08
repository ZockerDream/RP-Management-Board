# RP-Management-Board – Anleitung für KI-Assistenten

Diese Datei gilt für jede KI, die an diesem Projekt weiterarbeitet (`CLAUDE.md` verweist nur hierher). Sie ist die maßgebliche Quelle für Anforderungen, Regeln und Testablauf; halte sie bei jeder Änderung aktuell.

## Einstieg in eine neue Sitzung

1. Diese Datei ganz lesen, danach bei Bedarf [CONCEPT.md](CONCEPT.md) und [TECHNICAL.md](TECHNICAL.md).
2. `git status -sb`, `git log --oneline -5` und `git branch -a` prüfen: Es kann unfertige Arbeit oder ein offener Feature-Branch existieren.
3. Prüfen, welchen Stand die laufenden Container haben: `docker exec budget-manager-api-1 ls /app/migrations | tail -1` mit `ls apps/api/migrations | tail -1` vergleichen.
4. Die Punkte unter „Offene Punkte“ am Ende kennen, bevor du dort etwas änderst oder neu erfindest.
5. Vor dem Abschluss einer Änderung: Tests laufen lassen (siehe „Testen“) und Doku mitpflegen. Ergebnisse ehrlich berichten, auch Fehlschläge und Nicht-Getestetes.

Selbst gehostete deutschsprachige Web-App: Finanzen, Zeiterfassung, Sport, Objekte (Fahrzeuge, Häuser, Personen, Schlüssel), Teams, Kalender und Administration. Betrieb per Docker Compose.

Die Anforderungen wurden aus Code, Doku und Git-Historie abgeleitet (Stand 2026-11-08, Migration 016); die frühen Originalgespräche mit dem Auftraggeber lagen nicht vor. Im Zweifel beim Auftraggeber nachfragen und hier ergänzen. Fachliche Details: [CONCEPT.md](CONCEPT.md), Technik: [TECHNICAL.md](TECHNICAL.md), Betrieb: [README.md](README.md).

## Arbeitsweise

- Mit dem Auftraggeber **auf Deutsch** kommunizieren. UI, Hilfe, Fehlermeldungen und Doku sind deutsch (echte Umlaute, Du-Form).
- Fachbegriffe sauber trennen: **Konto** = Finanzbereich mit Kontostand (Code/DB/API: `budgets`, `budget_id`). **Budget** = Ausgabenlimit pro Zeitraum (`spending_budgets`). Die Namen im Code nicht „korrigieren“.
- Bei Funktionsänderungen immer mitpflegen: [help.js](apps/web/public/js/pages/help.js), `CONCEPT.md`, `TECHNICAL.md`, `README.md`, bei neuen personenbezogenen Daten auch [privacy.js](apps/web/public/js/pages/privacy.js), und diese Datei.
- Commit und Push nur auf Anweisung. Hauptbranch ist `develop` (der lokale Branch `main` trackt `origin/develop`); Änderungen über `feature/*`-Branches und Pull Requests, direkt auf `develop` nur auf ausdrückliche Anweisung. Remote: `git@github.com:ZockerDream/RP-Management-Board.git`.
- `.env` und `.env-impressum` enthalten Secrets bzw. private Daten und werden nie committet. Änderungen nur in `.env.example` / `.env-impressum.example` mit Platzhaltern.

## Stack

Node 22, Fastify 5, reines ESM-JavaScript, `zod`, `pg` mit handgeschriebenem SQL, `pg-boss`, PostgreSQL 16. Frontend ohne Build und ohne Framework: statische Vanilla-JS-Module in `apps/web/public`, die `api` selbst ausliefert. Keine neuen Frameworks, ORMs oder Build-Schritte einführen.

| Pfad | Inhalt |
|---|---|
| `apps/api/src/main.js` | Fastify, Security-Header, Fehler-Handler, Liste der Routen-Module |
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
- **Rate-Limits gibt es nur an Routen, die Passwörter oder Codes prüfen** (Entscheidung des Auftraggebers: kein allgemeines Limit). Neue Routen mit Passwort- oder Code-Prüfung brauchen eines. Login erlaubt 10 Versuche/Minute pro IP; Tests starten zwischen den Stufen die API neu.
- **Der Test-Stack auf 18088 kann in Benutzung sein:** Der Auftraggeber testet dort von Hand. Vor `down -v` oder einem Testlauf prüfen (Audit-Log), sonst auf einem eigenen Stack testen, siehe [tests/e2e/README.md](tests/e2e/README.md).
- **Statische Dateien sind versioniert:** `index.html` kommt immer frisch, JS und CSS laufen unter `/assets/<Inhalts-Hash>/` mit unbegrenztem Cache (`static-assets.js`). Eine feste Adresse wie `/js/app.js` gibt es nicht. In `index.html` relative Pfade (`js/…`, `css/…`) schreiben, der Server schreibt sie beim Start um; neue Asset-Arten dort in `versionIndexHtml` ergänzen. Module immer relativ und ohne Query importieren, sonst entstehen doppelte Instanzen mit getrenntem Zustand.
- **Mit fester Adresse wären neue Navigation und alter Code gemischt:** Genau das passierte beim Update von Migration 009 auf 013: Alle neuen Seiten leiteten aufs Dashboard um, das Impressum zeigte die alte Seite. Frische Testläufe sehen so etwas nie, deshalb gehört `upgrade.mjs` vor jedes Release.
- **`.env-impressum` ist nicht in Git:** Sie muss auf jedem Server einzeln existieren und gefüllt sein. Das Update überträgt sie nicht; `update.sh` warnt, wenn das Impressum leer ist.
- **Laufende Instanz:** Vor Tests prüfen, welchen Code die Container wirklich enthalten; das Image wird nicht automatisch neu gebaut.
- **Der alte Name `budget-manager` bleibt absichtlich an einigen Stellen:** App und GitHub-Repo heißen `RP-Management-Board` (seit Migration 016). Compose-Projekt (`name:` in `docker-compose.yml`), Container und Image `budget-manager-api` behalten den alten Namen: Der Projektname bestimmt die Volumes (`budget-manager_db_data` usw.), ihn zu ändern hieße, mit leerer Datenbank zu starten. Weil er fest gesetzt ist, darf das Verzeichnis beliebig heißen. Ebenso bleiben die iCal-UIDs (`…@budget-manager`, sonst erscheinen abonnierte Termine doppelt) und die Kennung `BMB1` verschlüsselter Backups (sonst lassen sich alte Backups nicht mehr entschlüsseln).
- **Admin-IP-Allowlist:** Wird nur gespeichert, wenn die eigene IP enthalten ist. Ausgesperrt? Direkt in der DB: `DELETE FROM settings WHERE key='security.admin_ip_allowlist'`.
- **Teil-Updates nur mit `patchSchema()`** (`validation.js`), nie mit `.partial()`: Zod 4 setzt dort Standardwerte, ein PATCH würde fehlende Felder still überschreiben. Schemas mit `.refine()` auf Objektebene haben kein `.shape` und lassen sich nicht ableiten; die Grundform getrennt halten (`keyFields` in `objects.js`).
- **Validierungsmeldungen:** Der Fehler-Handler übersetzt Zod-Fehler in `validation.js`. Neue API-Felder dort in `LABELS` eintragen, sonst heißt es nur „Eingabe ist ungültig“.
- **Benachrichtigungen:** Alles läuft über `notify()`. Die Zeile entsteht immer und verhindert doppelte Mails; ist „In der App“ aus, blendet `/notifications` die Art aus. E-Mail nur nach ausdrücklicher Wahl. Neue Arten in `KINDS` (`settings.js`) eintragen.
- **Neue Konten** erhalten ohne Angabe die Profilwährung; ein festes `EUR` hätte Benutzer mit anderer Währung vom Gehaltskonto ausgeschlossen. Gehaltskonten müssen eigene persönliche Konten in Profilwährung sein (`PATCH /me`, `payrollRun`), die Währung eines Gehaltskontos lässt sich nicht abweichend ändern.
- **Gehaltslauf:** Die Regeln stehen allein in `planPayroll` (`payroll.js`, ohne Datenbank testbar). `users.hourly_rate` ist seit Migration 015 ungenutzt. Automatische Gehaltsbuchungen lassen sich nicht ändern oder löschen, Fehler im Lauf sind also teuer.
- **`deepmerge` ist per `overrides` festgesetzt** (`apps/api/package.json`), weil die Versionen ab 4.2 eine Schwachstelle haben. `date-holidays` läuft damit nachweislich gleich (473 Feiertage, gleicher Hash); bei einem Update von `date-holidays` prüfen, ob es noch nötig ist.
- **TRUST_PROXY:** Hinter einem Proxy ohne diese Einstellung teilen sich alle Benutzer dessen IP, auch beim Login-Limit und im Audit-Log. Die App warnt dann im Log und unter *Server-Management → Sicherheit & Einstellungen*.
- **Letzter Admin:** Status, Rollen und Ablaufdatum des letzten aktiven Admins sind per `lastAdminGuard` geschützt; neue Felder, die den Zugang entziehen können, dort mit absichern.
- **Kalender rendert beim Filtern neu:** Element-Referenzen in Tests werden dabei ungültig; Elemente jedes Mal neu suchen.

## Testen

Nie gegen die laufende Instanz `budget-manager` testen, dort liegen echte Daten. Einen VS-Code-Browser braucht es nicht: Die Skripte in [tests/e2e/](tests/e2e/) steuern echtes Chromium im Playwright-Container und erzeugen Screenshots. Ablauf und Befehle stehen in [tests/e2e/README.md](tests/e2e/README.md).

| Stufe | Prüft |
|---|---|
| `npm test` in `apps/api` | Unit-Tests ohne Datenbank |
| `api.mjs` | Alle API-Bereiche, Rollen, IDOR, ungültige Eingaben, ToDo-Job im Worker-Container; jede 5xx-Antwort ist ein Fehler |
| `auth.mjs` | Refresh-Rotation, 2FA, Recovery-Codes, Passwort, Reset, Einladung |
| `browser.mjs` | Geführte Abläufe im Browser, Mobilbreite, Konsole |
| `crawl.mjs` | Klickt jede Aktionsart auf jeder Seite als Viewer, Owner, Admin, danach destruktiv |
| `upgrade.mjs` | Update von einem alten Stand im selben Browserprofil, ohne Cache-Löschen |

Zusätzlich vor einem Release: `upgrade.mjs` ab dem zuletzt ausgerollten Stand, Migrationen auf einer Wegwerf-Kopie des aktuellen Stands, alle Worker-Jobs mit Daten (`runJob`), Restore bei laufendem Stack und in eine leere DB. Der Test-Stack braucht ein eigenes `APP_VERSION`, sonst wird das produktive Image-Tag überschrieben.

Die Meldungen von `crawl.mjs` sind Hinweise, keine Urteile: Abgelehnte Testeingaben, nicht konfiguriertes OAuth, QR-Scan ohne `BarcodeDetector` in Headless-Chromium, deaktivierte Blätter-Knöpfe und neu gerenderte Kalender-Elemente sind normal. Verdachtsfälle gezielt nachprüfen; nur 5xx, JS-Fehler und Textfehler sind immer echte Fehler.

## Anforderungen

### Allgemein
- Einziger Einstieg ist `api` auf einem Port (UI und API, gleicher Ursprung). Kein mitgelieferter Reverse-Proxy; `db` nur im internen Netz.
- App-Name zentral in den Einstellungen änderbar; wirkt in Seitenleiste, Login, Titel und Rechtsseiten.
- Navigation: **Finanzen** (Dashboard, Transaktionen, Stundenzettel, Konten, Budgets, Daueraufträge, Sparziele, Berichte), **Zusammenarbeit** (Teams, Kalender, Notizblock, ToDos), **Sport** (Laufen, Schwimmen, Biken), **Object Management** (Fahrzeuge, Häuser, Personen, Schlüssel, Verwaltung), **Administration** (User-Management, Server-Management, Tickets – nur Admins; Hilfe und Fehler melden für alle), dazu Impressum und Datenschutz.
- Alte Links (`#/assets?tab=…`, `#/admin`, QR-Codes) müssen weiter funktionieren.

### Konten und Buchungen
- Konten sind persönlich oder geteilt (Team) und zeigen Kontostand, Einkommen und Ausgaben. **Kein Limit und kein Zeitraum im Kontoformular**; Limits gehören zu den Budgets. Kategorien dürfen weiter eigene Limits haben.
- Buchungstypen: Einnahme, Ausgabe, Einzahlung auf ein Sparziel. Viewer dürfen nicht buchen. CSV-Export, Belege.
- **Kontostand und Dashboard zeigen nur, was wirklich auf dem Konto ist** (Entscheidung des Auftraggebers): Einnahmen minus Ausgaben bis heute. Sparziel-Einzahlungen bleiben auf dem Konto und ändern den Saldo nicht; Buchungen mit Datum in der Zukunft zählen erst ab diesem Datum. KPIs, Cashflow und letzte Buchungen im Dashboard folgen derselben Regel; die Transaktionsliste und Berichte zeigen weiter auch Zukünftiges.
- Das Dashboard wechselt zwischen **Tag, Woche und Monat**. KPIs und Kategorien folgen dem gewählten Zeitraum, der Cashflow zeigt 14 Tage, 8 Wochen oder 6 Monate, der Gesamtsaldo bleibt der heutige Stand. Die Woche beginnt mit dem Wochenstart aus dem Profil.

### Budgets
- Ausgabenlimit mit Name, Betrag, Zeitraum (Tag, Woche, Monat, Jahr), optional auf Konto und/oder Kategorie begrenzt. Zeigt Verbrauch, Rest und Überschreitung. Privat pro Benutzer; Team-Ausgaben zählen nur für zugängliche Konten.

### Daueraufträge und Sparziele
- Intervalle täglich, wöchentlich, monatlich, jährlich, benutzerdefiniert in Tagen, jeweils mit Abstand. Monats-/Jahresserien rasten auf den letzten gültigen Tag ein.
- Teilen mit Teammitglied nach dessen Zustimmung: voller Betrag auch in dessen persönlichem Konto, gleiche Währung nötig.
- Objektkosten aktualisieren den verknüpften Auftrag, keine Duplikate. Sparziele mit Rate und Rhythmus.

### Stundenzettel und Gehalt
- Timer (Ein-/Ausstempeln, Pause) und manuelle Einträge, mit oder ohne Projekt; Pausen zählen nicht. Projekte privat oder im Team. Löschen von Teamprojekten nur durch Team-Owner.
- KPI „Wochen-Soll“. Monats-Soll = Wochen-Soll × Kalendertage / 7. PDF und CSV.
- Das Gehaltskonto ist auf dem Stundenzettel („Gehalt einstellen“) und im Profil wählbar. Nicht wählbare Konten stehen mit Begründung in der Liste; fehlt ein passendes Konto, sagt ein Hinweis, was zu tun ist.
- **Gehaltsregel des Auftraggebers** (Beispiel: 1.669 Festgehalt pro Tag, 13 Stunden Wochen-Soll, 17 % Bonus): Das Festgehalt wird jeden Tag um 03:45 für den Vortag gebucht, inklusive Wochenende und unabhängig von den Stunden, auf ein eigenes persönliches Konto. Nur Stunden über dem Wochen-Soll (Mo–So) bringen zusätzlich je Stunde den Bonus, einen Prozentsatz des Festgehalts (17 % von 1.669 = 283,73). Woche 1, Soll nicht erreicht: täglich nur Festgehalt. Woche 2, Soll am Dienstag erreicht: ab dann jede weitere Stunde mit Bonus. Woche 3, Soll am Samstag erreicht: nur der Rest von Samstag und Sonntag. Montags beginnt die Zählung neu.
- Nachgetragene Stunden derselben Woche kommen mit der nächsten Gutschrift dazu; abgeschlossene Wochen werden nicht nachberechnet, sonst würde ein geändertes Wochen-Soll alte Wochen neu bewerten. Stunden über dem Wochen-Soll (Mo–So) zusätzlich mit Stundenlohn plus Zuschlag. Idempotent, Ausfälle werden nachgeholt.
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

### Notizblock und ToDos
- Beide solo oder pro Team. Team-Owner und -Editoren ändern, Viewer lesen nur und sehen keine Aktionen; Fremde sehen nichts.
- ToDos mit optionaler Deadline. Offene ToDos mit Deadline erinnern in der Glocke einen Tag vorher, am Fälligkeitstag und einmal bei Überfälligkeit, Team-ToDos alle Mitglieder. In den Einstellungen abschaltbar, E-Mail nur nach ausdrücklicher Wahl.

### Administration
- User-Management: Benutzer, Rollen & Rechte, Gruppen, Teams. Server-Management: Übersicht, Sicherheit & Einstellungen, System & Backups, Integrationen, Audit-Log. Tickets: gemeldete Fehler (optional Abgleich mit GitHub Issues).
- Tickets lassen sich kommentieren und löschen: Admins alle, Melder ihre eigenen. Kommentare benachrichtigen die jeweils andere Seite. Eigene Kommentare darf jeder löschen, Admins alle. Kommentare bleiben intern; ein GitHub-Issue bleibt beim Löschen bestehen.
- Rechte als `ressource:aktion`, Systemrollen `Admin` und `User`, eigene Rollen frei. Jede Route prüft serverseitig, Frontend blendet nur aus.

### Sicherheit und Datenschutz
- Argon2, Login-Sperre, Rate-Limits nur bei Passwort- und Code-Prüfungen, TOTP-2FA mit 8 Recovery-Codes, Refresh-Rotation im httpOnly-Cookie, Access-Token nur im Speicher, strikte CSP, verschlüsselte Backups, Audit-Log.
- **Gravatar nur mit Einwilligung**: Standard aus, Migration 013 hat alles zurückgesetzt. Keine Tracker oder Cookies über das technisch Nötige hinaus.
- Impressum aus eigener Datei `.env-impressum` (nur nicht-leere Felder anzeigen), Datenschutzseite öffentlich erreichbar.

## Offene Punkte

- **Stunden für abgeschlossene Wochen** bringen keinen Bonus mehr. Das betrifft auch eine Nachtschicht von Sonntag auf Montag, die erst nach 03:45 ausgestempelt wird, weil der Eintrag am Starttag hängt.
- **Beträge** erscheinen überall in der Profilwährung, auch bei Konten in anderer Währung; umgerechnet wird nichts.
- Nicht enthalten: SSO/OIDC, LDAP, Bankanbindung, MT940, S3/SFTP-Backupziele, E-Mail-Bestätigung bei Registrierung, Restore in der Oberfläche.
