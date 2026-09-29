# quiz.dobsinsky.dev - survey engine

Handoff spec. Everything below is decided; treat open questions as the only
things to ask about.

## What this is

A self-hosted survey engine replacing Google Forms. First tenant is a
questionnaire for a Czech nursing-school thesis (*odborná práce*) on
endometriosis. The engine is generic - surveys are rows, not code - but the
first survey's needs drive the feature set.

Lives in the `sites` monorepo alongside the existing portfolio.

## Hard constraints

These are not negotiable; they came out of GDPR analysis and the school's
methodology requirements.

1. **Responses are anonymous.** No names, no emails, no IP addresses stored on
   or joinable to a response. Respondents disclose symptoms and diagnoses -
   that is Article 9 special-category data under GDPR.
2. **Answers store language-neutral codes, never display text.** A Czech
   respondent choosing "Ano" and an English one choosing "Yes" must land in the
   database as the same value, or the statistics split in half.
3. **The follow-up email list has no foreign key to `responses`.** It exists so
   participants can be sent results; it must not be joinable to anyone's
   answers.
4. **Consent is recorded as data**, with the version of the consent text the
   respondent agreed to (`responses.consent_ver`).
5. **User-agent is stored as a coarse family** ("Firefox/Android"), not the
   full string, which is near-unique.

The sample is a small convenience sample of people the researcher knows
personally. That makes free-text answers re-identifiable in combination.
Prefer closed questions; keep free-text few and narrow.

## Deployment target

- Host: LXC `cloudflared` (192.168.4.37), Debian 13, behind Cloudflare Tunnel.
- Checkout: `/opt/sites`, owned by `ghrunner`. Deploys run
  `/opt/sites/deploy/deploy.sh quiz` from a self-hosted GitHub Actions runner
  on push to `master` touching `quiz/**`.
- `git reset --hard` runs on every deploy. **No runtime state inside the
  checkout.**
- App: gunicorn on `127.0.0.1:5051`, systemd unit `quiz-api`, `User=www-data`.
- nginx serves `quiz/site/` statically and proxies `/api/` to `:5051`.
  Single `listen 127.0.0.1:8480` block, `server_name quiz.dobsinsky.dev`.
  Must force `X-Net: public` and set `X-Real-IP` from `CF-Connecting-IP`,
  matching the portfolio's existing trust contract, so the new subdomain
  cannot be used to spoof into it.
- Postgres 18 on a separate LXC (192.168.4.32). Connection string in
  `quiz/api/.env` as `DATABASE_URL`, file mode `640 root:www-data`.
  The app must also call `load_dotenv()` itself - see "Known traps".

## Layout

```
quiz/
├── api/            Flask app, requirements.txt, quiz-api.service, .env.example
├── site/           frontend (static, no build step preferred)
├── db/             001_init.sql and numbered migrations
└── nginx.conf
```

## Schema

Already applied; see `quiz/db/001_init.sql`. Summary:

- `surveys` - slug, `default_locale`, `locales[]`, `consent_ver`, `is_open`
- `survey_i18n` - (survey_id, locale) → title, intro_md, consent_md, thanks_md
- `questions` - survey_id, position, **code** (stable export key), kind,
  required, `spec` JSONB (option codes, scale bounds, bodymap regions)
- `question_i18n` - (question_id, locale) → prompt, help, `labels` JSONB
  mapping option code → display text
- `sources` - per-survey link codes for attribution
- `responses` - survey_id, source_id, locale, started_at, submitted_at,
  consent_ver, ua_family
- `answers` - (response_id, question_id) → value JSONB
- `followups` - opt-in emails, deliberately unlinked
- Views: `v_source_stats`, `v_answers_long`

Migrations are numbered SQL files applied manually. No ORM migration tool.

## URL scheme

```
/{locale}/s/{slug}?src={code}
```

e.g. `/cs/s/endo-2026?src=insta`, `/en/s/endo-2026?src=insta`

- Locale is a path segment, **not** a cookie or `Accept-Language`. The link
  itself determines language so a Czech link pasted in a Czech group cannot
  land someone in English.
- The language switcher rewrites the path segment and preserves `?src`.
- `src` resolves against `sources` server-side. Unknown values store `NULL` -
  never auto-create rows, or the stats can be polluted from the query string.
- `/` redirects to the survey's `default_locale`.

## API

