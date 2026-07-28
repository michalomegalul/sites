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
#
# Pick a lock path this user can actually open: a lock file left behind by a
# root-run deploy is not writable by the runner, and `exec 9>` on it would kill
# the script with a bare "Permission denied" that names nothing.
LOCK=/var/lock/sites-deploy.lock
if [ -e "$LOCK" ]; then
  [ -w "$LOCK" ] || LOCK="/tmp/sites-deploy.$(id -u).lock"
else
  [ -w "$(dirname "$LOCK")" ] || LOCK="/tmp/sites-deploy.$(id -u).lock"
fi
exec 9>"$LOCK"
flock 9

[ -d "$DIR" ] || { echo "no such site: $SITE"; exit 1; }

# Preflight. Every deploy writes into .git. If anything in there belongs to
# another user — a deploy once run under sudo, or a clone made as root — git
# dies inside fetch with "insufficient permission for adding an object to
# repository database .git/objects", which names neither the user nor the file.
# Say it plainly instead, and point at the fix.
ME=$(id -un)
FOREIGN=$(find "$ROOT/.git" ! -user "$ME" -print -quit 2>/dev/null || true)
if [ -n "$FOREIGN" ]; then
  cat >&2 <<EOF
deploy: $ROOT/.git contains files owned by another user, so git cannot write.
        first offender: $FOREIGN
        this deploy runs as: $ME
        fix on the host, as root:
            chown -R $ME:$ME $ROOT
EOF
  exit 1
fi

cd "$ROOT"
git fetch --prune origin master
git reset --hard origin/master

API="$DIR/api"
if [ -f "$API/requirements.txt" ]; then
  [ -d "$API/venv" ] || python3 -m venv "$API/venv"
  "$API/venv/bin/pip" install -q --upgrade -r "$API/requirements.txt"
fi

# Migrations before the restart, so the schema is never behind the code. The
# runner records what it applied and skips the rest, so this is a no-op once
# everything is up to date.
if [ -f "$DIR/db/migrate.py" ] && [ -x "$API/venv/bin/python" ]; then
  "$API/venv/bin/python" "$DIR/db/migrate.py"
fi

if systemctl list-unit-files --no-legend | grep -q "^${SITE}-api\.service"; then
  sudo systemctl restart "${SITE}-api"
  sleep 2
  systemctl is-active --quiet "${SITE}-api" || { journalctl -u "${SITE}-api" -n 40 --no-pager; exit 1; }
fi

sudo nginx -t && sudo systemctl reload nginx
echo "deployed: $SITE @ $(git rev-parse --short HEAD)"
