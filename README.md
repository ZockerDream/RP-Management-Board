# Budget Manager

Selbst gehostete Haushalts- und Teambudget-Verwaltung: Budgets, Transaktionen, Daueraufträge, Sparziele, Berichte, Teams, Kalender, Schlüssel-/Objektverwaltung, Rollen & Rechte, 2FA, verschlüsselte Backups. Konzept: [CONCEPT.md](CONCEPT.md), Technik: [TECHNICAL.md](TECHNICAL.md).

## Architektur

| Service  | Image / Build        | Aufgabe                                              |
|----------|----------------------|------------------------------------------------------|
| `api`    | Node 22 / Fastify    | **einziger Einstiegspunkt** (Port 8080): SPA und REST-API, Auth (JWT + Refresh-Cookie), RBAC, 2FA |
| `worker` | wie `api`            | Hintergrundjobs: Daueraufträge, Erinnerungen, Berichte, Backups |
| `db`     | PostgreSQL           | Datenhaltung (nur im internen Netz `backend`)        |

Nur `api` veröffentlicht **einen** Port (`HTTP_PORT`, Standard 8080, plain HTTP) und liefert sowohl die Weboberfläche als auch `/api` direkt aus. Das Repository enthält keinen Reverse-Proxy und benötigt keinen. `db` bleibt im internen Netz, der Worker hat keinen veröffentlichten Port. Ein bereits vorhandener NGINX kann optional vor den App-Port geschaltet werden; seine Konfiguration und sein Container sind nicht Teil dieses Repositories. Container laufen mit gedroppten Capabilities, `no-new-privileges` und Healthchecks; Restart-Policy `unless-stopped`.

## Installation

Voraussetzungen: Docker ≥ 24 mit Compose v2. Ein Reverse-Proxy ist optional.

```bash
git clone <repository-url>
cd budget-manager
cp .env.example .env
./scripts/gen-secrets.sh        # trägt DB_PASSWORD, JWT_SECRET, ENCRYPTION_KEY, ADMIN_PASSWORD in .env ein (oder manuell setzen)
$EDITOR .env                    # APP_URL (öffentliche URL), ADMIN_EMAIL, SMTP_* anpassen
docker compose up -d
```

Für direkten Zugriff ohne Reverse-Proxy `APP_URL` auf `http://<server-ip>:8080` setzen. Für HTTPS hinter einem bereits vorhandenen Proxy `APP_URL` auf die öffentliche `https://`-Adresse setzen; dadurch werden Refresh-Cookies als `Secure` markiert. Der erste Start baut die Images, legt das Schema an und erzeugt den Admin-Benutzer aus `ADMIN_EMAIL`/`ADMIN_PASSWORD`. Danach unter `APP_URL` anmelden und das Passwort ändern. Status: `docker compose ps` (alle Services `healthy`).

### Optionaler eigener Reverse-Proxy

Ein vorhandener NGINX kann den veröffentlichten App-Port (`HTTP_PORT`, Standard 8080) für HTTPS verwenden. Der App-Container liefert UI und API auf demselben Ursprung aus; der Proxy muss daher keine `/api`-Weiterleitung zu einem separaten API-Dienst einrichten. Für einen Proxy auf demselben Host `BIND_ADDR=127.0.0.1` setzen. Wenn der Proxy `X-Forwarded-*`-Header setzt, `TRUST_PROXY` auf dessen vertrauenswürdige IP-Adresse(n) oder CIDR(s) setzen (mehrere kommasepariert). Standardmäßig werden solche Header nicht vertraut. `TRUST_PROXY=true` nur verwenden, wenn ausschließlich der Proxy den App-Port erreichen kann.

Ohne Proxy direkt `http://<server-ip>:8080` öffnen. Bei HTTP sind Cookies nicht `Secure`; für öffentlich erreichbare Installationen HTTPS verwenden.

## Konfiguration (`.env`)

