-- 008: awareness quiz v2 - the final question list from the thesis author
--
-- Replaces the questions of endo-znalosti in place, so the links already
-- handed out (…/s/endo-znalosti?src=…) keep working. The 3 responses that
-- existed at the time were tests and are deleted with the old questions.
--
-- Guard: refuse if more than those 3 *completed* responses exist by the time
-- this deploys - anything beyond them would be a real respondent, and deleting
-- real answers must be a deliberate decision, not a side effect of a deploy.
-- Unfinished responses are not counted: they answered questions this file
-- removes, so they cannot carry over either way (at the time: 9, all from the
-- same test devices and sessions as the 3 completed tests).
--
-- Graded questions carry "correct" in spec and an explain_md per locale
-- (004). "nevím" is an ungraded-looking option but still counts as wrong on
-- a graded question, which is what the thesis wants to measure.

BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM responses r
        JOIN surveys s ON s.id = r.survey_id
       WHERE s.slug = 'endo-znalosti' AND r.submitted_at IS NOT NULL) > 3 THEN
    RAISE EXCEPTION
      'endo-znalosti has more than the 3 known completed test responses - refusing to replace its questions.';
  END IF;
END $$;

DELETE FROM responses
 WHERE survey_id = (SELECT id FROM surveys WHERE slug = 'endo-znalosti');
DELETE FROM questions
 WHERE survey_id = (SELECT id FROM surveys WHERE slug = 'endo-znalosti');

UPDATE survey_i18n SET intro_md =
'Krátký dotazník o nemoci, kterou má přibližně **každá desátá žena** - a o které
se skoro nemluví.

Sedmnáct otázek, **asi 7 minut**. U otázek na znalosti se po odpovědi dozvíte,
jak to je. Nevadí, když něco nevíte; právě to je smyslem této práce zjistit.'
 WHERE locale = 'cs'
   AND survey_id = (SELECT id FROM surveys WHERE slug = 'endo-znalosti');

UPDATE survey_i18n SET intro_md =
'A short questionnaire about a condition that affects roughly **one in ten
women** - and that is barely talked about.

Seventeen questions, **about 7 minutes**. For the knowledge questions you will
see how it actually is after you answer. It is fine not to know; finding that
out is the point.'
 WHERE locale = 'en'
   AND survey_id = (SELECT id FROM surveys WHERE slug = 'endo-znalosti');

CREATE TEMP TABLE aq (
  position INT, code TEXT, kind TEXT, required BOOLEAN, spec JSONB,
  cs_prompt TEXT, cs_help TEXT, cs_labels JSONB, cs_explain TEXT,
  en_prompt TEXT, en_help TEXT, en_labels JSONB, en_explain TEXT
) ON COMMIT DROP;

INSERT INTO aq VALUES

-- ===== about the respondent: ungraded ======================================
(10, 'who', 'single', true,
 '{"options":["woman","man","na"]}',
 'Jaké je Vaše pohlaví?', NULL,
 '{"woman":"žena","man":"muž","na":"nechci uvádět"}', NULL,
 'What is your sex?', NULL,
 '{"woman":"Female","man":"Male","na":"Prefer not to say"}', NULL),

(20, 'age_band', 'single', true,
 '{"options":["u18","18_24","25_34","35_44","45p"]}',
 'Kolik je Vám let?', NULL,
 '{"u18":"méně než 18 let","18_24":"18–24 let","25_34":"25–34 let","35_44":"35–44 let","45p":"45 let a více"}', NULL,
 'How old are you?', NULL,
 '{"u18":"Under 18","18_24":"18–24","25_34":"25–34","35_44":"35–44","45p":"45 or older"}', NULL),

(30, 'education', 'single', true,
 '{"options":["basic","secondary","secondary_exam","higher_vocational","university"]}',
 'Jaké je Vaše nejvyšší dosažené vzdělání?', NULL,
 '{"basic":"základní","secondary":"střední bez maturity","secondary_exam":"střední s maturitou","higher_vocational":"vyšší odborné","university":"vysokoškolské"}', NULL,
 'What is your highest completed education?', NULL,
 '{"basic":"Primary","secondary":"Secondary, without school-leaving exam","secondary_exam":"Secondary, with school-leaving exam","higher_vocational":"Tertiary professional school","university":"University"}', NULL),

