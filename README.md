# RP-Management-Board

Selbst gehostete Verwaltung persönlicher und geteilter Konten: Buchungen, Ausgaben-Budgets, Daueraufträge, Sparziele, Zeiterfassung mit Gehaltsgutschrift, Sport-Bestenlisten, Berichte, Organisationen mit Rängen, Gruppen und Rechten pro Funktion, Kalender, Notizblock, ToDos mit Deadline-Benachrichtigung, Google-/Outlook-Sync, Objektverwaltung (Fahrzeuge, Häuser, Personen, Schlüssel), Akten, Schulungen, Lizenzen, Dokumentationen, Rollen & Rechte, 2FA und verschlüsselte Backups. Konzept: [CONCEPT.md](CONCEPT.md), Technik: [TECHNICAL.md](TECHNICAL.md), Anleitung für KI-Assistenten mit allen Anforderungen: [AGENTS.md](AGENTS.md), Tests: [tests/e2e/README.md](tests/e2e/README.md).

## Architektur

| Service  | Image / Build        | Aufgabe                                              |
|----------|----------------------|------------------------------------------------------|
| `api`    | Node 22 / Fastify    | **einziger Einstiegspunkt** (Port 8080): SPA und REST-API, Auth (JWT + Refresh-Cookie), RBAC, 2FA |
| `worker` | wie `api`            | Hintergrundjobs: Daueraufträge, Gehalt, Erinnerungen (auch ablaufende Lizenzen und Schulungen), ToDo-Deadlines, Berichte, Backups |
| `db`     | PostgreSQL           | Datenhaltung (nur im internen Netz `backend`)        |

Nur `api` veröffentlicht **einen** Port (`HTTP_PORT`, Standard 8080, plain HTTP) und liefert sowohl die Weboberfläche als auch `/api` direkt aus. Das Repository enthält keinen Reverse-Proxy und benötigt keinen. `db` bleibt im internen Netz, der Worker hat keinen veröffentlichten Port. Ein bereits vorhandener NGINX kann optional vor den App-Port geschaltet werden; seine Konfiguration und sein Container sind nicht Teil dieses Repositories. Container laufen mit gedroppten Capabilities, `no-new-privileges` und Healthchecks; Restart-Policy `unless-stopped`.

## Installation

Voraussetzungen: Docker ≥ 24 mit Compose ≥ 2.24. Ein Reverse-Proxy ist optional.

```bash
git clone <repository-url>
cd RP-Management-Board
cp .env.example .env
./scripts/gen-secrets.sh        # trägt DB_PASSWORD, JWT_SECRET, ENCRYPTION_KEY, ADMIN_PASSWORD in .env ein (oder manuell setzen)
$EDITOR .env                    # APP_URL (öffentliche URL), ADMIN_EMAIL, SMTP_* anpassen
cp .env-impressum.example .env-impressum   # Impressum eintragen (optional, wird nicht committet)
docker compose up -d
```

Für direkten Zugriff ohne Reverse-Proxy `APP_URL` auf `http://<server-ip>:8080` setzen. Für HTTPS hinter einem bereits vorhandenen Proxy `APP_URL` auf die öffentliche `https://`-Adresse setzen; dadurch werden Refresh-Cookies als `Secure` markiert. Der erste Start baut die Images, legt das Schema an und erzeugt den Admin-Benutzer aus `ADMIN_EMAIL`/`ADMIN_PASSWORD`. Danach unter `APP_URL` anmelden und das Passwort ändern. Status: `docker compose ps` (alle Services `healthy`).

### Wenn die App nicht startet

Meldet `docker compose up -d` `container budget-manager-api-1 is unhealthy`, steht der Grund in `docker compose logs api`.

**„Die Datenbank lehnt die Anmeldung als … ab“** (oder „Die Datenbank … gibt es nicht“): PostgreSQL übernimmt `DB_USER`, `DB_PASSWORD` und `DB_NAME` nur beim allerersten Start, solange das Volume `budget-manager_db_data` leer ist. Das Log der Datenbank zeigt dann `Database directory appears to contain a database; Skipping initialization`. Ursache ist meist eine von zwei:

