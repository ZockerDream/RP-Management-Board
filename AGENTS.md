# RP-Management-Board – Anleitung für KI-Assistenten

Diese Datei gilt für jede KI, die an diesem Projekt weiterarbeitet (`CLAUDE.md` verweist nur hierher). Sie ist die maßgebliche Quelle für Anforderungen, Regeln und Testablauf; halte sie bei jeder Änderung aktuell.

## Einstieg in eine neue Sitzung

1. Diese Datei ganz lesen, danach bei Bedarf [CONCEPT.md](CONCEPT.md) und [TECHNICAL.md](TECHNICAL.md).
2. `git status -sb`, `git log --oneline -5` und `git branch -a` prüfen: Es kann unfertige Arbeit oder ein offener Feature-Branch existieren.
3. Prüfen, welchen Stand die laufenden Container haben: `docker exec budget-manager-api-1 ls /app/migrations | tail -1` mit `ls apps/api/migrations | tail -1` vergleichen.
4. Die Punkte unter „Offene Punkte“ am Ende kennen, bevor du dort etwas änderst oder neu erfindest.
5. Vor dem Abschluss einer Änderung: Tests laufen lassen (siehe „Testen“) und Doku mitpflegen. Ergebnisse ehrlich berichten, auch Fehlschläge und Nicht-Getestetes.

Selbst gehostete deutschsprachige Web-App: Finanzen, Zeiterfassung, Sport, Objekte (Fahrzeuge, Häuser, Personen, Schlüssel), Akten, Schulungen, Lizenzen, Dokumentationen, Organisationen mit Rängen, Gruppen und Rechten, Kalender und Administration. Betrieb per Docker Compose.

Die Anforderungen wurden aus Code, Doku und Git-Historie abgeleitet (Stand 2026-11-08, Migration 016); die frühen Originalgespräche mit dem Auftraggeber lagen nicht vor. Akten, Schulungen, Lizenzen, Dokumentationen und die Nachtschicht-Regel (Migration 017) hat der Auftraggeber am 2026-11-08 direkt entschieden, Organisationen mit Rängen, Gruppen und Rechten (Migration 018), globale Personen (Migration 019), das Aktensystem (Migration 020) und den Test im Tool für Schulungen (Migration 021) am 2026-11-09, Zinsen für Konten, Bilder zu Fahrzeugen und Akten, Fahrzeugbesitzer als Person, freie Kennzeichen ausgemusterter Fahrzeuge (Migration 022) sowie die Wünsche zu Stundenzettel, Kontoreihenfolge und ToDo-Terminen am 2026-11-10 (Zinsmodell am selben Tag bestätigt), den Changelog unter Administration ebenfalls am 2026-11-10. Im Zweifel beim Auftraggeber nachfragen und hier ergänzen. Fachliche Details: [CONCEPT.md](CONCEPT.md), Technik: [TECHNICAL.md](TECHNICAL.md), Betrieb: [README.md](README.md).

## Arbeitsweise