(40, 'heard_before', 'single', true,
 '{"options":["know","heard","never"]}',
 'Slyšeli jste o endometrióze před vyplněním tohoto dotazníku?', NULL,
 '{"know":"ano, vím, o jaké onemocnění se jedná","heard":"ano, ale nevím o něm mnoho","never":"ne"}', NULL,
 'Had you heard of endometriosis before filling in this questionnaire?', NULL,
 '{"know":"Yes, I know what the condition is","heard":"Yes, but I do not know much about it","never":"No"}', NULL),

-- ===== knowledge: graded ===================================================
(50, 'k_prevalence', 'single', true,
 '{"options":["ten","hundred","thousand","million"],"correct":["ten"]}',
 'Kolika žen se podle Vás endometrióza přibližně týká?', NULL,
 '{"ten":"1 z 10","hundred":"1 ze 100","thousand":"1 z 1 000","million":"1 z 1 000 000"}',
 'Podle Světové zdravotnické organizace se endometrióza týká přibližně **10 % žen a dívek v reprodukčním věku** - celosvětově asi 190 milionů. Je tedy zhruba stejně častá jako astma nebo cukrovka. Není to vzácné onemocnění, jen málo viditelné.',
 'Roughly how many women do you think endometriosis affects?', NULL,
 '{"ten":"1 in 10","hundred":"1 in 100","thousand":"1 in 1,000","million":"1 in 1,000,000"}',
 'The World Health Organization puts it at roughly **10% of women and girls of reproductive age** - around 190 million worldwide. That makes it about as common as asthma or diabetes. It is not rare, just not very visible.'),

(60, 'k_type', 'single', true,
 '{"options":["thyroid","lymph","gyn","sti"],"correct":["gyn"]}',
 'Jaký typ onemocnění je endometrióza?', NULL,
 '{"thyroid":"chronické onemocnění štítné žlázy","lymph":"zánětlivé onemocnění lymfatického systému","gyn":"chronické gynekologické onemocnění","sti":"pohlavně přenosná infekce"}',
 'Endometrióza je **chronické gynekologické onemocnění**. Není infekční, nepřenáší se pohlavním stykem a nesouvisí se štítnou žlázou ani s lymfatickým systémem. „Chronické“ znamená, že je dlouhodobé a léčba se zaměřuje na zvládání příznaků.',
 'What type of condition is endometriosis?', NULL,
 '{"thyroid":"A chronic thyroid condition","lymph":"An inflammatory disease of the lymphatic system","gyn":"A chronic gynaecological condition","sti":"A sexually transmitted infection"}',
 'Endometriosis is a **chronic gynaecological condition**. It is not an infection, it is not sexually transmitted, and it is unrelated to the thyroid or the lymphatic system. "Chronic" means it is long-term, and treatment focuses on managing symptoms.'),

(70, 'k_what', 'single', true,
 '{"options":["outside","overgrowth","infection","dunno"],"correct":["outside"]}',
 'Co je pro endometriózu charakteristické?', NULL,
 '{"outside":"výskyt tkáně podobné děložní sliznici mimo děložní dutinu","overgrowth":"nadměrné zmnožení děložní sliznice v děloze","infection":"bakteriální zánět dělohy","dunno":"nevím"}',
 'Při endometrióze roste tkáň **podobná** děložní sliznici **mimo dělohu** - nejčastěji na pobřišnici, vaječnících a v pánvi. Nadměrné zmnožení sliznice přímo v děloze je jiné onemocnění a nejde ani o bakteriální zánět. Tato tkáň reaguje na hormonální cyklus, krvácí a dráždí okolí, což vede k zánětu, srůstům a bolesti.',
 'What is characteristic of endometriosis?', NULL,
 '{"outside":"Tissue similar to the womb lining occurring outside the uterine cavity","overgrowth":"Excessive thickening of the lining inside the uterus","infection":"A bacterial infection of the uterus","dunno":"I do not know"}',
 'In endometriosis, tissue **similar to** the lining of the womb grows **outside the uterus** - most often on the peritoneum, ovaries and pelvis. Thickening of the lining inside the uterus is a different condition, and it is not a bacterial infection either. The tissue responds to the hormonal cycle, bleeds, and irritates what is around it, causing inflammation, adhesions and pain.'),

