#!/usr/bin/env sh
# Füllt leere Secrets in .env mit Zufallswerten (legt .env aus .env.example an, falls nötig).
set -eu
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env
chmod 600 .env

rand() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }

fill() {
  key="$1"; len="$2"
  if grep -Eq "^${key}=$" .env; then
    val="$(rand "$len")"
    sed -i "s|^${key}=\$|${key}=${val}|" .env
    echo "gesetzt: ${key}"
  fi
}

fill DB_PASSWORD 32
fill JWT_SECRET 64
fill ENCRYPTION_KEY 64
if grep -Eq '^ADMIN_PASSWORD=$' .env; then
  pw="$(rand 16)Aa1!"
  sed -i "s|^ADMIN_PASSWORD=\$|ADMIN_PASSWORD=${pw}|" .env
  echo "gesetzt: ADMIN_PASSWORD (siehe .env)"
fi
echo "Fertig. Passe APP_URL und ADMIN_EMAIL in .env an."

# Der Compose-Projektname ist fest (budget-manager): Eine neue Installation auf demselben Host nutzt die alte Datenbank,
# und die behält ihre alten Zugangsdaten.
if docker volume inspect budget-manager_db_data >/dev/null 2>&1; then
  echo ""
  echo "Achtung: Auf diesem Host gibt es schon eine Datenbank dieser App (Volume budget-manager_db_data)."
  echo "Sie gilt auch für dieses Verzeichnis und behält ihre alten DB_USER, DB_PASSWORD und DB_NAME;"
  echo "mit anderen Werten in .env startet die App nicht. Entweder die alten Werte eintragen oder, nur wenn"
  echo "die alten Daten weg dürfen: docker compose down -v (löscht Datenbank, Uploads und Backups)."
fi