- Mit dem Auftraggeber **auf Deutsch** kommunizieren. UI, Hilfe, Fehlermeldungen und Doku sind deutsch (echte Umlaute, Du-Form).
- Fachbegriffe sauber trennen: **Konto** = Finanzbereich mit Kontostand (Code/DB/API: `budgets`, `budget_id`). **Budget** = Ausgabenlimit pro Zeitraum (`spending_budgets`). **Organisation** = früher Team (Code/DB/API: `teams`, `team_id`, `/teams`, Route `#/teams`). **Gruppen** einer Organisation (`team_groups`) sind nicht die appweiten Gruppen der Administration (`groups`). Die Namen im Code nicht „korrigieren“.
- Bei Funktionsänderungen immer mitpflegen: einen Eintrag in `UNRELEASED` in [changelog.js](apps/web/public/js/changelog.js), [help.js](apps/web/public/js/pages/help.js), `CONCEPT.md`, `TECHNICAL.md`, `README.md`, bei neuen personenbezogenen Daten auch [privacy.js](apps/web/public/js/pages/privacy.js), und diese Datei.
- Commit und Push nur auf Anweisung. Hauptbranch ist `develop` (der lokale Branch `main` trackt `origin/develop`); Änderungen über `feature/*`-Branches und Pull Requests, direkt auf `develop` nur auf ausdrückliche Anweisung. Remote: `git@github.com:ZockerDream/RP-Management-Board.git`.
- **Release:** Version in `apps/api/package.json` (samt `package-lock.json`), im Image-Tag beider Dienste in `docker-compose.yml` (`${IMAGE_TAG:-x.y.z}`, geprüft von `test/release.test.js`) und in der Liste „Versionen“ im README hochzählen, im Changelog (`apps/web/public/js/changelog.js`) die Einträge aus `UNRELEASED` als neue Version oben in `CHANGELOG` übernehmen (`test/changelog.test.js` prüft, dass die oberste Version der `package.json` entspricht), die Checkliste unter „Testen“ abarbeiten, auf `develop` mergen und einen annotierten Tag `vX.Y.Z` pushen (wie `v1.0.0`, `v1.1.0`). `gh` ist auf dem Host nicht installiert; eine Release-Seite auf GitHub legt der Auftraggeber an. Ausrollen ist ein eigener Schritt und nur auf Anweisung; der Auftraggeber macht es mit `git pull` und `docker compose up -d` (optional `--build --force-recreate`), ohne die `.env` anzufassen. Das muss so bleiben: `api` hat `pull_policy: build`, `worker` `pull_policy: never`, Migrationen laufen beim API-Start.
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
- **Markdown:** neue Textfelder mit Formatierung bekommen in `openForm` `markdown: true` (sonst `textarea[data-md]` und `markdownEditors`), angezeigt wird mit `markdownBlock`. `markdown.js` nicht an `ui.js` hängen: Er muss ohne DOM laufen (`apps/api/test/markdown.test.js`). Keine `href="#…"` erzeugen außer `#/…`, der Hash-Router würde die Seite wechseln.
- **`.chip` ist doppelt belegt:** `calendar.css` definiert es global als Block; Chip-Listen brauchen den Container `.chips`.
- **Restore:** `src/cli/backup.js` filtert `pgboss` aus der Inhaltsliste des Dumps. `--exclude-schema` reicht nicht: Es würde das Schema trotzdem droppen; die partitionierten Tabellen scheitern ohnehin an `--clean`.
- **Datumsangaben** kommen als Strings aus der DB (Typ-Parser in `db.js`); Geldbeträge sind Strings aus `numeric`, nie als Float rechnen.
- **Rate-Limits gibt es nur an Routen, die Passwörter oder Codes prüfen** (Entscheidung des Auftraggebers: kein allgemeines Limit). Neue Routen mit Passwort- oder Code-Prüfung brauchen eines. Login erlaubt 10 Versuche/Minute pro IP; Tests starten zwischen den Stufen die API neu.
- **Der Test-Stack auf 18088 kann in Benutzung sein:** Der Auftraggeber testet dort von Hand. Vor `down -v` oder einem Testlauf prüfen (Audit-Log), sonst auf einem eigenen Stack testen, siehe [tests/e2e/README.md](tests/e2e/README.md).
- **Statische Dateien sind versioniert:** `index.html` kommt immer frisch, JS und CSS laufen unter `/assets/<Inhalts-Hash>/` mit unbegrenztem Cache (`static-assets.js`). Eine feste Adresse wie `/js/app.js` gibt es nicht. In `index.html` relative Pfade (`js/…`, `css/…`) schreiben, der Server schreibt sie beim Start um; neue Asset-Arten dort in `versionIndexHtml` ergänzen. Module immer relativ und ohne Query importieren, sonst entstehen doppelte Instanzen mit getrenntem Zustand.
- **Mit fester Adresse wären neue Navigation und alter Code gemischt:** Genau das passierte beim Update von Migration 009 auf 013: Alle neuen Seiten leiteten aufs Dashboard um, das Impressum zeigte die alte Seite. Frische Testläufe sehen so etwas nie, deshalb gehört `upgrade.mjs` vor jedes Release.
- **`.env-impressum` ist nicht in Git:** Sie muss auf jedem Server einzeln existieren und gefüllt sein. Das Update überträgt sie nicht; `update.sh` warnt, wenn das Impressum leer ist.
- **Laufende Instanz:** Vor Tests prüfen, welchen Code die Container wirklich enthalten; gebaut wird erst beim nächsten `docker compose up`. Das Image-Tag sagt darüber nichts: Am 2026-11-09 lief unter `budget-manager-api:1.0.0` noch `d632233` (Migration 009); bis 1.1.0 kam der Tag aus `APP_VERSION` in der `.env`, ohne `--build` lief nach einem `git pull` deshalb weiter der alte Code. Seit 1.1.1 heißt das Image nach der Code-Version und wird bei jedem `up` gebaut. Den Stand findet man über die letzte Migration im Container und den Vergleich einzelner Dateien (`md5sum`) mit der Git-Historie; die Verwaltung zeigt seit 1.1.0 die Version aus `package.json`.
- **Der alte Name `budget-manager` bleibt absichtlich an einigen Stellen:** App und GitHub-Repo heißen `RP-Management-Board` (seit Migration 016). Compose-Projekt (`name:` in `docker-compose.yml`), Container und Image `budget-manager-api` behalten den alten Namen: Der Projektname bestimmt die Volumes (`budget-manager_db_data` usw.), ihn zu ändern hieße, mit leerer Datenbank zu starten. Weil er fest gesetzt ist, darf das Verzeichnis beliebig heißen. Die Kehrseite: Jede Installation auf demselben Host nutzt dieselben Volumes, auch eine „neue“ in einem anderen Verzeichnis, und `down -v` dort löscht die alte. Ebenso bleiben die iCal-UIDs (`…@budget-manager`, sonst erscheinen abonnierte Termine doppelt) und die Kennung `BMB1` verschlüsselter Backups (sonst lassen sich alte Backups nicht mehr entschlüsseln).
- **Gebaut wird im Netz des Hosts** (`build.network: host` bei `api` in `docker-compose.yml`): Auf dem Server des Auftraggebers (Rocky Linux) hing `npm ci` beim Update auf 1.2.3 minutenlang ohne Meldung, weil Build-Container über Dockers Bridge nicht ins Internet kamen; hier lief derselbe Schritt in 9 Sekunden. Ursache waren fehlende Firewall-Regeln von Docker (NAT-Kette `DOCKER`, vermutlich nach einem Neuladen von firewalld): Danach scheiterte der Start der API mit „No chain/target/match by that name“, `systemctl restart docker` behob beides. Der Host-Netz-Bau bleibt als Schutz. Nicht entfernen. Hängt der Bau trotzdem, erreicht der Host selbst die Registry nicht (Test im README unter „Wenn die App nicht startet“). Abbrechen ist gefahrlos: Compose ersetzt die Container erst nach dem Bauen.
- **DB-Zugangsdaten gelten nur beim ersten Start:** PostgreSQL übernimmt `DB_USER`, `DB_PASSWORD` und `DB_NAME` nur in ein leeres Volume. Passen sie später nicht mehr, bricht `waitForDb` sofort ab und erklärt im Log den Ausweg (`dbStartError` in `db.js`); `gen-secrets.sh` warnt, wenn das Volume schon existiert. Vorher hieß es nur „Datenbank nicht erreichbar“, so geschehen bei der ersten Installation auf einem neuen Server.
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
- **Ein Arbeitszeit-Eintrag gehört genau einem Kalendertag.** Neue Wege, Einträge anzulegen oder zu ändern, müssen über `splitManualEntry`/`splitTimer` (`work-split.js`) gehen; sonst zählen Stunden nach Mitternacht in der falschen Woche.
- **Gehaltslauf stündlich, Stichtag 03:45:** `payroll.run` bucht vor 03:45 Uhr nur bis vorgestern. Tests, die den Job aufrufen, müssen das berücksichtigen (`api.mjs` tut es); der Teil „wartet auf das Ausstempeln“ läuft nur zwischen 03:45 und 23:00.
- **Personen sind global (Migration 019):** `people` hat kein `owner_user_id`/`team_id` mehr und keine Funktion in `ORG_MODULES`. Nie `visibleSql`/`levelSql`/`recordLevel` mit `'person'` aufrufen (wirft „Unbekannte Funktion“); Rechte kommen allein aus `person:*`. Verwenden darf jeder jede Person (`assertPerson` in `records.js`). Fällt beim Umbau ein `personJoin(…, '$2')` o. Ä. weg, auch den Parameter aus dem Array nehmen.
- **Personen sind Bezugspunkt für Akten, Lizenzen und Schulungsnachweise:** `DELETE /people/:id` lehnt solche Personen ab (`personRecords` in `objects.js`, inzwischen samt Berichten, Anklagen, Beweismitteln, Fahrzeugen, Fahndungen und Personenakten); neue Tabellen mit Personenbezug dort mit prüfen.
- **Alles an einer Akte über `casefile-access.js`:** `loadFile`/`loadChild` prüfen die Stufe per `case_file_level`; nie eigene Sichtbarkeitsregeln für Berichte, Beweismittel usw. schreiben. Ausnahmen bewusst: Entwürfe sieht nur Verfasser oder „Verwalten“, freigegebene Berichte sind unveränderlich, Beweismittel-Protokolle nur anfügen, Anklagen behalten den Katalogstand. Personen in Anklagen, Berichten, Beweismitteln und Fahndungen müssen an der Akte beteiligt sein (`assertInvolved`).
- **Personenakte = Stammdaten global + `person_files` je Bereich:** Medizinische Angaben und Warnhinweise gehören nie in `people` (dort sieht sie jeder mit `person:read`).
- **Bereich fest:** Akten, Lizenzarten, Schulungen und Doku-Kategorien wechseln nach dem Anlegen nicht zwischen Solo und Organisation; Benutzer als Teilnehmer müssen zur selben Organisation gehören bzw. man selbst sein (`assertUserInScope` in `records.js`). Personen sind davon ausgenommen.
- **Rechte in Organisationen nie selbst aus `team_members` ableiten:** Es gibt keine `team_role` mehr. Sichtbarkeit und Schreibrecht kommen allein aus der Datenbankfunktion `team_level(team, user, modul, bereich)` bzw. `case_file_level(akte, user)`; in JS über `levelSql`/`visibleSql`/`recordLevel`/`recordOwner`/`teamUsers` aus `org.js`. `visibleSql(alias, modul)` braucht immer das Modul; der Alias muss `owner_user_id` und `team_id` haben. Eine reine Mitgliedschaftsprüfung (`team_members`) ist nur richtig, wo es um Mitgliedschaft geht (Teilnehmer, geteilte Daueraufträge).
- **Neue Funktion mit Organisationsbezug:** in `ORG_MODULES` (`org.js`) eintragen, dieselben Stufen in `seed_team_ranks()` (neue Migration) ergänzen und bestehenden Organisationen per Migration Zeilen für ihre Ränge geben, sonst hat dort niemand außer den Inhabern Zugriff. Erinnerungen über `teamUsers(team, modul)` verschicken.
- **Niemand vergibt mehr, als er selbst hat:** `teams.js` prüft bei Rang, Gruppe, persönlichem Recht und Zuweisung jede gestiegene Stufe gegen die eigene (`assertWithin`), Nicht-Inhaber verwalten nur Mitglieder und Ränge unter dem eigenen Rang. Neue Verwaltungswege dort mit absichern. Inhaber (`team_members.is_owner`) dürfen immer alles; der letzte Inhaber kann nicht gehen.
- **Lösungen von Testfragen** (`options[].correct`) nie an Teilnehmende ausliefern: Für sie gibt es nur `publicQuestions` (`exam.js`); bewertet wird allein serverseitig gegen die gespeicherten Fragen. Antwort-IDs bleiben beim Bearbeiten einer Frage erhalten, sonst lassen sich alte Versuche nicht mehr lesen.
- **`node --check datei.js` findet hier keine Syntaxfehler in Frontend-Modulen** (es prüft nicht als ES-Modul); so ging die Hilfe-Seite mit einem fehlenden Anführungszeichen kaputt in einen Commit. `test/frontend-syntax.test.js` prüft jedes Modul mit `--input-type=module`, von Hand: `node --input-type=module --check < datei.js`.
- **Bereichsrechte (`scope_id`) hängen ohne Fremdschlüssel an Aktenarten und Doku-Kategorien:** Beim Löschen einer Art oder Kategorie die Zeilen in `team_permissions` mit löschen (wie in `casefiles.js` und `docs.js`).
- **Zinsen:** Die Regeln stehen allein in `planInterest` (`interest.js`, ohne Datenbank testbar), gerechnet wird in Cent als BigInt. `interest_payments` hält je Konto und Zeitraumende genau eine Zeile, auch bei 0,00 und auch nach Löschen der Buchung; nie „zur Korrektur“ Zeilen löschen, sonst bucht der Job den Zeitraum erneut. `budgets` hat einen CHECK: `interest_rate`, `interest_period` und `interest_since` sind zusammen gesetzt oder leer.
- **Kennzeichen sind nur unter nicht ausgemusterten Fahrzeugen eindeutig** (partielle Indizes): Auch ein PATCH kann 23505 auslösen (wieder in Betrieb nehmen), `objects.js` fängt das beim Anlegen und Ändern ab. Neue Abfragen für Service, Erinnerungen oder Übersichten filtern `status <> 'retired'`.
- **Bildunterschrift beim Upload:** `receiveUpload` liest `caption` aus `part.fields`; das Feld muss im FormData vor der Datei stehen, sonst kommt es nicht an.
- **Dateien im Upload-Volume** werden nur gelöscht, wo der Code es tut (Anhang, Akte, Foto, Fahrzeugbild, Fahrzeug). Kaskaden der Datenbank (z. B. beim Löschen einer Organisation) lassen die Dateien liegen.

