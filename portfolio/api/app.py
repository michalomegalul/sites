"""dobsinsky.xyz portfolio API
Run behind nginx. See nginx.conf in repo root for the header contract:
  - nginx MUST set X-Real-IP (and overwrite anything the client sent)
  - nginx sets X-Net: lan  ONLY on the LAN/Tailscale server block
Public (Cloudflare Tunnel) traffic must arrive with X-Net: public.
"""

import ipaddress
import json
import os
import sqlite3
import subprocess
import time
from functools import wraps
from pathlib import Path
from threading import Lock

import requests
from dotenv import load_dotenv
from flask import Flask, g, jsonify, request

load_dotenv()

app = Flask(__name__)
BASE = Path(__file__).parent

# Runtime state lives OUTSIDE the checkout. Two reasons, and both have bitten:
#
#   * deploy.sh runs `git reset --hard` on /opt/sites every deploy, so anything
#     tracked here is reverted and anything untracked is one `git clean` away.
#   * api/ is owned by the runner, not www-data. SQLite writes its rollback
#     journal next to the database file, so an INSERT needs a writable
#     *directory*, not just a writable file — which is why /api/visits (a plain
#     SELECT) worked while /api/whoami quietly 500'd, and the front end fell back
#     to PUBLIC because whoami()'s catch swallows the error.
#
# The unit sets STATE_DIR and systemd creates it owned by User=. Falling back to
# BASE keeps `python app.py` working for local poking.
STATE = Path(os.getenv("STATE_DIR") or BASE)
DB = STATE / "visitors.db"
NOW_FILE = STATE / "now.json"

TRUSTED_NETS = [
    ipaddress.ip_network(n)
    for n in os.getenv(
        "TRUSTED_NETS",
        "100.64.0.0/10,192.168.0.0/16,127.0.0.0/8,fd7a:115c:a1e0::/48",
    ).split(",")
]

PVE_HOST = os.getenv("PVE_HOST", "https://192.168.4.10:8006")
PVE_NODE = os.getenv("PVE_NODE", "pve")
PVE_TOKEN = os.getenv("PVE_TOKEN", "")  # user@pam!tokenid=uuid
PVE_VERIFY = os.getenv("PVE_VERIFY", "0") == "1"

STEAM_API_KEY = os.getenv("STEAM_API_KEY", "")
STEAM_VANITY = os.getenv("STEAM_VANITY", "ahoj_a_koukni_lul")

NTFY_URL = os.getenv("NTFY_URL", "")        # e.g. https://ntfy.dobsinsky.xyz/portfolio
NTFY_TOKEN = os.getenv("NTFY_TOKEN", "")    # optional bearer token

SERVICES = [
    {"name": "Jellyfin", "url": "http://192.168.4.20:8096", "note": "media"},
    {"name": "Sonarr", "url": "http://192.168.4.21:8989", "note": "tv"},
    {"name": "Radarr", "url": "http://192.168.4.21:7878", "note": "movies"},
    {"name": "qBittorrent", "url": "http://192.168.4.22:8080", "note": "torrents"},
    {"name": "Grafana", "url": "http://192.168.4.23:3000", "note": "metrics"},
    {"name": "Uptime Kuma", "url": "http://192.168.4.24:3001", "note": "status"},
    {"name": "Pi-hole", "url": "http://192.168.4.25/admin", "note": "dns"},
    {"name": "Home Assistant", "url": "http://192.168.4.26:8123", "note": "home"},
    {"name": "Proxmox", "url": "https://192.168.4.10:8006", "note": "host"},
    {"name": "Ntfy", "url": "https://ntfy.dobsinsky.xyz", "note": "alerts"},
]

# --------------------------------------------------------------- db


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB)
        g.db.row_factory = sqlite3.Row
        g.db.execute(
            """CREATE TABLE IF NOT EXISTS visitors (
                vid TEXT PRIMARY KEY,
                name TEXT, greeting TEXT,
                ua TEXT, first_seen INTEGER, last_seen INTEGER,
                visits INTEGER DEFAULT 0,
                theme TEXT
            )"""
        )
        g.db.execute(
            """CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vid TEXT, text TEXT, ts INTEGER
            )"""
        )
    return g.db


