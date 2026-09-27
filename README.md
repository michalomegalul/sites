# sites

Monorepo for everything served off the `cloudflared` LXC. One checkout at
`/opt/sites`, one deploy script, one runner.

| Site | Domain | What it is |
|---|---|---|
| [`portfolio/`](portfolio/) | `dobsinsky.dev` | CV, projects, and a trusted-only Proxmox panel |
| [`quiz/`](quiz/) | `quiz.dobsinsky.dev` | self-hosted survey engine — see [`quiz/SPEC.md`](quiz/SPEC.md) |

```
deploy/deploy.sh      shared: git reset --hard, rebuild venv, restart unit, reload nginx
.github/workflows/    one workflow per site, path-filtered
portfolio/            \  each site owns its own site/, api/, nginx.conf
quiz/                 /  and its own systemd unit
```

## Deploying

Push to `master`. A workflow fires for each site whose paths changed and runs
`/opt/sites/deploy/deploy.sh <site>` on the self-hosted runner.

The deploy script does **only** these: fetch and `git reset --hard`, rebuild the
venv if `requirements.txt` exists, restart `<site>-api` **if that unit is already
installed**, then `nginx -t && systemctl reload nginx`.

It deliberately does not install systemd units, write `.env`, symlink nginx
configs, or run database migrations. Those are one-time, root-owned, and
sometimes destructive — so they stay manual. **A green workflow does not mean a
working site on first deploy.** See the first-time setup below.

> `git reset --hard` runs every time. Nothing that must survive a deploy may
> live inside the checkout.

### When a deploy is green but the box is unchanged

`deploy.sh` aborts **before** `git reset --hard` if anything under
`/opt/sites/.git` is owned by someone other than the runner. Run one git command
in `/opt/sites` as root and it rewrites `.git/index` as root; every later deploy
stops there, so the checkout silently stays at an old commit while pushes keep
going green. Symptom: a file you know you fixed still has the old contents on the
box.

```bash
git -C /opt/sites log --oneline -1        # is the checkout where you think?
find /opt/sites/.git ! -user ghrunner -print | head
```

**Check that before copying anything out of the checkout.** Copying an
`nginx.conf` out of a stale one is how the portfolio ended up with a `root`
pointing at a directory that no longer existed, and a 404 on the live site.

The fix is `chown -R ghrunner:ghrunner /opt/sites`, but it has a sting:

> That also strips `root:www-data` off **every** `.env`, and python-dotenv raises
> on a file it cannot read rather than skipping it — so the next restart of
> either API dies before it serves a request. Re-apply in the same breath:
>
> ```bash
> chown -R ghrunner:ghrunner /opt/sites
> for f in /opt/sites/*/api/.env; do chown root:www-data "$f"; chmod 640 "$f"; done
> ```
>
> Runtime state is **not** in the checkout, so there is nothing else to repair:
> `visitors.db` and `now.json` live in `/var/lib/portfolio-api`, created by
> systemd's `StateDirectory=` and owned by `www-data`.
>
> That move fixed a bug worth remembering the shape of. SQLite writes its
> rollback journal *beside* the database file, so a write needs a writable
> **directory**, not just a writable file. With the database inside the
> runner-owned checkout, `/api/whoami` raised on every `INSERT` and 500'd, the
> front end's `catch` swallowed it, and the badge silently read PUBLIC on the
> LAN — while `/api/visits` kept working the whole time because it is a plain
> `SELECT`. It looked like a broken trust contract and was a filesystem
> permission.

Don't work in `/opt/sites` as root. Use `sudo -u ghrunner` for anything touching
git.

## quiz — first-time setup

Everything here is done once, as root on the `cloudflared` LXC.

**1. Database** (Postgres on 192.168.4.32). Create the database and roles once:

```bash
psql -h 192.168.4.32 -U postgres -c "CREATE DATABASE quiz;"
psql -h 192.168.4.32 -U postgres -c "CREATE ROLE quiz LOGIN PASSWORD 'something-long';"
psql -h 192.168.4.32 -U postgres -d quiz -c \
  "GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO quiz;
   GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO quiz;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public
     GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO quiz;"
```

**Migrations then run themselves.** `deploy.sh` runs `db/migrate.py` before
restarting the service, so the schema is never behind the code — the failure
that motivated this was deploying an app that selected `surveys.mode` before
that column existed, which 500s every request including the survey that was
already working.

