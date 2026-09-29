-- 010: a "Sources" block on the quiz results screen
--
-- Nullable per-locale markdown, like intro_md and thanks_md, so the researcher
-- can edit it in the editor. NULL means the results screen shows no block.
-- Every URL below was opened and checked against the claim it is listed for.

BEGIN;

ALTER TABLE survey_i18n ADD COLUMN sources_md TEXT;

UPDATE survey_i18n SET sources_md =
'- Světová zdravotnická organizace (WHO). [Endometriosis (fact sheet)](https://www.who.int/news-room/fact-sheets/detail/endometriosis). Výskyt (10 % žen v reprodukčním věku, 190 milionů), příznaky od první menstruace, chronický průběh bez léku. Dobu do diagnózy uvádí WHO 4 až 12 let.
- ESHRE. [Endometriosis guideline](https://www.eshre.eu/Guidelines-and-Legal/Guidelines/Endometriosis-guideline) (2022). Diagnostika, léčba, endometrióza u dospívajících.
- ESHRE. [Endometriosis: informace pro pacientky](https://www.eshre.eu/-/media/sitecore-files/Guidelines/Endometriosis/ESHRE-ENDOMETRIOSIS-patient-Guideline_21032022.pdf) (anglicky, podle doporučeného postupu). Ultrazvuk a magnetická rezonance diagnózu podporují, ale ložiska nemusí vždy odhalit.
- Journal of Women''s Health 2026. [Endometriosis diagnostic delay and its correlates: ComPaRe-Endometriosis cohort](https://pubmed.ncbi.nlm.nih.gov/40999898/). Průměrná doba do diagnózy se běžně uvádí 7 let, u 6 949 účastnic studie byla 10 let.
- BJOG 2025. [Time to diagnose endometriosis: a systematic literature review](https://pubmed.ncbi.nlm.nih.gov/39373298/). Zpoždění diagnózy 0,3 až 12 let, způsobené především lékaři.
- Frontiers in Medicine 2024. [A bird-eye view of diaphragmatic endometriosis](https://pmc.ncbi.nlm.nih.gov/articles/PMC11604425/). Cyklická bolest v rameni při postižení bránice, u přibližně 0,7 až 4,7 % pacientek.
- Clinical Obstetrics and Gynecology 2017. [Fertility and endometriosis](https://pubmed.ncbi.nlm.nih.gov/28742581/). S neplodností se potýká přibližně 30 až 50 % žen s endometriózou.'
 WHERE locale = 'cs'
   AND survey_id = (SELECT id FROM surveys WHERE slug = 'endo-znalosti');

UPDATE survey_i18n SET sources_md =
'- World Health Organization (WHO). [Endometriosis (fact sheet)](https://www.who.int/news-room/fact-sheets/detail/endometriosis). Prevalence (10% of women of reproductive age, 190 million), symptoms from the first period, chronic course with no cure. WHO gives the time to diagnosis as 4 to 12 years.
- ESHRE. [Endometriosis guideline](https://www.eshre.eu/Guidelines-and-Legal/Guidelines/Endometriosis-guideline) (2022). Diagnosis, treatment, endometriosis in adolescents.
- ESHRE. [Endometriosis: patient leaflet based on the guideline](https://www.eshre.eu/-/media/sitecore-files/Guidelines/Endometriosis/ESHRE-ENDOMETRIOSIS-patient-Guideline_21032022.pdf). Ultrasound and MRI support the diagnosis but cannot always detect the lesions.
- Journal of Women''s Health 2026. [Endometriosis diagnostic delay and its correlates: ComPaRe-Endometriosis cohort](https://pubmed.ncbi.nlm.nih.gov/40999898/). About 7 years is commonly described; among 6,949 participants the average was 10 years.
- BJOG 2025. [Time to diagnose endometriosis: a systematic literature review](https://pubmed.ncbi.nlm.nih.gov/39373298/). Reported delays of 0.3 to 12 years, driven mainly by physicians.
- Frontiers in Medicine 2024. [A bird-eye view of diaphragmatic endometriosis](https://pmc.ncbi.nlm.nih.gov/articles/PMC11604425/). Cyclic shoulder pain from lesions on the diaphragm, in roughly 0.7 to 4.7% of patients.
- Clinical Obstetrics and Gynecology 2017. [Fertility and endometriosis](https://pubmed.ncbi.nlm.nih.gov/28742581/). About 30 to 50% of women with endometriosis also struggle with infertility.'
 WHERE locale = 'en'
   AND survey_id = (SELECT id FROM surveys WHERE slug = 'endo-znalosti');

COMMIT;