@app.teardown_appcontext
def close_db(_):
    d = g.pop("db", None)
    if d:
        d.close()


# --------------------------------------------------------------- trust


def client_ip() -> str:
    return request.headers.get("X-Real-IP", request.remote_addr or "0.0.0.0")


def is_trusted() -> bool:
    # nginx contract: X-Net=lan is only ever set by the internal server block
    if request.headers.get("X-Net") == "lan":
        return True
    try:
        ip = ipaddress.ip_address(client_ip())
    except ValueError:
        return False
    return any(ip in net for net in TRUSTED_NETS)


def trusted_only(f):
    @wraps(f)
    def w(*a, **kw):
        if not is_trusted():
            return jsonify({"error": "not on trusted net"}), 403
        return f(*a, **kw)

    return w


# --------------------------------------------------------------- routes


@app.post("/api/whoami")
def whoami():
    body = request.get_json(silent=True) or {}
    vid = (body.get("vid") or "")[:40]
    ua = (body.get("ua") or "")[:300]
    greeting = None
    friend_theme = None
    friend_name = None
    if vid:
        d = db()
        now = int(time.time())
        d.execute(
            """INSERT INTO visitors (vid, ua, first_seen, last_seen, visits)
               VALUES (?, ?, ?, ?, 1)
               ON CONFLICT(vid) DO UPDATE SET
                 last_seen=excluded.last_seen, ua=excluded.ua,
                 visits=visits+1""",
            (vid, ua, now, now),
        )
        d.commit()
        row = d.execute("SELECT name, greeting, theme FROM visitors WHERE vid=?", (vid,)).fetchone()
        greeting = row["greeting"] if row else None
        friend_theme = row["theme"] if row else None
        friend_name = row["name"] if row else None
    return jsonify({"trusted": is_trusted(), "greeting": greeting, "theme": friend_theme, "name": friend_name})


@app.get("/api/ip")
def ip():
    return jsonify({"ip": client_ip(), "trusted": is_trusted()})


@app.get("/api/now")
def now():
    # Runtime copy first, then the one committed in the repo, which is what a
    # fresh box serves before anyone has set one. The old code only read the
    # repo copy, so every `git reset --hard` silently threw away whatever had
    # been posted to /api/now.
    for f in (NOW_FILE, BASE / "now.json"):
        if f.exists():
            return app.response_class(f.read_text(), mimetype="application/json")
    return jsonify({"working_on": "nothing logged", "updated": "never"})


@app.get("/api/services")
@trusted_only
def services():
    return jsonify(SERVICES)


@app.get("/api/visitors")
@trusted_only
def visitors():
    rows = db().execute(
        "SELECT * FROM visitors ORDER BY last_seen DESC LIMIT 50"
    ).fetchall()
    return jsonify(
        [
            {
                "vid": r["vid"],
                "name": r["name"],
                "greeting": r["greeting"],
                "theme": r["theme"],
                "visits": r["visits"],
                "last_seen": time.strftime("%d.%m. %H:%M", time.localtime(r["last_seen"])),
                "ua": (r["ua"] or "")[:80],
            }
            for r in rows
        ]
    )


@app.get("/api/visits")
def visits():
    """Public — aggregate counts only.

    /api/visitors above is trusted_only and hands back vids, names and
    user-agent strings. This is the same table reduced to three numbers, and
    nothing in the response identifies anybody. Keep it that way: the panel on
    the front page only ever needs the count.
    """
    d = db()
    totals = d.execute(
        "SELECT count(*) AS people, COALESCE(sum(visits), 0) AS visits FROM visitors"
    ).fetchone()
    recent = d.execute(
        "SELECT count(*) AS n FROM visitors WHERE last_seen >= ?",
        (int(time.time()) - 7 * 86400,),
    ).fetchone()
    return jsonify(
        {
            "people": totals["people"],
            "visits": totals["visits"],
            "people_7d": recent["n"],
        }
    )