The runner records what it applied in `schema_migrations` and skips it
afterwards, so it is a no-op once you are current. On a database that already
has tables but no `schema_migrations` it adopts `001`–`003` as a baseline
rather than replaying them — `001` is not idempotent and `003` would delete
collected responses. Run it by hand any time with:

```bash
/opt/sites/quiz/api/venv/bin/python /opt/sites/quiz/db/migrate.py --dry-run
```

The `ALTER DEFAULT PRIVILEGES` line matters: without it, every migration that
adds a table or view needs a fresh `GRANT` before the app can read it.

**`migrate.py` now re-asserts those grants itself**, on every run rather than
only when it applies something — so a database that is already current but
missing a grant repairs itself. It grants to `APP_DB_ROLE` (default `quiz`); if
the connecting role isn't allowed to grant, it warns loudly and carries on
rather than failing the deploy.

That exists because of a real outage worth understanding, since the shape
recurs. Nine views have been created by migrations and **not one carried a
`GRANT`** — whether the API could read them depended entirely on whether
`ALTER DEFAULT PRIVILEGES` happened to be set for whichever role ran the
migration. When it wasn't, nothing failed at migration time. It surfaced weeks
later as `permission denied for view v_quiz_stats` — a 500 on the results
dashboard, introduced by `004` but only noticed once the quiz had responses
worth looking at. A migration that succeeds is not the same claim as a schema
the app can read.

**2. Config.** `.env` must be `640 root:www-data` — python-dotenv raises on an
unreadable file rather than skipping it, and the app loads it as `www-data`.

```bash
cd /opt/sites/quiz/api
cp .env.example .env && nano .env          # DATABASE_URL
chown root:www-data .env && chmod 640 .env
```

**Two users need to read that file, not one.** The app reads it as `www-data`,
but `deploy.sh` runs `db/migrate.py` as the **runner**, so `ghrunner` needs it
too. With `640 root:www-data` and nothing else, every deploy dies in migrate.py
with `PermissionError: '/opt/sites/quiz/db/../api/.env'` — and because the
migration step precedes the service restart, the deploy stops there. Loosening
the mode to `644` is the wrong fix: `DATABASE_URL` contains the password. Put the
runner in the group instead:

```bash
usermod -aG www-data ghrunner
sudo -u ghrunner cat /opt/sites/quiz/api/.env >/dev/null && echo "runner can read it"
```

One-time, and it survives the `chown -R` recipe above because that keeps the
group as `www-data`.

**3. Service and nginx.** Entries in `sites-enabled/` must be symlinks; a
regular file there silently diverges from `sites-available/`.

```bash
cp /opt/sites/quiz/api/quiz-api.service /etc/systemd/system/
systemctl enable --now quiz-api

cp /opt/sites/quiz/nginx.conf /etc/nginx/sites-available/quiz
ln -s /etc/nginx/sites-available/quiz /etc/nginx/sites-enabled/
nano /etc/nginx/sites-enabled/quiz        # confirm the LAN IP in the internal block
nginx -t && systemctl reload nginx
```

**4. Cloudflare Tunnel.** Add a `quiz.dobsinsky.dev` ingress pointing at
`http://127.0.0.1:8480`. Both sites share that port and are separated by
`server_name`.

Check it: `curl -s localhost:5051/api/health` → `{"ok":true}`.

## The two surveys

| Slug | Mode | Audience | Point |
|---|---|---|---|
| `endo-2026` | survey | people who have or suspect endometriosis | collect symptoms, impact, care experience |
| `endo-znalosti` | quiz | the general public | measure what people know, and teach them |

`endo-znalosti` is the awareness quiz: 12 graded questions plus 4 ungraded
context ones. Each graded answer is recorded **and then** the respondent is
shown whether they were right, with a short explanation; the end screen gives a
score and a recap.

Two things make the numbers trustworthy:

- **The answer key never reaches the browser.** `GET /api/s/{slug}` strips
  `correct` from every spec and sends `graded: true` instead. Correct options
  and explanations come back from the `PATCH` that saves the answer, so the
  recorded answer is always the one given *before* the solution was visible.
- **A multi-choice answer must match the correct set exactly**, so ticking
  every box scores nothing. The SQL view and the Python grader implement the
  same rule.

