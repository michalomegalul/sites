-- 011: info_sources asks where you WOULD look, not where you have looked
--
-- "Odkud jste dosud čerpal/a…" assumed the respondent had already gone looking.
-- The question is now hypothetical, so the "nowhere" option is reworded to fit
-- it; its code stays `nowhere` so any answers already given still tabulate
-- together. 008 carries the same text for a fresh database.

BEGIN;

UPDATE question_i18n i SET
  prompt = 'Odkud byste čerpal/a informace o gynekologickém onemocnění?',
  labels = jsonb_set(i.labels, '{nowhere}', '"nikde, informace bych nehledal/a"')
FROM questions q JOIN surveys s ON s.id = q.survey_id
WHERE i.question_id = q.id AND i.locale = 'cs'
  AND s.slug = 'endo-znalosti' AND q.code = 'info_sources';

UPDATE question_i18n i SET
  prompt = 'Where would you look for information about a gynaecological condition?',
  labels = jsonb_set(i.labels, '{nowhere}', '"Nowhere, I would not look for it"')
FROM questions q JOIN surveys s ON s.id = q.survey_id
WHERE i.question_id = q.id AND i.locale = 'en'
  AND s.slug = 'endo-znalosti' AND q.code = 'info_sources';

COMMIT;