(80, 'k_symptoms', 'multi', true,
 '{"options":["period_pain","teeth","leg_pain","dizziness","bowel_pain","hair","dunno"],"correct":["period_pain","leg_pain","bowel_pain"],"exclusive":["dunno"]}',
 'Které z následujících možností mohou být příznaky endometriózy?', 'Můžete označit více odpovědí.',
 '{"period_pain":"bolest při menstruaci","teeth":"vypadávání zubů","leg_pain":"bolest v nohou","dizziness":"závratě","bowel_pain":"bolest při vyprazdňování stolice","hair":"vypadávání vlasů","dunno":"nevím"}',
 'Endometrióza není jen „bolestivá menstruace“. Patří k ní i **bolest při vyprazdňování stolice**, bolest vystřelující **do nohou**, bolest při styku, chronická únava nebo nadýmání. Vypadávání zubů či vlasů ani závratě k typickým příznakům nepatří. Právě šíře příznaků je důvod, proč se na diagnózu tak dlouho nepřijde.',
 'Which of the following can be symptoms of endometriosis?', 'You can choose more than one.',
 '{"period_pain":"Period pain","teeth":"Losing teeth","leg_pain":"Leg pain","dizziness":"Dizziness","bowel_pain":"Pain when opening the bowels","hair":"Hair loss","dunno":"I do not know"}',
 'Endometriosis is not only painful periods. It also involves **pain when opening the bowels**, pain radiating **into the legs**, pain during sex, chronic fatigue and bloating. Losing teeth or hair and dizziness are not typical symptoms. That breadth of symptoms is a large part of why it takes so long to recognise.'),

(90, 'k_pain_location', 'bodymap', false,
 '{"regions":["shoulder-l","shoulder-r","abdomen-upper","abdomen-lower-l","abdomen-lower-r","pelvis-suprapubic","thigh-l","thigh-r"],"correct":["abdomen-lower-l","abdomen-lower-r","pelvis-suprapubic","thigh-l","thigh-r"],"levels":1}',
 'Kde si myslíte, že bývá bolest při endometrióze nejčastěji?',
 'Klepnutím vyberte všechny oblasti, o kterých si myslíte, že bývají postižené, pak zkontrolujte odpověď.',
 '{"shoulder-l":"Levé rameno","shoulder-r":"Pravé rameno","abdomen-upper":"Horní část břicha","abdomen-lower-l":"Podbřišek vlevo","abdomen-lower-r":"Podbřišek vpravo","pelvis-suprapubic":"Nad stydkou kostí","thigh-l":"Levé stehno","thigh-r":"Pravé stehno"}',
 'Typický vzorec je podbřišek, oblast nad stydkou kostí a stehna - bolest tam často vystřeluje. Bolest v rameni se objevuje jen vzácně, a to tehdy, když ložiska zasahují až k bránici.',
 'Where do you think endometriosis pain is most commonly felt?',
 'Tap every area you think is commonly affected, then check your answer.',
 '{"shoulder-l":"Left shoulder","shoulder-r":"Right shoulder","abdomen-upper":"Upper abdomen","abdomen-lower-l":"Lower abdomen, left","abdomen-lower-r":"Lower abdomen, right","pelvis-suprapubic":"Above the pubic bone","thigh-l":"Left thigh","thigh-r":"Right thigh"}',
 'The classic pattern is the lower abdomen, the area above the pubic bone, and the thighs, where pain often radiates. Shoulder pain does happen, but only rarely, when lesions reach the diaphragm.'),