| Variable | Bedeutung |
|----------|-----------|
| `APP_URL` | öffentliche URL (Cookies, Links in Mails) |
| `BIND_ADDR`, `HTTP_PORT` | Bindeadresse und der eine veröffentlichte Port (Standard `0.0.0.0:8080`) |
| `TRUST_PROXY` | vertrauenswürdige Proxy-IP(s)/CIDR(s), standardmäßig `false` |
| `TZ` | Zeitzone |
| `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Datenbank |
| `JWT_SECRET` | Signatur der Access-Tokens (mind. 32 Zeichen) |
| `ENCRYPTION_KEY` | verschlüsselt 2FA-Secrets, SMTP-Passwort, Backups. **Nie verlieren oder ändern**, sonst sind diese Daten unlesbar |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | initialer Administrator (nur beim ersten Start) |
| `ACCESS_TOKEN_TTL_SEC`, `REFRESH_TOKEN_TTL_DAYS` | Token-Laufzeiten |
| `ALLOW_REGISTRATION` | Selbstregistrierung an/aus (Standard aus) |
| `HIBP_CHECK` | Passwörter gegen Have-I-Been-Pwned (k-Anonymität) prüfen |
| `SMTP_*` | Mailversand (Einladungen, Passwort-Reset, Benachrichtigungen); ohne SMTP werden Links in der UI angezeigt |
| `BACKUP_ENCRYPT`, `BACKUP_RETENTION_DAYS`, `BACKUP_HOUR` | nächtliches Backup |
| `MAX_UPLOAD_MB` | Belegupload-Limit |
| `HOLIDAY_COUNTRY`, `HOLIDAY_REGION` | Feiertage im Kalender |
| `LOG_LEVEL` | Log-Level |

Alle weiteren Einstellungen (Passwortregeln, Branding, Wartungsmodus) pflegt der Admin unter *Verwaltung → Einstellungen*.

## Betrieb

```bash
docker compose logs -f api worker        # Logs
docker compose pull && docker compose up -d --build   # Update (Migrationen laufen automatisch)
docker compose down                      # Stoppen (Daten bleiben in Volumes)
```

Persistente Daten liegen in den Docker-Volumes `db_data`, `uploads`, `backups`.

### Backup & Restore

Backups (pg_dump, AES-256-GCM-verschlüsselt) laufen nächtlich und manuell über *Verwaltung → System*. Aufbewahrung: `BACKUP_RETENTION_DAYS`.

```bash
# Backup-Datei aus dem Volume kopieren
docker compose exec -T api sh -c 'cat /data/backups/<datei>.dump.enc' > backup.dump.enc
# Wiederherstellen (Datei zuvor in /data/backups ablegen)
docker compose exec -T api node src/cli/backup.js restore <datei>.dump.enc
```

Sichere zusätzlich `.env` (insbesondere `ENCRYPTION_KEY`) getrennt vom Backup.

### Secrets rotieren
`JWT_SECRET` ändern + `docker compose up -d` → alle Nutzer müssen sich neu anmelden. `DB_PASSWORD` zusätzlich in der Datenbank ändern (`ALTER USER`). `ENCRYPTION_KEY` nicht ändern, ohne Daten neu zu verschlüsseln.

## Sicherheit
- Passwörter mit Argon2, Login-Sperre (5 Versuche/15 min), Rate-Limits, optionale TOTP-2FA mit Recovery-Codes (per Rolle erzwingbar).
- Access-Token im Speicher, Refresh-Token als httpOnly-/SameSite-Strict-Cookie mit Rotation.
- Strikte CSP (keine Inline-Skripte), X-Frame-Options DENY; HSTS im vorgelagerten Proxy.
- Rollen & Rechte (`resource:action`), Audit-Log, Webhooks mit HMAC-Signatur (`X-BM-Signature`).
- DB/API nur im internen Docker-Netz.

## Bekannte Abgrenzungen
Nicht enthalten: SSO/OIDC, LDAP, Bankanbindung (FinTS/PSD2), MT940-Import, S3/SFTP-Backupziele, E-Mail-Bestätigungsfluss bei Registrierung.

## Repository
Remote ist `git@github.com:ZockerDream/budget-manager.git` (Branch `develop`):

```bash
git clone -b develop git@github.com:ZockerDream/budget-manager.git
```
