#!/usr/bin/env bash
#
# One-time setup for quiz.dobsinsky.dev on the cloudflared LXC.
#
# Run as root on the host:
#     bash /opt/sites/deploy/bootstrap-quiz.sh
#
# Safe to re-run: every step checks before it acts, and nothing here touches
# collected responses. It does NOT run the SQL migrations -- those need the
# Postgres password and are printed at the end for you to paste.
#
# What it fixes, in order:
#   1. ownership of the checkout   (the "insufficient permission for adding an
#                                   object" failure the GitHub runner hit)
#   2. the python venv
#   3. .env, at the one mode python-dotenv tolerates
#   4. the systemd unit
#   5. the nginx site, as a symlink
set -euo pipefail

ROOT=/opt/sites
SITE=quiz
RUNNER=${RUNNER_USER:-ghrunner}
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok()  { printf '   ok: %s\n' "$*"; }
warn(){ printf '   !! %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "run this as root"; exit 1; }
[ -d "$ROOT/$SITE" ] || { echo "no $ROOT/$SITE -- is the repo cloned to $ROOT?"; exit 1; }

# ---------------------------------------------------------------- 1. ownership
say "checkout ownership"
if ! id -u "$RUNNER" >/dev/null 2>&1; then
  warn "user '$RUNNER' does not exist; set RUNNER_USER=<name> and re-run"
  exit 1
fi
FOREIGN=$(find "$ROOT" ! -user "$RUNNER" -print -quit 2>/dev/null || true)
if [ -n "$FOREIGN" ]; then
  warn "found files not owned by $RUNNER (e.g. $FOREIGN)"
  # This is why the runner's `git fetch` died: git could not add objects to
  # .git/objects because an earlier root-run command left root-owned files there.
  chown -R "$RUNNER:$RUNNER" "$ROOT"
  ok "chowned $ROOT to $RUNNER"
else
  ok "already owned by $RUNNER"
fi
# git refuses to operate on a repo owned by someone else; make it explicit.
sudo -u "$RUNNER" git -C "$ROOT" config --local --get safe.directory >/dev/null 2>&1 \
  || git config --system --add safe.directory "$ROOT" 2>/dev/null || true

# --------------------------------------------------------------------- 2. venv
say "python venv"
API="$ROOT/$SITE/api"
if [ ! -x "$API/venv/bin/python" ]; then
  # Venvs are not relocatable -- venv/bin/* hardcode absolute paths. If the
  # checkout ever moves, delete the venv and let this rebuild it.
  rm -rf "$API/venv"
  sudo -u "$RUNNER" python3 -m venv "$API/venv"
  ok "created"
else
  ok "present"
fi
sudo -u "$RUNNER" "$API/venv/bin/pip" install -q --upgrade -r "$API/requirements.txt"
ok "requirements installed"

# --------------------------------------------------------------------- 3. .env
say ".env"
if [ ! -f "$API/.env" ]; then
  cp "$API/.env.example" "$API/.env"
  warn "created from .env.example -- YOU MUST EDIT DATABASE_URL:"
  warn "    nano $API/.env"
  NEEDS_ENV=1
else
  ok "exists"
fi
# 640 root:www-data, not 600: systemd reads it as root, but the app also calls
# load_dotenv() as www-data, and python-dotenv raises on an unreadable file
# rather than skipping it.
chown root:www-data "$API/.env"
chmod 640 "$API/.env"
ok "mode 640 root:www-data"

# ------------------------------------------------------------------ 4. systemd
say "systemd unit"
if ! cmp -s "$API/quiz-api.service" /etc/systemd/system/quiz-api.service; then
  cp "$API/quiz-api.service" /etc/systemd/system/quiz-api.service
  systemctl daemon-reload
  ok "installed/updated"
else
  ok "up to date"
fi
systemctl enable quiz-api >/dev/null 2>&1 || true

# -------------------------------------------------------------------- 5. nginx
say "nginx site"
AVAIL=/etc/nginx/sites-available/quiz
ENABLED=/etc/nginx/sites-enabled/quiz
cp "$ROOT/$SITE/nginx.conf" "$AVAIL"
ok "copied to $AVAIL"
if [ -e "$ENABLED" ] && [ ! -L "$ENABLED" ]; then
  # A regular file here silently diverges from sites-available and edits go
  # nowhere. Replace it with the symlink it was supposed to be.
  warn "$ENABLED was a regular file, not a symlink -- replacing"
  rm -f "$ENABLED"
fi
[ -L "$ENABLED" ] || ln -s "$AVAIL" "$ENABLED"
ok "symlinked"

LAN=$(ip -4 -o addr show scope global | awk '{print $4}' | cut -d/ -f1 | head -1)
if ! grep -q "listen ${LAN}:80;" "$AVAIL"; then
  warn "internal block does not listen on this host's IP ($LAN)."
  warn "edit the 'listen' line in $AVAIL if you want the LAN dashboard."
fi

if nginx -t 2>/dev/null; then
  systemctl reload nginx
  ok "config valid, nginx reloaded"
else
  warn "nginx -t FAILED -- not reloading. Output:"
  nginx -t || true
  exit 1
fi

# ------------------------------------------------------------------- 6. start
say "service"
if [ "${NEEDS_ENV:-0}" = "1" ]; then
  warn "not starting quiz-api yet -- DATABASE_URL is still the placeholder."
else
  systemctl restart quiz-api
  sleep 2
  if systemctl is-active --quiet quiz-api; then
    ok "quiz-api running"
    printf '   health: %s\n' "$(curl -fsS --max-time 5 localhost:5051/api/health || echo 'NO RESPONSE')"
  else
    warn "quiz-api failed to start:"
    journalctl -u quiz-api -n 30 --no-pager
    exit 1
  fi
fi

cat <<'EOF'

== remaining, by hand ==

1. Database (needs the Postgres password, so it is not automated here):

     psql -h 192.168.4.32 -U postgres -c "CREATE DATABASE quiz;"
     psql -h 192.168.4.32 -U postgres -c "CREATE USER quiz PASSWORD 'change-me';"
     for f in /opt/sites/quiz/db/0*.sql; do
       psql -h 192.168.4.32 -U postgres -d quiz -v ON_ERROR_STOP=1 -f "$f" || break
     done
     psql -h 192.168.4.32 -U postgres -d quiz -c \
       "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO quiz;
        GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO quiz;"

   003 refuses to run if responses already exist, so the loop is safe to repeat.

2. Put that connection string in /opt/sites/quiz/api/.env, then:

     systemctl restart quiz-api && curl -s localhost:5051/api/health

3. Cloudflare Tunnel: ingress for quiz.dobsinsky.dev -> http://127.0.0.1:8480

Then: https://quiz.dobsinsky.dev/cs/s/endo-2026
EOF
