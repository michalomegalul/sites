-- 003: first tenant — endometriosis questionnaire (nursing thesis, 2026)
--
-- Idempotent-ish: re-running drops and recreates the survey. Because
-- surveys.id cascades, THIS DELETES ITS RESPONSES. Do not run it again once
-- collection has started.

BEGIN;

-- Guard. The README tells you to apply migrations with `for f in db/0*.sql`,
-- which re-runs this file every time a 004 is added. The DELETE below cascades
-- to responses, so without this a routine migration would silently destroy the
-- collected data. Refuse instead.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM responses r
             JOIN surveys s ON s.id = r.survey_id
             WHERE s.slug = 'endo-2026') THEN
    RAISE EXCEPTION
      'endo-2026 already has responses — refusing to reseed. '
      'Drop this file from the glob, or delete the responses deliberately first.';
  END IF;
END $$;

DELETE FROM surveys WHERE slug = 'endo-2026';

INSERT INTO surveys (slug, default_locale, locales, consent_ver, is_open)
VALUES ('endo-2026', 'cs', ARRAY['cs','en'], 'v1', true);

-- ---------------------------------------------------------------- survey text

INSERT INTO survey_i18n (survey_id, locale, title, intro_md, consent_md, thanks_md)
SELECT id, 'cs',
'Život s endometriózou',
'Tento dotazník je součástí odborné práce na zdravotnické škole. Mapuje, jak
endometrióza ovlivňuje každodenní život — bolest, její umístění, dopad na práci
a vztahy, a zkušenost se zdravotní péčí.

Vyplnění trvá **přibližně 10 minut**. Odpovědi se ukládají průběžně, takže
můžete kdykoli přestat a vrátit se na stejném zařízení později.',
'**Účast je dobrovolná a anonymní.**

- Neukládáme Vaše jméno, e-mail ani IP adresu. K odpovědím se nedá připojit nic,
  co by vedlo k Vaší osobě.
- Odpovědi obsahují údaje o zdravotním stavu. To je podle GDPR zvláštní kategorie
  osobních údajů, a proto k jejich zpracování potřebujeme Váš výslovný souhlas.
- **Autorka práce Vaše odpovědi uvidí.** Okruh oslovených je malý a lidé se
  navzájem znají. U otevřených odpovědí proto může být poznat, kdo je napsal.
  Prosím pište je s tímto vědomím a neuvádějte jména ani místa.
- Výsledky budou zveřejněny pouze souhrnně, ve formě tabulek a grafů.
- Vyplňování můžete kdykoli ukončit. Dokud dotazník neodešlete, nic se
  nezapočítá.

Odesláním potvrzujete, že je Vám alespoň 18 let.',
'**Děkujeme.**

Vaše odpovědi byly odeslány a od této chvíle jsou součástí anonymního souhrnu.

Pokud Vás zajímá, jak práce dopadla, můžete níže nechat e-mail. Ukládá se
odděleně od odpovědí a nedá se s nimi spojit.'
FROM surveys WHERE slug = 'endo-2026';

INSERT INTO survey_i18n (survey_id, locale, title, intro_md, consent_md, thanks_md)
SELECT id, 'en',
'Living with endometriosis',
'This questionnaire is part of a nursing-school thesis. It looks at how
endometriosis affects daily life — pain and where it sits, the impact on work
and relationships, and your experience of healthcare.

It takes **about 10 minutes**. Answers save as you go, so you can stop and come
back later on the same device.',
'**Taking part is voluntary and anonymous.**

- We do not store your name, email, or IP address. Nothing that identifies you
  can be attached to your answers.
- Your answers include health information. Under GDPR that is special-category
  personal data, which is why we need your explicit consent to process it.
- **The researcher will read your answers.** The group being asked is small and
  people in it know each other, so free-text answers may be recognisable. Please
  write them with that in mind, and avoid names and places.
- Results will only ever be published in aggregate, as tables and charts.
- You can stop at any time. Nothing counts until you submit.

By submitting you confirm that you are at least 18 years old.',
'**Thank you.**

