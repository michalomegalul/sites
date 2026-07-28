-- 005: second tenant — public awareness quiz ("Co víte o endometrióze?")
--
-- Audience is the general public, not people who already have the diagnosis.
-- It measures what people know AND teaches them: every graded question carries
-- an explanation shown once the answer is recorded.
--
-- Guard, same as 003: refuse if responses already exist.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM responses r
             JOIN surveys s ON s.id = r.survey_id
             WHERE s.slug = 'endo-znalosti') THEN
    RAISE EXCEPTION
      'endo-znalosti already has responses — refusing to reseed.';
  END IF;
END $$;

DELETE FROM surveys WHERE slug = 'endo-znalosti';

INSERT INTO surveys (slug, default_locale, locales, consent_ver, is_open, mode)
VALUES ('endo-znalosti', 'cs', ARRAY['cs','en'], 'v1', true, 'quiz');

INSERT INTO survey_i18n (survey_id, locale, title, intro_md, consent_md, thanks_md)
SELECT id, 'cs',
'Co víte o endometrióze?',
'Krátký kvíz o nemoci, kterou má přibližně **každá desátá žena** — a o které se
skoro nemluví.

Dvanáct otázek, **asi 5 minut**. Po každé odpovědi se dozvíte, jak to je.
Nevadí, když něco nevíte; právě to je smyslem této práce zjistit.',
'Kvíz je **anonymní**. Neukládáme jméno, e-mail ani IP adresu.

- Zaznamenává se jen to, co odpovíte, a v jakém jazyce.
- Odpovědi slouží jako podklad odborné práce na zdravotnické škole a budou
  zveřejněny pouze souhrnně.
- Vaše odpověď se ukládá dřív, než uvidíte správné řešení, aby výsledky
  odpovídaly skutečnosti.
- Účast můžete kdykoli ukončit.',
'**Díky, že jste to dočetli až sem.**

Nejdůležitější věta z celého kvízu: *menstruační bolest, kvůli které nemůžete
fungovat, není normální a patří k vyšetření.*

Pokud v tom poznáváte sebe nebo někoho blízkého, může pomoct i to, že o tom
řeknete dál. Právě mlčení stojí za tím, že diagnóza trvá roky.'
FROM surveys WHERE slug = 'endo-znalosti';

INSERT INTO survey_i18n (survey_id, locale, title, intro_md, consent_md, thanks_md)
SELECT id, 'en',
'What do you know about endometriosis?',
'A short quiz about a condition that affects roughly **one in ten women** — and
that is barely talked about.

Twelve questions, **about 5 minutes**. After each answer you will see how it
actually is. It is fine not to know; finding that out is the point.',
'This quiz is **anonymous**. We do not store your name, email, or IP address.

- Only your answers and the language you used are recorded.
- The results support a nursing-school thesis and will only be published in
  aggregate.
- Your answer is saved before you are shown the correct one, so the results
  reflect what people actually knew.
- You can stop at any time.',
'**Thank you for reading to the end.**

The single most important sentence in this quiz: *period pain that stops you
functioning is not normal, and deserves to be investigated.*

If you recognise yourself or someone close to you in this, telling them matters.
Silence is a large part of why diagnosis takes years.'
FROM surveys WHERE slug = 'endo-znalosti';

INSERT INTO sources (survey_id, code, label)
SELECT id, v.code, v.label
FROM surveys, (VALUES
  ('direct','Direct link'), ('insta','Instagram'), ('fb-group','Facebook'),
  ('school','School'), ('word','Word of mouth')
) AS v(code, label)
WHERE slug = 'endo-znalosti';

CREATE TEMP TABLE aq (
  position INT, code TEXT, kind TEXT, required BOOLEAN, spec JSONB,
  cs_prompt TEXT, cs_labels JSONB, cs_explain TEXT,
  en_prompt TEXT, en_labels JSONB, en_explain TEXT
) ON COMMIT DROP;

INSERT INTO aq VALUES

-- ===== context: ungraded, so she can segment awareness by group ===========
(10, 'who', 'single', true,
 '{"options":["woman","man","other"]}',
 'Kdo vyplňuje?',
 '{"woman":"Žena","man":"Muž","other":"Jinak / nechci uvádět"}', NULL,
 'Who is filling this in?',
 '{"woman":"A woman","man":"A man","other":"Other / prefer not to say"}', NULL),