@app.post("/api/tag")
@trusted_only
def tag():
    b = request.get_json(force=True)
    db().execute(
        "UPDATE visitors SET name=?, greeting=?, theme=? WHERE vid=?",
        ((b.get("name") or "")[:60], (b.get("greeting") or "")[:200], (b.get("theme") or "")[:20], b["vid"]),
    )
    db().commit()
    return jsonify({"ok": True})


# --------------------------------------------------------------- messages

_msg_rate: dict[str, list[float]] = {}


@app.post("/api/message")
def message():
    b = request.get_json(silent=True) or {}
    vid = (b.get("vid") or "anon")[:40]
    text = (b.get("text") or "").strip()[:500]
    if not text:
        return jsonify({"error": "empty"}), 400

    now_t = time.time()
    times = [t for t in _msg_rate.get(vid, []) if now_t - t < 3600]
    if len(times) >= 5:
        return jsonify({"error": "rate limited"}), 429
    times.append(now_t)
    _msg_rate[vid] = times

    d = db()
    d.execute("INSERT INTO messages (vid, text, ts) VALUES (?, ?, ?)", (vid, text, int(now_t)))
    d.commit()

    if NTFY_URL:
        try:
            headers = {"Title": f"portfolio msg from {vid}"}
            if NTFY_TOKEN:
                headers["Authorization"] = f"Bearer {NTFY_TOKEN}"
            requests.post(NTFY_URL, data=text.encode(), headers=headers, timeout=4)
        except Exception:
            pass  # message is stored either way

    return jsonify({"ok": True})


@app.get("/api/messages")
@trusted_only
def messages():
    rows = db().execute(
        """SELECT m.vid, m.text, m.ts, v.name FROM messages m
           LEFT JOIN visitors v ON v.vid = m.vid
           ORDER BY m.ts DESC LIMIT 50"""
    ).fetchall()
    return jsonify(
        [
            {
                "vid": r["vid"],
                "name": r["name"],
                "text": r["text"],
                "when": time.strftime("%d.%m. %H:%M", time.localtime(r["ts"])),
            }
            for r in rows
        ]
    )


@app.post("/api/now")
@trusted_only
def set_now():
    b = request.get_json(force=True)  # validates JSON
    NOW_FILE.write_text(json.dumps(b, ensure_ascii=False, indent=2))
    return jsonify({"ok": True})


# --------------------------------------------------------------- proxmox

_pve_cache = {"t": 0, "data": None}


def _pve_data():
    if time.time() - _pve_cache["t"] < 10 and _pve_cache["data"]:
        return _pve_cache["data"]

    h = {"Authorization": f"PVEAPIToken={PVE_TOKEN}"}

    def get(path):
        r = requests.get(f"{PVE_HOST}/api2/json{path}", headers=h, verify=PVE_VERIFY, timeout=5)
        r.raise_for_status()
        return r.json()["data"]

    if True:
        st = get(f"/nodes/{PVE_NODE}/status")
        lxc = get(f"/nodes/{PVE_NODE}/lxc")
        storage = get(f"/nodes/{PVE_NODE}/storage")

        gib = lambda b: round(b / 2**30, 1)
        up = st["uptime"]
        data = {
            "cpu_pct": round(st["cpu"] * 100, 1),
            "cores": st["cpuinfo"]["cpus"],
            "load": st["loadavg"][0],
            "mem_pct": round(st["memory"]["used"] / st["memory"]["total"] * 100, 1),
            "mem_used": gib(st["memory"]["used"]),
            "mem_total": gib(st["memory"]["total"]),
            "lxc_running": sum(1 for c in lxc if c["status"] == "running"),
            "lxc_total": len(lxc),
            "uptime": f"{up // 86400}d {up % 86400 // 3600}h",
            "disks": [
                {
                    "name": s["storage"],
                    "pct": round(s["used"] / s["total"] * 100, 1),
                    "used": f"{gib(s['used'])}G",
                    "total": f"{gib(s['total'])}G",
                }
                for s in storage
                if s.get("total")
            ][:4],
        }
        _pve_cache.update(t=time.time(), data=data)
        return data