## Testen

Nie gegen die laufende Instanz `budget-manager` testen, dort liegen echte Daten. Einen VS-Code-Browser braucht es nicht: Die Skripte in [tests/e2e/](tests/e2e/) steuern echtes Chromium im Playwright-Container und erzeugen Screenshots. Ablauf und Befehle stehen in [tests/e2e/README.md](tests/e2e/README.md).

| Stufe | Prüft |
|---|---|
| `npm test` in `apps/api` | Unit-Tests ohne Datenbank |
| `api.mjs` | Alle API-Bereiche, Rollen, IDOR, ungültige Eingaben, ToDo-Job im Worker-Container; jede 5xx-Antwort ist ein Fehler |
| `auth.mjs` | Refresh-Rotation, 2FA, Recovery-Codes, Passwort, Reset, Einladung |
| `browser.mjs` | Geführte Abläufe im Browser, Mobilbreite, Konsole |
| `crawl.mjs` | Klickt jede Aktionsart auf jeder Seite als Viewer, Owner, Admin, danach destruktiv; je Durchlauf mehrere Browser (`CRAWL_WORKERS`), nur bestimmte Rollen mit `CRAWL_ROLES` |
| `upgrade.mjs` | Update von einem alten Stand im selben Browserprofil, ohne Cache-Löschen |