(20, 'age_band', 'single', true,
 '{"options":["u18","18_24","25_34","35_44","45p"]}',
 'Kolik je Vám let?',
 '{"u18":"Méně než 18","18_24":"18–24","25_34":"25–34","35_44":"35–44","45p":"45 a více"}', NULL,
 'How old are you?',
 '{"u18":"Under 18","18_24":"18–24","25_34":"25–34","35_44":"35–44","45p":"45 or older"}', NULL),

(30, 'heard_before', 'single', true,
 '{"options":["know","heard","never"]}',
 'Slyšeli jste o endometrióze před tímto kvízem?',
 '{"know":"Ano a vím, co to je","heard":"Slyšel/a jsem ten pojem, ale nevím přesně","never":"Ne, slyším to poprvé"}', NULL,
 'Had you heard of endometriosis before this quiz?',
 '{"know":"Yes, and I know what it is","heard":"I had heard the word but was not sure","never":"No, this is the first time"}', NULL),

(40, 'knows_someone', 'single', false,
 '{"options":["yes","suspect","no","unsure"]}',
 'Znáte někoho, kdo endometriózu má?',
 '{"yes":"Ano","suspect":"Mám podezření u někoho blízkého","no":"Ne","unsure":"Nevím"}', NULL,
 'Do you know anyone who has endometriosis?',
 '{"yes":"Yes","suspect":"I suspect someone close to me does","no":"No","unsure":"I do not know"}', NULL),

-- ===== graded knowledge questions =========================================
(100, 'k_what', 'single', true,
 '{"options":["outside","infection","tumour","stress"],"correct":["outside"]}',
 'Co je endometrióza?',
 '{"outside":"Tkáň podobná děložní sliznici roste mimo dělohu","infection":"Zánět dělohy způsobený infekcí","tumour":"Nezhoubný nádor dělohy","stress":"Porucha cyklu způsobená stresem"}',
 'Endometrióza je onemocnění, při kterém tkáň **podobná** děložní sliznici roste **mimo dělohu** — nejčastěji na pobřišnici, vaječnících a v pánvi. Není to infekce ani nádor a nezpůsobuje ji stres. Tato tkáň reaguje na hormonální cyklus, krvácí a dráždí okolí, což vede k zánětu, srůstům a bolesti.',
 'What is endometriosis?',
 '{"outside":"Tissue similar to the womb lining grows outside the uterus","infection":"Inflammation of the womb caused by infection","tumour":"A benign tumour of the uterus","stress":"A cycle disorder caused by stress"}',
 'Endometriosis is a condition where tissue **similar to** the lining of the womb grows **outside the uterus** — most often on the peritoneum, ovaries and pelvis. It is not an infection or a tumour, and stress does not cause it. The tissue responds to the hormonal cycle, bleeds, and irritates what is around it, causing inflammation, adhesions and pain.'),

(110, 'k_prevalence', 'single', true,
 '{"options":["ten","hundred","thousand","rare"],"correct":["ten"]}',
 'Kolika žen v reprodukčním věku se endometrióza přibližně týká?',
 '{"ten":"Zhruba každé desáté","hundred":"Zhruba jedné ze sta","thousand":"Zhruba jedné z tisíce","rare":"Je to vzácné onemocnění"}',
 'Podle Světové zdravotnické organizace se endometrióza týká přibližně **10 % žen a dívek v reprodukčním věku** — celosvětově asi 190 milionů. Je tedy zhruba stejně častá jako astma nebo cukrovka. Není to vzácné onemocnění, jen málo viditelné.',
 'Roughly how many women of reproductive age does endometriosis affect?',
 '{"ten":"About one in ten","hundred":"About one in a hundred","thousand":"About one in a thousand","rare":"It is a rare disease"}',
 'The World Health Organization puts it at roughly **10% of women and girls of reproductive age** — around 190 million worldwide. That makes it about as common as asthma or diabetes. It is not rare, just not very visible.'),

