#!/usr/bin/env bash
set -euo pipefail

SITE="${1:?usage: deploy.sh <site-slug>}"
ROOT=/opt/sites
DIR="$ROOT/$SITE"

[ -d "$DIR" ] || { echo "no such site: $SITE"; exit 1; }

cd "$ROOT"
git fetch --prune origin master
git reset --hard origin/master

API="$DIR/api"
if [ -f "$API/requirements.txt" ]; then
  [ -d "$API/venv" ] || python3 -m venv "$API/venv"
  "$API/venv/bin/pip" install -q --upgrade -r "$API/requirements.txt"
fi

if systemctl list-unit-files --no-legend | grep -q "^${SITE}-api\.service"; then
  sudo systemctl restart "${SITE}-api"
  sleep 2
  systemctl is-active --quiet "${SITE}-api" || { journalctl -u "${SITE}-api" -n 40 --no-pager; exit 1; }
fi

sudo nginx -t && sudo systemctl reload nginx
echo "deployed: $SITE @ $(git rev-parse --short HEAD)"