Your answers have been submitted and are now part of the anonymous total.

If you would like to know how the thesis turned out, you can leave an email
below. It is stored separately from your answers and cannot be linked to them.'
FROM surveys WHERE slug = 'endo-2026';

-- --------------------------------------------------------------------- sources

INSERT INTO sources (survey_id, code, label)
SELECT id, v.code, v.label
FROM surveys, (VALUES
  ('direct',    'Direct link'),
  ('insta',     'Instagram'),
  ('fb-group',  'Facebook support group'),
  ('reddit',    'Reddit'),
  ('clinic',    'Poster at clinic'),
  ('word',      'Word of mouth')
) AS v(code, label)
WHERE slug = 'endo-2026';

-- ------------------------------------------------------------------- questions
--
-- Positions step by 10 so questions can be inserted later without renumbering.
-- `code` is the export key and must never change once collection starts.

CREATE TEMP TABLE q_seed (
  position INT, code TEXT, kind TEXT, required BOOLEAN, spec JSONB,
  cs_prompt TEXT, cs_help TEXT, cs_labels JSONB,
  en_prompt TEXT, en_help TEXT, en_labels JSONB
) ON COMMIT DROP;

INSERT INTO q_seed VALUES

-- ===== A. About you ========================================================
(10, 'age_band', 'single', true,
 '{"options":["u25","25_34","35_44","45_54","55p"]}',
 'Kolik je Vám let?', NULL,
 '{"u25":"18–24","25_34":"25–34","35_44":"35–44","45_54":"45–54","55p":"55 a více"}',
 'How old are you?', NULL,
 '{"u25":"18–24","25_34":"25–34","35_44":"35–44","45_54":"45–54","55p":"55 or older"}'),

(20, 'country', 'single', true,
 '{"options":["cz","sk","other"]}',
 'Kde žijete?', 'Ptáme se kvůli srovnání dostupnosti péče, ne kvůli identifikaci.',
 '{"cz":"Česká republika","sk":"Slovensko","other":"Jinde"}',
 'Where do you live?', 'We ask to compare access to care, not to identify you.',
 '{"cz":"Czechia","sk":"Slovakia","other":"Elsewhere"}'),

-- ===== B. Diagnosis ========================================================
(30, 'dg_status', 'single', true,
 '{"options":["lap","clinical","suspected","none"]}',
 'Máte diagnostikovanou endometriózu?', NULL,
 '{"lap":"Ano, potvrzenou laparoskopicky","clinical":"Ano, stanovenou lékařem podle příznaků a zobrazovacích metod","suspected":"Zatím ne, ale je u mě vyslovené podezření","none":"Ne, nemám diagnózu ani podezření"}',
 'Have you been diagnosed with endometriosis?', NULL,
 '{"lap":"Yes, confirmed by laparoscopy","clinical":"Yes, diagnosed clinically from symptoms and imaging","suspected":"Not yet, but it is suspected","none":"No diagnosis and none suspected"}'),

(40, 'dg_delay', 'single', false,
 '{"options":["u1","1_2","3_5","6_10","10p","na"]}',
 'Jak dlouho trvalo od prvních obtíží ke stanovení diagnózy?', NULL,
 '{"u1":"Méně než rok","1_2":"1–2 roky","3_5":"3–5 let","6_10":"6–10 let","10p":"Více než 10 let","na":"Diagnózu zatím nemám"}',
 'How long was it from your first symptoms to a diagnosis?', NULL,
 '{"u1":"Less than a year","1_2":"1–2 years","3_5":"3–5 years","6_10":"6–10 years","10p":"More than 10 years","na":"I do not have a diagnosis yet"}'),

(50, 'dg_doctors', 'single', false,
 '{"options":["1","2_3","4_5","6p","na"]}',
 'Kolik lékařů jste navštívila, než Vaše obtíže někdo bral vážně?', NULL,
 '{"1":"Prvního, u kterého jsem byla","2_3":"2–3","4_5":"4–5","6p":"6 a více","na":"Zatím se to nestalo"}',
 'How many doctors did you see before anyone took your symptoms seriously?', NULL,
 '{"1":"The first one I saw","2_3":"2–3","4_5":"4–5","6p":"6 or more","na":"It has not happened yet"}'),