Zusätzlich vor einem Release: `upgrade.mjs` ab dem zuletzt ausgerollten Stand, Migrationen auf einer Wegwerf-Kopie des aktuellen Stands, alle Worker-Jobs mit Daten (`runJob`), Restore bei laufendem Stack und in eine leere DB. Der Test-Stack braucht ein eigenes `IMAGE_TAG`, sonst baut er das Image unter dem Namen der produktiven Instanz.

Die Meldungen von `crawl.mjs` sind Hinweise, keine Urteile: Abgelehnte Testeingaben, nicht konfiguriertes OAuth, QR-Scan ohne `BarcodeDetector` in Headless-Chromium, deaktivierte Blätter-Knöpfe und neu gerenderte Kalender-Elemente sind normal. Verdachtsfälle gezielt nachprüfen; nur 5xx, JS-Fehler und Textfehler sind immer echte Fehler.

## Anforderungen

### Allgemein
- Einziger Einstieg ist `api` auf einem Port (UI und API, gleicher Ursprung). Kein mitgelieferter Reverse-Proxy; `db` nur im internen Netz.
- App-Name zentral in den Einstellungen änderbar; wirkt in Seitenleiste, Login, Titel und Rechtsseiten.
- Navigation: **Finanzen** (Dashboard, Transaktionen, Stundenzettel, Konten, Budgets, Daueraufträge, Sparziele, Berichte), **Zusammenarbeit** (Kalender, Notizblock, ToDos), **Sport** (Laufen, Schwimmen, Biken), **Object Management** (Fahrzeuge, Häuser, Schlüssel, Verwaltung; Personen über „Akten → Personenakten“), **Organisation** (Organisationen, Akten, Schulungen, Lizenzen, Dokumentationen), **Administration** (User-Management, Server-Management, Tickets – nur Admins; Hilfe, Changelog und Fehler melden für alle), dazu Impressum und Datenschutz.
- **Changelog (Wunsch des Auftraggebers vom 2026-11-10):** Seite unter Administration mit allen Versionen seit 0.0.0, neueste oben als „Installiert“, Suche und Filter nach Art (Neu, Geändert, Behoben, Technik). Daten in `apps/web/public/js/changelog.js`; die Stände vor 1.0.0 sind nachträglich als 0.x nummeriert, weil es vorher keine Versionsnummern gab.
- Alte Links (`#/assets?tab=…`, `#/admin`, QR-Codes) müssen weiter funktionieren.

