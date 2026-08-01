/* Walks the awareness quiz the way a respondent does, in a real DOM, against a
 * stubbed API. Exists because of one specific bug and the class it belongs to.
 *
 * THE BUG: renderGraded() relabelled its button to "Continue" and also assigned
 * btn.onclick, while an addEventListener for the same click was already
 * attached. Once feedback existed both handlers ran `state.index++` in the same
 * dispatch — detaching a node mid-dispatch does not cancel the remaining
 * listeners on it — so the index advanced by two and the next question was never
 * shown. Those questions then had no answer, so submit ended in
 * missing_required. It read as intermittent because endo-znalosti interleaves 12
 * graded questions with 4 ungraded ones.
 *
 * An API-level test cannot see this: the server behaved correctly throughout.
 * That is why this drives the actual frontend.
 *
 * Run:  cd quiz/tools/devtest && npm i jsdom      (once)
 *       node quiz/tools/quiz-walkthrough.test.js
 *
 * jsdom is a dev-only dependency in a gitignored directory. The site itself
 * still has no build step and the deploy still has no npm stage — SPEC.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'site');
let JSDOM;
try {
  ({ JSDOM } = require(path.join(__dirname, 'devtest', 'node_modules', 'jsdom')));
} catch (e) {
  console.error('jsdom missing. Run: cd ' + path.join(__dirname, 'devtest') + ' && npm i jsdom');
  process.exit(2);
}

// ---------------------------------------------------------------- fake survey
// Mirrors endo-znalosti's shape: graded questions interleaved with ungraded
// context ones. The interleaving is the point — a bug that eats "the next
// question" behaves differently depending on what follows.
const QUESTIONS = [
  { code: 'heard_before', kind: 'single', graded: false, required: true,
    spec: { options: ['yes', 'no'] }, labels: { yes: 'Ano', no: 'Ne' }, prompt: 'Slyšela jste o ní?' },
  { code: 'q_prevalence', kind: 'single', graded: true, required: true,
    spec: { options: ['a', 'b', 'c'] }, labels: { a: '1 %', b: '10 %', c: '30 %' }, prompt: 'Kolik žen?' },
  { code: 'q_pregnancy', kind: 'single', graded: true, required: true,
    spec: { options: ['a', 'b'] }, labels: { a: 'Ano', b: 'Ne' }, prompt: 'Vyléčí ji těhotenství?' },
  { code: 'knows_someone', kind: 'single', graded: false, required: true,
    spec: { options: ['yes', 'no'] }, labels: { yes: 'Ano', no: 'Ne' }, prompt: 'Znáte někoho?' },
  { code: 'q_multi', kind: 'multi', graded: true, required: true,
    spec: { options: ['a', 'b', 'c'] }, labels: { a: 'A', b: 'B', c: 'C' }, prompt: 'Které příznaky?' },
  { code: 'q_delay', kind: 'single', graded: true, required: true,
    spec: { options: ['a', 'b'] }, labels: { a: '1 rok', b: '7 let' }, prompt: 'Jak dlouho trvá diagnóza?' },
];

const CORRECT = { q_prevalence: ['b'], q_pregnancy: ['b'], q_multi: ['a', 'b'], q_delay: ['b'] };

// ------------------------------------------------------------------ fake API
const server = {
  answers: {},
  submitted: false,
  patches: 0,

  handle(method, url, body) {
    if (method === 'GET' && url.startsWith('/api/s/')) {
      return { status: 200, json: {
        slug: 'endo-znalosti', locale: 'cs', locales: ['cs', 'en'], is_open: true,
        consent_ver: 1, mode: 'quiz', title: 'Kvíz', intro_md: 'i', consent_md: 'c',
        thanks_md: 'd', questions: QUESTIONS,
      } };
    }
    if (method === 'POST' && url.endsWith('/start')) {
      return { status: 201, json: { response_id: '11111111-2222-3333-4444-555555555555', locale: 'cs' } };
    }
    if (method === 'PATCH') {
      this.patches++;
      const saved = [], feedback = {};
      for (const [code, value] of Object.entries(body)) {
        this.answers[code] = value;
        saved.push(code);
        // Grading happens only for questions that have a key — same as the API.
        if (CORRECT[code]) {
          const want = CORRECT[code];
          const ok = Array.isArray(value)
            ? JSON.stringify([...value].sort()) === JSON.stringify([...want].sort())
            : want.includes(value);
          feedback[code] = { correct: ok, correct_options: want, explain_md: 'protože…' };
        }
      }
      return { status: 200, json: { saved, rejected: [], feedback } };
    }
    if (method === 'POST' && url.endsWith('/submit')) {
      const missing = QUESTIONS.filter((q) => q.required && this.answers[q.code] === undefined)
        .map((q) => q.code);
      if (missing.length) return { status: 422, json: { error: 'missing_required', questions: missing } };
      this.submitted = true;
      const review = Object.keys(CORRECT).map((code) => ({
        code, prompt: code, correct: true, correct_options: CORRECT[code], explain_md: 'x',
      }));
      return { status: 200, json: { ok: true, score: review.length, out_of: review.length, review } };
    }
    return { status: 404, json: { error: 'not_found' } };
  },
};

// ------------------------------------------------------------------- harness
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  // Strip the <script> tags; we inject the sources ourselves in order so that
  // jsdom does not try to fetch them.
  .replace(/<script[^>]*src=[^>]*><\/script>/g, '');

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://quiz.dobsinsky.xyz/cs/s/endo-znalosti' });
const { window } = dom;

window.fetch = (url, opts = {}) => {
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  const res = server.handle(method, url, body);
  return Promise.resolve({
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    json: () => Promise.resolve(res.json),
  });
};
window.requestAnimationFrame = (fn) => setTimeout(fn, 0);
window.scrollTo = () => {};

// Same order as index.html — palette.js before theme.js, because theme.js
// applies a cached accent through it.
for (const f of ['js/palette.js', 'js/theme.js', 'js/config.js', 'js/i18n.js',
                 'js/bodymap.js', 'js/app.js']) {
  window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

// ------------------------------------------------------------------ driving
const tick = () => new Promise((r) => setTimeout(r, 12));
const doc = window.document;
const $ = (s) => doc.querySelector(s);
const text = () => doc.getElementById('screen').textContent;
const buttonWith = (label) =>
  [...doc.querySelectorAll('button')].find((b) => b.textContent.trim() === label);

const failures = [];
const seen = [];      // prompts actually shown, in order

function check(cond, msg) {
  if (cond) console.log('  ok   ' + msg);
  else { console.log('  FAIL ' + msg); failures.push(msg); }
}

(async () => {
  await tick(); await tick();

  console.log('\nconsent screen');
  check(/Kvíz/.test(text()), 'renders the survey title');
  const agree = doc.querySelector('.check input[type=checkbox]');
  check(!!agree, 'consent checkbox present');
  const start = buttonWith('Začít vyplňovat');
  check(!!start && start.disabled, 'start is disabled until consent is ticked');

  agree.checked = true;
  agree.dispatchEvent(new window.Event('change'));
  check(!start.disabled, 'ticking consent enables start');
  start.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(); await tick();

  console.log('\nwalking every question');
  for (let guard = 0; guard < 40; guard++) {
    const heading = doc.querySelector('#screen h2');
    if (!heading) break;
    const prompt = heading.textContent.trim();
    if (prompt === 'Kvíz') break;                 // reached the review screen
    seen.push(prompt);

    // Answer: click the first option.
    const opt = doc.querySelector('.opt input');
    if (opt) {
      opt.checked = true;
      opt.dispatchEvent(new window.Event('change', { bubbles: true }));
      await tick();
    }

    // Graded questions show "Zkontrolovat odpověď" first, then "Pokračovat".
    let btn = buttonWith('Zkontrolovat odpověď') || buttonWith('Pokračovat');
    if (!btn) break;
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await tick(); await tick();

    // If a verdict appeared, the same button now says Pokračovat — press on.
    if (doc.querySelector('.verdict')) {
      const next = buttonWith('Pokračovat');
      if (next) {
        next.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await tick(); await tick();
      }
    }
  }

  const expected = QUESTIONS.map((q) => q.prompt);
  console.log('  shown:    ' + seen.join(' | '));
  console.log('  expected: ' + expected.join(' | '));
  check(seen.length === expected.length,
    `every question was shown (${seen.length}/${expected.length}) — this is the double-advance regression`);
  check(JSON.stringify(seen) === JSON.stringify(expected), 'shown in the right order, none skipped');

  console.log('\nsubmitting');
  const send = buttonWith('Odeslat dotazník');
  check(!!send, 'review screen offers submit');
  if (send) {
    send.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await tick(); await tick(); await tick();
  }
  check(!/povinn/i.test(text()), 'no missing-required complaint at the end');
  check(server.submitted, 'server recorded the submission');
  check(/\/ 4/.test(text()) || /4/.test(text()), 'score card rendered');

  console.log('\nanswers the server received: ' + Object.keys(server.answers).join(', '));
  check(Object.keys(server.answers).length === QUESTIONS.length,
    `all ${QUESTIONS.length} answers reached the server`);

  console.log(failures.length ? `\n${failures.length} FAILED` : '\nall checks passed');
  process.exit(failures.length ? 1 : 0);
})();