-- ===== C. Symptoms =========================================================
(60, 'sym_list', 'multi', true,
 '{"options":["dysmenorrhea","pelvic_pain","dyspareunia","dyschezia","dysuria","heavy_bleeding","spotting","fatigue","bloating","nausea","bowel","infertility","back_pain","leg_pain","shoulder_pain","none"],"exclusive":["none"]}',
 'Které z těchto obtíží se u Vás objevují?', 'Vyberte vše, co platí.',
 '{"dysmenorrhea":"Bolestivá menstruace","pelvic_pain":"Chronická pánevní bolest","dyspareunia":"Bolest při pohlavním styku","dyschezia":"Bolest při vyprazdňování stolice","dysuria":"Bolest při močení","heavy_bleeding":"Silné menstruační krvácení","spotting":"Špinění mimo menstruaci","fatigue":"Výrazná únava","bloating":"Nadýmání a otok břicha (tzv. endo belly)","nausea":"Nevolnost nebo zvracení","bowel":"Střevní obtíže (průjem, zácpa)","infertility":"Potíže s otěhotněním","back_pain":"Bolest zad","leg_pain":"Bolest vystřelující do nohou","shoulder_pain":"Bolest v rameni nebo pod lopatkou","none":"Žádné z uvedených"}',
 'Which of these do you experience?', 'Select everything that applies.',
 '{"dysmenorrhea":"Painful periods","pelvic_pain":"Chronic pelvic pain","dyspareunia":"Pain during sex","dyschezia":"Pain when opening your bowels","dysuria":"Pain when urinating","heavy_bleeding":"Heavy menstrual bleeding","spotting":"Spotting between periods","fatigue":"Severe fatigue","bloating":"Bloating and abdominal swelling (endo belly)","nausea":"Nausea or vomiting","bowel":"Bowel problems (diarrhoea, constipation)","infertility":"Difficulty getting pregnant","back_pain":"Back pain","leg_pain":"Pain radiating into the legs","shoulder_pain":"Shoulder or shoulder-blade pain","none":"None of these"}'),

(70, 'pain_map', 'bodymap', true,
 '{"regions":["shoulder-l","shoulder-r","ribs-l","ribs-r","abdomen-upper","abdomen-lower-l","abdomen-lower-r","pelvis-suprapubic","groin-l","groin-r","thigh-l","thigh-r","back-lower","sacrum","coccyx","buttock-l","buttock-r","rectal-deep"],"levels":3}',
 'Kde cítíte bolest?',
 'Klepnutím na oblast zvyšujete intenzitu: mírná → střední → silná. Dalším klepnutím se vrátíte na nulu. Přepínačem nahoře přejdete na záda.',
 '{"shoulder-l":"Levé rameno","shoulder-r":"Pravé rameno","ribs-l":"Pod levými žebry","ribs-r":"Pod pravými žebry","abdomen-upper":"Horní část břicha","abdomen-lower-l":"Podbřišek vlevo","abdomen-lower-r":"Podbřišek vpravo","pelvis-suprapubic":"Nad stydkou kostí","groin-l":"Levé tříslo","groin-r":"Pravé tříslo","thigh-l":"Levé stehno","thigh-r":"Pravé stehno","back-lower":"Bederní páteř","sacrum":"Křížová kost","coccyx":"Kostrč","buttock-l":"Levá hýždě","buttock-r":"Pravá hýždě","rectal-deep":"Hluboko v pánvi / konečník"}',
 'Where do you feel pain?',
 'Tap a region to raise the intensity: mild → moderate → severe. Tap again to return to none. Use the switch above to turn to the back view.',
 '{"shoulder-l":"Left shoulder","shoulder-r":"Right shoulder","ribs-l":"Under left ribs","ribs-r":"Under right ribs","abdomen-upper":"Upper abdomen","abdomen-lower-l":"Lower abdomen, left","abdomen-lower-r":"Lower abdomen, right","pelvis-suprapubic":"Above the pubic bone","groin-l":"Left groin","groin-r":"Right groin","thigh-l":"Left thigh","thigh-r":"Right thigh","back-lower":"Lower back","sacrum":"Sacrum","coccyx":"Tailbone","buttock-l":"Left buttock","buttock-r":"Right buttock","rectal-deep":"Deep pelvic / rectal"}'),

