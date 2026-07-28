-- 004: quiz mode — surveys that grade answers and explain them
--
-- The engine stays generic. A survey is either a plain questionnaire (default)
-- or a quiz, and a question becomes gradable purely by carrying a "correct"
-- key in its spec. Nothing here changes how endo-2026 behaves.

ALTER TABLE surveys
  ADD COLUMN mode TEXT NOT NULL DEFAULT 'survey'
  CHECK (mode IN ('survey', 'quiz'));

-- The teaching text shown after the respondent has answered. Per locale,
-- like every other piece of display text.
ALTER TABLE question_i18n
  ADD COLUMN explain_md TEXT;

-- Correct answers live in questions.spec as option CODES:
--     {"options": ["a","b","c"], "correct": ["b"]}
-- Language-neutral, exactly like the answers themselves — a Czech and an
-- English respondent picking the same option are graded identically.

-- --------------------------------------------------------------- grading view
--
-- One row per answer, with whether it was right. `gradable` is false for
-- questions with no "correct" key (demographics on a quiz, every question on a
-- plain survey), and those are excluded from scores rather than counted wrong.
CREATE VIEW v_quiz_answers AS
SELECT r.id AS response_id,
       r.survey_id,
       r.locale,
       r.submitted_at,
       q.code     AS question,
       q.position,
       q.kind,
       a.value,
       (q.spec ? 'correct') AS gradable,
       CASE
         WHEN NOT (q.spec ? 'correct') THEN NULL
         -- multi: the chosen set must match the correct set exactly, so
         -- picking every option cannot score a point.
         WHEN q.kind = 'multi' THEN
           (SELECT COALESCE(array_agg(x ORDER BY x), '{}')
              FROM jsonb_array_elements_text(a.value) x)
           =
           (SELECT COALESCE(array_agg(y ORDER BY y), '{}')
              FROM jsonb_array_elements_text(q.spec -> 'correct') y)
         ELSE (q.spec -> 'correct') ? (a.value #>> '{}')
       END AS is_correct
FROM responses r
JOIN answers a   ON a.response_id = r.id
JOIN questions q ON q.id = a.question_id;

-- Per-question awareness: the table the thesis actually needs.
-- "83 % knew endometriosis is not cured by pregnancy" comes straight off this.
CREATE VIEW v_quiz_stats AS
SELECT survey_id,
       position,
       question,
       count(*)                                AS answered,
       count(*) FILTER (WHERE is_correct)      AS correct,
       round(100.0 * count(*) FILTER (WHERE is_correct)
             / NULLIF(count(*), 0), 1)         AS pct_correct
FROM v_quiz_answers
WHERE gradable AND submitted_at IS NOT NULL
GROUP BY 1, 2, 3;

-- Score distribution — how many people got 0, 1, 2 … right.
CREATE VIEW v_quiz_scores AS
SELECT survey_id,
       response_id,
       locale,
       count(*) FILTER (WHERE is_correct) AS score,
       count(*)                           AS out_of
FROM v_quiz_answers
WHERE gradable AND submitted_at IS NOT NULL
GROUP BY 1, 2, 3;
