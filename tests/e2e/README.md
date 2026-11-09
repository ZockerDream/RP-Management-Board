# End-to-End-Tests

Testen die laufende App von außen gegen einen **Wegwerf-Stack**. Nie gegen die produktive Instanz ausführen: Die Skripte legen Daten an und löschen sie.

## Vorbereitung

Eine Env-Datei außerhalb des Repositories anlegen, z. B. `/tmp/bm-e2e/test.env`. Benutzer und Port sind in den Skripten fest eingetragen:

```
APP_URL=http://localhost:18088
BIND_ADDR=127.0.0.1
HTTP_PORT=18088
IMAGE_TAG=e2e
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

`IMAGE_TAG=e2e` schützt das Image der produktiven Instanz (ohne heißt es wie die Code-Version, z. B. `budget-manager-api:1.1.1`); `-p bm-e2e` trennt Container und Volumes.

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

`api.mjs` startet die Jobs `payroll.run`, `todos.remind` und `reminders` per `docker exec` im Worker-Container und setzt für das Gehaltsbeispiel ein Startdatum und für die Nachtschicht die Startzeit eines Timers direkt in der Datenbank, braucht also Docker auf dem Host. Der Gehaltslauf bucht den Vortag erst ab 03:45 Uhr; die Prüfung „wartet auf das Ausstempeln“ läuft deshalb nur zwischen 03:45 und 23:00 Uhr (Europe/Berlin). Mit `MAILPIT=http://localhost:18025` prüft es zusätzlich den Mailversand über einen Mailpit-Container, sonst entfällt dieser Teil. Zwischen den Stufen die API neu starten. Organisationen prüft `api.mjs` mit Rängen, Gruppen, persönlichen Rechten, Hierarchie, Aktenarten, beschränkten Akten, Schulungs-Teilnahme und Doku-Kategorien; `browser.mjs` legt Rang und Gruppe über die Oberfläche an und setzt ein Recht. Zwischen Mitternacht und 1 Uhr (Sommer 2 Uhr) schlagen Prüfungen mit „heute“ fehl, weil der Server dann noch das UTC-Datum nimmt; in diesem Zeitfenster nicht testen. `browser.mjs` und `crawl.mjs` setzen die Daten aus `api.mjs` voraus; `crawl.mjs` verändert sie stark, also für einen weiteren Lauf den Stack mit `down -v` neu aufsetzen.

## Zweiter Stack neben einem benutzten Test-Stack

Testet jemand gerade von Hand auf 18088, nicht denselben Stack nehmen: `down -v` löscht dessen Daten, und `crawl.mjs` verändert sie. Stattdessen eine Kopie der Env-Datei mit anderem `HTTP_PORT`, `APP_URL` und `IMAGE_TAG` anlegen und die Skripte darauf zeigen lassen:

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

Unter `crawl/` entstehen `findings.txt`, je Durchlauf eine Liste aller Aktionen und Bildschirmfotos: je Seite und Tab im sicheren Durchlauf und zu jeder Aktion, die etwas Neues gefunden hat (`…-fund-….png`). Am Ende jedes Durchlaufs steht, wie viele Aktionen er in welcher Zeit geschafft hat.

Ein kompletter Lauf (fünf Durchläufe, rund 1.300 Aktionen) dauert etwa 7 Minuten; vor der Überarbeitung waren es weit über eine Stunde. Der Roboter wartet nicht mit festen Pausen, sondern bis keine Anfrage an die App mehr offen ist; er lädt eine Seite per `hashchange` neu, füllt Formulare in einem Schritt und überspringt deaktivierte Knöpfe (in der Aktionsliste als „deaktiviert“). Jeder Durchlauf verteilt die Seiten auf mehrere Browser mit eigener Anmeldung. Die Rollen laufen weiter nacheinander, damit sich etwa die Rangänderungen von Alice nicht mit Carols Durchlauf überschneiden.

| Variable | Wirkung |
|---|---|
| `CRAWL_WORKERS=3` | Browser je Durchlauf; `1` ergibt die alte Reihenfolge Seite für Seite |
| `CRAWL_ROLES=carol,alice` | Nur diese Rollen, je sicher und destruktiv |
| `CRAWL_SHOTS=pages` | `all` zusätzlich jeder Dialog vor und nach dem Absenden, `none` keine Bildschirmfotos |
| `ONLY_ADMIN=1` | Nur Admin, sicher und destruktiv |

Mehrere Browser derselben Rolle melden sich jeweils neu an (Login-Limit 10 pro Minute und IP); vor dem Lauf die API neu starten. Ändert ein Browser das Passwort oder setzt 2FA zurück, beendet das die Sitzungen der anderen: `ABGEMELDET` und `401` an beliebiger Stelle sind dann normal, der Roboter meldet sich neu an. Mit `CRAWL_WORKERS=1` lässt sich so ein Fund eindeutig einer Aktion zuordnen. Jede Aktion steht mit ihrer Dauer in der Aktionsliste, die langsamsten Seiten am Ende jedes Durchlaufs.

| Art | Bedeutung |
|---|---|
| `SERVER-5XX`, `JS-FEHLER`, `KONSOLE`, `TEXTFEHLER`, `SEITENFEHLER`, `LAYOUT` | Immer ein echter Fehler |
| `FORMULAR-FEHLER`, `API-4XX`, `FEHLERMELDUNG` | Prüfen: oft korrekte Ablehnung automatisch ausgefüllter Testwerte |
| `OHNE-WIRKUNG`, `NICHT-KLICKBAR` | Prüfen: oft bereits gewählte Elemente oder neu gerenderter Kalender; deaktivierte Knöpfe meldet der Roboter nicht mehr |
| `ABGEMELDET`, `ROBOTER-ABBRUCH` | Prüfen: Der Roboter füllt auch eigene Benutzerdaten aus |

Der Roboter füllt keine echten 2FA-Codes aus und klickt keine Kamera- oder OAuth-Abläufe zu Ende. Google, Microsoft, SMTP-Versand und GitHub-Tickets brauchen echte Zugangsdaten und sind hier nicht abgedeckt.
