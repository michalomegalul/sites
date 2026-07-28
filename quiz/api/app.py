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
        "SELECT id, slug, default_locale, locales, consent_ver, is_open, mode"
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


@app.get("/api/health")
def health():
    with db().cursor() as cur:
        cur.execute("SELECT 1 AS ok")
        cur.fetchone()
    return jsonify(ok=True)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5051, debug=True)