@app.get("/api/proxmox")
@trusted_only
def proxmox():
    try:
        return jsonify(_pve_data())
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 502


@app.get("/api/pulse")
def pulse():
    """Public, reduced vitals — numbers only, no names of services."""
    try:
        d = _pve_data()
        return jsonify(
            {
                "cpu_pct": d["cpu_pct"],
                "mem_pct": d["mem_pct"],
                "disks": [{"name": x["name"], "pct": x["pct"]} for x in d["disks"]],
                "lxc_running": d["lxc_running"],
                "lxc_total": d["lxc_total"],
                "uptime": d["uptime"],
            }
        )
    except Exception:
        return jsonify({"error": "pve offline"}), 502


# --------------------------------------------------------------- crowdsec

# Set CROWDSEC=0 to hide the counter entirely (e.g. before CrowdSec is
# installed). The endpoint then 503s and the status bar simply stays empty.
CROWDSEC = os.getenv("CROWDSEC", "1") != "0"
CSCLI = os.getenv("CSCLI", "/usr/bin/cscli")
CS_TTL = 120

_cs_cache = {"t": 0, "data": None}
# gunicorn runs 2 workers. Three cscli calls at 5 s each is 15 s worst case, so
# a cache miss must not be something every concurrent request joins in on: one
# refresh at a time per worker, everyone else gets the previous answer.
_cs_lock = Lock()


def _cscli(*args):
    """One read-only cscli call.

    `sudo -n` with a fixed argument list and no shell. Nothing from a request
    ever reaches this function, so there is no injection surface; the sudoers
    rule in the README allows exactly these read-only subcommands. cscli needs
    root to read the local API credentials, which is the only reason sudo is
    here at all.
    """
    out = subprocess.run(
        ["sudo", "-n", CSCLI, *args],
        capture_output=True, text=True, timeout=5, check=True,
    ).stdout.strip()
    # cscli prints the JSON literal `null`, not `[]`, for an empty result.
    return json.loads(out) if out and out != "null" else []


def _crowdsec_data():
    fresh = time.time() - _cs_cache["t"] < CS_TTL and _cs_cache["data"]
    if fresh:
        return _cs_cache["data"]

    # Someone else is already refreshing: hand back the stale numbers rather
    # than queueing behind them. Only a cold cache has nothing to give.
    if not _cs_lock.acquire(blocking=_cs_cache["data"] is None):
        return _cs_cache["data"]
    try:
        decisions = _cscli("decisions", "list", "-o", "json")
        alerts_24h = _cscli("alerts", "list", "-o", "json", "--since", "24h", "--limit", "0")
        alerts_7d = _cscli("alerts", "list", "-o", "json", "--since", "168h", "--limit", "0")

        data = {
            "blocked_now": len(decisions),
            "alerts_24h": len(alerts_24h),
            "alerts_7d": len(alerts_7d),
            # An alert bundles the several requests that triggered it, so this
            # is the "how many malicious requests" number rather than "how many
            # incidents". It is the bigger and more honest of the two.
            "events_7d": sum(int(a.get("events_count") or 0) for a in alerts_7d),
        }
        _cs_cache.update(t=time.time(), data=data)
        return data
    finally:
        _cs_lock.release()


@app.get("/api/crowdsec")
def crowdsec():
    """Public — counts only, never the addresses behind them.

    Same rule as /api/pulse. Publishing the blocked-IP list would be both a
    privacy problem and a free reputation feed for anyone who wanted one; the
    count carries the whole point without either.
    """
    if not CROWDSEC:
        return jsonify({"error": "disabled"}), 503
    try:
        return jsonify(_crowdsec_data())
    except Exception:  # noqa: BLE001 — missing binary, sudo denied, LAPI down
        return jsonify({"error": "crowdsec unavailable"}), 502


