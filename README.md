# Budget Manager

Selbst gehostete Haushalts- und Teambudget-Verwaltung: Budgets, Transaktionen, Daueraufträge, Sparziele, Berichte, Teams, Kalender, Schlüssel-/Objektverwaltung, Rollen & Rechte, 2FA, verschlüsselte Backups. Konzept: [CONCEPT.md](CONCEPT.md), Technik: [TECHNICAL.md](TECHNICAL.md).

## Architektur

| Service  | Image / Build        | Aufgabe                                              |
|----------|----------------------|------------------------------------------------------|
| `web`    | nginx-unprivileged   | **einziger Einstiegspunkt** (Port 8080): statische SPA, Security-Header, `/api` → api |
| `api`    | Node 22 / Fastify    | REST-API, Auth (JWT + Refresh-Cookie), RBAC, 2FA     |
| `worker` | wie `api`            | Hintergrundjobs: Daueraufträge, Erinnerungen, Berichte, Backups |
| `db`     | PostgreSQL           | Datenhaltung (nur im internen Netz `backend`)        |

Nur `web` veröffentlicht **einen** Port (`HTTP_PORT`, Standard 8080, plain HTTP). TLS, HSTS und Domain übernimmt dein vorgelagerter NGINX-Proxy. DB und API sind nicht von außen erreichbar. Container laufen mit gedroppten Capabilities, `no-new-privileges` und Healthchecks; Restart-Policy `unless-stopped`.

## Installation

Voraussetzungen: Docker ≥ 24 mit Compose v2 und ein Reverse-Proxy (z. B. NGINX) für TLS.

```bash
git clone <repository-url>
cd budget-manager
cp .env.example .env
./scripts/gen-secrets.sh        # trägt DB_PASSWORD, JWT_SECRET, ENCRYPTION_KEY, ADMIN_PASSWORD in .env ein (oder manuell setzen)
$EDITOR .env                    # APP_URL (öffentliche https-URL), ADMIN_EMAIL, SMTP_* anpassen
docker compose up -d
```

Der erste Start baut die Images, legt das Schema an und erzeugt den Admin-Benutzer aus `ADMIN_EMAIL`/`ADMIN_PASSWORD`. Danach unter `APP_URL` anmelden und das Passwort ändern. Status: `docker compose ps` (alle Services `healthy`).

### NGINX-Proxy

`APP_URL` muss exakt die öffentliche Adresse sein (bei `https://` werden Cookies als `Secure` gesetzt). Beispiel-Server-Block:

```nginx
server {
  listen 443 ssl http2;
  server_name budget.example.com;
  # ssl_certificate ... ;
  client_max_body_size 25m;

  location / {
    proxy_pass http://127.0.0.1:8080;      # oder Containername/Host:HTTP_PORT
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Läuft der Proxy auf demselben Host, setze `BIND_ADDR=127.0.0.1`, damit der Port nicht von außen erreichbar ist. HSTS im Proxy-Server-Block aktivieren (`add_header Strict-Transport-Security "max-age=31536000" always;`).

### Betrieb ohne Proxy
Der Stack enthält keinen Proxy und läuft auch ohne: `APP_URL=http://<server-ip>:8080` setzen, `docker compose up -d`, dann direkt `http://<server-ip>:8080` öffnen (Cookies sind bei `http://` nicht `Secure`). Für Produktion im Internet TLS über einen vorgelagerten Proxy empfohlen.

## Konfiguration (`.env`)

| Variable | Bedeutung |
|----------|-----------|
| `APP_URL` | öffentliche URL (Cookies, Links in Mails) |
| `BIND_ADDR`, `HTTP_PORT` | Bindeadresse und der eine veröffentlichte Port (Standard `0.0.0.0:8080`) |
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

## GitLab veröffentlichen
Remote ist `https://gitlab.zd-c.com/timpner/budget-manager.git`. Push (legt das private Projekt beim ersten Mal an; Passwort oder Access Token mit `write_repository`):

```bash
git push -u origin main
```