(120, 'k_delay', 'single', true,
 '{"options":["fast","two","seven","immediate"],"correct":["seven"]}',
 'Jak dlouho v průměru trvá, než je endometrióza diagnostikována?',
 '{"fast":"Méně než rok","two":"2–3 roky","seven":"7–10 let","immediate":"Pozná se hned při první návštěvě"}',
 'Studie z různých zemí uvádějí průměrné zpoždění **7 až 10 let** od prvních příznaků ke stanovení diagnózy. Hlavním důvodem je, že se silná menstruační bolest považuje za normální — okolím, lékaři i samotnými pacientkami.',
 'On average, how long does it take to get an endometriosis diagnosis?',
 '{"fast":"Less than a year","two":"2–3 years","seven":"7–10 years","immediate":"It is spotted at the first appointment"}',
 'Studies across countries report an average delay of **7 to 10 years** from first symptoms to diagnosis. The main reason is that severe period pain gets treated as normal — by those around the patient, by clinicians, and by patients themselves.'),

(130, 'k_normal_pain', 'single', true,
 '{"options":["not_normal","always","if_pills","young"],"correct":["not_normal"]}',
 'Je velmi silná menstruační bolest normální?',
 '{"not_normal":"Ne — bolest, která brání běžnému fungování, normální není","always":"Ano, menstruace prostě bolí","if_pills":"Ano, pokud zabere lék proti bolesti","young":"Ano, u mladých dívek je to běžné"}',
 'Nepříjemné křeče jsou běžné. Bolest, kvůli které **nemůžete jít do školy nebo do práce**, kvůli které zvracíte, omdléváte nebo Vám nepomáhají běžné léky, běžná není a zaslouží si vyšetření. Tohle je nejdůležitější věta celého kvízu.',
 'Is very severe period pain normal?',
 '{"not_normal":"No — pain that stops you functioning is not normal","always":"Yes, periods simply hurt","if_pills":"Yes, as long as painkillers work","young":"Yes, it is common in young girls"}',
 'Uncomfortable cramps are common. Pain that **stops you going to school or work**, that makes you vomit or faint, or that ordinary painkillers do not touch, is not normal and deserves investigation. This is the most important sentence in the quiz.'),

(140, 'k_cure', 'single', true,
 '{"options":["no_cure","surgery","pill","menopause"],"correct":["no_cure"]}',
 'Dá se endometrióza zcela vyléčit?',
 '{"no_cure":"Ne, ale dá se léčit a příznaky výrazně tlumit","surgery":"Ano, jednou operací","pill":"Ano, hormonální antikoncepcí","menopause":"Ano, v přechodu vždy zmizí"}',
 'Endometrióza je **chronické onemocnění**. Operace i hormonální léčba mohou příznaky výrazně zmírnit, ale onemocnění se může vrátit. Cílem léčby proto není „vyléčit“, ale dostat příznaky pod kontrolu a udržet kvalitu života.',
 'Can endometriosis be cured completely?',
 '{"no_cure":"No, but it can be treated and symptoms greatly reduced","surgery":"Yes, with one operation","pill":"Yes, with hormonal contraception","menopause":"Yes, it always disappears at menopause"}',
 'Endometriosis is a **chronic condition**. Surgery and hormonal treatment can reduce symptoms a great deal, but it can come back. The goal of treatment is not a cure but control of symptoms and quality of life.'),

(150, 'k_pregnancy', 'single', true,
 '{"options":["myth","cures","young_only"],"correct":["myth"]}',
 'Vyléčí endometriózu těhotenství?',
 '{"myth":"Ne, je to rozšířený mýtus","cures":"Ano, těhotenství ji vyléčí","young_only":"Ano, ale jen u mladých žen"}',
 'Je to jeden z nejrozšířenějších mýtů. U části žen se příznaky během těhotenství zmírní, protože se zastaví menstruace — po porodu se ale obvykle vracejí. **Doporučovat těhotenství jako léčbu je zastaralé** a pro ženu, která zrovna děti neplánuje, i škodlivé.',
 'Does pregnancy cure endometriosis?',
 '{"myth":"No — this is a widespread myth","cures":"Yes, pregnancy cures it","young_only":"Yes, but only in young women"}',
 'This is one of the most persistent myths. Some women find symptoms ease during pregnancy because periods stop, but they usually return afterwards. **Recommending pregnancy as a treatment is outdated**, and harmful to anyone not planning children.'),

