#!/usr/bin/env python3
"""Apply any db/*.sql that has not been applied yet.

Run by deploy.sh before the service restarts, so schema and code never move
separately — the failure that motivates this was deploying code which selected
`surveys.mode` before the column existed, which 500s every request.

    python3 db/migrate.py [--dry-run]

Connection comes from quiz/api/.env:

    MIGRATE_DATABASE_URL   used if set — needs rights to CREATE/ALTER
    DATABASE_URL           fallback (the app role, often not enough for DDL)

Rules:
  * files run in filename order, one transaction each; a failure stops the run
    and leaves that file unapplied
  * applied filenames are recorded in schema_migrations and never re-run
  * an advisory lock makes concurrent deploys wait rather than collide
"""
import glob
import os
import sys

import psycopg
from dotenv import load_dotenv

HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, "..", "api", ".env"))

DSN = os.getenv("MIGRATE_DATABASE_URL") or os.getenv("DATABASE_URL")
if not DSN:
    sys.exit("migrate: no MIGRATE_DATABASE_URL or DATABASE_URL in quiz/api/.env")

DRY = "--dry-run" in sys.argv

# Migrations that predate this runner. On a database that already has tables
# but no schema_migrations, these are recorded as applied instead of being run
# again — 001 is not idempotent and 003 would refuse anyway. On an empty
# database they are applied normally like everything else.
BASELINE = ["001_init.sql", "002_analytics.sql", "003_seed_endo_2026.sql"]

LOCK_KEY = 8412  # arbitrary, just has to be stable


def main():
    files = sorted(os.path.basename(p) for p in glob.glob(os.path.join(HERE, "*.sql")))
    if not files:
        print("migrate: no .sql files found")
        return 0

    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute("SELECT pg_advisory_lock(%s)", (LOCK_KEY,))
        try:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations ("
                "  filename   TEXT PRIMARY KEY,"
                "  applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            )

            done = {r[0] for r in conn.execute(
                "SELECT filename FROM schema_migrations").fetchall()}

            # First run against a database that already has the old schema:
            # adopt the baseline rather than replaying it.
            if not done:
                exists = conn.execute(
                    "SELECT to_regclass('public.surveys') IS NOT NULL").fetchone()[0]
                if exists:
                    for name in BASELINE:
                        if name in files:
                            conn.execute(
                                "INSERT INTO schema_migrations (filename) VALUES (%s)"
                                " ON CONFLICT DO NOTHING", (name,))
                            done.add(name)
                    print("migrate: adopted existing schema, baseline marked applied:")
                    for name in BASELINE:
                        print("           " + name)

            todo = [f for f in files if f not in done]
            if not todo:
                print("migrate: up to date (%d applied)" % len(done))
                return 0

            print("migrate: %d to apply" % len(todo))
            for name in todo:
                if DRY:
                    print("   would apply  " + name)
                    continue
                sql = open(os.path.join(HERE, name), encoding="utf-8").read()
                print("   applying     " + name, flush=True)
                # Each file gets its own transaction. The .sql files that need
                # to be atomic already carry their own BEGIN/COMMIT; nesting is
                # harmless because psycopg only opens one level.
                with psycopg.connect(DSN) as run:
                    with run.cursor() as cur:
                        cur.execute(sql)
                    run.commit()
                conn.execute(
                    "INSERT INTO schema_migrations (filename) VALUES (%s)", (name,))
                print("   applied      " + name)
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (LOCK_KEY,))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except psycopg.Error as e:
        # Print the failing file's error plainly; the traceback is noise in a
        # CI log and the message is what tells you what to fix.
        sys.exit("migrate: FAILED — %s" % str(e).strip())