- Die Werte in `.env` wurden nach dem ersten Start geändert.
- Auf dem Host lief schon einmal eine Installation dieser App. Der Projektname ist fest, deshalb teilen sich alle Installationen auf einem Host die Volumes `budget-manager_*`, egal in welchem Verzeichnis sie liegen.

So geht es weiter:

- **Daten behalten:** die alten Werte wieder in `.env` eintragen (Standard war `DB_USER=budget`). Das Passwort lässt sich danach per `ALTER USER` ändern, siehe „Secrets rotieren“.
- **Daten dürfen weg:** Bei einer neuen Installation ohne Daten setzt `docker compose down -v` alles zurück, danach `docker compose up -d`. Achtung: Das löscht Datenbank, Uploads und Backups jeder Installation dieser App auf dem Host. Wann das Volume angelegt wurde, zeigt `docker volume inspect budget-manager_db_data --format '{{.CreatedAt}}'`.

`./scripts/gen-secrets.sh` warnt, wenn es das Volume schon gibt.

### Optionaler eigener Reverse-Proxy

Ein vorhandener NGINX kann den veröffentlichten App-Port (`HTTP_PORT`, Standard 8080) für HTTPS verwenden. Der App-Container liefert UI und API auf demselben Ursprung aus; der Proxy muss daher keine `/api`-Weiterleitung zu einem separaten API-Dienst einrichten. Für einen Proxy auf demselben Host `BIND_ADDR=127.0.0.1` setzen. Wenn der Proxy `X-Forwarded-*`-Header setzt, `TRUST_PROXY` auf dessen vertrauenswürdige IP-Adresse(n) oder CIDR(s) setzen (mehrere kommasepariert). Standardmäßig werden solche Header nicht vertraut. `TRUST_PROXY=true` nur verwenden, wenn ausschließlich der Proxy den App-Port erreichen kann.

Ohne Proxy direkt `http://<server-ip>:8080` öffnen. Bei HTTP sind Cookies nicht `Secure`; für öffentlich erreichbare Installationen HTTPS verwenden.

## Konfiguration (`.env`)

