#!/usr/bin/env sh
# Legt das GitLab-Projekt an (falls nötig), setzt den Remote und pusht main.
# Authentifizierung ohne gespeicherte Zugangsdaten:
#   a) glab (empfohlen):  glab auth login --hostname gitlab.zd-d.com
#   b) Token nur für diesen Aufruf:  GITLAB_TOKEN=... ./scripts/gitlab-publish.sh
# Optional: GITLAB_NAMESPACE=<gruppe-oder-user>  (Standard: dein Benutzer)
set -eu
cd "$(dirname "$0")/.."

HOST="${GITLAB_HOST:-gitlab.zd-d.com}"
NAME="budget-manager"
DESC="Selbst gehostete Budget-, Team- und Objektverwaltung mit Docker Compose (Fastify, PostgreSQL, SPA, RBAC, 2FA, Backups)"

[ -d .git ] || { echo "Kein Git-Repository: erst 'git init -b main && git add . && git commit' ausführen." >&2; exit 1; }
if git ls-files --error-unmatch .env >/dev/null 2>&1; then echo ".env ist getrackt – Abbruch." >&2; exit 1; fi

if git remote get-url origin >/dev/null 2>&1; then
  echo "Remote origin existiert bereits: $(git remote get-url origin)"
elif command -v glab >/dev/null 2>&1 && [ -z "${GITLAB_TOKEN:-}" ]; then
  GLAB_HOST="$HOST" glab repo create ${GITLAB_NAMESPACE:+"$GITLAB_NAMESPACE/"}"$NAME" --private --description "$DESC" --defaultBranch main --skipGitInit 2>/dev/null \
    || GLAB_HOST="$HOST" glab repo create ${GITLAB_NAMESPACE:+"$GITLAB_NAMESPACE/"}"$NAME" --private --description "$DESC"
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "git@$HOST:${GITLAB_NAMESPACE:-$(GLAB_HOST="$HOST" glab api user --jq .username)}/$NAME.git"
elif [ -n "${GITLAB_TOKEN:-}" ]; then
  ns=""
  if [ -n "${GITLAB_NAMESPACE:-}" ]; then
    ns="$(curl -fsS -H "PRIVATE-TOKEN: $GITLAB_TOKEN" "https://$HOST/api/v4/namespaces?search=$GITLAB_NAMESPACE" | sed -n 's/.*"id":\([0-9]*\),.*/\1/p' | head -1)"
  fi
  resp="$(curl -fsS -X POST -H "PRIVATE-TOKEN: $GITLAB_TOKEN" \
    --data-urlencode "name=$NAME" --data-urlencode "path=$NAME" --data-urlencode "description=$DESC" \
    --data-urlencode "visibility=private" --data-urlencode "initialize_with_readme=false" \
    ${ns:+--data-urlencode "namespace_id=$ns"} "https://$HOST/api/v4/projects")"
  url="$(printf '%s' "$resp" | sed -n 's/.*"ssh_url_to_repo":"\([^"]*\)".*/\1/p')"
  [ -n "$url" ] || { echo "Projekt konnte nicht angelegt werden: $resp" >&2; exit 1; }
  git remote add origin "$url"
else
  echo "Weder glab noch GITLAB_TOKEN vorhanden. Siehe Kopf dieses Skripts." >&2
  exit 1
fi

git push -u origin main
echo "Fertig: $(git remote get-url origin)"