(100, 'k_age', 'single', true,
 '{"options":["before_first","reproductive","menopause","dunno"],"correct":["reproductive"]}',
 'V jakém stadiu života ženy se začne endometrióza projevovat?', NULL,
 '{"before_first":"před první menstruací","reproductive":"v reprodukčním věku","menopause":"v menopauze","dunno":"nevím"}',
 'Endometrióza se projevuje **v reprodukčním věku** - příznaky mohou začít už s první menstruací v dospívání. U dospívajících se bolest ale často bagatelizuje („to přejde“, „to má každá“), a právě to prodlužuje cestu k diagnóze o roky.',
 'At what stage of a woman''s life does endometriosis start to show?', NULL,
 '{"before_first":"Before the first period","reproductive":"During the reproductive years","menopause":"At menopause","dunno":"I do not know"}',
 'Endometriosis shows **during the reproductive years** - symptoms can begin with the very first period in adolescence. In teenagers the pain is often dismissed ("it will pass", "everyone gets that"), and that is exactly what adds years to the path to diagnosis.'),

(110, 'k_fertility', 'single', true,
 '{"options":["harder","no_effect","dunno"],"correct":["harder"]}',
 'Může endometrióza ovlivnit plodnost ženy?', NULL,
 '{"harder":"ano, může ztížit otěhotnění","no_effect":"ne, plodnost neovlivňuje","dunno":"nevím"}',
 'Ano. Potíže s otěhotněním se odhadují zhruba u **30–50 %** žen s endometriózou. Neznamená to ale automaticky neplodnost - mnoho žen s endometriózou otěhotní přirozeně nebo s pomocí léčby.',
 'Can endometriosis affect a woman''s fertility?', NULL,
 '{"harder":"Yes, it can make it harder to get pregnant","no_effect":"No, it does not affect fertility","dunno":"I do not know"}',
 'Yes. Difficulty conceiving is estimated in roughly **30–50%** of women with endometriosis. It does not automatically mean infertility, though - many women with endometriosis conceive naturally or with treatment.'),

(120, 'k_delay', 'single', true,
 '{"options":["yes","no","dunno"],"correct":["yes"]}',
 'Myslíte si, že může od prvních příznaků do stanovení diagnózy endometriózy uplynout několik let?', NULL,
 '{"yes":"ano","no":"ne","dunno":"nevím"}',
 'Ano. Studie z různých zemí uvádějí průměrné zpoždění **7 až 10 let** od prvních příznaků ke stanovení diagnózy. Hlavním důvodem je, že se silná menstruační bolest považuje za normální - okolím, lékaři i samotnými pacientkami.',
 'Do you think several years can pass between the first symptoms and a diagnosis of endometriosis?', NULL,
 '{"yes":"Yes","no":"No","dunno":"I do not know"}',
 'Yes. Studies across countries report an average delay of **7 to 10 years** from first symptoms to diagnosis. The main reason is that severe period pain gets treated as normal - by those around the patient, by clinicians, and by patients themselves.'),

(130, 'k_cure', 'single', true,
 '{"options":["surgery","hormones","no_cure"],"correct":["no_cure"]}',
 'Lze endometriózu úplně vyléčit?', NULL,
 '{"surgery":"ano, operací","hormones":"ano, hormonální terapií","no_cure":"ne, léčba se zaměřuje především na zmírnění obtíží"}',
 'Endometrióza je **chronické onemocnění**. Operace i hormonální léčba mohou příznaky výrazně zmírnit, ale onemocnění se může vrátit. Cílem léčby proto není „vyléčit“, ale dostat příznaky pod kontrolu a udržet kvalitu života.',
 'Can endometriosis be cured completely?', NULL,
 '{"surgery":"Yes, with surgery","hormones":"Yes, with hormone therapy","no_cure":"No, treatment focuses mainly on easing symptoms"}',
 'Endometriosis is a **chronic condition**. Surgery and hormonal treatment can reduce symptoms a great deal, but it can come back. The goal of treatment is not a cure but control of symptoms and quality of life.'),