(80, 'pain_worst', 'scale', true,
 '{"min":0,"max":10}',
 'Jak silná je Vaše bolest, když je nejhorší?', NULL,
 '{"min":"Žádná bolest","max":"Nejhorší představitelná"}',
 'How bad is your pain at its worst?', NULL,
 '{"min":"No pain","max":"Worst imaginable"}'),

(90, 'pain_days', 'single', false,
 '{"options":["0","1_3","4_7","8_14","15p"]}',
 'Kolik dní v měsíci máte bolesti?', NULL,
 '{"0":"Žádný","1_3":"1–3 dny","4_7":"4–7 dní","8_14":"8–14 dní","15p":"15 a více dní"}',
 'How many days a month are you in pain?', NULL,
 '{"0":"None","1_3":"1–3 days","4_7":"4–7 days","8_14":"8–14 days","15p":"15 days or more"}'),

(100, 'pain_cycle', 'single', false,
 '{"options":["period_only","before_during","most_month","unrelated"]}',
 'Jak bolest souvisí s menstruačním cyklem?', NULL,
 '{"period_only":"Jen během menstruace","before_during":"Před menstruací a během ní","most_month":"Většinu měsíce","unrelated":"S cyklem nesouvisí"}',
 'How does the pain relate to your cycle?', NULL,
 '{"period_only":"Only during my period","before_during":"Before and during my period","most_month":"Most of the month","unrelated":"Unrelated to my cycle"}'),

-- ===== D. Impact ===========================================================
(110, 'imp_absence', 'single', false,
 '{"options":["0","1_2","3_5","6p","na"]}',
 'Kolik dní v měsíci kvůli obtížím zmeškáte práci nebo školu?', NULL,
 '{"0":"Žádný","1_2":"1–2 dny","3_5":"3–5 dní","6p":"6 a více dní","na":"Nepracuji ani nestuduji"}',
 'How many days a month do you miss work or school because of symptoms?', NULL,
 '{"0":"None","1_2":"1–2 days","3_5":"3–5 days","6p":"6 or more days","na":"I do not work or study"}'),

(120, 'imp_areas', 'multi', false,
 '{"options":["work","study","sport","social","partner","sex","sleep","household","travel","plans","none"],"exclusive":["none"]}',
 'Co Vám obtíže nejvíce omezují?', 'Vyberte vše, co platí.',
 '{"work":"Práci","study":"Studium","sport":"Sport a pohyb","social":"Setkávání s přáteli","partner":"Partnerský vztah","sex":"Sexuální život","sleep":"Spánek","household":"Domácnost","travel":"Cestování","plans":"Plánování do budoucna","none":"Nic z uvedeného"}',
 'What do your symptoms limit most?', 'Select everything that applies.',
 '{"work":"Work","study":"Study","sport":"Sport and exercise","social":"Seeing friends","partner":"My relationship","sex":"Sex life","sleep":"Sleep","household":"Housework","travel":"Travel","plans":"Planning ahead","none":"None of these"}'),

(130, 'imp_mental', 'scale', false,
 '{"min":0,"max":10}',
 'Jak moc obtíže ovlivňují Vaše duševní zdraví?', NULL,
 '{"min":"Vůbec","max":"Zásadně"}',
 'How much do your symptoms affect your mental health?', NULL,
 '{"min":"Not at all","max":"Enormously"}'),

