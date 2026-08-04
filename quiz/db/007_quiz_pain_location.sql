-- 007: a graded body-map question on the awareness quiz
--
-- The other graded questions ask what respondents know in words. This one
-- asks it spatially: tap every region you think is commonly affected, then
-- see the classic pattern. It reuses the same BodyMap component and region
-- vocabulary as endo-2026's `pain_map` (003) — same codes, same labels where
-- they overlap — but in "select" mode rather than intensity mode: a region is
-- either tapped or not, `levels: 1` in the spec caps it at 0/1, so grading is
-- a set comparison exactly like a `multi` question, not an intensity read.
--
-- Additive only: this INSERTs one more question into the existing survey
-- rather than the delete-and-reseed pattern 003/005 use, because a reseed
-- guard would start refusing to deploy the moment the quiz has real
-- responses. A respondent already mid-quiz simply meets one more question,
-- in position order, same as any other survey edit.
--
-- Grading needs both sides updated together (CLAUDE.md: SQL view and Python
-- grader must agree) — see the new WHEN branch in v_quiz_answers below and
-- the matching branch in api/app.py's grade().

-- Not required, unlike the other graded questions: a respondent already
-- mid-quiz when this deploys may be past position 175 in their local
-- `state.index` and never see it inserted behind them. Required would turn
-- that into a submit-time "missing required question" detour for every
-- in-flight response at deploy time; optional just lets them finish.
INSERT INTO questions (survey_id, position, code, kind, required, spec)
SELECT s.id, 175, 'k_pain_location', 'bodymap', false,
  '{"regions":["shoulder-l","shoulder-r","abdomen-upper","abdomen-lower-l","abdomen-lower-r","pelvis-suprapubic","thigh-l","thigh-r"],
    "correct":["abdomen-lower-l","abdomen-lower-r","pelvis-suprapubic","thigh-l","thigh-r"],
    "levels":1}'::jsonb
FROM surveys s WHERE s.slug = 'endo-znalosti';

INSERT INTO question_i18n (question_id, locale, prompt, help, labels, explain_md)
SELECT q.id, 'cs',
  'Kde bývá bolest při endometrióze nejčastěji?',
  'Klepnutím vyberte všechny oblasti, o kterých si myslíte, že bývají postižené, pak zkontrolujte odpověď.',
  '{"shoulder-l":"Levé rameno","shoulder-r":"Pravé rameno","abdomen-upper":"Horní část břicha","abdomen-lower-l":"Podbřišek vlevo","abdomen-lower-r":"Podbřišek vpravo","pelvis-suprapubic":"Nad stydkou kostí","thigh-l":"Levé stehno","thigh-r":"Pravé stehno"}'::jsonb,
  'Typický vzorec je podbřišek, oblast nad stydkou kostí a stehna — bolest tam často vystřeluje. Bolest v rameni se objevuje jen vzácně, a to tehdy, když ložiska zasahují až k bránici.'
FROM questions q
JOIN surveys s ON s.id = q.survey_id
WHERE s.slug = 'endo-znalosti' AND q.code = 'k_pain_location';

INSERT INTO question_i18n (question_id, locale, prompt, help, labels, explain_md)
SELECT q.id, 'en',
  'Where is endometriosis pain most commonly felt?',
  'Tap every area you think is commonly affected, then check your answer.',
  '{"shoulder-l":"Left shoulder","shoulder-r":"Right shoulder","abdomen-upper":"Upper abdomen","abdomen-lower-l":"Lower abdomen, left","abdomen-lower-r":"Lower abdomen, right","pelvis-suprapubic":"Above the pubic bone","thigh-l":"Left thigh","thigh-r":"Right thigh"}'::jsonb,
  'The classic pattern is the lower abdomen, the area above the pubic bone, and the thighs, where pain often radiates. Shoulder pain does happen, but only rarely, when lesions reach the diaphragm.'
FROM questions q
JOIN surveys s ON s.id = q.survey_id
WHERE s.slug = 'endo-znalosti' AND q.code = 'k_pain_location';

-- --------------------------------------------------------------- grading
--
-- Extends v_quiz_answers (004) with a bodymap branch: the chosen set is the
-- answer's object keys (a region present at all means "tapped" — `levels: 1`
-- keeps the stored value at 0/1, so there is no intensity to lose), compared
-- to spec.correct exactly like `multi` compares its array. CREATE OR REPLACE
-- keeps the dependent views (v_quiz_stats, v_quiz_scores) intact since the
-- column list is unchanged.
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
              FROM jsonb_object_keys(a.value) x)
           =
           (SELECT COALESCE(array_agg(y ORDER BY y), '{}')
              FROM jsonb_array_elements_text(q.spec -> 'correct') y)
         ELSE (q.spec -> 'correct') ? (a.value #>> '{}')
       END AS is_correct
FROM responses r
JOIN answers a   ON a.response_id = r.id
JOIN questions q ON q.id = a.question_id;