(140, 'k_see_doctor', 'single', true,
 '{"options":["yes","no","unsure"],"correct":["yes"]}',
 'Považujete silnou menstruační bolest, která omezuje běžné denní fungování, za důvod k návštěvě lékaře?', NULL,
 '{"yes":"ano, silná bolest by se měla nechat vyšetřit gynekologem","no":"ne, silná bolest je běžnou součástí menstruace","unsure":"nedokážu posoudit"}',
 'Nepříjemné křeče jsou běžné. Bolest, kvůli které **nemůžete jít do školy nebo do práce**, kvůli které zvracíte, omdléváte nebo Vám nepomáhají běžné léky, běžná není a zaslouží si vyšetření u gynekologa. Tohle je nejdůležitější věta celého dotazníku.',
 'Do you consider severe period pain that limits everyday functioning a reason to see a doctor?', NULL,
 '{"yes":"Yes, severe pain should be checked by a gynaecologist","no":"No, severe pain is a normal part of periods","unsure":"I cannot judge"}',
 'Uncomfortable cramps are common. Pain that **stops you going to school or work**, that makes you vomit or faint, or that ordinary painkillers do not touch, is not normal and deserves a gynaecologist''s attention. This is the most important sentence in the questionnaire.'),

-- ===== information and feedback: ungraded ==================================
(150, 'info_sources', 'multi', true,
 '{"options":["doctor","internet","family","school","nowhere"],"exclusive":["nowhere"]}',
 'Odkud byste čerpal/a informace o gynekologickém onemocnění?', 'Můžete označit více odpovědí.',
 '{"doctor":"od lékaře / zdravotní sestry","internet":"z internetu a sociálních sítí","family":"od rodiny nebo přátel","school":"ze školy / výuky","nowhere":"nikde, informace bych nehledal/a"}', NULL,
 'Where would you look for information about a gynaecological condition?', 'You can choose more than one.',
 '{"doctor":"From a doctor or nurse","internet":"From the internet and social media","family":"From family or friends","school":"From school / classes","nowhere":"Nowhere, I would not look for it"}', NULL),

(160, 'wants_materials', 'single', true,
 '{"options":["yes","no","unsure"]}',
 'Uvítali byste více informačních materiálů o endometrióze?', NULL,
 '{"yes":"ano","no":"ne","unsure":"nedokážu určit"}', NULL,
 'Would you welcome more information materials about endometriosis?', NULL,
 '{"yes":"Yes","no":"No","unsure":"I cannot say"}', NULL),

(170, 'free_missing', 'textarea', false,
 '{"maxlen":1000}',
 'Je něco, co byste se o endometrióze rád/a dozvěděl/a, nebo co Vám v tomto dotazníku chybělo?',
 'Nepovinné. Prosím neuvádějte jména ani jiné údaje, podle kterých by Vás šlo poznat.',
 '{}', NULL,
 'Is there anything you would like to learn about endometriosis, or anything you missed in this questionnaire?',
 'Optional. Please do not include names or other details that would make you recognisable.',
 '{}', NULL);

INSERT INTO questions (survey_id, position, code, kind, required, spec)
SELECT s.id, a.position, a.code, a.kind, a.required, a.spec
FROM surveys s, aq a WHERE s.slug = 'endo-znalosti';

INSERT INTO question_i18n (question_id, locale, prompt, help, labels, explain_md)
SELECT q.id, 'cs', a.cs_prompt, a.cs_help, a.cs_labels, a.cs_explain
FROM aq a
JOIN surveys s   ON s.slug = 'endo-znalosti'
JOIN questions q ON q.survey_id = s.id AND q.code = a.code;

INSERT INTO question_i18n (question_id, locale, prompt, help, labels, explain_md)
SELECT q.id, 'en', a.en_prompt, a.en_help, a.en_labels, a.en_explain
FROM aq a
JOIN surveys s   ON s.slug = 'endo-znalosti'
JOIN questions q ON q.survey_id = s.id AND q.code = a.code;

COMMIT;