### Konten und Buchungen
- Konten sind persönlich oder geteilt (Organisation) und zeigen Kontostand, Einkommen und Ausgaben. **Kein Limit und kein Zeitraum im Kontoformular**; Limits gehören zu den Budgets. Kategorien dürfen weiter eigene Limits haben.
- **Persönliche Konten zuerst (Wunsch des Auftraggebers vom 2026-11-10):** `GET /budgets` sortiert persönliche vor geteilten; Kontenseite und alle Auswahllisten wählen damit ein persönliches Konto vor.
- **Zinsen (optional, Wunsch vom 2026-11-10, z. B. Sparkonto):** Satz in % pro Tag, Woche (Mo–So), Monat oder Jahr, gutgeschrieben als Einnahme am letzten Tag jedes abgeschlossenen Zeitraums auf den durchschnittlichen Tagessaldo (Minus-Tage zählen 0, Zinseszins, ab Einschalten). Geänderter Satz gilt für alles noch nicht Gutgeschriebene; abgerechnete Zeiträume werden nicht nachberechnet. Zinsbuchungen nicht änderbar, nur löschbar. Vom Auftraggeber am 2026-11-10 so bestätigt.
- Buchungstypen: Einnahme, Ausgabe, Einzahlung auf ein Sparziel. Viewer dürfen nicht buchen. CSV-Export, Belege.
- **Kontostand und Dashboard zeigen nur, was wirklich auf dem Konto ist** (Entscheidung des Auftraggebers): Einnahmen minus Ausgaben bis heute. Sparziel-Einzahlungen bleiben auf dem Konto und ändern den Saldo nicht; Buchungen mit Datum in der Zukunft zählen erst ab diesem Datum. KPIs, Cashflow und letzte Buchungen im Dashboard folgen derselben Regel; die Transaktionsliste und Berichte zeigen weiter auch Zukünftiges.
- Das Dashboard wechselt zwischen **Tag, Woche und Monat**. KPIs und Kategorien folgen dem gewählten Zeitraum, der Cashflow zeigt 14 Tage, 8 Wochen oder 6 Monate, der Gesamtsaldo bleibt der heutige Stand. Die Woche beginnt mit dem Wochenstart aus dem Profil.

### Budgets
- Ausgabenlimit mit Name, Betrag, Zeitraum (Tag, Woche, Monat, Jahr), optional auf Konto und/oder Kategorie begrenzt. Zeigt Verbrauch, Rest und Überschreitung. Privat pro Benutzer; Ausgaben auf Konten einer Organisation zählen nur, wenn man sie lesen darf.

### Daueraufträge und Sparziele
- Intervalle täglich, wöchentlich, monatlich, jährlich, benutzerdefiniert in Tagen, jeweils mit Abstand. Monats-/Jahresserien rasten auf den letzten gültigen Tag ein.
- Teilen mit einem Mitglied derselben Organisation nach dessen Zustimmung: voller Betrag auch in dessen persönlichem Konto, gleiche Währung nötig.
- Objektkosten aktualisieren den verknüpften Auftrag, keine Duplikate. Sparziele mit Rate und Rhythmus.