(160, 'k_fertility', 'single', true,
 '{"options":["not_always","always","only_surgery"],"correct":["not_always"]}',
 'Znamená endometrióza vždy neplodnost?',
 '{"not_always":"Ne — část žen má potíže otěhotnět, mnoho jich otěhotní přirozeně","always":"Ano, vždy","only_surgery":"Ano, pokud nepodstoupí operaci"}',
 'Potíže s otěhotněním se odhadují zhruba u **30–50 %** žen s endometriózou. Většina ostatních otěhotní přirozeně. Diagnóza sama o sobě tedy neznamená, že žena nemůže mít děti — a je dobré to slyšet hned na začátku, protože opak bývá první obava.',
 'Does endometriosis always mean infertility?',
 '{"not_always":"No — some struggle to conceive, many conceive naturally","always":"Yes, always","only_surgery":"Yes, unless they have surgery"}',
 'Difficulty conceiving is estimated in roughly **30–50%** of women with endometriosis. Most of the rest conceive naturally. A diagnosis on its own does not mean someone cannot have children — worth hearing early, because the opposite is usually the first fear.'),

(170, 'k_location', 'single', true,
 '{"options":["elsewhere","uterus_only","pelvis_only"],"correct":["elsewhere"]}',
 'Vyskytuje se endometrióza jen v děloze a jejím okolí?',
 '{"elsewhere":"Ne, může být i na střevě, močovém měchýři nebo bránici","uterus_only":"Ano, pouze v děloze","pelvis_only":"Ano, nikdy mimo pánev"}',
 'Ložiska bývají nejčastěji v pánvi, ale mohou být i na **střevě, močovém měchýři nebo bránici**, vzácně jinde. Ložisko na bránici může vystřelovat bolest **do ramene** — proto se na to ptáme i v dotazníku pro pacientky. Bolest ramene při menstruaci je příznak, na který se skoro nikdy nezeptá nikdo.',
 'Does endometriosis only occur in and around the uterus?',
 '{"elsewhere":"No — it can involve the bowel, bladder or diaphragm","uterus_only":"Yes, only in the uterus","pelvis_only":"Yes, never outside the pelvis"}',
 'Lesions are most often in the pelvis, but can involve the **bowel, bladder or diaphragm**, and rarely elsewhere. A lesion on the diaphragm can refer pain **to the shoulder** — which is why the patient questionnaire asks about it. Shoulder pain during a period is a symptom almost nobody thinks to ask about.'),

(180, 'k_symptoms', 'multi', true,
 '{"options":["cramps","sex_pain","fatigue","bowel_pain","hearing","teeth"],"correct":["cramps","sex_pain","fatigue","bowel_pain"]}',
 'Které z těchto obtíží mohou být příznakem endometriózy?',
 '{"cramps":"Silná menstruační bolest","sex_pain":"Bolest při pohlavním styku","fatigue":"Výrazná chronická únava","bowel_pain":"Bolest při vyprazdňování stolice","hearing":"Náhlá ztráta sluchu","teeth":"Vypadávání zubů"}',
 'Endometrióza není jen „bolestivá menstruace“. Patří k ní i **bolest při styku, chronická únava, střevní a močové obtíže, nadýmání** nebo bolest vystřelující do nohou. Ztráta sluchu ani problémy se zuby s ní nesouvisejí. Právě šíře příznaků je důvod, proč se na diagnózu tak dlouho nepřijde.',
 'Which of these can be symptoms of endometriosis?',
 '{"cramps":"Severe period pain","sex_pain":"Pain during sex","fatigue":"Marked chronic fatigue","bowel_pain":"Pain when opening the bowels","hearing":"Sudden hearing loss","teeth":"Losing teeth"}',
 'Endometriosis is not only painful periods. It also involves **pain during sex, chronic fatigue, bowel and bladder symptoms, bloating**, and pain radiating into the legs. Hearing loss and dental problems are unrelated. That breadth of symptoms is a large part of why it takes so long to recognise.'),

