-- 002: analytics views + followup hardening
--
-- These views answer "how do I make the survey better?" from rows we already
-- have. No new collection, nothing that touches SPEC hard constraint #1.

-- Coarsen followup timestamps to a date.
--
-- SPEC constraint #3 says followups must not be joinable to responses. There is
-- no foreign key, but a full timestamp is a de facto join: in a small sample,
-- a followup written at 20:14:07 and the only response submitted at 20:14:05
-- are obviously the same person. A date is enough to know when sign-ups came in
-- and not enough to line anyone up.
ALTER TABLE followups
  ALTER COLUMN created_at TYPE DATE USING created_at::date;
ALTER TABLE followups
  ALTER COLUMN created_at SET DEFAULT CURRENT_DATE;

-- Where people give up.
--
-- For every response that was started but never submitted, find the highest
-- question position that got an answer. That is the last screen they saw before
-- closing the tab. A spike at one position means that question is the problem:
-- too personal, too confusing, or too much typing.
--
-- Position 0 is its own answer: they consented, opened the questionnaire, and
-- left without answering anything. If that bucket is large the problem is the
-- consent screen or the very first question, not any question further in.
CREATE VIEW v_dropoff AS
SELECT r.survey_id,
       COALESCE(q.position, 0)             AS position,
       COALESCE(q.code, '(no answers)')    AS question,
       COALESCE(q.kind, '-')               AS kind,
       count(*)                            AS abandoned_here
FROM responses r
LEFT JOIN LATERAL (
  SELECT max(q2.position) AS p
  FROM answers a
  JOIN questions q2 ON q2.id = a.question_id
  WHERE a.response_id = r.id
) m ON true
LEFT JOIN questions q ON q.survey_id = r.survey_id AND q.position = m.p
WHERE r.submitted_at IS NULL
GROUP BY 1, 2, 3, 4;

-- How far the funnel gets, question by question.
--
-- reached = responses (finished or not) that answered at or past this position.
-- Read it top to bottom; the big steps down are where the survey is losing people.
CREATE VIEW v_funnel AS
WITH progress AS (
  SELECT r.id, r.survey_id, r.submitted_at,
         max(q.position) AS furthest
  FROM responses r
  JOIN answers a   ON a.response_id = r.id
  JOIN questions q ON q.id = a.question_id
  GROUP BY r.id, r.survey_id, r.submitted_at
)
SELECT q.survey_id,
       q.position,
       q.code AS question,
       q.required,
       count(p.id) FILTER (WHERE p.furthest >= q.position) AS reached,
       count(p.id) FILTER (WHERE p.furthest >= q.position
                             AND p.submitted_at IS NOT NULL) AS reached_and_finished
FROM questions q
LEFT JOIN progress p ON p.survey_id = q.survey_id
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2;

-- How long it actually takes, for completed responses only.
--
-- If the median is far above what you tell people on the consent screen, the
-- consent screen is lying and completion suffers for it.
CREATE VIEW v_duration AS
SELECT survey_id,
       count(*) AS completed,
       round(avg(EXTRACT(EPOCH FROM (submitted_at - started_at)) / 60)::numeric, 1) AS mean_minutes,
       round((percentile_cont(0.5) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM (submitted_at - started_at)) / 60))::numeric, 1) AS median_minutes
FROM responses
WHERE submitted_at IS NOT NULL
GROUP BY 1;

-- Body map heat map, per SPEC.
CREATE VIEW v_bodymap AS
SELECT r.survey_id,
       q.code AS question,
       e.k    AS region,
       count(*) AS respondents,
       round(avg(e.v::int), 2) AS mean_intensity
FROM answers a
JOIN responses r ON r.id = a.response_id
JOIN questions q ON q.id = a.question_id
CROSS JOIN LATERAL jsonb_each_text(a.value) AS e(k, v)
WHERE q.kind = 'bodymap'
  AND r.submitted_at IS NOT NULL
  AND e.v ~ '^[0-9]+$'
  AND e.v::int > 0
GROUP BY 1, 2, 3;
