/* quiz.dobsinsky.xyz — survey runner.
 *
 * Vanilla, no build step: the deploy script has no npm stage and shouldn't
 * need one (SPEC). Screens are rendered one question at a time; every answer
 * PATCHes straight away so an interrupted session resumes.
 */
(function () {
  'use strict';

  var CFG = window.QUIZ_CONFIG;
  var state = {
    slug: null, locale: null, src: null, survey: null,
    responseId: null, answers: {}, index: 0, print: false,
    // Quiz mode only: what the server said about each graded answer. Kept in
    // memory rather than localStorage, because the server is the authority and
    // re-sending the same answer returns the same verdict.
    feedback: {}
  };

  var screen = document.getElementById('screen');
  var bar = document.getElementById('bar');
  var fill = document.getElementById('progress-fill');
  var progressText = document.getElementById('progress-text');
  var backBtn = document.getElementById('back');
  var savedEl = document.getElementById('saved');
  var t;

  // ------------------------------------------------------------------ routing

  function parseRoute() {
    var m = location.pathname.match(/^\/([a-z]{2})\/s\/([a-z0-9-]+)(\/print)?\/?$/);
    var params = new URLSearchParams(location.search);
    state.src = params.get('src');
    if (m) {
      state.locale = m[1];
      state.slug = m[2];
      state.print = !!m[3];
      return true;
    }
    return false;
  }

  function surveyPath(locale) {
    var p = '/' + locale + '/s/' + state.slug + (state.print ? '/print' : '');
    return p + (state.src ? '?src=' + encodeURIComponent(state.src) : '');
  }

  // --------------------------------------------------------------- storage
  // localStorage holds only the bearer response_id and the screen index. It is
  // scoped per survey so two surveys on one host cannot collide.

  function key(name) { return 'quiz:' + state.slug + ':' + name; }

  function store(name, value) {
    try { localStorage.setItem(key(name), value); } catch (e) { /* private mode */ }
  }
  function load(name) {
    try { return localStorage.getItem(key(name)); } catch (e) { return null; }
  }
  function clearStored() {
    try {
      localStorage.removeItem(key('rid'));
      localStorage.removeItem(key('idx'));
      localStorage.removeItem(key('answers'));
    } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------------ google
  // Opt-in only. Nothing is requested from Google until consent is given, and
  // no event ever carries an answer value or the response_id.

  var gaReady = false;

  function enableAnalytics() {
    if (gaReady || !CFG.gaMeasurementId) return;
    gaReady = true;
    store('ga', '1');

    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', CFG.gaMeasurementId, CFG.gaOptions);

    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(CFG.gaMeasurementId);
    document.head.appendChild(s);
  }

  function track(event, params) {
    if (!gaReady || !window.gtag) return;
    window.gtag('event', event, params || {});
  }

  // ---------------------------------------------------------------- markdown
  // Deliberately tiny and DOM-built rather than innerHTML: paragraphs, bullet
  // lists and **bold** are all the consent text needs.

  function renderMarkdown(src, into) {
    into.textContent = '';
    if (!src) return into;
    src.split(/\n{2,}/).forEach(function (block) {
      var lines = block.split('\n').map(function (l) { return l.trim(); });
      if (lines[0].charAt(0) === '-') {
        var ul = document.createElement('ul');
        var current = null;
        lines.forEach(function (line) {
          if (line.charAt(0) === '-') {
            current = document.createElement('li');
            inline(line.slice(1).trim(), current);
            ul.appendChild(current);
          } else if (current && line) {
            current.appendChild(document.createTextNode(' ' + line));
          }
        });
        into.appendChild(ul);
      } else {
        var p = document.createElement('p');
        inline(lines.join(' '), p);
        into.appendChild(p);
      }
    });
    return into;
  }

  function inline(text, into) {
    text.split(/(\*\*[^*]+\*\*)/).forEach(function (part) {
      if (!part) return;
      if (part.slice(0, 2) === '**' && part.slice(-2) === '**') {
        var b = document.createElement('strong');
        b.textContent = part.slice(2, -2);
        into.appendChild(b);
      } else {
        into.appendChild(document.createTextNode(part));
      }
    });
  }

  // --------------------------------------------------------------------- api

  function api(method, path, body) {
    return fetch('/api' + path, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var err = new Error(data.error || 'http_' + r.status);
          err.status = r.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  // ------------------------------------------------------------- autosaving

  var pending = {};
  var saveTimer = null;
  var savedTimer = null;

  function flash(message, sticky) {
    savedEl.textContent = message;
    savedEl.classList.add('show');
    clearTimeout(savedTimer);
    if (!sticky) {
      savedTimer = setTimeout(function () { savedEl.classList.remove('show'); }, 1800);
    }
  }

  function queueSave(code, value) {
    state.answers[code] = value;
    pending[code] = value;
    clearTimeout(saveTimer);
    flash(t.saving, true);
    saveTimer = setTimeout(flush, 550);
  }

  function flush() {
    if (!state.responseId || !Object.keys(pending).length) return Promise.resolve();
    var batch = pending;
    pending = {};
    return api('PATCH', '/r/' + state.responseId, batch)
      .then(function () { flash(t.saved); })
      .catch(function (e) {
        // Put it back so the next edit or the submit retries it.
        Object.assign(pending, batch);
        flash(t.saveFailed, true);
        throw e;
      });
  }

  // Best-effort flush when the tab goes away mid-answer.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && Object.keys(pending).length) {
      clearTimeout(saveTimer);
      flush().catch(function () {});
    }
  });

  // ------------------------------------------------------------- rendering

  function h(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function show(node) {
    screen.textContent = '';
    node.classList.add('step');
    screen.appendChild(node);
    screen.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function langSwitcher() {
    var nav = h('nav', 'lang');
    (state.survey.locales || []).forEach(function (loc) {
      var a = h('a', null, (window.I18N[loc] || {}).langName || loc.toUpperCase());
      a.href = surveyPath(loc);
      if (loc === state.locale) a.setAttribute('aria-current', 'true');
      nav.appendChild(a);
    });
    return nav;
  }

  function setProgress(step, total) {
    var pct = total ? Math.round((step / total) * 100) : 0;
    fill.style.width = pct + '%';
    progressText.textContent = t.progress(step, total);
    bar.querySelector('.progress').setAttribute('aria-valuenow', String(pct));
  }

  // ---------------------------------------------------------- consent screen

  function renderConsent() {
    bar.hidden = true;
    var wrap = h('div');
    wrap.appendChild(h('h1', null, state.survey.title));
    renderMarkdown(state.survey.intro_md, wrap.appendChild(h('div', 'prose')));

    var box = h('div', 'consent-box');
    renderMarkdown(state.survey.consent_md, box.appendChild(h('div', 'prose')));
    wrap.appendChild(box);

    // Unticked by default — SPEC. Consent has to be an action, not a default.
    var agree = checkbox(t.consentAgree, t.consentAgreeSub);
    wrap.appendChild(agree.label);

    var analytics = null;
    if (CFG.gaMeasurementId) {
      analytics = checkbox(t.consentAnalytics, t.consentAnalyticsSub);
      wrap.appendChild(analytics.label);
    }

    var hp = h('div', 'hp');
    var hpInput = document.createElement('input');
    hpInput.type = 'text';
    hpInput.name = 'website';
    hpInput.tabIndex = -1;
    hpInput.autocomplete = 'off';
    hp.append('Leave this field empty', hpInput);
    wrap.appendChild(hp);

    var actions = h('div', 'actions');
    var go = h('button', 'btn', t.start);
    go.type = 'button';
    go.disabled = true;
    actions.appendChild(go);
    wrap.appendChild(actions);

    agree.input.addEventListener('change', function () { go.disabled = !agree.input.checked; });

    go.addEventListener('click', function () {
      go.disabled = true;
      if (analytics && analytics.input.checked) enableAnalytics();
      api('POST', '/s/' + state.slug + '/start', {
        locale: state.locale,
        src: state.src,
        website: hpInput.value
      }).then(function (res) {
        state.responseId = res.response_id;
        store('rid', res.response_id);
        track('survey_start', { survey: state.slug, locale: state.locale, source: state.src || 'direct' });
        state.index = 0;
        renderQuestion();
      }).catch(function (e) {
        go.disabled = false;
        wrap.insertBefore(h('div', 'error', e.data && e.data.error === 'closed' ? t.closed : t.errorGeneric), wrap.firstChild);
      });
    });

    wrap.appendChild(langSwitcher());
    show(wrap);
  }

  function checkbox(text, sub) {
    var label = h('label', 'check');
    var input = document.createElement('input');
    input.type = 'checkbox';
    var mark = h('span', 'mark');
    var body = h('span', 'check-text', text);
    if (sub) body.appendChild(h('small', null, sub));
    label.append(input, mark, body);
    return { label: label, input: input };
  }

  // -------------------------------------------------------- question screens

  function questions() { return state.survey.questions || []; }

  function isQuiz() { return state.survey && state.survey.mode === 'quiz'; }

  function renderQuestion() {
    var qs = questions();
    if (state.index >= qs.length) return renderReview();

    var q = qs[state.index];
    store('idx', String(state.index));
    bar.hidden = false;
    backBtn.hidden = state.index === 0;
    setProgress(state.index + 1, qs.length + 1);
    track('question_view', { survey: state.slug, question: q.code, position: state.index + 1 });

    var wrap = h('div');
    wrap.appendChild(h('p', 'eyebrow', t.progress(state.index + 1, qs.length)));
    wrap.appendChild(h('h2', null, q.prompt || q.code));
    if (q.help) wrap.appendChild(h('p', 'help', q.help));

    var errorSlot = h('div');
    wrap.appendChild(errorSlot);

    if (isQuiz() && q.graded) return renderGraded(q, wrap, errorSlot);

    wrap.appendChild(fieldFor(q));

    var actions = h('div', 'actions');
    var next = h('button', 'btn', t.next);
    next.type = 'button';
    next.addEventListener('click', function () {
      if (q.required && isEmpty(state.answers[q.code], q.kind)) {
        errorSlot.textContent = '';
        errorSlot.appendChild(h('div', 'error', t.required));
        return;
      }
      clearTimeout(saveTimer);
      flush().catch(function () {});
      state.index++;
      renderQuestion();
    });
    actions.appendChild(next);

    if (!q.required) {
      var skip = h('button', 'btn btn-quiet', t.skip);
      skip.type = 'button';
      skip.addEventListener('click', function () {
        clearTimeout(saveTimer);
        flush().catch(function () {});
        state.index++;
        renderQuestion();
      });
      actions.appendChild(skip);
    }
    wrap.appendChild(actions);
    show(wrap);
  }

  /* A graded question. The answer is deliberately NOT autosaved while the
   * respondent is still choosing: it is sent once, when they commit, and the
   * verdict comes back from that same request. That way the recorded answer is
   * always the one given before the explanation was visible. */
  function renderGraded(q, wrap, errorSlot) {
    var chosen = state.answers[q.code];
    var field = fieldFor(q, function (code, value) { chosen = value; update(); });
    wrap.appendChild(field);

    var panel = h('div');
    wrap.appendChild(panel);

    var actions = h('div', 'actions');
    var btn = h('button', 'btn', t.checkAnswer);
    btn.type = 'button';
    actions.appendChild(btn);
    wrap.appendChild(actions);

    function update() {
      btn.disabled = isEmpty(chosen, q.kind);
    }

    function lock() {
      field.querySelectorAll('input').forEach(function (i) { i.disabled = true; });
      field.querySelectorAll('.opt').forEach(function (o) { o.style.cursor = 'default'; });
    }

    function showVerdict(fb) {
      state.feedback[q.code] = fb;
      lock();
      panel.textContent = '';
      panel.appendChild(verdictPanel(q, fb));
      btn.textContent = t.next;
      btn.disabled = false;
      btn.onclick = function () { state.index++; renderQuestion(); };
      track('question_answered', {
        survey: state.slug, question: q.code, correct: fb.correct ? 1 : 0
      });
    }

    btn.addEventListener('click', function () {
      if (state.feedback[q.code]) { state.index++; renderQuestion(); return; }
      btn.disabled = true;
      errorSlot.textContent = '';
      state.answers[q.code] = chosen;
      api('PATCH', '/r/' + state.responseId, kv(q.code, chosen))
        .then(function (res) {
          var fb = (res.feedback || {})[q.code];
          if (!fb) { state.index++; return renderQuestion(); }
          showVerdict(fb);
        })
        .catch(function () {
          btn.disabled = false;
          errorSlot.appendChild(h('div', 'error', t.saveFailed));
        });
    });

    update();
    // Coming back to an already-answered question: re-send the same answer to
    // recover the verdict rather than storing the answer key client-side.
    if (state.feedback[q.code]) {
      showVerdict(state.feedback[q.code]);
    } else if (!isEmpty(chosen, q.kind)) {
      api('PATCH', '/r/' + state.responseId, kv(q.code, chosen))
        .then(function (res) {
          var fb = (res.feedback || {})[q.code];
          if (fb) showVerdict(fb);
        })
        .catch(function () {});
    }
    show(wrap);
  }

  function kv(k, v) { var o = {}; o[k] = v; return o; }

  function verdictPanel(q, fb) {
    var box = h('div', 'verdict ' + (fb.correct ? 'verdict--ok' : 'verdict--no'));
    var head = h('p', 'verdict-head');
    head.appendChild(h('span', 'verdict-mark', fb.correct ? '✓' : '✕'));
    head.appendChild(document.createTextNode(fb.correct ? t.correctLabel : t.wrongLabel));
    box.appendChild(head);

    if (!fb.correct) {
      var labels = q.labels || {};
      var names = (fb.correct_options || []).map(function (c) { return labels[c] || c; });
      if (names.length) {
        var line = h('p', 'verdict-answer');
        line.appendChild(h('strong', null, t.correctAnswerWas + ' '));
        line.appendChild(document.createTextNode(names.join(', ')));
        box.appendChild(line);
      }
    }
    if (fb.explain_md) renderMarkdown(fb.explain_md, box.appendChild(h('div', 'prose')));
    return box;
  }

  function isEmpty(v, kind) {
    if (v == null || v === '') return true;
    if (Array.isArray(v)) return v.length === 0;
    // A body map with nothing marked is an answer ("no pain in any of these
    // areas") once the respondent has said so explicitly, not a blank. The
    // difference between {} and undefined is the whole point here.
    if (kind === 'bodymap') return false;
    if (typeof v === 'object') return Object.keys(v).length === 0;
    return false;
  }

  /* `sink` receives (code, value) whenever the field changes. It defaults to
   * the autosaving path; graded quiz questions pass their own so the answer is
   * held locally until the respondent commits it. */
  function fieldFor(q, sink) {
    var save = sink || queueSave;
    var spec = q.spec || {};
    var labels = q.labels || {};
    var current = state.answers[q.code];

    if (q.kind === 'single' || q.kind === 'multi') {
      var list = h('div', 'options');
      (spec.options || []).forEach(function (code) {
        var label = h('label', 'opt');
        label.setAttribute('data-kind', q.kind);
        var input = document.createElement('input');
        input.type = q.kind === 'single' ? 'radio' : 'checkbox';
        input.name = q.code;
        input.value = code;
        if (q.kind === 'single') input.checked = current === code;
        else input.checked = Array.isArray(current) && current.indexOf(code) !== -1;

        input.addEventListener('change', function () {
          if (q.kind === 'single') {
            save(q.code, code);
            return;
          }
          var chosen = Array.prototype.filter
            .call(list.querySelectorAll('input'), function (i) { return i.checked; })
            .map(function (i) { return i.value; });
          // "None of these" cannot coexist with anything else. The API enforces
          // this too; doing it here keeps the UI honest as you tap.
          var exclusive = spec.exclusive || [];
          if (exclusive.indexOf(code) !== -1 && input.checked) {
            chosen = [code];
          } else if (input.checked) {
            chosen = chosen.filter(function (c) { return exclusive.indexOf(c) === -1; });
          }
          list.querySelectorAll('input').forEach(function (i) {
            i.checked = chosen.indexOf(i.value) !== -1;
          });
          save(q.code, chosen);
        });

        label.append(input, h('span', 'mark'), h('span', null, labels[code] || code));
        list.appendChild(label);
      });
      return list;
    }

    if (q.kind === 'scale') {
      var box = h('div');
      var min = spec.min != null ? spec.min : 0;
      var max = spec.max != null ? spec.max : 10;
      var value = h('div', 'scale-value', current != null ? String(current) : '–');
      if (current == null) value.classList.add('unset');
      var range = document.createElement('input');
      range.type = 'range';
      range.min = String(min);
      range.max = String(max);
      range.step = '1';
      range.value = String(current != null ? current : Math.round((min + max) / 2));
      range.setAttribute('aria-label', q.prompt || q.code);
      range.addEventListener('input', function () {
        value.textContent = range.value;
        value.classList.remove('unset');
      });
      range.addEventListener('change', function () { save(q.code, Number(range.value)); });
      var ends = h('div', 'scale-ends');
      ends.append(h('span', null, labels.min || String(min)), h('span', null, labels.max || String(max)));
      box.append(value, range, ends);
      return box;
    }

    if (q.kind === 'bodymap') {
      return window.BodyMap.create({
        regions: spec.regions,
        labels: labels,
        levels: spec.levels || 3,
        value: current || {},
        answered: current !== undefined,
        t: t,
        onChange: function (v) { save(q.code, v); }
      });
    }

    if (q.kind === 'textarea' || q.kind === 'text') {
      var field = document.createElement(q.kind === 'textarea' ? 'textarea' : 'input');
      if (q.kind === 'text') field.type = 'text';
      var maxlen = spec.maxlen || 2000;
      field.maxLength = maxlen;
      field.value = current || '';
      field.setAttribute('aria-label', q.prompt || q.code);
      var counter = h('div', 'counter', t.chars(field.value.length, maxlen));
      field.addEventListener('input', function () {
        counter.textContent = t.chars(field.value.length, maxlen);
        counter.classList.toggle('over', field.value.length >= maxlen);
        save(q.code, field.value);
      });
      var box2 = h('div');
      box2.append(field, counter);
      return box2;
    }

    if (q.kind === 'number' || q.kind === 'date') {
      var input2 = document.createElement('input');
      input2.type = q.kind;
      if (q.kind === 'number') {
        if (spec.min != null) input2.min = String(spec.min);
        if (spec.max != null) input2.max = String(spec.max);
      }
      input2.value = current != null ? current : '';
      input2.setAttribute('aria-label', q.prompt || q.code);
      input2.addEventListener('change', function () {
        if (input2.value === '') save(q.code, null);
        else save(q.code, q.kind === 'number' ? Number(input2.value) : input2.value);
      });
      return input2;
    }

    return h('p', 'help', q.kind);
  }

  // ----------------------------------------------------------- review/submit

  function renderReview() {
    var qs = questions();
    bar.hidden = false;
    backBtn.hidden = false;
    setProgress(qs.length + 1, qs.length + 1);

    var wrap = h('div');
    wrap.appendChild(h('p', 'eyebrow', t.review));
    wrap.appendChild(h('h2', null, state.survey.title));
    wrap.appendChild(h('p', 'help', t.reviewIntro));

    var errorSlot = h('div');
    wrap.appendChild(errorSlot);

    var actions = h('div', 'actions');
    var send = h('button', 'btn', t.submit);
    send.type = 'button';
    send.addEventListener('click', function () {
      send.disabled = true;
      send.textContent = t.submitting;
      errorSlot.textContent = '';
      clearTimeout(saveTimer);
      flush()
        .then(function () { return api('POST', '/r/' + state.responseId + '/submit'); })
        .then(function (res) {
          track('survey_submit', {
            survey: state.slug, locale: state.locale, source: state.src || 'direct',
            score: res && res.score
          });
          clearStored();
          renderThanks(res || {});
        })
        .catch(function (e) {
          send.disabled = false;
          send.textContent = t.submit;
          var data = (e && e.data) || {};
          if (data.error === 'missing_required') {
            var codes = data.questions || [];
            errorSlot.appendChild(h('div', 'error', t.requiredMissing));
            var firstIdx = qs.findIndex(function (q) { return codes.indexOf(q.code) !== -1; });
            if (firstIdx >= 0) {
              var jump = h('button', 'btn btn-quiet', qs[firstIdx].prompt || qs[firstIdx].code);
              jump.type = 'button';
              jump.addEventListener('click', function () {
                state.index = firstIdx;
                renderQuestion();
              });
              errorSlot.appendChild(jump);
            }
          } else {
            errorSlot.appendChild(h('div', 'error', data.error === 'too_fast' ? t.errorTooFast : t.errorGeneric));
          }
        });
    });
    actions.appendChild(send);
    wrap.appendChild(actions);
    show(wrap);
  }

  function renderThanks(result) {
    result = result || {};
    bar.hidden = true;
    var wrap = h('div');

    if (result.out_of) {
      wrap.appendChild(scoreCard(result));
    } else {
      wrap.appendChild(h('div', 'big-emoji center', '🌼'));
    }
    renderMarkdown(state.survey.thanks_md, wrap.appendChild(h('div', 'prose')));
    if (result.out_of) {
      wrap.appendChild(recap(result));
      wrap.appendChild(shareBox());
    }

    // Follow-up form. Note it posts to the survey, not to the response: this
    // page never sends an email and a response_id in the same request, which
    // is what keeps `followups` unjoinable (SPEC constraint #3).
    var box = h('div', 'consent-box');
    box.appendChild(h('h2', null, t.followupTitle));
    box.appendChild(h('p', 'help', t.followupHelp));

    var email = document.createElement('input');
    email.type = 'email';
    email.placeholder = t.followupPlaceholder;
    email.autocomplete = 'email';
    email.setAttribute('aria-label', t.followupTitle);
    box.appendChild(email);

    var hp = h('div', 'hp');
    var hpInput = document.createElement('input');
    hpInput.type = 'text';
    hpInput.tabIndex = -1;
    hpInput.autocomplete = 'off';
    hp.appendChild(hpInput);
    box.appendChild(hp);

    var status = h('div');
    var send = h('button', 'btn', t.followupSend);
    send.type = 'button';
    send.addEventListener('click', function () {
      status.textContent = '';
      send.disabled = true;
      api('POST', '/s/' + state.slug + '/followup', {
        email: email.value.trim(),
        website: hpInput.value
      }).then(function () {
        box.textContent = '';
        box.appendChild(h('p', null, t.followupOk));
      }).catch(function (e) {
        send.disabled = false;
        var bad = e.data && e.data.error === 'bad_email';
        status.appendChild(h('div', 'error', bad ? t.followupBad : t.errorGeneric));
      });
    });
    box.append(status, send);
    wrap.appendChild(box);
    wrap.appendChild(langSwitcher());
    show(wrap);
  }

  // ------------------------------------------------------- quiz result screen

  function scoreCard(result) {
    var pct = result.out_of ? result.score / result.out_of : 0;
    var box = h('div', 'scorecard');
    box.appendChild(h('p', 'eyebrow center', t.scoreHead));
    var big = h('p', 'score-big');
    big.appendChild(h('strong', null, String(result.score)));
    big.appendChild(document.createTextNode(' / ' + result.out_of));
    box.appendChild(big);

    // A ring rather than a bar: this is one number, not a comparison.
    var track = h('div', 'score-track');
    var fillEl = h('div', 'score-fill');
    fillEl.style.width = Math.round(pct * 100) + '%';
    track.appendChild(fillEl);
    box.appendChild(track);

    var msg = pct === 1 ? t.scoreAllRight : (pct >= 0.6 ? t.scoreGood : t.scoreLow);
    box.appendChild(h('p', 'help center', msg));
    return box;
  }

  function recap(result) {
    var box = h('div');
    box.appendChild(h('h2', null, t.reviewHead));
    (result.review || []).forEach(function (item) {
      var row = h('details', 'recap' + (item.correct ? ' recap--ok' : ' recap--no'));
      var sum = h('summary');
      sum.appendChild(h('span', 'verdict-mark', item.correct ? '✓' : '✕'));
      sum.appendChild(document.createTextNode(item.prompt || item.code));
      row.appendChild(sum);
      if (item.explain_md) renderMarkdown(item.explain_md, row.appendChild(h('div', 'prose')));
      box.appendChild(row);
    });
    return box;
  }

  function shareBox() {
    var box = h('div', 'consent-box');
    box.appendChild(h('h2', null, t.shareHead));
    box.appendChild(h('p', 'help', t.shareBody));
    var url = location.origin + '/' + state.locale + '/s/' + state.slug;
    var btn = h('button', 'btn', t.copyLink);
    btn.type = 'button';
    btn.addEventListener('click', function () {
      var done = function () { btn.textContent = t.copied; };
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(done, done);
      } else {
        // Older mobile browsers: select-and-copy from a temporary field.
        var tmp = document.createElement('input');
        tmp.value = url;
        box.appendChild(tmp);
        tmp.select();
        try { document.execCommand('copy'); } catch (e) { /* ignore */ }
        box.removeChild(tmp);
        done();
      }
    });
    box.appendChild(btn);
    return box;
  }

  // ------------------------------------------------------------- print view
  // SPEC: blank questionnaire, print-stylesheet clean, all regions labelled.
  // Required as a thesis appendix.

  function renderPrint() {
    bar.hidden = true;
    document.title = state.survey.title;
    var wrap = h('div');
    wrap.appendChild(h('h1', null, state.survey.title));
    wrap.appendChild(h('p', 'help', t.printNote));
    renderMarkdown(state.survey.consent_md, wrap.appendChild(h('div', 'prose')));

    questions().forEach(function (q, i) {
      var block = h('div', 'print-q');
      var head = h('h2');
      head.appendChild(h('span', 'num', (i + 1) + '. '));
      head.appendChild(document.createTextNode(q.prompt || q.code));
      block.appendChild(head);
      if (q.help) block.appendChild(h('p', 'help', q.help));

      var spec = q.spec || {};
      var labels = q.labels || {};

      if (q.kind === 'single' || q.kind === 'multi') {
        var ul = h('ul', 'print-opts');
        (spec.options || []).forEach(function (code) {
          var li = h('li');
          var box = h('span', 'print-box' + (q.kind === 'single' ? ' round' : ''));
          li.append(box, document.createTextNode(labels[code] || code));
          ul.appendChild(li);
        });
        block.appendChild(ul);
      } else if (q.kind === 'scale') {
        var row = h('div', 'print-scale');
        var min = spec.min != null ? spec.min : 0;
        var max = spec.max != null ? spec.max : 10;
        for (var v = min; v <= max; v++) row.appendChild(h('span', null, String(v)));
        block.appendChild(row);
        var ends = h('div', 'scale-ends');
        ends.append(h('span', null, labels.min || ''), h('span', null, labels.max || ''));
        block.appendChild(ends);
      } else if (q.kind === 'bodymap') {
        block.appendChild(window.BodyMap.createPrint({ regions: spec.regions, labels: labels }));
        var list = h('ul', 'print-opts');
        (spec.regions || []).forEach(function (code) {
          var li = h('li');
          li.append(h('span', 'print-box'), document.createTextNode(labels[code] || code));
          list.appendChild(li);
        });
        block.appendChild(list);
      } else {
        var lines = q.kind === 'textarea' ? 4 : 1;
        for (var n = 0; n < lines; n++) block.appendChild(h('div', 'print-rule'));
      }
      wrap.appendChild(block);
    });
    show(wrap);
  }

  // -------------------------------------------------------------- resume

  function resume() {
    var rid = load('rid');
    if (!rid) return Promise.resolve(false);
    // Answers come back from the server rather than localStorage, so a resumed
    // session repaints what was actually saved, not what we hoped was saved.
    return api('GET', '/r/' + rid)
      .then(function (res) {
        state.responseId = rid;
        state.answers = res.answers || {};
        return true;
      })
      .catch(function () {
        // Unknown, or already submitted. Either way this id is spent.
        state.responseId = null;
        clearStored();
        return false;
      });
  }

  // ---------------------------------------------------------------- startup

  backBtn.addEventListener('click', function () {
    if (state.index > 0) {
      state.index--;
      renderQuestion();
    } else {
      renderConsent();
    }
  });

  function boot() {
    if (!parseRoute()) {
      location.replace('/' + CFG.defaultLocale + '/s/' + CFG.defaultSlug + location.search);
      return;
    }
    t = window.I18N[state.locale] || window.I18N[CFG.defaultLocale];
    document.documentElement.lang = state.locale;
    screen.appendChild(h('div', 'spinner'));

    api('GET', '/s/' + state.slug + '?locale=' + encodeURIComponent(state.locale))
      .then(function (survey) {
        state.survey = survey;
        // The API falls back to the survey's default locale for an unknown one;
        // follow it so the URL and the text on screen never disagree.
        if (survey.locale !== state.locale) {
          state.locale = survey.locale;
          t = window.I18N[state.locale] || t;
          document.documentElement.lang = state.locale;
          history.replaceState(null, '', surveyPath(state.locale));
        }
        document.title = survey.title;

        if (state.print) return renderPrint();
        if (!survey.is_open) {
          return show(h('p', 'error', t.closed));
        }
        if (load('ga') === '1') enableAnalytics();

        return resume().then(function (ok) {
          if (!ok) return renderConsent();
          var idx = parseInt(load('idx') || '0', 10);
          state.index = isNaN(idx) ? 0 : Math.min(idx, questions().length);
          renderQuestion();
          flash(t.resumed);
        });
      })
      .catch(function () {
        show(h('div', 'error', t.errorLoad));
      });
  }

  boot();
})();