### Stundenzettel und Gehalt
- Timer (Ein-/Ausstempeln, Pause) und manuelle Einträge, mit oder ohne Projekt; Pausen zählen nicht. Projekte privat oder in einer Organisation: buchen ab „Teilnehmen“, anlegen und ändern ab „Lesen & Schreiben“, löschen mit „Verwalten“.
- KPI „Wochen-Soll“. Monats-Soll = Wochen-Soll × Kalendertage / 7. PDF und CSV.
- Das Gehaltskonto ist auf dem Stundenzettel („Gehalt einstellen“) und im Profil wählbar. Nicht wählbare Konten stehen mit Begründung in der Liste; fehlt ein passendes Konto, sagt ein Hinweis, was zu tun ist.
- **Gehaltsregel des Auftraggebers** (Beispiel: 1.669 Festgehalt pro Tag, 13 Stunden Wochen-Soll, 17 % Bonus): Das Festgehalt wird jeden Tag um 03:45 für den Vortag gebucht, inklusive Wochenende und unabhängig von den Stunden, auf ein eigenes persönliches Konto. Nur Stunden über dem Wochen-Soll (Mo–So) bringen zusätzlich je Stunde den Bonus, einen Prozentsatz des Festgehalts (17 % von 1.669 = 283,73). Woche 1, Soll nicht erreicht: täglich nur Festgehalt. Woche 2, Soll am Dienstag erreicht: ab dann jede weitere Stunde mit Bonus. Woche 3, Soll am Samstag erreicht: nur der Rest von Samstag und Sonntag. Montags beginnt die Zählung neu.
- **Nachtschicht (Entscheidung des Auftraggebers):** Stunden zählen an dem Kalendertag, an dem gearbeitet wurde. Timer und manuelle Einträge werden an Mitternacht in einen Eintrag je Tag geteilt; in der Nacht von Sonntag auf Montag gehören die Stunden nach 0 Uhr zur neuen Woche. Läuft um 03:45 noch ein Timer (jünger als 24 Stunden), wartet die Gutschrift seines Starttags bis zum Ausstempeln und folgt spätestens eine Stunde danach. Timer über 24 Stunden lassen sich nur verwerfen.
- Nachgetragene Stunden derselben Woche kommen mit der nächsten Gutschrift dazu; abgeschlossene Wochen werden nicht nachberechnet, sonst würde ein geändertes Wochen-Soll alte Wochen neu bewerten. Stunden über dem Wochen-Soll (Mo–So) zusätzlich mit Stundenlohn plus Zuschlag. Idempotent, Ausfälle werden nachgeholt.
- Mit „Lesen“ beim Stundenzettel sieht man die Zeiten aller Mitglieder der Organisation, mit „Lesen & Schreiben“ bearbeitet man sie und die Mitarbeitereinstellungen.
- **Wünsche vom 2026-11-10:** Der Stundenzettel der Organisation zeigt die eigene Person nicht (deren Zeiten stehen oben) und hat eine Suche nach Mitarbeitern. Im Eintragsformular rechnen sich die Stunden bei jeder Änderung von Beginn, Ende oder Pause neu (über Mitternacht eingeschlossen), von Hand überschreibbar.

### Sport
- Getrennte Seiten für Laufen, Schwimmen, Biken. Strecken gehören einer Organisation, mit Checkpoints, Distanz, Notizen. Bestenliste nach Punkten absteigend, dann Zeit.
- Mit „Lesen“ Bestenliste sehen und eigene Ergebnisse eintragen und löschen; mit „Lesen & Schreiben“ Strecken verwalten und fremde Ergebnisse löschen. Fremde sehen nichts.

### Objekte
- Fahrzeuge, Häuser und Schlüssel sind privat oder pro Datensatz einer Organisation freigegeben (ändern ab „Lesen & Schreiben“, löschen mit „Verwalten“). Fahrzeuge (Service nach Datum/km, Verbandskasten), Häuser (Wartung), Schlüssel (freie Art, Kopien, Ausgabe, Rückgabe, verloren, QR-Code, Inventur).
- **Personen sind global (Entscheidung des Auftraggebers vom 2026-11-09):** eine gemeinsame Liste für das ganze System, auch Personen ohne Login. Jeder mit `person:read` sieht alle und verwendet sie überall (Schlüssel, Häuser, Akten, Lizenzen, Schulungen jeder Organisation und solo). Anlegen, Ändern, Löschen nur über die Rollenrechte `person:create|update|delete`, mit Audit-Log. Die Personenübersicht zeigt Akten, Lizenzen und Schulungen nur, soweit die eigenen Rechte reichen.
- **Personen nur über die Personenakten (Wunsch des Auftraggebers vom 2026-11-10):** Die Seite „Personen“ unter Object Management ist ausgeblendet; Liste, Anlegen, Stammdaten, Löschen und CSV laufen unter „Akten → Personenakten“ (`person-files.js`). `#/assets-people` und `#/assets?tab=people` leiten dorthin um (`assets.js`). Pflegen braucht damit auch `casefile:read`; Verwenden in Schlüsseln, Häusern und Fahrzeugen weiter nur `person:read` (`GET /people` bleibt).
- **Personen per CSV (Wunsch des Auftraggebers vom 2026-11-09):** Export mit `person:export` (Spalten ID, Name, Art, Funktion, Telefon, E-Mail, Aktiv, Notiz; lässt sich unverändert wieder importieren). Import mit `person:create`, erst Prüfen, dann Importieren. Mit ID ändern (zusätzlich `person:update`, nur Spalten der Datei), ohne ID anlegen; vorhandene oder doppelte Namen werden übersprungen, damit ein zweiter Import nichts verdoppelt. Fehlerhafte Zeilen fallen mit Zeilennummer weg. Regeln in `planPeopleImport` (`people.js`), ohne Datenbank testbar.
- Tür-PINs verschlüsselt, nie in Listen, nur nach Passwort und ggf. 2FA sichtbar, jeder Zugriff im Audit-Log.
- „Verwaltung“ bündelt Übersicht, Kosten, Protokoll und Auditlog (nur mit `audit:read`). Keine Versicherungsangabe an Fahrzeugen.
- **Fahrzeuge (Wünsche vom 2026-11-10, Migration 022):** Besitzer aus der globalen Personenliste (`owner_person_id`), das Fahrzeug erscheint automatisch in dessen Personenakte und Personenübersicht; Freitext nur für Besitzer ohne Personeneintrag; Personen mit Fahrzeugen nicht löschbar. Ausgemusterte Fahrzeuge geben das Kennzeichen frei, fehlen im Dashboard und erzeugen keine Service-/Verbandskasten-Termine und -Erinnerungen. Bilder (PNG/JPEG, Bildunterschrift, höchstens 50) sehen alle, die das Fahrzeug sehen; ändern ab „Lesen & Schreiben“.

