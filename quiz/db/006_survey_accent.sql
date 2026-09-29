-- 006: per-survey accent colour, set by the researcher, not the respondent
--
-- The palette picker used to sit in the public header, where every respondent
-- could change it. That was decoration competing with the questions on a screen
-- the SPEC reserves for one question at a time - and it made the survey look
-- different to different people, which is the opposite of what an instrument
-- wants. The choice moves into the editor and becomes a property of the survey.
--
-- ONE colour, not a palette. site/js/palette.js derives background, ink,
-- borders and the accent ramp from this seed and clamps lightness until the
-- WCAG floors hold; quiz/tools/palette.test.js proves that over all 360 hues.
-- Storing the individual variables instead would let a pale yellow through.
--
-- NULL means the built-in rose, so every existing survey keeps exactly the
-- palette it has today and this migration changes nothing visible.

ALTER TABLE surveys
  ADD COLUMN accent TEXT
  CHECK (accent IS NULL OR accent ~ '^#[0-9a-f]{6}$');

COMMENT ON COLUMN surveys.accent IS
  'Seed colour as lowercase #rrggbb; NULL uses the default palette. '
  'The rest of the palette is derived from this - see site/js/palette.js.';