(190, 'k_ultrasound', 'single', true,
 '{"options":["not_reliable","reliable","blood_test"],"correct":["not_reliable"]}',
 'Vyloučí běžný ultrazvuk endometriózu?',
 '{"not_reliable":"Ne — povrchová ložiska na něm obvykle vidět nejsou","reliable":"Ano, spolehlivě ji vyloučí","blood_test":"Ne, ale stačí krevní test"}',
 'Ultrazvuk u zkušeného vyšetřujícího zobrazí cysty na vaječnících a hlubokou formu. **Povrchová ložiska ale často nevidí, a normální nález endometriózu nevylučuje.** Neexistuje ani krevní test, který by ji potvrdil nebo vyloučil. To je další důvod, proč ženy slyší, že „je všechno v pořádku“, i když v pořádku nic není.',
 'Does a routine ultrasound rule out endometriosis?',
 '{"not_reliable":"No — superficial lesions usually cannot be seen on one","reliable":"Yes, it rules it out reliably","blood_test":"No, but a blood test does"}',
 'In experienced hands ultrasound shows ovarian cysts and deep disease. But it **often cannot see superficial lesions, and a normal scan does not rule endometriosis out.** There is also no blood test that confirms or excludes it. This is another reason women are told everything is fine when it is not.'),

(200, 'k_age', 'single', true,
 '{"options":["teen","thirty","after_birth","menopause"],"correct":["teen"]}',
 'Odkdy se endometrióza může projevit?',
 '{"teen":"Už od prvních menstruací v dospívání","thirty":"Až po třicátém roce","after_birth":"Až po prvním porodu","menopause":"Až v přechodu"}',
 'Příznaky mohou začít **s úplně první menstruací**. U dospívajících se bolest ale nejčastěji bagatelizuje — „to přejde“, „to má každá“ — a právě to prodlužuje cestu k diagnóze o roky.',
 'From what age can endometriosis appear?',
 '{"teen":"From the very first periods in adolescence","thirty":"Only after the age of thirty","after_birth":"Only after a first birth","menopause":"Only at menopause"}',
 'Symptoms can begin with the **very first period**. In teenagers the pain is most often dismissed — "it will pass", "everyone gets that" — and that is exactly what adds years to the path to diagnosis.'),

(210, 'k_contraception', 'single', true,
 '{"options":["manages","cures","nothing"],"correct":["manages"]}',
 'Jak působí hormonální antikoncepce u endometriózy?',
 '{"manages":"Může tlumit příznaky, ale onemocnění neléčí","cures":"Vyléčí ji","nothing":"Nemá na ni žádný vliv"}',
 'Hormonální léčba potlačuje cyklus, a tím u řady žen výrazně zmírní bolest. **Ložiska ale neodstraní** a po vysazení se příznaky obvykle vracejí. Je to nástroj na zvládání příznaků, ne vyléčení.',
 'How does hormonal contraception work in endometriosis?',
 '{"manages":"It can reduce symptoms but does not cure the disease","cures":"It cures it","nothing":"It has no effect at all"}',
 'Hormonal treatment suppresses the cycle, which substantially reduces pain for many. But it **does not remove the lesions**, and symptoms usually return once it is stopped. It is a tool for managing symptoms, not a cure.');

INSERT INTO questions (survey_id, position, code, kind, required, spec)
SELECT s.id, a.position, a.code, a.kind, a.required, a.spec
FROM surveys s, aq a WHERE s.slug = 'endo-znalosti';

INSERT INTO question_i18n (question_id, locale, prompt, help, labels, explain_md)
SELECT q.id, 'cs', a.cs_prompt, NULL, a.cs_labels, a.cs_explain
FROM aq a
JOIN surveys s   ON s.slug = 'endo-znalosti'
JOIN questions q ON q.survey_id = s.id AND q.code = a.code;

INSERT INTO question_i18n (question_id, locale, prompt, help, labels, explain_md)
SELECT q.id, 'en', a.en_prompt, NULL, a.en_labels, a.en_explain
FROM aq a
JOIN surveys s   ON s.slug = 'endo-znalosti'
JOIN questions q ON q.survey_id = s.id AND q.code = a.code;

COMMIT;
