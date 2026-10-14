-- 016: k_pain_location loses the upper abdomen and gains both hands
--
-- The upper abdomen was graded wrong, but diaphragmatic endometriosis does cause
-- upper (right) abdominal pain, and respondents had to guess where "upper" ends.
-- One belly region remains: the lower abdomen, still the only right answer.
-- Hands (forearm and hand, see bodymap.js) replace it as wrong options so the
-- map still offers enough to choose from. They are the safe distractor: legs
-- (sciatic), chest (thoracic) and neck (diaphragmatic referral) can all carry
-- endometriosis pain, hands cannot. 008 carries the same rows for a fresh
-- database.

BEGIN;

UPDATE questions q SET spec =
  '{"regions":["head","shoulder-l","shoulder-r","hand-l","hand-r","abdomen-lower"],"correct":["abdomen-lower"],"levels":1}'
FROM surveys s
WHERE s.id = q.survey_id AND s.slug = 'endo-znalosti' AND q.code = 'k_pain_location';

UPDATE question_i18n i SET
  labels = '{"head":"Hlava","shoulder-l":"Levé rameno","shoulder-r":"Pravé rameno","hand-l":"Levá ruka","hand-r":"Pravá ruka","abdomen-lower":"Břicho (podbřišek)"}',
  explain_md = 'Bolest při endometrióze bývá nejčastěji v **podbřišku** - ve spodní části břicha a v pánvi. Bolest rukou k endometrióze nepatří a bolest hlavy k jejímu typickému obrazu také ne. Bolest v rameni se objevuje jen vzácně, a to tehdy, když ložiska zasahují až k bránici.'
FROM questions q JOIN surveys s ON s.id = q.survey_id
WHERE i.question_id = q.id AND i.locale = 'cs'
  AND s.slug = 'endo-znalosti' AND q.code = 'k_pain_location';

UPDATE question_i18n i SET
  labels = '{"head":"Head","shoulder-l":"Left shoulder","shoulder-r":"Right shoulder","hand-l":"Left hand","hand-r":"Right hand","abdomen-lower":"Lower abdomen"}',
  explain_md = 'Endometriosis pain is most often felt in the **lower abdomen** - the lower belly and pelvis. Pain in the hands has nothing to do with it, and headaches are not part of the typical picture. Shoulder pain does happen, but only rarely, when lesions reach the diaphragm.'
FROM questions q JOIN surveys s ON s.id = q.survey_id
WHERE i.question_id = q.id AND i.locale = 'en'
  AND s.slug = 'endo-znalosti' AND q.code = 'k_pain_location';

COMMIT;
