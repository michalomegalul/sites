# dobsinsky.xyz — portfolio

Static brutalist site + tiny Flask API. Public side: CV, projects, contact.
Trusted side (LAN/Tailscale only): Proxmox stats, service links, visitor tagging.

## Layout

```
site/        static frontend (nginx serves this)
api/         Flask API (gunicorn on 127.0.0.1:5050)
nginx.conf   the trust contract — read the comments before touching
```

## Deploy

Pushes to `master` touching `portfolio/**` run `deploy/deploy.sh portfolio` on
the self-hosted runner. First-time setup on a fresh LXC:

```bash
apt install -y nginx python3-venv

cd /opt/sites/portfolio/api
python3 -m venv venv && venv/bin/pip install -r requirements.txt
cp .env.example .env && nano .env        # PVE token + nets

cp portfolio-api.service /etc/systemd/system/
systemctl enable --now portfolio-api

cp /opt/sites/portfolio/nginx.conf /etc/nginx/sites-available/portfolio
ln -s /etc/nginx/sites-available/portfolio /etc/nginx/sites-enabled/
nano /etc/nginx/sites-enabled/portfolio   # set LAN IP of this container
nginx -t && systemctl reload nginx
```

Cloudflare Tunnel: point the `dobsinsky.xyz` ingress at `http://127.0.0.1:8480`.

> **Path check.** The monorepo restructure moved this to `/opt/sites/portfolio`,
> but `portfolio-api.service` and `nginx.conf` in this directory still reference
> the old `/opt/portfolio`. If the service on the host still points there, the
> deploy script updates `/opt/sites` and then restarts a unit running from a
> directory it did not touch. Fix the paths in both files, or symlink
> `/opt/portfolio → /opt/sites/portfolio`, before trusting a deploy.

## Proxmox token (read-only!)

```bash
pveum user add portfolio@pam
pveum acl modify / --users portfolio@pam --roles PVEAuditor
pveum user token add portfolio@pam readonly --privsep 0
# paste the value into .env as PVE_TOKEN=portfolio@pam!readonly=<uuid>
```

## How trusted mode works

The frontend POSTs `/api/whoami`. The API answers `trusted: true` only when
nginx tagged the request `X-Net: lan` (internal server block) **or** the
X-Real-IP falls in `TRUSTED_NETS` (Tailscale CGNAT 100.64.0.0/10, LAN).
Public traffic comes through the Cloudflare block which forces
`X-Net: public` and sets X-Real-IP from CF-Connecting-IP, so nobody can
spoof their way in by sending headers — nginx overwrites them.

When trusted: the `;; SRV` section appears with live Proxmox stats
(15 s refresh, 10 s server-side cache), service shortcuts, and the
visitor log.

## Friend tagging

Every browser gets a random `vid` in localStorage and is logged on visit.
From a trusted device, open `;; SRV → tail -f visitors.log`, recognize a
friend (timing + user agent), give them a name and a custom greeting.
Next time they open the site, the greeting shows in the hero.

## Editing content

- `site/projects.json` — featured vs archive cards
- `api/now.json` — the "what am I doing" panel; edit anytime, no restart
- `api/app.py` → `SERVICES` — your service shortcuts (fix the IPs)
