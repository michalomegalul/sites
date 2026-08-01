"""quiz.dobsinsky.xyz — survey engine API.

Surveys are rows, not code. See ../SPEC.md for the constraints this file exists
to enforce; the ones that bite are:

  * Nothing identifying is ever written next to an answer. No IP, no full
    user-agent, no email.
  * `followups` must not be joinable to `responses`. This module never sees a
    response_id and an email in the same request, deliberately.
  * Option codes are validated server-side. The client is not trusted to send
    values that exist.
"""

import csv
import io
import os
import re
import time
from collections import defaultdict
from functools import wraps
from ipaddress import ip_address, ip_network
from threading import Lock

import psycopg
from dotenv import load_dotenv
from flask import Flask, Response, g, jsonify, request
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

# systemd reads EnvironmentFile= as root; we also load it as www-data. See
# SPEC "Known traps" — .env must be 640 root:www-data or python-dotenv raises.
load_dotenv()

DATABASE_URL = os.environ["DATABASE_URL"]
TRUSTED_NETS = [
    ip_network(n.strip())
    for n in os.getenv(
        "TRUSTED_NETS",
        "100.64.0.0/10,192.168.0.0/16,127.0.0.0/8,fd7a:115c:a1e0::/48",
    ).split(",")
    if n.strip()
]
START_LIMIT = int(os.getenv("START_LIMIT_PER_HOUR", "20"))
FOLLOWUP_LIMIT = int(os.getenv("FOLLOWUP_LIMIT_PER_HOUR", "5"))
MIN_FILL_SECONDS = int(os.getenv("MIN_FILL_SECONDS", "15"))

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 256 * 1024

pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=8, kwargs={"row_factory": dict_row})

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$")


# --------------------------------------------------------------------- helpers

def db():
    if "conn" not in g:
        g.conn_ctx = pool.connection()
        g.conn = g.conn_ctx.__enter__()
    return g.conn


@app.teardown_appcontext
def _close_db(exc):
    ctx = g.pop("conn_ctx", None)
    g.pop("conn", None)
    if ctx is None:
        return
    if exc is None:
        ctx.__exit__(None, None, None)
    else:
        ctx.__exit__(type(exc), exc, exc.__traceback__)


def client_ip():
    """Transient only — used for rate limiting and never written to a row.

    nginx overwrites X-Real-IP from CF-Connecting-IP on the public block, so
    this cannot be spoofed by sending the header. See portfolio/nginx.conf.
    """
    raw = request.headers.get("X-Real-IP", "")
    try:
        return ip_address(raw)
    except ValueError:
        return None


def is_trusted():
    """Admin gate. Mirrors the portfolio trust contract exactly."""
    if request.headers.get("X-Net") == "lan":
        return True
    ip = client_ip()
    return ip is not None and any(ip in net for net in TRUSTED_NETS)