-- ===== E. Care =============================================================
(140, 'care_tried', 'multi', false,
 '{"options":["hormonal","gnrh","iud","surgery","painkillers","physio","psych","diet","alt","none"],"exclusive":["none"]}',
 'Co jste z léčby zkusila?', 'Vyberte vše, co platí.',
 '{"hormonal":"Hormonální antikoncepci","gnrh":"GnRH analoga","iud":"Nitroděložní tělísko","surgery":"Operaci (laparoskopii)","painkillers":"Léky proti bolesti","physio":"Fyzioterapii pánevního dna","psych":"Psychoterapii","diet":"Úpravu jídelníčku","alt":"Alternativní metody","none":"Zatím nic"}',
 'What treatments have you tried?', 'Select everything that applies.',
 '{"hormonal":"Hormonal contraception","gnrh":"GnRH analogues","iud":"Intrauterine device","surgery":"Surgery (laparoscopy)","painkillers":"Pain medication","physio":"Pelvic-floor physiotherapy","psych":"Psychotherapy","diet":"Dietary changes","alt":"Alternative therapies","none":"Nothing yet"}'),

(150, 'care_help', 'scale', false,
 '{"min":0,"max":10}',
 'Jak moc Vám dosavadní léčba pomohla?', NULL,
 '{"min":"Vůbec nepomohla","max":"Velmi pomohla"}',
 'How much has your treatment helped?', NULL,
 '{"min":"Not at all","max":"Enormously"}'),

(160, 'care_serious', 'single', false,
 '{"options":["always","mostly","sometimes","rarely","never"]}',
 'Měla jste pocit, že zdravotníci Vaše obtíže berou vážně?', NULL,
 '{"always":"Vždy","mostly":"Většinou","sometimes":"Někdy","rarely":"Zřídka","never":"Nikdy"}',
 'Did you feel healthcare staff took your symptoms seriously?', NULL,
 '{"always":"Always","mostly":"Mostly","sometimes":"Sometimes","rarely":"Rarely","never":"Never"}'),

(170, 'care_satisfaction', 'scale', false,
 '{"min":0,"max":10}',
 'Jak jste celkově spokojená s péčí, které se Vám dostalo?', NULL,
 '{"min":"Vůbec nespokojená","max":"Velmi spokojená"}',
 'Overall, how satisfied are you with the care you received?', NULL,
 '{"min":"Not at all satisfied","max":"Very satisfied"}'),

-- ===== F. In your own words ================================================
-- Kept to two, both narrow. See SPEC: free text is re-identifiable in a small
-- convenience sample, so the help text warns before the keyboard opens.
(180, 'free_hcp', 'textarea', false,
 '{"maxlen":600}',
 'Co by podle Vás měli zdravotníci o endometrióze vědět?',
 'Nepovinné. Prosím neuvádějte jména, místa ani nemocnice — podle nich by Vás šlo poznat.',
 '{}',
 'What do you think healthcare staff should know about endometriosis?',
 'Optional. Please do not include names, places, or hospitals — they would make you recognisable.',
 '{}'),

(190, 'free_advice', 'textarea', false,
 '{"maxlen":600}',
 'Co byste vzkázala ženě, která diagnózu právě dostala?',
 'Nepovinné. Stejná prosba: žádná jména ani místa.',
 '{}',
 'What would you say to someone who has just been diagnosed?',
 'Optional. Same request: no names or places.',
 '{}');

INSERT INTO questions (survey_id, position, code, kind, required, spec)
SELECT s.id, q.position, q.code, q.kind, q.required, q.spec
FROM surveys s, q_seed q
WHERE s.slug = 'endo-2026';

INSERT INTO question_i18n (question_id, locale, prompt, help, labels)
SELECT qq.id, 'cs', q.cs_prompt, q.cs_help, q.cs_labels
FROM q_seed q
JOIN surveys s   ON s.slug = 'endo-2026'
JOIN questions qq ON qq.survey_id = s.id AND qq.code = q.code;

INSERT INTO question_i18n (question_id, locale, prompt, help, labels)
SELECT qq.id, 'en', q.en_prompt, q.en_help, q.en_labels
FROM q_seed q
JOIN surveys s   ON s.slug = 'endo-2026'
JOIN questions qq ON qq.survey_id = s.id AND qq.code = q.code;

COMMIT;
