-- 014: thighs on k_pain_location are neutral
--
-- Pain radiating into the thighs is real but not part of everyone's picture of
-- endometriosis, so leaving them untapped should not cost the point. A bodymap
-- spec may now carry `neutral`: regions that are right whether tapped or not.
-- They come out of `correct` and are dropped from the chosen set before the
-- comparison. api/app.py's grade() does the same (CLAUDE.md: SQL view and
-- Python grader must agree). 008 carries the same spec for a fresh database.

BEGIN;

UPDATE questions q SET spec = q.spec
    || '{"correct":["abdomen-lower-l","abdomen-lower-r","pelvis-suprapubic"],"neutral":["thigh-l","thigh-r"]}'::jsonb
FROM surveys s
WHERE s.id = q.survey_id AND s.slug = 'endo-znalosti' AND q.code = 'k_pain_location';

CREATE OR REPLACE VIEW v_quiz_answers AS
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
         WHEN q.kind = 'multi' THEN
           (SELECT COALESCE(array_agg(x ORDER BY x), '{}')
              FROM jsonb_array_elements_text(a.value) x)
           =
           (SELECT COALESCE(array_agg(y ORDER BY y), '{}')
              FROM jsonb_array_elements_text(q.spec -> 'correct') y)
         WHEN q.kind = 'bodymap' THEN
           (SELECT COALESCE(array_agg(x ORDER BY x), '{}')
              FROM jsonb_object_keys(a.value) x
             WHERE NOT COALESCE(q.spec -> 'neutral', '[]'::jsonb) ? x)
           =
           (SELECT COALESCE(array_agg(y ORDER BY y), '{}')
              FROM jsonb_array_elements_text(q.spec -> 'correct') y)
         ELSE (q.spec -> 'correct') ? (a.value #>> '{}')
       END AS is_correct
FROM responses r
JOIN answers a   ON a.response_id = r.id
JOIN questions q ON q.id = a.question_id;

COMMIT;
