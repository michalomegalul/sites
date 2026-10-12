-- 015: leg pain out of k_symptoms, a simpler k_pain_location map
--
-- The thesis author's last review before launch: leg and thigh pain as right
-- answers confused respondents, in the symptom list and on the picture alike.
-- leg_pain is dropped from k_symptoms rather than kept as a wrong option -
-- radiating leg pain is a real symptom, so grading it wrong would teach
-- something false. The body map shrinks to head, shoulders, upper and lower
-- abdomen, with the lower abdomen (one undivided region, see bodymap.js) as
-- the only right answer; the thighs and their `neutral` (014) go with it.
-- 008 carries the same rows for a fresh database.

BEGIN;

UPDATE questions q SET spec =
  '{"options":["period_pain","teeth","dizziness","bowel_pain","hair","dunno"],"correct":["period_pain","bowel_pain"],"exclusive":["dunno"]}'
FROM surveys s
WHERE s.id = q.survey_id AND s.slug = 'endo-znalosti' AND q.code = 'k_symptoms';

UPDATE questions q SET spec =
  '{"regions":["head","shoulder-l","shoulder-r","abdomen-upper","abdomen-lower"],"correct":["abdomen-lower"],"levels":1}'
FROM surveys s
WHERE s.id = q.survey_id AND s.slug = 'endo-znalosti' AND q.code = 'k_pain_location';

UPDATE question_i18n i SET
  labels = '{"period_pain":"bolest při menstruaci","teeth":"vypadávání zubů","dizziness":"závratě","bowel_pain":"bolest při vyprazdňování stolice","hair":"vypadávání vlasů","dunno":"nevím"}',
  explain_md = 'Endometrióza není jen „bolestivá menstruace“. Patří k ní i **bolest při vyprazdňování stolice**, bolest při styku, chronická únava nebo nadýmání. Vypadávání zubů či vlasů ani závratě k typickým příznakům nepatří. Právě šíře příznaků je důvod, proč se na diagnózu tak dlouho nepřijde.'
FROM questions q JOIN surveys s ON s.id = q.survey_id
WHERE i.question_id = q.id AND i.locale = 'cs'
  AND s.slug = 'endo-znalosti' AND q.code = 'k_symptoms';

UPDATE question_i18n i SET
  labels = '{"period_pain":"Period pain","teeth":"Losing teeth","dizziness":"Dizziness","bowel_pain":"Pain when opening the bowels","hair":"Hair loss","dunno":"I do not know"}',
  explain_md = 'Endometriosis is not only painful periods. It also involves **pain when opening the bowels**, pain during sex, chronic fatigue and bloating. Losing teeth or hair and dizziness are not typical symptoms. That breadth of symptoms is a large part of why it takes so long to recognise.'
FROM questions q JOIN surveys s ON s.id = q.survey_id
WHERE i.question_id = q.id AND i.locale = 'en'
  AND s.slug = 'endo-znalosti' AND q.code = 'k_symptoms';

UPDATE question_i18n i SET
  labels = '{"head":"Hlava","shoulder-l":"Levé rameno","shoulder-r":"Pravé rameno","abdomen-upper":"Horní část břicha","abdomen-lower":"Spodní část břicha"}',
  explain_md = 'Bolest při endometrióze bývá nejčastěji ve **spodní části břicha** - v podbřišku a v pánvi. Bolest hlavy ani horní části břicha k typickému obrazu nepatří. Bolest v rameni se objevuje jen vzácně, a to tehdy, když ložiska zasahují až k bránici.'
FROM questions q JOIN surveys s ON s.id = q.survey_id
WHERE i.question_id = q.id AND i.locale = 'cs'
  AND s.slug = 'endo-znalosti' AND q.code = 'k_pain_location';

UPDATE question_i18n i SET
  labels = '{"head":"Head","shoulder-l":"Left shoulder","shoulder-r":"Right shoulder","abdomen-upper":"Upper abdomen","abdomen-lower":"Lower abdomen"}',
  explain_md = 'Endometriosis pain is most often felt in the **lower abdomen** - the lower belly and pelvis. Headaches and upper abdominal pain are not part of the typical picture. Shoulder pain does happen, but only rarely, when lesions reach the diaphragm.'
FROM questions q JOIN surveys s ON s.id = q.survey_id
WHERE i.question_id = q.id AND i.locale = 'en'
  AND s.slug = 'endo-znalosti' AND q.code = 'k_pain_location';

COMMIT;
