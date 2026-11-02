#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "Update abgebrochen: Arbeitsverzeichnis enthält lokale Änderungen." >&2
  echo "Bitte Änderungen sichern oder committen und das Update erneut starten." >&2
  exit 1
fi

git pull --ff-only
docker compose up -d --build --wait --wait-timeout 180

echo "Update abgeschlossen. Datenbankmigrationen wurden beim API-Start ausgeführt."
