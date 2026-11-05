# End-to-End-Tests

Testen die laufende App von außen gegen einen **Wegwerf-Stack**. Nie gegen die produktive Instanz ausführen: Die Skripte legen Daten an und löschen sie.

## Vorbereitung

Eine Env-Datei außerhalb des Repositories anlegen, z. B. `/tmp/bm-e2e/test.env`. Benutzer und Port sind in den Skripten fest eingetragen:

```
APP_URL=http://localhost:18088
BIND_ADDR=127.0.0.1
HTTP_PORT=18088
APP_VERSION=e2e
TZ=Europe/Berlin
DB_NAME=budget
DB_USER=budget
DB_PASSWORD=<openssl rand -hex 16>
JWT_SECRET=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>
ADMIN_EMAIL=admin@e2e.test
ADMIN_PASSWORD=E2e-Admin-Passw0rd!x
ADMIN_NAME=E2E Admin
```

`APP_VERSION=e2e` schützt das Image-Tag der produktiven Instanz; `-p bm-e2e` trennt Container und Volumes.

## Ablauf

```bash
docker compose -p bm-e2e --env-file /tmp/bm-e2e/test.env up -d --build --wait

node tests/e2e/api.mjs                    # zuerst: legt die Testdaten an
docker restart bm-e2e-api-1               # setzt das Rate-Limit zurück (300/min pro IP)
node tests/e2e/auth.mjs

# Browser-Tests laufen im Playwright-Container; Screenshots landen im Arbeitsverzeichnis
mkdir -p /tmp/bm-e2e/work && cp tests/e2e/*.mjs /tmp/bm-e2e/work/ && mkdir -p /tmp/bm-e2e/work/shots
docker run --rm --network host -v /tmp/bm-e2e/work:/work -w /work mcr.microsoft.com/playwright:v1.49.1-noble \
  sh -c 'npm i --silent --no-audit --no-fund playwright@1.49.1 && node browser.mjs'
docker run --rm --network host -v /tmp/bm-e2e/work:/work -w /work mcr.microsoft.com/playwright:v1.49.1-noble node crawl.mjs

docker compose -p bm-e2e --env-file /tmp/bm-e2e/test.env down -v   # aufräumen
```

Zwischen den Stufen die API neu starten. `browser.mjs` und `crawl.mjs` setzen die Daten aus `api.mjs` voraus; `crawl.mjs` verändert sie stark, also für einen weiteren Lauf den Stack mit `down -v` neu aufsetzen.

## Ergebnisse von crawl.mjs

Unter `crawl/` entstehen Screenshots, `findings.txt` und je Rolle eine Liste aller Aktionen.

| Art | Bedeutung |
|---|---|
| `SERVER-5XX`, `JS-FEHLER`, `KONSOLE`, `TEXTFEHLER`, `SEITENFEHLER`, `LAYOUT` | Immer ein echter Fehler |
| `FORMULAR-FEHLER`, `API-4XX`, `FEHLERMELDUNG` | Prüfen: oft korrekte Ablehnung automatisch ausgefüllter Testwerte |
| `OHNE-WIRKUNG`, `NICHT-KLICKBAR` | Prüfen: oft bereits gewählte oder deaktivierte Elemente oder neu gerenderter Kalender |
| `ABGEMELDET`, `ROBOTER-ABBRUCH` | Prüfen: Der Roboter füllt auch eigene Benutzerdaten aus |

Der Roboter füllt keine echten 2FA-Codes aus und klickt keine Kamera- oder OAuth-Abläufe zu Ende. Google, Microsoft, SMTP-Versand und GitHub-Tickets brauchen echte Zugangsdaten und sind hier nicht abgedeckt.
