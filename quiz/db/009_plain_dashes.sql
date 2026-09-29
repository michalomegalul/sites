-- 009: plain hyphens instead of em dashes in everything a respondent reads
--
-- The seed files (003, 005, 008) are already applied, so editing them only
-- changes what a fresh database gets. This brings the live text in line.
-- A generic replace rather than row-by-row rewrites, so it also catches any
-- text the researcher typed in the editor. Idempotent: a second run finds
-- nothing to replace.

BEGIN;

UPDATE survey_i18n SET
  title      = replace(replace(title,      ' — ', ' - '), '—', '-'),
  intro_md   = replace(replace(intro_md,   ' — ', ' - '), '—', '-'),
  consent_md = replace(replace(consent_md, ' — ', ' - '), '—', '-'),
  thanks_md  = replace(replace(thanks_md,  ' — ', ' - '), '—', '-')
WHERE concat(title, intro_md, consent_md, thanks_md) LIKE '%—%';

UPDATE question_i18n SET
  prompt     = replace(replace(prompt,     ' — ', ' - '), '—', '-'),
  help       = replace(replace(help,       ' — ', ' - '), '—', '-'),
  explain_md = replace(replace(explain_md, ' — ', ' - '), '—', '-'),
  labels     = replace(replace(labels::text, ' — ', ' - '), '—', '-')::jsonb
WHERE concat(prompt, help, explain_md, labels::text) LIKE '%—%';

COMMIT;
