# dobsinsky.dev portfolio

Static site plus a small Flask API.
The public side is the CV, projects and contact.
The trusted side (LAN or Tailscale only) adds Proxmox stats, service links and the visitor log.

## Layout

```
site/        static frontend, served by nginx
api/         Flask API, gunicorn on 127.0.0.1:5050
nginx.conf   the trust setup, read the comments before changing it
```

## Deploy

A push to `master` that touches `portfolio/**` runs `/opt/sites/deploy/deploy.sh portfolio` on the self-hosted runner.
The script only pulls, rebuilds the venv, restarts `portfolio-api` if the unit is already installed and reloads nginx.
It does not install units, write `.env` or link nginx configs, so a fresh LXC needs a one-time setup:

```bash
apt install -y nginx python3-venv

cd /opt/sites/portfolio/api
python3 -m venv venv && venv/bin/pip install -r requirements.txt
cp .env.example .env && nano .env        # PVE token, trusted nets
chown root:www-data .env && chmod 640 .env

cp portfolio-api.service /etc/systemd/system/
systemctl enable --now portfolio-api

cp /opt/sites/portfolio/nginx.conf /etc/nginx/sites-available/portfolio
ln -s /etc/nginx/sites-available/portfolio /etc/nginx/sites-enabled/
nano /etc/nginx/sites-enabled/portfolio   # set the LAN IP of this container
nginx -t && systemctl reload nginx
```

Cloudflare Tunnel: point the `dobsinsky.dev` ingress at `http://127.0.0.1:8480`.

The CrowdSec counter in the status bar needs a sudoers rule.
It is described in the root `README.md`.
Without it the counter just stays hidden, or set `CROWDSEC=0` in `.env`.

## Proxmox token

Read-only, so a leaked token can't do anything:

```bash
pveum user add portfolio@pam
pveum acl modify / --users portfolio@pam --roles PVEAuditor
pveum user token add portfolio@pam readonly --privsep 0
# put the value in .env as PVE_TOKEN=portfolio@pam!readonly=<uuid>
```

## Trusted mode

The frontend POSTs `/api/whoami`.
The API says `trusted: true` only if nginx tagged the request `X-Net: lan` (the internal server block) or `X-Real-IP` is inside `TRUSTED_NETS` (Tailscale 100.64.0.0/10, LAN).
Public traffic comes through the Cloudflare server block, which forces `X-Net: public` and sets `X-Real-IP` from `CF-Connecting-IP`.
Headers sent by the client get overwritten, so they can't be spoofed.

When trusted, the `;; SRV` section shows up with live Proxmox stats (15 s refresh, 10 s server-side cache), service shortcuts and the visitor log.

## Friend tagging

Every browser gets a random `vid` in localStorage and is logged when it visits.
From a trusted device, open `;; SRV` and `tail -f visitors.log`, find a friend, and give them a name, a greeting and optionally a theme.
The greeting shows up in the hero the next time they open the site.
The shell does the same with `tag <vid> <name> | <greeting> / <theme>`.

## Editing content

- `site/projects.json`: featured and archive project cards. An empty `url` means the card has no link.
- `api/now.json`: default text for the NOW panel. Once you save from the shell (`status`), the live copy in `/var/lib/portfolio-api/now.json` wins.
- `api/app.py`, `SERVICES`: service shortcuts. The IPs in there are placeholders, fix them.

## Survey response count

The survey project card shows "N+ responses so far" when the API has a number.
The browser never calls the quiz site itself, because the CSP allows only same-origin requests.
`GET /api/quizcount` fetches `QUIZ_COUNT_URL` server-side (5 s timeout), caches the answer for 10 minutes and returns `{"responses": N}`.
The quiz site floors N to a multiple of 10 and sends `null` below 10, and the card shows nothing in that case.
Any fetch error gives a 502 and the card simply stays without the line.
`QUIZ_COUNT_URL` defaults to `https://quiz.dobsinsky.dev/api/public/count`.