def trusted_only(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if not is_trusted():
            return jsonify(error="not_found"), 404
        return fn(*a, **kw)

    return wrapper


_hits = defaultdict(list)
_hits_lock = Lock()


def rate_limit(bucket, limit, window=3600):
    """Fixed-window counter in process memory.

    Deliberately not backed by the database: rate-limit state is keyed on IP,
    and an IP must not end up in Postgres next to survey data.
    """
    ip = client_ip()
    key = (bucket, str(ip) if ip else "unknown")
    now = time.time()
    with _hits_lock:
        hits = [t for t in _hits[key] if now - t < window]
        if len(hits) >= limit:
            _hits[key] = hits
            return False
        hits.append(now)
        _hits[key] = hits
        if len(_hits) > 10000:  # crude bound; process restart clears it anyway
            for k in [k for k, v in _hits.items() if not v or now - v[-1] > window]:
                _hits.pop(k, None)
    return True


UA_BROWSERS = [
    ("Edg/", "Edge"), ("OPR/", "Opera"), ("Firefox/", "Firefox"),
    ("Chrome/", "Chrome"), ("Safari/", "Safari"),
]
UA_PLATFORMS = [
    ("Android", "Android"), ("iPhone", "iOS"), ("iPad", "iPadOS"),
    ("Windows", "Windows"), ("Mac OS", "macOS"), ("Linux", "Linux"),
]


def ua_family():
    """Coarse family only. The full string is near-unique — SPEC constraint #5."""
    ua = request.headers.get("User-Agent", "")
    browser = next((n for t, n in UA_BROWSERS if t in ua), "Other")
    platform = next((n for t, n in UA_PLATFORMS if t in ua), "Other")
    return f"{browser}/{platform}"


def load_survey(cur, slug, locale=None):
    cur.execute(
        "SELECT id, slug, default_locale, locales, consent_ver, is_open, mode, accent"
        " FROM surveys WHERE slug = %s",
        (slug,),
    )
    survey = cur.fetchone()
    if survey is None:
        return None, None
    if locale is None:
        return survey, None
    if locale not in survey["locales"]:
        locale = survey["default_locale"]
    return survey, locale


# ------------------------------------------------------------------ public API

@app.get("/api/surveys")
def public_surveys():
    """The chooser on the landing page.

    Deliberately NOT the same shape as /api/admin/surveys: that one carries
    submitted-response counts, which are nobody's business from the internet.
    This returns only what a respondent needs in order to pick a questionnaire.

    A closed survey is listed only to a trusted client. Publicly it is not
    mentioned at all — its existence is not a fact the internet needs, and a
    dead card is worse than no card.

    `trusted` rides along so the page can render the admin shortcuts in the same
    round trip. It is the same gate as every other admin surface here: nginx
    forces X-Net: public through the tunnel, so this is false from outside.
    """
    locale = request.args.get("locale", "")
    trusted = is_trusted()

    with db().cursor() as cur:
        cur.execute(
            "SELECT s.slug, s.mode, s.is_open, s.default_locale, s.locales,"
            "       COALESCE(i.title, d.title) AS title,"
            "       COALESCE(i.intro_md, d.intro_md) AS intro_md"
            " FROM surveys s"
            " LEFT JOIN survey_i18n i ON i.survey_id = s.id AND i.locale = %s"
            " LEFT JOIN survey_i18n d ON d.survey_id = s.id"
            "                        AND d.locale = s.default_locale"
            " WHERE %s OR s.is_open"
            " ORDER BY s.is_open DESC, s.slug",
            (locale, trusted),
        )
        surveys = cur.fetchall()

    return jsonify(surveys=surveys, trusted=trusted)


@app.get("/api/s/<slug>")
def get_survey(slug):
    if not SLUG_RE.match(slug):
        return jsonify(error="bad_slug"), 400
    locale = request.args.get("locale", "")

    with db().cursor() as cur:
        survey, locale = load_survey(cur, slug, locale or None)
        if survey is None:
            return jsonify(error="not_found"), 404

        cur.execute(
            "SELECT title, intro_md, consent_md, thanks_md FROM survey_i18n"
            " WHERE survey_id = %s AND locale = %s",
            (survey["id"], locale),
        )
        text = cur.fetchone() or {}

        cur.execute(
            "SELECT q.code, q.kind, q.required, q.spec, q.position,"
            "       i.prompt, i.help, i.labels"
            " FROM questions q"
            " LEFT JOIN question_i18n i ON i.question_id = q.id AND i.locale = %s"
            " WHERE q.survey_id = %s ORDER BY q.position",
            (locale, survey["id"]),
        )
        questions = cur.fetchall()

    # Never ship the answer key. In quiz mode the correct options and the
    # explanation come back from PATCH, once the answer is already recorded —
    # otherwise the survey measures who thought to open devtools.
    for q in questions:
        spec = q.get("spec") or {}
        if "correct" in spec:
            q["spec"] = {k: v for k, v in spec.items() if k != "correct"}
            q["graded"] = True
        else:
            q["graded"] = False

    return jsonify(
        slug=survey["slug"],
        locale=locale,
        locales=survey["locales"],
        is_open=survey["is_open"],
        consent_ver=survey["consent_ver"],
        mode=survey["mode"],
        # NULL means the built-in palette. The browser derives the rest of the
        # colours from this one value — see site/js/palette.js.
        accent=survey["accent"],
        **text,
        questions=questions,
    )


@app.post("/api/s/<slug>/start")
def start(slug):
    if not SLUG_RE.match(slug):
        return jsonify(error="bad_slug"), 400
    if not rate_limit("start", START_LIMIT):
        return jsonify(error="rate_limited"), 429

    body = request.get_json(silent=True) or {}

    # Honeypot: a field hidden with CSS that only a form-filling bot completes.
    if body.get("website"):
        return jsonify(error="rejected"), 400

    with db().cursor() as cur:
        survey, locale = load_survey(cur, slug, body.get("locale"))
        if survey is None:
            return jsonify(error="not_found"), 404
        if not survey["is_open"]:
            return jsonify(error="closed"), 403

        # Unknown src stores NULL. Never auto-create — SPEC: the query string
        # must not be able to pollute source stats.
        source_id = None
        src = body.get("src")
        if isinstance(src, str) and src:
            cur.execute(
                "SELECT id FROM sources WHERE survey_id = %s AND code = %s",
                (survey["id"], src),
            )
            row = cur.fetchone()
            source_id = row["id"] if row else None

        cur.execute(
            "INSERT INTO responses (survey_id, source_id, locale, consent_ver, ua_family)"
            " VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (survey["id"], source_id, locale, survey["consent_ver"], ua_family()),
        )
        response_id = cur.fetchone()["id"]
        db().commit()

    return jsonify(response_id=str(response_id), locale=locale), 201


def validate(kind, spec, value):
    """Return (ok, cleaned). Never trust the client — SPEC.

    A `None` value means "clear this answer" and is always allowed.
    """
    if value is None:
        return True, None

    if kind in ("text", "textarea"):
        if not isinstance(value, str):
            return False, None
        maxlen = int(spec.get("maxlen", 2000))
        return True, value.strip()[:maxlen]

    if kind == "single":
        options = spec.get("options", [])
        return (value in options), value

    if kind == "multi":
        if not isinstance(value, list):
            return False, None
        options = set(spec.get("options", []))
        if not all(isinstance(v, str) and v in options for v in value):
            return False, None
        cleaned = list(dict.fromkeys(value))
        # An exclusive option ("None of these") cannot be combined with others.
        exclusive = set(spec.get("exclusive", []))
        if exclusive & set(cleaned) and len(cleaned) > 1:
            cleaned = [v for v in cleaned if v in exclusive][:1]
        return True, cleaned

    if kind in ("scale", "number"):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return False, None
        lo, hi = spec.get("min", 0), spec.get("max", 10**9)
        return (lo <= value <= hi), value

    if kind == "date":
        return bool(isinstance(value, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", value)), value

    if kind == "bodymap":
        if not isinstance(value, dict):
            return False, None
        regions = set(spec.get("regions", []))
        levels = int(spec.get("levels", 3))
        cleaned = {}
        for k, v in value.items():
            if k not in regions or isinstance(v, bool) or not isinstance(v, int):
                return False, None
            if not 0 <= v <= levels:
                return False, None
            if v > 0:  # store only painful regions; absence means zero
                cleaned[k] = v
        return True, cleaned

    return False, None


def grade(kind, spec, value):
    """True/False for a gradable question, None if it is not graded.

    Kept identical to the SQL in db/004_quiz_mode.sql — a multi must match the
    correct set exactly, so ticking everything scores nothing.
    """
    correct = spec.get("correct")
    if correct is None:
        return None
    if kind == "multi":
        return sorted(value or []) == sorted(correct)
    return value in correct


def open_response(cur, response_id):
    cur.execute(
        "SELECT id, survey_id, submitted_at, started_at, locale"
        " FROM responses WHERE id = %s",
        (response_id,),
    )
    return cur.fetchone()


@app.get("/api/r/<response_id>")
def get_response(response_id):
    """Read back a part-finished response so a returning browser can repaint
    the answers it already gave.

    Same bearer capability as PATCH, and the same limit: once `submitted_at` is
    set this stops answering, so a leaked id cannot be used to read a completed
    submission back out.
    """
    if not UUID_RE.match(response_id):
        return jsonify(error="bad_id"), 400

    with db().cursor() as cur:
        resp = open_response(cur, response_id)
        if resp is None:
            return jsonify(error="not_found"), 404
        if resp["submitted_at"] is not None:
            return jsonify(error="already_submitted"), 409

        cur.execute(
            "SELECT q.code, a.value FROM answers a"
            " JOIN questions q ON q.id = a.question_id"
            " WHERE a.response_id = %s",
            (response_id,),
        )
        answers = {r["code"]: r["value"] for r in cur.fetchall()}

    return jsonify(response_id=response_id, answers=answers)


@app.patch("/api/r/<response_id>")
def patch_response(response_id):
    """Partial save. `response_id` is a bearer capability for this one
    unsubmitted response and nothing else."""
    if not UUID_RE.match(response_id):
        return jsonify(error="bad_id"), 400
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict) or not body:
        return jsonify(error="empty"), 400

    with db().cursor() as cur:
        resp = open_response(cur, response_id)
        if resp is None:
            return jsonify(error="not_found"), 404
        if resp["submitted_at"] is not None:
            return jsonify(error="already_submitted"), 409

        cur.execute(
            "SELECT q.id, q.code, q.kind, q.spec, i.explain_md"
            " FROM questions q"
            " LEFT JOIN question_i18n i"
            "        ON i.question_id = q.id AND i.locale = %s"
            " WHERE q.survey_id = %s",
            (resp["locale"], resp["survey_id"]),
        )
        by_code = {q["code"]: q for q in cur.fetchall()}

        saved, rejected, feedback = [], [], {}
        for code, value in body.items():
            q = by_code.get(code)
            if q is None:
                rejected.append(code)
                continue
            ok, cleaned = validate(q["kind"], q["spec"], value)
            if not ok:
                rejected.append(code)
                continue
            # An empty body map is a real answer — "no pain in any of these
            # areas" — and must be stored, or a respondent with nothing to mark
            # can never satisfy a required body-map question. Every other kind
            # treats empty as "clear this answer". Send null to clear a bodymap.
            blank = cleaned is None or cleaned == "" or cleaned == []
            if cleaned == {} and q["kind"] != "bodymap":
                blank = True

            if blank:
                cur.execute(
                    "DELETE FROM answers WHERE response_id = %s AND question_id = %s",
                    (response_id, q["id"]),
                )
            else:
                cur.execute(
                    "INSERT INTO answers (response_id, question_id, value)"
                    " VALUES (%s, %s, %s)"
                    " ON CONFLICT (response_id, question_id)"
                    " DO UPDATE SET value = EXCLUDED.value",
                    (response_id, q["id"], psycopg.types.json.Jsonb(cleaned)),
                )
            saved.append(code)

            # Grade only after the answer is committed to the row above, so the
            # recorded answer is always the one given before the respondent saw
            # the solution. Nothing here is sent for ungraded questions.
            verdict = grade(q["kind"], q["spec"], cleaned)
            if verdict is not None:
                feedback[code] = {
                    "correct": verdict,
                    "correct_options": q["spec"].get("correct", []),
                    "explain_md": q["explain_md"],
                }
        db().commit()

    status = 200 if saved else 400
    return jsonify(saved=saved, rejected=rejected, feedback=feedback), status


@app.post("/api/r/<response_id>/submit")
def submit(response_id):
    if not UUID_RE.match(response_id):
        return jsonify(error="bad_id"), 400

    with db().cursor() as cur:
        resp = open_response(cur, response_id)
        if resp is None:
            return jsonify(error="not_found"), 404
        if resp["submitted_at"] is not None:
            return jsonify(ok=True, already=True)

        # Timing check: a human cannot read a consent screen and 19 questions in
        # under a few seconds. Cheap, needs no third-party script.
        cur.execute(
            "SELECT EXTRACT(EPOCH FROM (now() - started_at)) AS age FROM responses WHERE id = %s",
            (response_id,),
        )
        if cur.fetchone()["age"] < MIN_FILL_SECONDS:
            return jsonify(error="too_fast"), 429

        cur.execute(
            "SELECT q.code FROM questions q"
            " WHERE q.survey_id = %s AND q.required"
            "   AND NOT EXISTS (SELECT 1 FROM answers a"
            "                   WHERE a.response_id = %s AND a.question_id = q.id)"
            " ORDER BY q.position",
            (resp["survey_id"], response_id),
        )
        missing = [r["code"] for r in cur.fetchall()]
        if missing:
            return jsonify(error="missing_required", questions=missing), 422

        cur.execute(
            "UPDATE responses SET submitted_at = now() WHERE id = %s", (response_id,)
        )

        # Score, for the recap screen. It has to be computed here: once
        # submitted_at is set, GET /api/r/<id> stops answering, so the client
        # cannot read its own answers back to work this out.
        cur.execute(
            "SELECT q.code, q.kind, q.spec, q.position, i.prompt, i.explain_md, a.value"
            " FROM questions q"
            " JOIN answers a ON a.question_id = q.id AND a.response_id = %s"
            " LEFT JOIN question_i18n i"
            "        ON i.question_id = q.id AND i.locale = %s"
            " WHERE q.survey_id = %s AND q.spec ? 'correct'"
            " ORDER BY q.position",
            (response_id, resp["locale"], resp["survey_id"]),
        )
        review = []
        for row in cur.fetchall():
            review.append({
                "code": row["code"],
                "prompt": row["prompt"],
                "correct": grade(row["kind"], row["spec"], row["value"]),
                "correct_options": row["spec"].get("correct", []),
                "explain_md": row["explain_md"],
            })
        db().commit()

    if not review:
        return jsonify(ok=True)
    return jsonify(
        ok=True,
        score=sum(1 for r in review if r["correct"]),
        out_of=len(review),
        review=review,
    )


@app.post("/api/s/<slug>/followup")
def followup(slug):
    """Opt-in email list.

    Note what this endpoint does NOT accept: a response_id. Not as a body field,
    not as a query parameter. It cannot link an email to answers because it is
    never told which response the browser holds — SPEC constraint #3.
    """
    if not SLUG_RE.match(slug):
        return jsonify(error="bad_slug"), 400
    if not rate_limit("followup", FOLLOWUP_LIMIT):
        return jsonify(error="rate_limited"), 429

    body = request.get_json(silent=True) or {}
    if body.get("website"):
        return jsonify(error="rejected"), 400

    email = (body.get("email") or "").strip().lower()
    if not EMAIL_RE.match(email) or len(email) > 254:
        return jsonify(error="bad_email"), 400

    with db().cursor() as cur:
        survey, _ = load_survey(cur, slug)
        if survey is None:
            return jsonify(error="not_found"), 404
        cur.execute(
            "INSERT INTO followups (survey_id, email) VALUES (%s, %s)"
            " ON CONFLICT (survey_id, email) DO NOTHING",
            (survey["id"], email),
        )
        db().commit()

    return jsonify(ok=True), 201


# ------------------------------------------------------------------- admin API
# Trusted networks only. nginx forces X-Net: public on the Cloudflare block, so
# these 404 from the internet.

@app.get("/api/admin/<slug>/stats")
@trusted_only
def admin_stats(slug):
    if not SLUG_RE.match(slug):
        return jsonify(error="bad_slug"), 400

    with db().cursor() as cur:
        survey, _ = load_survey(cur, slug)
        if survey is None:
            return jsonify(error="not_found"), 404
        sid = survey["id"]

        cur.execute("SELECT * FROM v_source_stats WHERE survey_id = %s", (sid,))
        sources = cur.fetchall()
        cur.execute("SELECT * FROM v_funnel WHERE survey_id = %s", (sid,))
        funnel = cur.fetchall()
        cur.execute(
            "SELECT * FROM v_dropoff WHERE survey_id = %s ORDER BY abandoned_here DESC",
            (sid,),
        )
        dropoff = cur.fetchall()
        cur.execute("SELECT * FROM v_duration WHERE survey_id = %s", (sid,))
        duration = cur.fetchone()
        cur.execute(
            "SELECT region, respondents, mean_intensity FROM v_bodymap"
            " WHERE survey_id = %s ORDER BY respondents DESC",
            (sid,),
        )
        bodymap = cur.fetchall()

        # Per-question tallies for closed questions.
        cur.execute(
            "SELECT q.code, q.kind, e.v AS option, count(*) AS n"
            " FROM answers a"
            " JOIN responses r ON r.id = a.response_id AND r.submitted_at IS NOT NULL"
            " JOIN questions q ON q.id = a.question_id"
            # A multi answer is already a JSON array; everything else is wrapped
            # into a one-element array so both shapes expand the same way.
            # (The CASE cannot contain the expansion itself — Postgres does not
            # allow a set-returning function inside CASE.)
            " CROSS JOIN LATERAL jsonb_array_elements_text("
            "   CASE WHEN q.kind = 'multi' THEN a.value"
            "        ELSE jsonb_build_array(a.value) END"
            " ) AS e(v)"
            " WHERE r.survey_id = %s AND q.kind IN ('single','multi','scale','number')"
            " GROUP BY 1, 2, 3 ORDER BY 1, 4 DESC",
            (sid,),
        )
        tallies = defaultdict(list)
        for row in cur.fetchall():
            tallies[row["code"]].append({"option": row["option"], "n": row["n"]})

        cur.execute(
            "SELECT ua_family, count(*) AS n FROM responses"
            " WHERE survey_id = %s GROUP BY 1 ORDER BY 2 DESC",
            (sid,),
        )
        devices = cur.fetchall()

        # Awareness results, for quiz-mode surveys. Empty list on a plain
        # questionnaire, so the dashboard just omits the section.
        cur.execute(
            "SELECT position, question, answered, correct, pct_correct"
            " FROM v_quiz_stats WHERE survey_id = %s ORDER BY position",
            (sid,),
        )
        knowledge = cur.fetchall()
        cur.execute(
            "SELECT score, out_of, count(*) AS n FROM v_quiz_scores"
            " WHERE survey_id = %s GROUP BY 1, 2 ORDER BY 1",
            (sid,),
        )
        score_hist = cur.fetchall()

    return jsonify(
        mode=survey["mode"],
        sources=sources, funnel=funnel, dropoff=dropoff, duration=duration,
        bodymap=bodymap, tallies=tallies, devices=devices,
        knowledge=knowledge, score_hist=score_hist,
    )


@app.get("/api/admin/<slug>/export.csv")
@trusted_only
def admin_export(slug):
    """`?format=wide` (default) is the spreadsheet shape; `long` is one row per
    answer. Columns are keyed on questions.code, never on prompt text."""
    if not SLUG_RE.match(slug):
        return jsonify(error="bad_slug"), 400
    fmt = request.args.get("format", "wide")

    with db().cursor() as cur:
        survey, _ = load_survey(cur, slug)
        if survey is None:
            return jsonify(error="not_found"), 404
        sid = survey["id"]

        cur.execute(
            "SELECT code, kind FROM questions WHERE survey_id = %s ORDER BY position",
            (sid,),
        )
        questions = cur.fetchall()

        out = io.StringIO()
        writer = csv.writer(out)

        if fmt == "long":
            writer.writerow(
                ["response_id", "locale", "source", "submitted_at", "question", "kind", "value"]
            )
            cur.execute(
                "SELECT l.response_id, l.locale, COALESCE(s.code, 'direct') AS source,"
                "       l.submitted_at, l.question, l.kind, l.value"
                " FROM v_answers_long l"
                " LEFT JOIN sources s ON s.id = l.source_id"
                " WHERE l.survey_id = %s ORDER BY l.response_id",
                (sid,),
            )
            for r in cur.fetchall():
                writer.writerow(
                    [r["response_id"], r["locale"], r["source"], r["submitted_at"],
                     r["question"], r["kind"], flatten(r["kind"], r["value"])]
                )
        else:
            codes = [q["code"] for q in questions]
            kinds = {q["code"]: q["kind"] for q in questions}
            writer.writerow(
                ["response_id", "locale", "source", "device", "submitted_at", "minutes"] + codes
            )
            cur.execute(
                "SELECT r.id, r.locale, COALESCE(s.code,'direct') AS source, r.ua_family,"
                "       r.submitted_at,"
                "       round((EXTRACT(EPOCH FROM (r.submitted_at - r.started_at))/60)::numeric,1) AS minutes,"
                "       COALESCE(jsonb_object_agg(q.code, a.value)"
                "                FILTER (WHERE q.code IS NOT NULL), '{}'::jsonb) AS ans"
                " FROM responses r"
                " LEFT JOIN sources s   ON s.id = r.source_id"
                " LEFT JOIN answers a   ON a.response_id = r.id"
                " LEFT JOIN questions q ON q.id = a.question_id"
                " WHERE r.survey_id = %s AND r.submitted_at IS NOT NULL"
                " GROUP BY r.id, s.code ORDER BY r.submitted_at",
                (sid,),
            )
            for r in cur.fetchall():
                ans = r["ans"] or {}
                writer.writerow(
                    [r["id"], r["locale"], r["source"], r["ua_family"],
                     r["submitted_at"], r["minutes"]]
                    + [flatten(kinds[c], ans.get(c)) for c in codes]
                )

    # BOM so Excel opens Czech diacritics correctly instead of mojibake.
    data = "﻿" + out.getvalue()
    return Response(
        data,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{slug}-{fmt}.csv"'},
    )


def flatten(kind, value):
    """One cell per answer, in a form a spreadsheet can pivot on."""
    if value is None:
        return ""
    if kind == "multi" and isinstance(value, list):
        return ";".join(value)
    if kind == "bodymap" and isinstance(value, dict):
        return ";".join(f"{k}={v}" for k, v in sorted(value.items()))
    return value


# ------------------------------------------------------------------ editor API
# Authoring, trusted networks only. Writes here change a live instrument, so the
# rules that protect collected data are enforced server-side, not in the UI:
#   * a question's `code` is the export key — it cannot change once answers exist
#   * deleting a question cascades to its answers, so that needs ?force=1
#   * option codes may not be removed while answers reference them

# A question code becomes a column header in the CSV export, so it stays a
# conservative identifier. Option codes are only ever map keys and the seeded
# ones already start with digits ("25_34") or contain hyphens ("shoulder-l"),
# so they get the looser rule — a validator stricter than the existing data
# would make those questions uneditable.
ACCENT_RE = re.compile(r"^#[0-9a-f]{6}$")
CODE_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
OPT_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
KINDS = ("text", "textarea", "single", "multi", "scale", "number", "date", "bodymap")


def question_answer_counts(cur, survey_id):
    cur.execute(
        "SELECT q.code, count(a.response_id) AS n"
        " FROM questions q LEFT JOIN answers a ON a.question_id = q.id"
        " WHERE q.survey_id = %s GROUP BY q.code",
        (survey_id,),
    )
    return {r["code"]: r["n"] for r in cur.fetchall()}


@app.get("/api/admin/surveys")
@trusted_only
def admin_surveys():
    with db().cursor() as cur:
        cur.execute(
            "SELECT s.slug, s.mode, s.is_open, s.default_locale, s.locales,"
            "       (SELECT count(*) FROM questions q WHERE q.survey_id = s.id) AS questions,"
            "       (SELECT count(*) FROM responses r"
            "         WHERE r.survey_id = s.id AND r.submitted_at IS NOT NULL) AS responses,"
            "       (SELECT title FROM survey_i18n i"
            "         WHERE i.survey_id = s.id AND i.locale = s.default_locale) AS title"
            " FROM surveys s ORDER BY s.slug",
            (),
        )
        return jsonify(surveys=cur.fetchall())


@app.get("/api/admin/<slug>/edit")
@trusted_only
def admin_edit_get(slug):
    """Full authoring view. Unlike the public endpoint this DOES include correct
    answers and explanations — it is only reachable from a trusted network."""
    if not SLUG_RE.match(slug):
        return jsonify(error="bad_slug"), 400

    with db().cursor() as cur:
        survey, _ = load_survey(cur, slug)
        if survey is None:
            return jsonify(error="not_found"), 404

        cur.execute(
            "SELECT locale, title, intro_md, consent_md, thanks_md"
            " FROM survey_i18n WHERE survey_id = %s",
            (survey["id"],),
        )
        i18n = {r.pop("locale"): r for r in cur.fetchall()}

        cur.execute(
            "SELECT id, code, kind, required, position, spec FROM questions"
            " WHERE survey_id = %s ORDER BY position",
            (survey["id"],),
        )
        questions = cur.fetchall()
        by_id = {q["id"]: q for q in questions}
        for q in questions:
            q["i18n"] = {}

        cur.execute(
            "SELECT question_id, locale, prompt, help, labels, explain_md"
            " FROM question_i18n WHERE question_id = ANY(%s)",
            ([q["id"] for q in questions],),
        )
        for row in cur.fetchall():
            q = by_id.get(row.pop("question_id"))
            if q is not None:
                q["i18n"][row.pop("locale")] = row

        counts = question_answer_counts(cur, survey["id"])
        for q in questions:
            q["answers"] = counts.get(q["code"], 0)
            q.pop("id", None)

    return jsonify(
        slug=survey["slug"], mode=survey["mode"], is_open=survey["is_open"],
        default_locale=survey["default_locale"], locales=survey["locales"],
        consent_ver=survey["consent_ver"], accent=survey["accent"],
        i18n=i18n, questions=questions,
    )


@app.put("/api/admin/<slug>/survey")
@trusted_only
def admin_edit_survey(slug):
    if not SLUG_RE.match(slug):
        return jsonify(error="bad_slug"), 400
    body = request.get_json(silent=True) or {}

    with db().cursor() as cur:
        survey, _ = load_survey(cur, slug)
        if survey is None:
            return jsonify(error="not_found"), 404

        if "is_open" in body:
            cur.execute("UPDATE surveys SET is_open = %s WHERE id = %s",
                        (bool(body["is_open"]), survey["id"]))

        # The colour wheel sends one seed; everything else is derived in the
        # browser. Validated here as well as by the column's CHECK, so a bad
        # value is a 422 naming the field rather than a 500 from Postgres.
        if "accent" in body:
            accent = body["accent"]
            if accent in (None, ""):
                accent = None
            elif not (isinstance(accent, str) and ACCENT_RE.match(accent.strip().lower())):
                return jsonify(error="invalid", detail=(
                    "accent must be a hex colour like #8d3f66, or null for the "
                    "default palette")), 422
            else:
                accent = accent.strip().lower()
            cur.execute("UPDATE surveys SET accent = %s WHERE id = %s",
                        (accent, survey["id"]))

        for locale, text in (body.get("i18n") or {}).items():
            if locale not in survey["locales"]:
                continue
            cur.execute(
                "INSERT INTO survey_i18n"
                " (survey_id, locale, title, intro_md, consent_md, thanks_md)"
                " VALUES (%s, %s, %s, %s, %s, %s)"
                " ON CONFLICT (survey_id, locale) DO UPDATE SET"
                "   title = EXCLUDED.title, intro_md = EXCLUDED.intro_md,"
                "   consent_md = EXCLUDED.consent_md, thanks_md = EXCLUDED.thanks_md",
                (survey["id"], locale, (text.get("title") or "").strip() or slug,
                 text.get("intro_md"), text.get("consent_md"), text.get("thanks_md")),
            )
        db().commit()
    return jsonify(ok=True)


def validate_question_body(body, survey, existing_code=None):
    """Returns (error_message, cleaned) — cleaned is ready to write."""
    code = (body.get("code") or "").strip()
    if not CODE_RE.match(code):
        return "code must be lowercase letters, digits and underscores", None
    kind = body.get("kind")
    if kind not in KINDS:
        return "unknown kind", None

    spec = body.get("spec")
    if not isinstance(spec, dict):
        return "spec must be an object", None

    if kind in ("single", "multi"):
        options = spec.get("options")
        if not isinstance(options, list) or not options:
            return "this kind needs at least one option", None
        if not all(isinstance(o, str) and OPT_RE.match(o) for o in options):
            return ("option codes must be lowercase letters, digits, "
                    "underscores or hyphens"), None
        if len(set(options)) != len(options):
            return "duplicate option codes", None
        for key in ("correct", "exclusive"):
            vals = spec.get(key)
            if vals is not None:
                if not isinstance(vals, list) or not all(v in options for v in vals):
                    return "%s must reference existing option codes" % key, None
    if kind == "bodymap" and not isinstance(spec.get("regions"), list):
        return "bodymap needs a regions list", None
    if kind == "scale":
        lo, hi = spec.get("min", 0), spec.get("max", 10)
        if not isinstance(lo, int) or not isinstance(hi, int) or lo >= hi:
            return "scale needs integer min < max", None

    return None, {
        "code": code,
        "kind": kind,
        "required": bool(body.get("required")),
        "spec": spec,
        "i18n": body.get("i18n") or {},
    }


def write_question_i18n(cur, question_id, i18n, locales):
    for locale, text in i18n.items():
        if locale not in locales:
            continue
        cur.execute(
            "INSERT INTO question_i18n"
            " (question_id, locale, prompt, help, labels, explain_md)"
            " VALUES (%s, %s, %s, %s, %s, %s)"
            " ON CONFLICT (question_id, locale) DO UPDATE SET"
            "   prompt = EXCLUDED.prompt, help = EXCLUDED.help,"
            "   labels = EXCLUDED.labels, explain_md = EXCLUDED.explain_md",
            (question_id, locale, (text.get("prompt") or "").strip() or "(untitled)",
             text.get("help"),
             psycopg.types.json.Jsonb(text.get("labels") or {}),
             text.get("explain_md")),
        )


@app.post("/api/admin/<slug>/questions")
@trusted_only
def admin_question_create(slug):
    if not SLUG_RE.match(slug):
        return jsonify(error="bad_slug"), 400
    body = request.get_json(silent=True) or {}

    with db().cursor() as cur:
        survey, _ = load_survey(cur, slug)
        if survey is None:
            return jsonify(error="not_found"), 404

        err, q = validate_question_body(body, survey)
        if err:
            return jsonify(error="invalid", detail=err), 422

        cur.execute("SELECT 1 FROM questions WHERE survey_id = %s AND code = %s",
                    (survey["id"], q["code"]))
        if cur.fetchone():
            return jsonify(error="duplicate_code"), 409

        cur.execute(
            "SELECT COALESCE(max(position), 0) + 10 AS p FROM questions WHERE survey_id = %s",
            (survey["id"],),
        )
        pos = cur.fetchone()["p"]
        cur.execute(
            "INSERT INTO questions (survey_id, position, code, kind, required, spec)"
            " VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
            (survey["id"], pos, q["code"], q["kind"], q["required"],
             psycopg.types.json.Jsonb(q["spec"])),
        )
        qid = cur.fetchone()["id"]
        write_question_i18n(cur, qid, q["i18n"], survey["locales"])
        db().commit()
    return jsonify(ok=True, code=q["code"]), 201


@app.put("/api/admin/<slug>/questions/<code>")
@trusted_only
def admin_question_update(slug, code):
    if not SLUG_RE.match(slug) or not CODE_RE.match(code):
        return jsonify(error="bad_request"), 400
    body = request.get_json(silent=True) or {}

    with db().cursor() as cur:
        survey, _ = load_survey(cur, slug)
        if survey is None:
            return jsonify(error="not_found"), 404

        cur.execute(
            "SELECT q.id, q.spec, q.kind, count(a.response_id) AS answers"
            " FROM questions q LEFT JOIN answers a ON a.question_id = q.id"
            " WHERE q.survey_id = %s AND q.code = %s GROUP BY q.id",
            (survey["id"], code),
        )
        row = cur.fetchone()
        if row is None:
            return jsonify(error="not_found"), 404

        err, q = validate_question_body(body, survey, code)
        if err:
            return jsonify(error="invalid", detail=err), 422

        answered = row["answers"] > 0
        # The export key must not move once data exists, or a half-finished
        # analysis silently splits into two columns.
        if answered and q["code"] != code:
            return jsonify(error="code_locked", detail=(
                "%d answers already use this code; renaming it would split the "
                "export column" % row["answers"]), answers=row["answers"]), 409
        if answered and q["kind"] != row["kind"]:
            return jsonify(error="kind_locked", detail=(
                "%d answers are stored in the old shape; changing the kind would "
                "make them unreadable" % row["answers"]), answers=row["answers"]), 409

        # Removing an option that answers already point at would orphan them.
        if answered and q["kind"] in ("single", "multi"):
            old = set((row["spec"] or {}).get("options", []))
            gone = old - set(q["spec"].get("options", []))
            if gone:
                cur.execute(
                    "SELECT count(*) AS n FROM answers a"
                    " WHERE a.question_id = %s AND ("
                    "   a.value #>> '{}' = ANY(%s)"
                    "   OR EXISTS (SELECT 1 FROM jsonb_array_elements_text("
                    "       CASE WHEN jsonb_typeof(a.value)='array' THEN a.value"
                    "            ELSE '[]'::jsonb END) v WHERE v = ANY(%s)))",
                    (row["id"], list(gone), list(gone)),
                )
                used = cur.fetchone()["n"]
                if used:
                    return jsonify(error="option_in_use", detail=(
                        "%d answers still use: %s" % (used, ", ".join(sorted(gone)))
                    )), 409

        cur.execute(
            "UPDATE questions SET code = %s, kind = %s, required = %s, spec = %s"
            " WHERE id = %s",
            (q["code"], q["kind"], q["required"],
             psycopg.types.json.Jsonb(q["spec"]), row["id"]),
        )
        write_question_i18n(cur, row["id"], q["i18n"], survey["locales"])
        db().commit()
    return jsonify(ok=True, code=q["code"])


@app.delete("/api/admin/<slug>/questions/<code>")
@trusted_only
def admin_question_delete(slug, code):
    if not SLUG_RE.match(slug) or not CODE_RE.match(code):
        return jsonify(error="bad_request"), 400

    with db().cursor() as cur:
        survey, _ = load_survey(cur, slug)
        if survey is None:
            return jsonify(error="not_found"), 404
        cur.execute(
            "SELECT q.id, count(a.response_id) AS answers"
            " FROM questions q LEFT JOIN answers a ON a.question_id = q.id"
            " WHERE q.survey_id = %s AND q.code = %s GROUP BY q.id",
            (survey["id"], code),
        )
        row = cur.fetchone()
        if row is None:
            return jsonify(error="not_found"), 404

        # Deleting cascades to answers. Never do that on a single click.
        if row["answers"] and request.args.get("force") != "1":
            return jsonify(error="has_answers", answers=row["answers"], detail=(
                "%d collected answers would be deleted with it" % row["answers"]
            )), 409

        cur.execute("DELETE FROM questions WHERE id = %s", (row["id"],))
        db().commit()
    return jsonify(ok=True, deleted=code, answers_deleted=row["answers"])


@app.post("/api/admin/<slug>/questions/reorder")
@trusted_only
def admin_question_reorder(slug):
    if not SLUG_RE.match(slug):
        return jsonify(error="bad_slug"), 400
    codes = (request.get_json(silent=True) or {}).get("codes")
    if not isinstance(codes, list) or not codes:
        return jsonify(error="codes required"), 400

    with db().cursor() as cur:
        survey, _ = load_survey(cur, slug)
        if survey is None:
            return jsonify(error="not_found"), 404
        cur.execute("SELECT code FROM questions WHERE survey_id = %s", (survey["id"],))
        known = {r["code"] for r in cur.fetchall()}
        if set(codes) != known:
            return jsonify(error="codes must list every question exactly once"), 422

        # UNIQUE(survey_id, position) is DEFERRABLE INITIALLY DEFERRED, so the
        # positions can be rewritten in place without shuffling through a gap.
        for i, code in enumerate(codes, start=1):
            cur.execute(
                "UPDATE questions SET position = %s WHERE survey_id = %s AND code = %s",
                (i * 10, survey["id"], code),
            )
        db().commit()
    return jsonify(ok=True)


@app.get("/api/health")
def health():
    with db().cursor() as cur:
        cur.execute("SELECT 1 AS ok")
        cur.fetchone()
    return jsonify(ok=True)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5051, debug=True)