# --------------------------------------------------------------- rdap / whois

RDAP_DOMAIN = os.getenv("RDAP_DOMAIN", "dobsinsky.xyz")
RDAP_TTL = 6 * 3600          # registry data changes about twice a year
_rdap_cache = {"t": 0, "data": None}


def _vcard_name(entity):
    """Pull the display name out of an RDAP jCard, which is a nested array."""
    for prop in (entity.get("vcardArray") or [None, []])[1]:
        if len(prop) >= 4 and prop[0] == "fn":
            return prop[3]
    return None


def _rdap():
    if time.time() - _rdap_cache["t"] < RDAP_TTL and _rdap_cache["data"]:
        return _rdap_cache["data"]

    r = requests.get(
        f"https://rdap.org/domain/{RDAP_DOMAIN}",
        headers={"Accept": "application/rdap+json"},
        timeout=6,
    )
    r.raise_for_status()
    d = r.json()

    events = {e.get("eventAction"): e.get("eventDate") for e in d.get("events") or []}

    # Registrar only. Every other entity role — registrant, administrative,
    # technical, abuse — can carry a person's name, address, phone and email, and
    # this endpoint is public. Nothing from those is read, not even to log it:
    # the panel needs a registrar and some dates, so that is all that is parsed.
    registrar = next(
        (_vcard_name(e) for e in d.get("entities") or [] if "registrar" in (e.get("roles") or [])),
        None,
    )

    data = {
        "domain": d.get("ldhName") or RDAP_DOMAIN,
        "registrar": registrar,
        "created": (events.get("registration") or "")[:10] or None,
        "expires": (events.get("expiration") or "")[:10] or None,
        "changed": (events.get("last changed") or "")[:10] or None,
        "status": d.get("status") or [],
        "nameservers": [n.get("ldhName") for n in d.get("nameservers") or [] if n.get("ldhName")],
        "dnssec": bool((d.get("secureDNS") or {}).get("delegationSigned")),
    }
    _rdap_cache.update(t=time.time(), data=data)
    return data


@app.get("/api/whois")
def whois():
    """Public. The domain's own registry record, over RDAP rather than port 43.

    RDAP is the structured replacement for whois: JSON over HTTPS, so there is
    nothing to scrape. rdap.org is a thin redirector to whichever registry is
    authoritative, which keeps this working if the TLD ever changes.

    Cached for six hours — registry data changes about twice a year, and hammering
    someone else's redirector on every page load would be rude.
    """
    try:
        return jsonify(_rdap())
    except Exception:  # noqa: BLE001
        return jsonify({"error": "rdap unreachable"}), 502


_steam_cache = {"t": 0, "data": None, "sid": None}


@app.get("/api/steam")
def steam():
    """Latest played game, public, cached 5 min."""
    if not STEAM_API_KEY:
        return jsonify({"error": "not configured"}), 503
    if time.time() - _steam_cache["t"] < 300 and _steam_cache["data"]:
        return jsonify(_steam_cache["data"])
    try:
        if not _steam_cache["sid"]:
            r = requests.get(
                "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/",
                params={"key": STEAM_API_KEY, "vanityurl": STEAM_VANITY},
                timeout=5,
            ).json()["response"]
            _steam_cache["sid"] = r["steamid"]
        g = requests.get(
            "https://api.steampowered.com/IPlayerService/GetRecentlyPlayedGames/v1/",
            params={"key": STEAM_API_KEY, "steamid": _steam_cache["sid"], "count": 3},
            timeout=5,
        ).json()["response"]
        games = g.get("games", [])
        data = {
            "games": [
                {"name": x["name"], "hours_2w": round(x.get("playtime_2weeks", 0) / 60, 1)}
                for x in games
            ]
        }
        _steam_cache.update(t=time.time(), data=data)
        return jsonify(data)
    except Exception:
        return jsonify({"error": "steam unreachable"}), 502


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050)
