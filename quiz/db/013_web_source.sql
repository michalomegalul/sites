-- 013: a `web` source on every survey
--
-- Every link from dobsinsky.dev (nav, CV, project card) carries ?src=web.
-- Without this row the start endpoint would store it as NULL.

BEGIN;

INSERT INTO sources (survey_id, code, label)
SELECT id, 'web', 'dobsinsky.dev' FROM surveys
ON CONFLICT (survey_id, code) DO NOTHING;

COMMIT;
