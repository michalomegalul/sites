-- 012: a `search` source on every survey
--
-- The quiz is now indexed. js/app.js tags a visit with no ?src= that arrives
-- from a search engine as src=search; without this row the start endpoint
-- would store it as NULL, indistinguishable from an untagged link.

BEGIN;

INSERT INTO sources (survey_id, code, label)
SELECT id, 'search', 'Search engine' FROM surveys
ON CONFLICT (survey_id, code) DO NOTHING;

COMMIT;