For the thesis, `v_quiz_stats` gives the per-question table directly ("83 %
knew that pregnancy does not cure it") and `v_quiz_scores` gives the score
distribution. Both appear on the dashboard under *What people knew*.

Because `heard_before` and `knows_someone` are ungraded context questions, you
can segment awareness by them — for example, whether knowing someone with the
diagnosis predicts a higher score.

## The landing page

`https://quiz.dobsinsky.dev/` is a chooser listing every open survey, built from
the public `GET /api/surveys`. It used to redirect straight into `endo-2026`.

That endpoint is deliberately not `/api/admin/surveys`: the admin one carries
submitted-response counts. The public one returns slug, title, mode, locales and
the first paragraph of the intro, and **a closed survey is not listed publicly at
all** — its existence is not something the internet needs to know.

The response also carries `trusted`, and when it is true the page renders an
admin block with per-survey links to the dashboard, the editor and the CSV
export. That flag is decided server-side by the same gate as every other admin
surface, so from the internet it is simply false. Over LAN or Tailscale
(`http://quiz.internal/`) it is true and the block appears.

`index.html` is still `noindex, nofollow`. That is right for the questionnaires;
if you ever want the landing page itself to be findable, that meta tag is the
one thing to change.

## Themes and chrome

The quiz has a site bar (brand, language) and a footer on the chooser, consent
and thanks screens. Question screens get neither — one question per screen is a
SPEC rule, and a link out of the survey mid-survey is an accidental exit. The
print view drops all of it.

### The accent colour is the researcher's, not the respondent's

There used to be a four-palette picker in the public header. It is gone. Colour
is now a property of the **survey**, chosen with a colour wheel in the editor and
stored in `surveys.accent`. A questionnaire should look the same to everyone
filling it in, and a palette picker on a question screen is decoration competing
with the question.

**You pick one colour; everything else is derived.** `site/js/palette.js` builds
the background, ink, borders and accent ramp from that seed and *clamps
lightness until the contrast floors hold*:

| Pair | Floor |
|---|---|
| body text on background | 7.0:1 (AAA) |
| secondary text on background | 4.5:1 (AA) |
| accent on background | 4.5:1 (AA) |

`quiz/tools/palette.test.js` proves this over every hue — 11,584 assertions
across 1,448 seeds, including pure yellow, neon cyan, white, black and mid grey,
which are the ones that break naive derivation. Run it after touching the
derivation:

```bash
node quiz/tools/palette.test.js
```

Storing the individual variables instead of a seed would hand back exactly the
way to break this, which is why the wheel gives you one choice. The editor shows
the derived light and dark palettes side by side with their measured ratios, so
a colour that only works in one mode is visible before you save. Expect the
rendered accent to differ from the swatch you picked — that is the clamping
doing its job.

`NULL` accent means the built-in rose, so a survey that has never been themed
looks exactly as it always did.

**`--pain-1/2/3` is not derived and never changes with the accent.** It encodes
intensity on the body map, so it is data rather than decoration, and it has to
stay distinguishable from the accent or a selected region reads as a painful one.

The accent is applied before first paint from a per-survey cache in
`localStorage`, then corrected from `GET /api/s/{slug}`. A first-time visitor
sees the default palette for one paint; the alternative is blocking first paint
on a network round trip.

## Links to hand out

```
https://quiz.dobsinsky.dev/                                chooser (all surveys)
https://quiz.dobsinsky.dev/cs/s/endo-2026?src=insta        patient questionnaire
https://quiz.dobsinsky.dev/cs/s/endo-znalosti?src=insta    awareness quiz
https://quiz.dobsinsky.dev/en/s/endo-znalosti?src=insta
```

Language is the path segment, never a cookie — a Czech link pasted into a Czech
group cannot land someone in English. `?src=` must match a row in `sources`
(`direct`, `insta`, `fb-group`, `reddit`, `clinic`, `word`); anything else is
stored as NULL rather than auto-created, so the funnel cannot be polluted from
the query string.

## Reading the results

The dashboard and exports are on the internal hostname only —
`http://quiz.internal/` over LAN or Tailscale. The public block returns 404 for
both the pages and the admin API, and the API checks the network itself as well.

**Start at `http://quiz.internal/`**, not at a remembered filename. That is the
same chooser the public sees, except the admin block is rendered: one row per
survey with links to its dashboard, its editor and its CSV export. Install
Tailscale on your phone and the same URL works from anywhere, with nothing
exposed to the internet.

This is deliberately *not* reachable at `quiz.dobsinsky.dev` from your home
broadband. It would mean allowlisting a residential IP, and the editor can
delete collected answers — the day the ISP reassigns that address, whoever gets
it inherits the access. Tailscale costs one app and has no such failure mode.

| What | Where |
|---|---|
| **Edit questions and survey text** | `/editor.html` |
| Completion, sources, drop-off, pain heat map | `/admin.html` |
| Spreadsheet export, one row per response | `/api/admin/endo-2026/export.csv` |
| Long format, one row per answer | `…/export.csv?format=long` |
| Blank questionnaire for the thesis appendix | `/cs/s/endo-2026/print` → print to PDF |

CSV columns are keyed on `questions.code`, never on prompt text, so renaming a
question in Czech does not break a half-finished analysis. The file carries a
UTF-8 BOM so Excel opens Czech diacritics correctly.

**The useful number is drop-off.** `v_dropoff` gives the last question answered
by everyone who started but never submitted. A spike at one question means that
question is the problem — too personal, too confusing, or too much typing.
Position 0 means they consented and left immediately, which points at the
consent screen or the first question rather than anything deeper in.

## Analytics

**There is none, and that is a decision rather than a gap.**

Google Analytics was wired in, consent-gated, deployed, and then removed on
2026-07-30. Two reasons, in order of weight:

1. **The dashboard already answers the question better.** GA was there to show
   where people give up. `v_dropoff` gives the last question answered by everyone
   who started and never submitted — by question code, with no sampling and no
   setup. To chart the same thing in GA you had to register a custom dimension
   and wait for it to start collecting. The local view was always the better
   source; the README said so even while GA was installed.
2. **It was the only off-origin request left.** Fonts and GSAP are self-hosted
   now, so removing the tag made `default-src 'self'` with no exceptions true of
   the whole site. The CSP in `quiz/nginx.conf` no longer allow-lists anything
   external, which means a script added by accident is *blocked*, not merely
   discouraged.

What replaced it: nothing on the quiz, because nothing was needed. On the
portfolio, `GET /api/visits` counts people and visits from the existing
`visitors` table — first-party, aggregate, and the id never leaves the box.

> Worth keeping in mind if you are ever tempted to add a tag back, since it is a
> thesis on the line: the respondents are a small group approached personally. A
> GA client ID plus a timestamp, combined with knowing who was sent a link and
> when, is a re-identification path that the survey data alone does not have. The
> drop-off and funnel views answer "how do I make this better?" without that
> exposure.

## Blocking bots

Three layers, outside-in. The first two need no script on the page.

**1. Cloudflare (do this first — it is where the traffic actually arrives).**
In the dashboard for `dobsinsky.dev`:

- **Security → Bots → Bot Fight Mode: on.** Challenges known bad automation at
  the edge, before it ever reaches the tunnel.
- **Security → WAF → Rate limiting rules.** Add one: expression
  `(http.host eq "quiz.dobsinsky.dev" and starts_with(http.request.uri.path, "/api/"))`,
  10 requests per 10 seconds per IP, action *Block*, duration 60 s.
- **Security → WAF → Custom rules.** Managed Challenge where
  `cf.threat_score gt 20` on that hostname.
- **Scrape Shield → Email obfuscation: on.**

Turnstile is the escalation if these are not enough. It is deliberately not used
yet: it is a third-party script in the page, which the SPEC rules out, and the
edge rules cost nothing in privacy.

**2. nginx** (`quiz/nginx.conf`) — defense in depth, already configured:
30 req/min per IP on `/api/`, 5 req/min on `start`, 20 concurrent connections,
256 KB body cap.

The zones key on `$http_cf_connecting_ip`, **not** `$binary_remote_addr`.
cloudflared connects from localhost, so every public request has
`$remote_addr = 127.0.0.1`; a zone keyed on that would throttle the entire site
as one bucket. If you copy these rules to another block, check that first.

**3. The app** — a honeypot field hidden with CSS on both the start and followup
forms, a minimum time between `start` and `submit` (`MIN_FILL_SECONDS`, default
15 s), and per-IP hourly caps on `start` and `followup`. Rate-limit state is
kept in process memory and keyed on the Cloudflare client IP, which is never
written to the database — an IP must not end up in Postgres next to health data.

### CrowdSec (the shared-blocklist one)

CrowdSec is the tool where detections are pooled: it reads your nginx logs
locally, and IPs that misbehave against *anyone* in the community land in a
blocklist that everyone pulls. It runs as its own service (or container) with a
separate "bouncer" that does the actual blocking.

It fits here, but **read the real-IP warning below before installing it.**

```bash
curl -s https://install.crowdsec.net | sudo sh
apt install -y crowdsec crowdsec-firewall-bouncer-iptables
cscli collections install crowdsecurity/nginx
systemctl reload crowdsec
```

Check it is parsing real addresses, not loopback:

```bash
cscli metrics                 # nginx lines should be climbing
cscli alerts list
cscli decisions list          # who is currently blocked
cscli decisions delete --ip 1.2.3.4     # if it blocks someone real
```

> **The trap.** cloudflared connects from localhost, so by default every public
> request is logged with `remote_addr = 127.0.0.1`. CrowdSec would attribute all
> traffic — including attacks — to the loopback address and eventually ban it,
> which takes the whole site down while looking like a random outage.
>
> Both `quiz/nginx.conf` and `portfolio/nginx.conf` now carry the fix:
> `set_real_ip_from 127.0.0.1` plus `real_ip_header CF-Connecting-IP` in the
> Cloudflare-facing block, so `$remote_addr` and the log line carry the true
> client IP. They are deliberately **not** in the internal blocks, where
> `$remote_addr` must stay the real LAN peer.
>
> Since `deploy.sh` never copies nginx configs, a fix in this repo is not a fix
> on the box. Confirm the live files before trusting the parser:
>
> ```bash
> grep -c real_ip_header /etc/nginx/sites-enabled/portfolio /etc/nginx/sites-enabled/quiz
> ```
>
> Two `1`s means you are good. A `0` means that file predates the fix:
>
> ```bash
> cp /opt/sites/portfolio/nginx.conf /etc/nginx/sites-available/portfolio
> nginx -t && systemctl reload nginx
> ```
>
> That `cp` is safe as of 2026-07-29, when the repo copy was reconciled against
> the live file: it had drifted to `root /opt/portfolio/site` and
> `listen 192.168.4.30:80`, neither of which exists on the box. If you ever
> hand-edit a live config again, fix the repo copy in the same sitting — the
> next person to run that `cp` is trusting it.

### The DEFENCE panel on the portfolio

The A-section panel and the slim header chip both come from one pass over two
endpoints, and each half fails on its own — CrowdSec being absent still leaves a
working visit counter.

| Endpoint | Public? | Returns |
|---|---|---|
| `GET /api/crowdsec` | yes | blocked now, alerts 24h/7d, requests 7d |
| `GET /api/visits` | yes | visitor count, visit count, active in 7d |
| `GET /api/visitors` | **trusted only** | vids, names, user-agents — the detail |

`/api/visits` exists so the front page never needs the trusted one. If you find
yourself wanting to put a name or a user-agent on the public panel, that is the
line: aggregate is public, per-visitor is not.

### The counter on the portfolio

The status bar on `dobsinsky.dev` shows `⛨ N BLOCKED · M/7D`, served by
`GET /api/crowdsec`. It is public but returns **counts only** — the addresses
behind them never leave the box. Publishing a blocked-IP list would be both a
privacy problem and a free reputation feed for whoever wanted one.

`cscli` needs root to read the local API credentials, so the API calls it
through `sudo -n` with a fixed argument list. Grant exactly the two read-only
subcommands and nothing else:

```bash
cat >/etc/sudoers.d/portfolio-crowdsec <<'EOF'
www-data ALL=(root) NOPASSWD: /usr/bin/cscli decisions list -o json
www-data ALL=(root) NOPASSWD: /usr/bin/cscli alerts list -o json --since * --limit 0
EOF
chmod 440 /etc/sudoers.d/portfolio-crowdsec
visudo -c
```

Check it works as the service user, which is the thing that actually matters:

```bash
sudo -u www-data sudo -n /usr/bin/cscli decisions list -o json | head -c 200
curl -s localhost:5050/api/crowdsec
```

The response caches for 120 s, so the counter costs one `cscli` pair per two
minutes no matter how many people load the page. If CrowdSec is not installed
yet the endpoint 502s and the status bar simply stays empty — set `CROWDSEC=0`
in `.env` to switch it off deliberately.

`events_7d` is the number of malicious *requests*, not incidents: one alert
bundles the several requests that triggered it. That is the bigger number and
the one on the bar.

### Verifying the Cloudflare bouncer

The firewall bouncer blocks at the LXC, after Cloudflare. The Cloudflare
bouncer blocks at the edge instead, so the visitor never reaches the box — but
it fails quietly if the API token is wrong, and a quiet failure looks exactly
like "no attacks today". Check it explicitly:

```bash
systemctl status crowdsec-cloudflare-bouncer --no-pager
cscli bouncers list                      # yours must show a recent "last pull"
journalctl -u crowdsec-cloudflare-bouncer -n 40 --no-pager
```

The decisive test is whether decisions actually reach Cloudflare. Add one for a
harmless address, then look for it in the dashboard under **Security → WAF →
Tools → IP Access Rules**:

```bash
cscli decisions add --ip 203.0.113.42 --duration 5m --reason "bouncer test"
sleep 30 && journalctl -u crowdsec-cloudflare-bouncer -n 20 --no-pager
cscli decisions delete --ip 203.0.113.42
```

`203.0.113.0/24` is the reserved documentation range, so this cannot lock out
anyone real. The token needs **Zone → Firewall Services → Edit** on the zone; a
token missing that scope is the usual cause of a bouncer that starts cleanly and
then does nothing.

Because traffic arrives through the tunnel, the firewall bouncer blocks at the
LXC, after Cloudflare. To block at the edge instead — cheaper, and the visitor
never reaches your box — use the Cloudflare bouncer with a scoped API token:

```bash
apt install -y crowdsec-cloudflare-bouncer
nano /etc/crowdsec/bouncers/crowdsec-cloudflare-bouncer.yaml
```

Either way, keep the nginx `limit_req` zones. CrowdSec reacts to a pattern over
time; the rate limiter caps a single burst immediately.

## Privacy invariants

These came out of the GDPR analysis in `quiz/SPEC.md` and are easy to break by
accident. If you change the schema or the API, re-check all five.

1. No name, email, or IP is stored on or joinable to a response.
2. Answers store language-neutral codes, never display text — a Czech "Ano" and
   an English "Yes" must land in the database as the same value.
3. `followups` has no foreign key to `responses`, and the followup endpoint
   never receives a `response_id` — not even for convenience. `created_at` is a
   **date**, not a timestamp, because in a small sample a timestamp seconds away
   from a submission is a de facto join.
4. Consent is recorded as data, with the version of the text agreed to
   (`responses.consent_ver`).
5. User-agent is stored as a coarse family (`Chrome/Android`), never the full
   string, which is near-unique.

## Editing the surveys

`http://quiz.internal/editor.html` — LAN/Tailscale only, same gate as the
dashboard. Edit survey text per locale, add/edit/reorder/delete questions,
manage options and their labels, and tick which options are correct.

Three guards are enforced by the API, not the UI, so they hold no matter what
sends the request:

- **A question's `code` locks once it has answers.** It is the CSV column
  header; renaming it mid-collection splits one variable into two.
- **So does its `kind`.** The stored answers are shaped for the old kind and
  would become unreadable.
- **An option still referenced by an answer cannot be removed**, and deleting a
  question that has answers needs an explicit confirm, because it cascades.

Wording — prompts, help text, labels, explanations — stays editable at any
time. That is the point: fixing a confusing question mid-collection is exactly
what the drop-off view is for.

Editing the other locale is a separate tab; the editor preserves the locale it
is not showing, so switching tabs never blanks the other language.

## Adding a question by hand

The editor is the easy path. If you would rather write SQL: surveys are rows,
not code.

```sql
INSERT INTO questions (survey_id, position, code, kind, required, spec)
SELECT id, 195, 'new_code', 'single', false,
       '{"options":["a","b"]}'::jsonb
FROM surveys WHERE slug = 'endo-2026';
```

Then a `question_i18n` row per locale with `prompt` and a `labels` map covering
every option code. Positions step by 10 so there is room to insert without
renumbering. **Never change a `code` once collection has started** — it is the
export key, and changing it splits a column in the spreadsheet.

Kinds: `text` `textarea` `single` `multi` `scale` `number` `date` `bodymap`.

To make a question **graded**, add `correct` to its spec and an `explain_md` to
each `question_i18n` row. The survey itself must be `mode = 'quiz'`, or the
frontend will not show feedback:

```sql
UPDATE questions SET spec = spec || '{"correct":["b"]}'::jsonb
WHERE code = 'new_code';

UPDATE question_i18n SET explain_md = 'Proč to tak je…'
WHERE question_id = (SELECT id FROM questions WHERE code = 'new_code')
  AND locale = 'cs';
```

Correct answers are option **codes**, like the answers themselves, so grading is
identical in both languages.