### Akten, Schulungen, Lizenzen, Dokumentationen (Entscheidungen des Auftraggebers vom 2026-11-08)
- Alle vier solo oder pro Organisation, Bereich beim Anlegen fest. Rechte nach „Organisationen und Rechte“; Fremde sehen nichts; zusätzlich Katalogrechte `casefile`, `training`, `license`, `doc`. Beteiligte Personen, Lizenzinhaber und Teilnehmer-Personen kommen aus der globalen Personenliste.
- **Akten:** Fall- bzw. Vorgangsakten mit Aktenzeichen (automatisch `Jahr-Nummer`), Status offen/ruhend/abgeschlossen, beteiligten Personen mit Rolle, chronologischen Einträgen und Anhängen. Bilder (Wunsch vom 2026-11-10) sind PNG-/JPEG-Anhänge mit Bildunterschrift im eigenen Tab „Bilder“. Auf jeder Person zeigt die „Übersicht“ alle Akten und Einträge zu ihr, dazu Lizenzen und Schulungen.
- **Aktensystem (Wunsch des Auftraggebers vom 2026-11-09, Migration 020):** „wie ein richtiges Aktensystem bei Polizei, Medics und Co.“: Fallakten mit Priorität, Ort, Zeit, Sachbearbeitung, Fahrzeugen und Verknüpfungen; Berichte mit Vorlagen (Polizei, Rettungsdienst, allgemein) und Freigabe nach dem Vier-Augen-Prinzip; Strafkatalog mit CSV und Anklagepunkte mit Entscheidung und Vorstrafen; Beweismittel mit Übergabekette; Fahndungen mit Fahndungsliste und Abfrage; Personenakte je Bereich mit Foto, Warnhinweisen, Vermerken und medizinischen Angaben. Details in `CONCEPT.md` Abschnitt 9.
- **Lizenzen für Personen:** frei anlegbare Lizenzarten mit Standard-Gültigkeit; Lizenz mit Nummer, Aussteller, Ausstellung, Ablauf, Status gültig/gesperrt/entzogen mit Begründung; Erinnerung 30 Tage vorher und nach Ablauf.
- **Schulungen, Teilnahme und Nachweis:** Termine, Teilnehmer (Benutzer oder Personen), Ergebnis, Gültigkeit mit Erinnerung, Übersicht wer was hat. Keine Lerninhalte im Tool, nur der Test.
- **Test im Tool (Wunsch des Auftraggebers vom 2026-11-09, Migration 021):** optional je Schulung; „wenn der Ausbilder sagt, für diese Schulung ist ein Test nötig“. Ohne Test reichen Teilnahme und „bestanden“. Mit Test: Fragen mit einer oder mehreren richtigen Antworten und Punkten, Bestehensgrenze, optional Zeitlimit, Versuche, Mischen und „erst nach Teilnahme“; Benutzer bestehen nur über den Test, Personen ohne Zugang weiter von Hand. Details in `CONCEPT.md` Abschnitt 9.
- **Dokumentationen:** Wiki mit selbst angelegten Kategorien (z. B. Gesetze, Funktionen), einfache Formatierung, Suche.

### Organisationen und Rechte (Entscheidungen des Auftraggebers vom 2026-11-09)
- „Team“ heißt jetzt **Organisation** (nur in der Oberfläche). Navigation: Abschnitt „Organisation“ mit Organisationen, Akten, Schulungen, Lizenzen, Dokumentationen.
- Jedes Mitglied hat einen **Rang**; Ränge haben eine Reihenfolge. Dazu beliebig viele **Gruppen** pro Organisation. Neue Organisationen bekommen Leitung, Mitglied und Leser; bestehende Teams wurden so übernommen: Owner → Inhaber mit Rang Leitung, Editor → Mitglied, Viewer → Leser.
- Rechte **pro Funktion** (`ORG_MODULES`): Kein Zugriff, Teilnehmen, Lesen, Lesen & Schreiben, Verwalten; vergeben für Ränge, Gruppen und einzelne Mitglieder. **Es gilt das höchste Recht aus Rang und Gruppen; ein persönlich gesetztes Recht gilt genau so, auch wenn es weniger ist.** Aktenarten und Doku-Kategorien haben eigene Zeilen, die der allgemeinen Zeile desselben Rangs bzw. derselben Gruppe vorgehen.
- **„Teilnehmen“** (Wunsch des Auftraggebers für Schulungen): Schulungen und Termine sehen, sich selbst an- und abmelden, aber keine Teilnehmer und keine Ergebnisse sehen oder bearbeiten. Beim Stundenzettel heißt es: auf Projekte der Organisation buchen.
- **Akten:** Aktenarten mit eigenen Rechten und zusätzlich einzelne Akten beschränkbar auf Ränge (samt allen höheren), Gruppen und Mitglieder; Inhaber und Ersteller sehen sie immer, sich selbst aussperren geht nicht.
- **Hierarchie:** Nicht-Inhaber verwalten nur Mitglieder und Ränge unter dem eigenen Rang und vergeben nie mehr, als sie selbst haben. Inhaber dürfen alles; mindestens ein Inhaber bleibt.
- Die appweiten Rollen aus der Administration gelten zusätzlich (z. B. `casefile:read`); fehlt dort ein Recht, hilft auch die Organisation nicht.