```
GET  /api/s/{slug}?locale=cs        survey + questions + labels for one locale
POST /api/s/{slug}/start            {locale, src} → {response_id}
PATCH /api/r/{response_id}          {question_code: value, ...} partial save
POST /api/r/{response_id}/submit    sets submitted_at
POST /api/s/{slug}/followup         {email} → writes to followups
```

- `response_id` is a UUID held in `localStorage`, enabling resume after an
  interrupted session. It is a bearer capability: it permits writing to that
  one incomplete response and nothing else. Reject `PATCH` once
  `submitted_at` is set.
- Validate `required` and option codes server-side. Never trust the client.
- Rate-limit `start` per source to blunt trivial flooding.

## Question kinds

`text` `textarea` `single` `multi` `scale` `number` `date` `bodymap`

`bodymap` is the centrepiece. An SVG body outline (front and back) with named
anatomical regions; tapping a region cycles intensity 0–3.

```
spec:  {"regions": ["pelvis", "sacrum", "shoulder-l", ...]}
value: {"pelvis": 3, "sacrum": 2, "shoulder-l": 1}
```

**Named regions, not freehand coordinates.** Coordinates cannot be tabulated
or graphed; the thesis requires basic statistical processing with tables and
charts. Regions aggregate with one query:

```sql
SELECT k AS region, count(*) AS respondents, round(avg(v::int), 2) AS mean_intensity
FROM answers a
CROSS JOIN LATERAL jsonb_each_text(a.value) AS e(k, v)
WHERE a.question_id = $1 AND v::int > 0
GROUP BY k ORDER BY respondents DESC;
```

Region set must include referral sites, not just the obvious ones: lower
abdomen (L/R), suprapubic pelvis, groin, thighs, lower back, sacrum/coccyx,
buttocks, rectal/deep pelvic, under-ribs, and **shoulders** - diaphragmatic
lesions refer pain to the shoulder, and a plain checkbox list never catches it.

## Frontend

Design constraint that should drive everything: this is filled in on a phone,
often lying down, often by someone who feels awful.

- One question per screen, large tap targets, generous type, honest progress
  indicator.
- Autosave on every answer via `PATCH`. Resume from `localStorage` on return.
- Consent screen first, checkbox unticked by default. Plain language. It must
  state that the researcher will see the answers and, given the small sample,
  may be able to tell who wrote what.
- The body map gets the whole screen; everything else gets out of its way.
- Prefer vanilla JS or a single-file framework over a build pipeline - the
  deploy script has no `npm` step and shouldn't need one.
- Full CZ and EN parity. Czech diacritics and typography must be correct.

## Researcher-facing

Behind Tailscale/LAN only, never public:

- `GET /api/admin/{slug}/export.csv` - long format from `v_answers_long`,
  plus a wide format keyed on `questions.code`, which is what she'll actually
  load into a spreadsheet.
- Aggregate view: per-question tallies, source funnel from `v_source_stats`,
  body-map heat map.
- `GET /{locale}/s/{slug}/print` - the blank questionnaire, print-stylesheet
  clean, all regions unfilled and labelled. **Required as a thesis appendix.**

## Non-goals

- No respondent accounts or logins.
- No scoring, branching logic, or personality typing. It collects answers.
- No admin CRUD UI for authoring questions in v1 - seed SQL is fine.
- No analytics, no third-party scripts, no fonts from outside the origin.

## Known traps

- Venvs are not relocatable: `venv/bin/*` shebangs hardcode absolute paths.
  If the checkout moves, delete the venv and let the deploy rebuild it.
- `EnvironmentFile=` is read by systemd as root, but the app also calls
  `load_dotenv()` as `www-data`. python-dotenv raises on an unreadable file
  rather than skipping it, so `.env` must be `640 root:www-data` - not `600`.
- `pg_hba.conf` is first-match-wins. A permissive catch-all above a specific
  rule silently defeats it.
- nginx `sites-enabled/` entries here must be symlinks. A regular file there
  diverges from `sites-available/` and edits go nowhere.

## Definition of done

1. Czech and English links both render the full questionnaire on a phone.
2. A part-finished response resumes after closing the browser.
3. Body map records regions; heat map renders from real rows.
4. CSV export opens cleanly in a spreadsheet, columns keyed on question codes.
5. Print view produces an appendix-ready blank questionnaire.
6. Push to `master` deploys it with no manual step.
7. `followups` cannot be joined to `responses` by any query in the codebase.
