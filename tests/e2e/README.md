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
docker restart bm-e2e-api-1               # setzt das Login-Limit zurück (10/min pro IP)
node tests/e2e/auth.mjs

# Browser-Tests laufen im Playwright-Container; Screenshots landen im Arbeitsverzeichnis
mkdir -p /tmp/bm-e2e/work && cp tests/e2e/*.mjs /tmp/bm-e2e/work/ && mkdir -p /tmp/bm-e2e/work/shots
docker run --rm --network host -v /tmp/bm-e2e/work:/work -w /work mcr.microsoft.com/playwright:v1.49.1-noble \
  sh -c 'npm i --silent --no-audit --no-fund playwright@1.49.1 && node browser.mjs'
docker run --rm --network host -v /tmp/bm-e2e/work:/work -w /work mcr.microsoft.com/playwright:v1.49.1-noble node crawl.mjs

docker compose -p bm-e2e --env-file /tmp/bm-e2e/test.env down -v   # aufräumen
```

`api.mjs` startet die Jobs `payroll.run`, `todos.remind` und `reminders` per `docker exec` im Worker-Container und setzt für das Gehaltsbeispiel ein Startdatum und für die Nachtschicht die Startzeit eines Timers direkt in der Datenbank, braucht also Docker auf dem Host. Der Gehaltslauf bucht den Vortag erst ab 03:45 Uhr; die Prüfung „wartet auf das Ausstempeln“ läuft deshalb nur zwischen 03:45 und 23:00 Uhr (Europe/Berlin). Mit `MAILPIT=http://localhost:18025` prüft es zusätzlich den Mailversand über einen Mailpit-Container, sonst entfällt dieser Teil. Zwischen den Stufen die API neu starten. `browser.mjs` und `crawl.mjs` setzen die Daten aus `api.mjs` voraus; `crawl.mjs` verändert sie stark, also für einen weiteren Lauf den Stack mit `down -v` neu aufsetzen.

## Zweiter Stack neben einem benutzten Test-Stack

Testet jemand gerade von Hand auf 18088, nicht denselben Stack nehmen: `down -v` löscht dessen Daten, und `crawl.mjs` verändert sie. Stattdessen eine Kopie der Env-Datei mit anderem `HTTP_PORT`, `APP_URL` und `APP_VERSION` anlegen und die Skripte darauf zeigen lassen:

```bash
docker compose -p bm-check --env-file /tmp/bm-e2e/check.env up -d --build --wait
BASE=http://localhost:18089 E2E_PROJECT=bm-check node tests/e2e/api.mjs
docker restart bm-check-api-1
BASE=http://localhost:18089 E2E_PROJECT=bm-check node tests/e2e/auth.mjs
# Im Playwright-Container mit -e BASE=http://localhost:18089
```

Ein Update des benutzten Stacks ohne Datenverlust: derselbe `up -d --build --wait` ohne `down -v`.

## Update im selben Browser (upgrade.mjs)

Vor jedem Release ab dem zuletzt ausgerollten Stand ausführen. Der Test findet, was frische Testläufe nie sehen: neue Navigation auf altem Code aus dem Browser-Cache.

```bash
git worktree add /tmp/bm-e2e/old <zuletzt-ausgerollter-commit>
docker compose -p bm-e2e --env-file /tmp/bm-e2e/test.env -f /tmp/bm-e2e/old/docker-compose.yml up -d --build --wait

# im Playwright-Container wie oben, mit /tmp/bm-e2e/work als /work
node upgrade.mjs before                     # alte Version benutzen, alles landet im Cache

docker compose -p bm-e2e --env-file /tmp/bm-e2e/test.env up -d --build --wait   # derselbe Befehl wie in update.sh

node upgrade.mjs after                      # normal neu laden, nichts löschen
```

`after` prüft alle neuen Seiten samt Titel und endet bei Fehlern mit Exit-Code 1. Für einen weiteren Lauf ein neues Browserprofil angeben: `node upgrade.mjs before /work/shots /work/profil2`.

## Ergebnisse von crawl.mjs

Unter `crawl/` entstehen Screenshots, `findings.txt` und je Rolle eine Liste aller Aktionen.

| Art | Bedeutung |
|---|---|
| `SERVER-5XX`, `JS-FEHLER`, `KONSOLE`, `TEXTFEHLER`, `SEITENFEHLER`, `LAYOUT` | Immer ein echter Fehler |
| `FORMULAR-FEHLER`, `API-4XX`, `FEHLERMELDUNG` | Prüfen: oft korrekte Ablehnung automatisch ausgefüllter Testwerte |
| `OHNE-WIRKUNG`, `NICHT-KLICKBAR` | Prüfen: oft bereits gewählte oder deaktivierte Elemente oder neu gerenderter Kalender |
| `ABGEMELDET`, `ROBOTER-ABBRUCH` | Prüfen: Der Roboter füllt auch eigene Benutzerdaten aus |

Der Roboter füllt keine echten 2FA-Codes aus und klickt keine Kamera- oder OAuth-Abläufe zu Ende. Google, Microsoft, SMTP-Versand und GitHub-Tickets brauchen echte Zugangsdaten und sind hier nicht abgedeckt.