| Variable | Bedeutung |
|----------|-----------|
| `APP_URL` | öffentliche URL (Cookies, Links in Mails) |
| `BIND_ADDR`, `HTTP_PORT` | Bindeadresse und der eine veröffentlichte Port (Standard `0.0.0.0:8080`) |
| `TRUST_PROXY` | vertrauenswürdige Proxy-IP(s)/CIDR(s), standardmäßig `false`. Hinter einem Proxy unbedingt setzen, sonst teilen sich alle Benutzer dessen IP, auch beim Login-Limit und im Audit-Log; die App warnt dann unter *Server-Management → Sicherheit & Einstellungen* |
| `TZ` | Zeitzone |
| `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Datenbank |
| `JWT_SECRET` | Signatur der Access-Tokens (mind. 32 Zeichen) |
| `ENCRYPTION_KEY` | verschlüsselt 2FA-Secrets, SMTP-Passwort, Provider-Tokens und Backups. **Nie verlieren oder ändern**, sonst sind diese Daten unlesbar |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | initialer Administrator (nur beim ersten Start) |
| `ACCESS_TOKEN_TTL_SEC`, `REFRESH_TOKEN_TTL_DAYS` | Token-Laufzeiten |
| `ALLOW_REGISTRATION` | Selbstregistrierung an/aus (Standard aus) |
| `HIBP_CHECK` | Passwörter gegen Have-I-Been-Pwned (k-Anonymität) prüfen |
| `SMTP_*` | Mailversand (Einladungen, Passwort-Reset, Benachrichtigungen); ohne SMTP werden Links in der UI angezeigt |
| `BACKUP_ENCRYPT`, `BACKUP_RETENTION_DAYS`, `BACKUP_HOUR` | nächtliches Backup |
| `MAX_UPLOAD_MB` | Belegupload-Limit |
| `HOLIDAY_COUNTRY`, `HOLIDAY_REGION` | Feiertage im Kalender |
| `LOG_LEVEL` | Log-Level |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth für Kontakte und Kalender; Redirect-URI `APP_URL/api/integrations/google/callback`, Scopes `contacts.readonly` und `calendar.readonly` |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Microsoft OAuth für Kontakte und Kalender; Redirect-URI `APP_URL/api/integrations/microsoft/callback`, API-Berechtigungen `Contacts.Read`, `Calendars.Read`, `User.Read` sowie `offline_access` |
| `GITHUB_ISSUES_TOKEN`, `GITHUB_ISSUES_REPOSITORY` | Optionaler GitHub-Abgleich interner Fehler-Tickets; Token benötigt Issues-Schreibzugriff im Zielrepository |
| `IMPRINT_*` | Impressum: eigene Datei `.env-impressum` (Vorlage `.env-impressum.example`), danach `docker compose up -d api` |

Alle weiteren Einstellungen (Passwortregeln, App-Name, Wartungsmodus, Aufbewahrungsfristen) pflegt der Admin unter *Server-Management → Sicherheit & Einstellungen*.

Google- und Microsoft-Verbindungen importieren Kontakte und Kalendertermine ausschließlich lesend. Verbindungen und importierte Daten können in *Einstellungen → API & Kalender* wieder getrennt bzw. gelöscht werden. Die Zeiterfassung bietet Timer mit Pausen, private Projekte oder Projekte einer Organisation, manuelle Einträge sowie Wochen-/Tagesübersicht und CSV-Export. Mitarbeiter können in ihrem Profil ein eigenes Konto für die automatische Gehaltsgutschrift auswählen. Das Festgehalt wird täglich einschließlich Wochenende ab 03:45 Uhr für den Vortag gutgeschrieben; Stunden über dem Wochen-Soll bringen zusätzlich einen Bonus in Prozent des Festgehalts. Schichten über Mitternacht werden in einen Eintrag je Kalendertag geteilt, und ist um 03:45 Uhr noch jemand eingestempelt, wartet dessen Gutschrift bis zum Ausstempeln. Objekte, Schlüssel und Personen werden beim Anlegen privat gespeichert; die Freigabe für eine Organisation kann pro Datensatz gewählt werden. Bereits vorhandene globale Objekte werden beim Update dem ersten Admin privat zugeordnet. Akten, Schulungen, Lizenzen und Dokumentationen gehören wie Notizen einer Person oder einer Organisation; Akten und Lizenzen beziehen sich auf Personen aus der Objektverwaltung. Organisationen (früher Teams) haben Ränge mit Reihenfolge und Gruppen; Rechte pro Funktion (Kein Zugriff, Teilnehmen, Lesen, Lesen & Schreiben, Verwalten) gelten für Ränge, Gruppen und einzelne Mitglieder, bei Akten zusätzlich pro Aktenart und pro Akte, bei Dokumentationen pro Kategorie. Notizen, Beschreibungen, Akteneinträge und Tickets unterstützen einfaches Markdown. Budgets sind Ausgabenlimits pro Tag, Woche, Monat oder Jahr; Sportstrecken gehören einer Organisation und führen eine gemeinsame Bestenliste. Gravatar ist standardmäßig aus und wird nur nach Einwilligung im Profil genutzt; Impressum und Datenschutzerklärung sind ohne Anmeldung erreichbar.

## Betrieb

```bash
docker compose logs -f api worker        # Logs
./scripts/update.sh                     # Branch aktualisieren, Images bauen, Services prüfen
docker compose down                     # Stoppen (Daten bleiben in Volumes)
```

Persistente Daten liegen in den Docker-Volumes `budget-manager_db_data`, `budget-manager_uploads` und `budget-manager_backups`. Der Name hängt am festen Projektnamen, nicht am Verzeichnis.

### Bestehende Git-Installation aktualisieren

Im Projektverzeichnis genügt:

```bash
./scripts/update.sh
```

Das Skript aktualisiert den ausgecheckten Branch per Fast-Forward, baut die Images neu, startet die Services und wartet auf deren Healthchecks. Es bricht ab, wenn lokale Änderungen vorhanden sind. Datenbankmigrationen laufen beim API-Start automatisch; ein manueller Migrationsschritt ist nicht erforderlich und die Docker-Volumes bleiben erhalten. Das Update setzt alle Gravatar-Einstellungen einmalig auf „aus“ (Migration 013). Migration 018 macht aus Teams Organisationen: Owner werden Inhaber mit Rang Leitung, Editoren Mitglied, Viewer Leser; die Standardrechte entsprechen dem bisherigen Verhalten. Eigene Rollen der Administration bekommen neue Katalogrechte nicht automatisch. Browser und Proxys bekommen die neue Version automatisch, Cache-Löschen ist nicht nötig; bereits offene Tabs einmal neu laden. `.env-impressum` ist nicht in Git und wird vom Update nicht angelegt; das Skript weist darauf hin, wenn das Impressum leer ist. Bei Problemen helfen `docker compose logs -f api worker`. Vor größeren Updates empfiehlt sich ein Backup.

### Backup & Restore

Backups (pg_dump, AES-256-GCM-verschlüsselt) laufen nächtlich und manuell über *Server-Management → System & Backups*. Aufbewahrung: `BACKUP_RETENTION_DAYS`.

```bash
# Backup-Datei aus dem Volume kopieren
docker compose exec -T api sh -c 'cat /data/backups/<datei>.dump.enc' > backup.dump.enc
# Wiederherstellen (Datei zuvor in /data/backups ablegen)
docker compose exec -T api node src/cli/backup.js restore <datei>.dump.enc
docker compose restart api worker
```

Die Wiederherstellung ersetzt alle Anwendungsdaten und läuft in einer einzigen Transaktion. Die Job-Warteschlange (Schema `pgboss`) wird dabei bewusst nicht angefasst.

Sichere zusätzlich `.env` (insbesondere `ENCRYPTION_KEY`) und `.env-impressum` getrennt vom Backup.

### Secrets rotieren
`JWT_SECRET` ändern + `docker compose up -d` → alle Nutzer müssen sich neu anmelden. `DB_PASSWORD` zusätzlich in der Datenbank ändern (`ALTER USER`). `ENCRYPTION_KEY` nicht ändern, ohne Daten neu zu verschlüsseln.

## Sicherheit
- Passwörter mit Argon2, Login-Sperre (5 Versuche/15 min), Rate-Limits bei Passwort- und Code-Prüfungen, optionale TOTP-2FA mit Recovery-Codes (global oder pro Benutzer erzwingbar).
- Access-Token im Speicher, Refresh-Token als httpOnly-/SameSite-Strict-Cookie mit Rotation.
- Strikte CSP (keine Inline-Skripte), X-Frame-Options DENY; HSTS im vorgelagerten Proxy.
- Rollen & Rechte (`resource:action`), dazu Rechte pro Funktion in Organisationen, Audit-Log, Webhooks mit HMAC-Signatur (`X-BM-Signature`).
- DB/API nur im internen Docker-Netz.

## Bekannte Abgrenzungen
Nicht enthalten: SSO/OIDC, LDAP, Bankanbindung (FinTS/PSD2), MT940-Import, S3/SFTP-Backupziele, E-Mail-Bestätigungsfluss bei Registrierung.

## Repository
Remote ist `git@github.com:ZockerDream/RP-Management-Board.git` (Branch `develop`):

```bash
git clone -b develop git@github.com:ZockerDream/RP-Management-Board.git
```
