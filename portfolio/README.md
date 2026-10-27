# dobsinsky.dev

My personal site. Static frontend plus a small Flask API, self-hosted on Proxmox behind a Cloudflare Tunnel.

## Stack

- Frontend: plain HTML, CSS and JavaScript, GSAP + ScrollTrigger (vendored), self-hosted fonts (Archivo Black, IBM Plex Mono)
- API: Python, Flask, gunicorn, SQLite
- Data: Proxmox API, CrowdSec, Steam Web API, GitHub API, quiz.dobsinsky.dev
- Server: nginx, Cloudflare Tunnel, systemd, GitHub Actions self-hosted runner

## Structure

```
portfolio/
├── api/
│   ├── app.py                  Flask API (/api/now, /api/github, /api/pulse, ...)
│   ├── now.json                default text for the NOW panel
│   ├── portfolio-api.service   systemd unit
│   ├── requirements.txt
│   └── .env.example            settings (Proxmox token, Steam key, GitHub token, ...)
├── site/
│   ├── index.html              the page
│   ├── cv.html, cv.pdf         CV
│   ├── projects.json           project cards
│   ├── css/                    styles and fonts
│   ├── js/app.js               page logic
│   ├── js/cursor.js            the caret that follows the mouse
│   ├── shell/                  the ~ shell, loaded only when needed
│   ├── vendor/                 GSAP
│   ├── fonts/, img/
│   └── robots.txt, sitemap.xml
├── tools/og-card.html          source of the link preview image
├── nginx.conf                  public (tunnel) and LAN server blocks
└── security-headers.conf       CSP, HSTS etc., included by nginx.conf
```

## Deploy

Pushing to `master` runs `deploy/deploy.sh portfolio` on the runner.
It pulls, rebuilds the venv, restarts `portfolio-api` and reloads nginx.
`nginx.conf` and `.env` are set up by hand once, see the root `README.md`.
After changing CSS or JS, bump the `?v=` in `index.html` and `ASSET_V` in `app.js`.