### Texte mit Markdown (Wunsch des Auftraggebers vom 2026-11-09)
- „Wirklich volles Markdown“ in Notizen, ToDo-Notizen, Dokumentationen, Akten (Sachverhalt, Einträge), Schulungen, Lizenzarten, Streckennotizen, Tickets und Kommentaren: CommonMark mit GitHub-Erweiterungen (Tabellen, Aufgabenlisten, Durchstreichen, automatische Links, Fußnoten, Hinweis-Kästen). Dazu eine Werkzeugleiste über dem Textfeld mit Vorschau, Nebeneinander, Vollbild, Hilfe und Tastenkürzeln.
- Sicher vor Code aus dem Text: HTML erscheint als Text bis auf wenige Tags ohne Attribute; externe Bilder nur als Link (Datenschutz, CSP). Ein Zeilenumbruch bleibt ein Zeilenumbruch.

### Kalender und Benachrichtigungen
- Monat, Woche, Tag, Agenda; eigene Termine plus abgeleitete (Zahlungen, Service, Schlüsselfristen, Wartung, Schulungstermine, Ablauf von Lizenzen und Schulungsnachweisen, Deadlines offener ToDos seit 2026-11-10, Feiertage); iCal-Abo. Glocke mit Zähler. Täglicher Job erinnert an Termine, Service, Verbandskasten, Schlüsselrückgaben, ablaufende Lizenzen und Schulungsnachweise.

### Notizblock und ToDos
- Beide solo oder pro Organisation. Mit „Lesen & Schreiben“ ändern, mit „Lesen“ nur lesen ohne Aktionen; Fremde sehen nichts.
- ToDos mit optionaler Deadline. Offene ToDos mit Deadline erinnern in der Glocke einen Tag vorher, am Fälligkeitstag und einmal bei Überfälligkeit, ToDos einer Organisation alle Mitglieder mit Leserecht. In den Einstellungen abschaltbar, E-Mail nur nach ausdrücklicher Wahl.

### Administration
- User-Management: Benutzer, Rollen & Rechte, Gruppen, Organisationen (nur Übersicht). Server-Management: Übersicht, Sicherheit & Einstellungen, System & Backups, Integrationen, Audit-Log. Tickets: gemeldete Fehler (optional Abgleich mit GitHub Issues).
- Tickets lassen sich kommentieren und löschen: Admins alle, Melder ihre eigenen. Kommentare benachrichtigen die jeweils andere Seite. Eigene Kommentare darf jeder löschen, Admins alle. Kommentare bleiben intern; ein GitHub-Issue bleibt beim Löschen bestehen.
- Rechte als `ressource:aktion`, Systemrollen `Admin` und `User`, eigene Rollen frei. Jede Route prüft serverseitig, Frontend blendet nur aus.

### Sicherheit und Datenschutz
- Argon2, Login-Sperre, Rate-Limits nur bei Passwort- und Code-Prüfungen, TOTP-2FA mit 8 Recovery-Codes, Refresh-Rotation im httpOnly-Cookie, Access-Token nur im Speicher, strikte CSP, verschlüsselte Backups, Audit-Log.
- **Gravatar nur mit Einwilligung**: Standard aus, Migration 013 hat alles zurückgesetzt. Keine Tracker oder Cookies über das technisch Nötige hinaus.
- Impressum aus eigener Datei `.env-impressum` (nur nicht-leere Felder anzeigen), Datenschutzseite öffentlich erreichbar.

## Offene Punkte

- **Nachgetragene Buchungen und Zinsen:** Buchungen, die für einen schon verzinsten Zeitraum nachgetragen werden, ändern dessen Zinsen nicht.
- **Stunden für abgeschlossene Wochen**, die nachgetragen werden, bringen keinen Bonus mehr. Nachtschichten sind davon seit Migration 017 nicht mehr betroffen. Einträge über Mitternacht von vor dieser Regel wurden nicht umgerechnet.
- **„Heute“ ist im Server UTC:** `today()` in `lib.js` nimmt das UTC-Datum. Zwischen Mitternacht und 1 Uhr (Sommer 2 Uhr) ist „heute“ deshalb noch gestern, etwa beim Abschlussdatum einer Akte oder als Vorgabe für Buchungen. Ein Umstieg auf `TZ` betrifft viele Stellen und ist noch nicht entschieden; Tests mit Datum schlagen in diesem Zeitfenster fehl.
- **Eigene Rollen** aus der Administration bekommen neue Katalogrechte nicht automatisch; Admin und User schon.
- **Doppelte Personen:** Migration 019 hat private und Organisations-Personen unverändert zusammengelegt; gleichnamige Personen stehen doppelt in der Liste. Zusammenführen gibt es nicht, ebenso keine Suche in den Auswahllisten.
- **Beträge** erscheinen überall in der Profilwährung, auch bei Konten in anderer Währung; umgerechnet wird nichts.
- Nicht enthalten: SSO/OIDC, LDAP, Bankanbindung, MT940, S3/SFTP-Backupziele, E-Mail-Bestätigung bei Registrierung, Restore in der Oberfläche.
