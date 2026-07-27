#!/usr/bin/env bash
set -euo pipefail

SITE="${1:?usage: deploy.sh <site-slug>}"
ROOT=/opt/sites
DIR="$ROOT/$SITE"

# Both sites share this one checkout and every deploy runs `git reset --hard`
# on it. A commit touching portfolio/ and quiz/ fires both workflows, and their
# concurrency groups are per-workflow so they cannot see each other — with more
# than one self-hosted runner they would reset the tree under each other. Wait
# our turn instead.
exec 9>/var/lock/sites-deploy.lock
flock 9

[ -d "$DIR" ] || { echo "no such site: $SITE"; exit 1; }

cd "$ROOT"
if [ ! -w "$ROOT/.git/objects" ]; then
  echo "repairing $ROOT/.git ownership for $(id -un)"
  sudo chown -R "$(id -un):$(id -gn)" "$ROOT/.git"
fi
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
