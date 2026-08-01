/* Survey editor — authoring UI for the questions, without writing SQL.
 *
 * LAN/Tailscale only. Every rule that protects collected data is enforced by
 * the API, not here; this just surfaces the reasons legibly. In particular a
 * question's code and kind lock once answers exist, and deleting a question
 * that has answers needs an explicit confirm because it cascades.
 */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var SLUG = params.get('slug');
  var root = document.getElementById('root');
  var sub = document.getElementById('sub');
  var data = null;
  var activeLocale = null;
  var editing = null;   // question code currently open, or '__new__'

  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function field(label, control, hint) {
    var wrap = h('div', 'ed-field');
    var lab = h('label');
    lab.appendChild(document.createTextNode(label));
    if (hint) lab.appendChild(h('span', 'hint', '  ' + hint));
    wrap.append(lab, control);
    return wrap;
  }

  function input(value, cls) {
    var i = document.createElement('input');
    i.type = 'text';
    i.value = value == null ? '' : value;
    if (cls) i.className = cls;
    return i;
  }

  function textarea(value, rows) {
    var t = document.createElement('textarea');
    t.value = value == null ? '' : value;
    if (rows) t.rows = rows;
    return t;
  }

  function api(method, path, body) {
    return fetch('/api/admin' + path, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) {
          var e = new Error(d.detail || d.error || ('http ' + r.status));
          e.data = d; e.status = r.status;
          throw e;
        }
        return d;
      });
    });
  }

  function toast(where, text, ok) {
    var m = h('div', 'msg ' + (ok ? 'ok' : 'err'), text);
    where.appendChild(m);
    if (ok) setTimeout(function () { m.remove(); }, 2500);
    return m;
  }

  // ----------------------------------------------------------- survey picker

  function listSurveys() {
    sub.textContent = 'LAN / Tailscale only';
    api('GET', '/surveys').then(function (res) {
      root.textContent = '';
      var sec = h('section');
      sec.appendChild(h('h2', null, 'Surveys'));
      res.surveys.forEach(function (s) {
        var card = h('div', 'surveycard');
        var left = h('div');
        var a = h('a', null, s.title || s.slug);
        a.href = '?slug=' + encodeURIComponent(s.slug);
        left.appendChild(a);
        left.appendChild(h('div', 'meta',
          s.slug + ' · ' + s.mode + ' · ' + s.questions + ' questions · ' +
          s.responses + ' responses · ' + (s.is_open ? 'open' : 'closed')));
        card.appendChild(left);
        var open = h('a', 'dl', 'Open');
        open.href = '/' + s.default_locale + '/s/' + s.slug;
        card.appendChild(open);
        sec.appendChild(card);
      });
      root.appendChild(sec);
    }).catch(fatal);
  }

  function fatal(e) {
    root.textContent = '';
    root.appendChild(h('div', 'warn', e.status === 404
      ? 'Not available from this network. The editor answers only on LAN or Tailscale.'
      : ('Could not load: ' + e.message)));
  }

  // ------------------------------------------------------------------ survey

  function load() {
    api('GET', '/' + encodeURIComponent(SLUG) + '/edit').then(function (res) {
      data = res;
      activeLocale = activeLocale || data.default_locale;
      render();
    }).catch(fatal);
  }

  function localeTabs(onPick) {
    var tabs = h('div', 'tabs');
    data.locales.forEach(function (loc) {
      var b = h('button', null, loc.toUpperCase());
      b.type = 'button';
      b.setAttribute('aria-selected', String(loc === activeLocale));
      b.addEventListener('click', function () { activeLocale = loc; onPick(); });
      tabs.appendChild(b);
    });
    return tabs;
  }

  function render() {
    root.textContent = '';
    sub.textContent = data.slug + ' · ' + data.mode +
      ' · ' + (data.is_open ? 'open' : 'closed');

    var back = h('a', 'dl', '← All surveys');
    back.href = '?';
    var bar = h('div', 'toolbar');
    bar.appendChild(back);
    var live = h('a', 'dl', 'Open survey');
    live.href = '/' + data.default_locale + '/s/' + data.slug;
    bar.appendChild(live);
    var dash = h('a', 'dl', 'Results');
    dash.href = '/admin.html?slug=' + encodeURIComponent(data.slug);
    bar.appendChild(dash);
    root.appendChild(bar);

    root.appendChild(surveySection());
    root.appendChild(questionsSection());
  }

  function surveySection() {
    var sec = h('section');
    sec.appendChild(h('h2', null, 'Survey text'));
    sec.appendChild(localeTabs(render));

    var text = (data.i18n || {})[activeLocale] || {};
    var title = input(text.title);
    var intro = textarea(text.intro_md, 5);
    var consent = textarea(text.consent_md, 8);
    var thanks = textarea(text.thanks_md, 5);

    sec.appendChild(field('Title', title));
    sec.appendChild(field('Intro', intro, 'markdown: **bold**, - lists'));
    sec.appendChild(field('Consent text', consent,
      'shown before starting, checkbox unticked by default'));
    sec.appendChild(field('Thank-you text', thanks));

    var openBox = h('label', 'ed-check');
    var openIn = document.createElement('input');
    openIn.type = 'checkbox';
    openIn.checked = !!data.is_open;
    openBox.append(openIn, document.createTextNode('Accepting responses'));
    sec.appendChild(openBox);

    var accent = accentPicker(data.accent);
    sec.appendChild(accent.el);

    var row = h('div', 'saverow');
    var save = h('button', 'primary', 'Save survey text');
    save.type = 'button';
    row.appendChild(save);
    sec.appendChild(row);

    save.addEventListener('click', function () {
      save.disabled = true;
      var i18n = {};
      i18n[activeLocale] = {
        title: title.value, intro_md: intro.value,
        consent_md: consent.value, thanks_md: thanks.value
      };
      api('PUT', '/' + encodeURIComponent(SLUG) + '/survey',
          { is_open: openIn.checked, accent: accent.value(), i18n: i18n })
        .then(function () {
          toast(row, 'Saved', true);
          save.disabled = false;
          data.is_open = openIn.checked;
          data.accent = accent.value();
          data.i18n[activeLocale] = i18n[activeLocale];
          sub.textContent = data.slug + ' · ' + data.mode +
            ' · ' + (data.is_open ? 'open' : 'closed');
        })
        .catch(function (e) { toast(row, e.message, false); save.disabled = false; });
    });
    return sec;
  }

  /* Colour wheel for the survey's accent.
   *
   * One colour, not a palette: palette.js derives background, ink, borders and
   * the accent ramp from this seed and clamps lightness until the WCAG floors
   * hold. Exposing each variable separately would hand back exactly the way to
   * break that.
   *
   * The preview renders the derived light and dark palettes side by side with
   * their measured contrast ratios, so a colour that only works in one mode is
   * visible here rather than on a respondent's phone at 2am. */
  function accentPicker(current) {
    var DEFAULT = '#8d3f66';                 // the built-in rose
    var el = h('div', 'ed-accent');
    el.appendChild(h('div', 'ed-label', 'Accent colour'));
    el.appendChild(h('p', 'ed-hint',
      'The rest of the palette is derived from this and checked for contrast. '
      + 'Respondents cannot change it.'));

    var row = h('div', 'ed-accent-row');
    var wheel = document.createElement('input');
    wheel.type = 'color';
    wheel.value = current || DEFAULT;
    wheel.setAttribute('aria-label', 'Accent colour');

    var hexIn = document.createElement('input');
    hexIn.type = 'text';
    hexIn.className = 'ed-accent-hex';
    hexIn.value = current || DEFAULT;
    hexIn.spellcheck = false;
    hexIn.setAttribute('aria-label', 'Accent colour as hex');

    var useDefault = h('label', 'ed-check');
    var defIn = document.createElement('input');
    defIn.type = 'checkbox';
    defIn.checked = !current;
    useDefault.append(defIn, document.createTextNode('Use the default palette'));

    row.append(wheel, hexIn, useDefault);
    el.appendChild(row);

    var preview = h('div', 'ed-accent-preview');
    el.appendChild(preview);

    function seed() { return defIn.checked ? null : hexIn.value.trim().toLowerCase(); }

    function swatch(pal, label) {
      var box = h('div', 'ed-swatch');
      box.style.background = pal.bg;
      box.style.color = pal.ink;
      box.style.borderColor = pal.line;
      box.appendChild(h('div', 'ed-swatch-name', label));
      var eyebrow = h('div', 'ed-swatch-eyebrow', 'OTÁZKA 3 / 16');
      eyebrow.style.color = pal.accent;
      box.appendChild(eyebrow);
      box.appendChild(h('div', 'ed-swatch-body', 'Jak často máte bolesti?'));
      var soft = h('div', 'ed-swatch-soft', 'Vyberte jednu možnost.');
      soft.style.color = pal['ink-soft'];
      box.appendChild(soft);
      var chip = h('span', 'ed-swatch-chip', 'Pokračovat');
      chip.style.background = pal.accent;
      chip.style.color = pal.bg;
      box.appendChild(chip);
      return box;
    }

    function ratio(a, b) {
      var A = window.QuizPalette.hexToHsl(a), B = window.QuizPalette.hexToHsl(b);
      return window.QuizPalette.contrast(A.h, A.s, A.l, B.h, B.s, B.l);
    }

    function repaint() {
      var s = seed();
      wheel.disabled = hexIn.disabled = defIn.checked;
      preview.textContent = '';
      if (!s) {
        preview.appendChild(h('p', 'ed-hint',
          'Using the built-in palette. Untick the box to choose a colour.'));
        return;
      }
      var p = window.QuizPalette.build(s);
      if (!p) {
        preview.appendChild(h('p', 'ed-warn', 'Not a hex colour — expected #rrggbb.'));
        return;
      }
      var grid = h('div', 'ed-swatches');
      grid.append(swatch(p.light, 'Light'), swatch(p.dark, 'Dark'));
      preview.appendChild(grid);

      // Reported, not just enforced: seeing the number makes it obvious the
      // derived accent is not always the colour that was picked.
      var lines = [];
      [['Light', p.light], ['Dark', p.dark]].forEach(function (pair) {
        lines.push(pair[0] + ': text ' + ratio(pair[1].ink, pair[1].bg).toFixed(1)
          + ':1 · accent ' + ratio(pair[1].accent, pair[1].bg).toFixed(1) + ':1');
      });
      preview.appendChild(h('p', 'ed-hint', lines.join('   ')));
    }

    wheel.addEventListener('input', function () {
      hexIn.value = wheel.value.toLowerCase();
      repaint();
    });
    hexIn.addEventListener('input', function () {
      if (/^#[0-9a-fA-F]{6}$/.test(hexIn.value.trim())) wheel.value = hexIn.value.trim();
      repaint();
    });
    defIn.addEventListener('change', repaint);
    repaint();

    return { el: el, value: seed };
  }

  // --------------------------------------------------------------- questions

  function questionsSection() {
    var sec = h('section');
    sec.appendChild(h('h2', null, 'Questions'));
    sec.appendChild(h('p', 'note',
      'Order here is the order respondents see. A question locks its code and ' +
      'kind once it has answers, because both would corrupt the export.'));

    var list = h('div', 'qlist');
    data.questions.forEach(function (q, i) {
      list.appendChild(questionRow(q, i));
      if (editing === q.code) list.appendChild(questionEditor(q));
    });
    sec.appendChild(list);

    if (editing === '__new__') {
      sec.appendChild(questionEditor(null));
    } else {
      var add = h('button', 'primary', '+ Add question');
      add.type = 'button';
      add.addEventListener('click', function () { editing = '__new__'; render(); });
      sec.appendChild(add);
    }
    return sec;
  }

  function questionRow(q, i) {
    var row = h('div', 'qitem' + (editing === q.code ? ' editing' : ''));

    var move = h('div', 'qmove');
    var up = h('button', null, '▲');
    var down = h('button', null, '▼');
    up.type = down.type = 'button';
    up.disabled = i === 0;
    down.disabled = i === data.questions.length - 1;
    up.addEventListener('click', function () { reorder(i, i - 1); });
    down.addEventListener('click', function () { reorder(i, i + 1); });
    move.append(up, down);
    row.appendChild(move);

    var meta = h('div', 'qmeta');
    var text = (q.i18n || {})[activeLocale] || {};
    meta.appendChild(h('div', 'qprompt', text.prompt || '(no prompt in ' + activeLocale + ')'));
    var tags = h('div', 'qtags');
    tags.appendChild(h('span', 'qcode', q.code));
    tags.appendChild(h('span', 'tag', q.kind));
    if (q.required) tags.appendChild(h('span', 'tag req', 'required'));
    if ((q.spec || {}).correct) tags.appendChild(h('span', 'tag graded', 'graded'));
    if (q.answers) tags.appendChild(h('span', 'tag locked', q.answers + ' answers'));
    meta.appendChild(tags);
    row.appendChild(meta);

    var actions = h('div', 'qactions');
    var edit = h('button', 'mini', editing === q.code ? 'Close' : 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', function () {
      editing = editing === q.code ? null : q.code;
      render();
    });
    actions.appendChild(edit);
    row.appendChild(actions);
    return row;
  }

  function reorder(from, to) {
    var codes = data.questions.map(function (q) { return q.code; });
    var moved = codes.splice(from, 1)[0];
    codes.splice(to, 0, moved);
    api('POST', '/' + encodeURIComponent(SLUG) + '/questions/reorder', { codes: codes })
      .then(load)
      .catch(function (e) { alert(e.message); });
  }

  var KINDS = ['single', 'multi', 'text', 'textarea', 'scale', 'number', 'date', 'bodymap'];

  function questionEditor(q) {
    var isNew = !q;
    var locked = !isNew && q.answers > 0;
    var spec = JSON.parse(JSON.stringify((q && q.spec) || {}));
    var box = h('div', 'qedit');

    var code = input(isNew ? '' : q.code, 'mono');
    code.disabled = locked;
    var kindSel = document.createElement('select');
    KINDS.forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = k;
      if (!isNew && q.kind === k) o.selected = true;
      kindSel.appendChild(o);
    });
    kindSel.disabled = locked;

    var top = h('div', 'ed-row');
    top.appendChild(field('Code', code, locked ? '(locked — has answers)' : 'export key'));
    var kw = field('Kind', kindSel, locked ? '(locked)' : '');
    kw.className = 'ed-field narrow';
    top.appendChild(kw);
    box.appendChild(top);

    var reqBox = h('label', 'ed-check');
    var reqIn = document.createElement('input');
    reqIn.type = 'checkbox';
    reqIn.checked = !isNew && !!q.required;
    reqBox.append(reqIn, document.createTextNode('Required'));
    box.appendChild(reqBox);

    if (locked) {
      box.appendChild(h('p', 'note',
        q.answers + ' answers already exist. Wording and options can still be ' +
        'edited; the code and kind cannot, because changing them would make the ' +
        'collected answers unreadable.'));
    }

    // per-locale wording
    box.appendChild(localeTabs(function () { render(); }));
    var text = (!isNew && (q.i18n || {})[activeLocale]) || {};
    var prompt = input(text.prompt);
    var help = input(text.help);
    box.appendChild(field('Prompt (' + activeLocale + ')', prompt));
    box.appendChild(field('Help text (' + activeLocale + ')', help, 'optional'));

    var explain = null;
    if (data.mode === 'quiz') {
      explain = textarea(text.explain_md, 4);
      box.appendChild(field('Explanation (' + activeLocale + ')', explain,
        'shown after answering — only used if the question has a correct answer'));
    }

    // options
    var optWrap = h('div');
    box.appendChild(optWrap);
    var labels = Object.assign({}, text.labels || {});

    function drawOptions() {
      optWrap.textContent = '';
      var kind = kindSel.value;
      if (kind !== 'single' && kind !== 'multi') {
        if (kind === 'scale') {
          var r = h('div', 'ed-row');
          var mn = input(spec.min != null ? spec.min : 0);
          var mx = input(spec.max != null ? spec.max : 10);
          mn.addEventListener('input', function () { spec.min = parseInt(mn.value, 10) || 0; });
          mx.addEventListener('input', function () { spec.max = parseInt(mx.value, 10) || 10; });
          r.append(field('Min', mn), field('Max', mx));
          optWrap.appendChild(r);
          var lmin = input(labels.min), lmax = input(labels.max);
          lmin.addEventListener('input', function () { labels.min = lmin.value; });
          lmax.addEventListener('input', function () { labels.max = lmax.value; });
          var r2 = h('div', 'ed-row');
          r2.append(field('Low end label', lmin), field('High end label', lmax));
          optWrap.appendChild(r2);
        }
        return;
      }

      var options = spec.options || (spec.options = []);
      var correct = spec.correct || [];
      var head = h('div', 'opthead');
      head.append(h('span', null, 'Code'), h('span', null, 'Label (' + activeLocale + ')'),
                  h('span', null, data.mode === 'quiz' ? 'Correct' : ''), h('span', null, ''));
      optWrap.appendChild(head);

      var rows = h('div', 'opts');
      options.forEach(function (oc, idx) {
        var row = h('div', 'optrow');
        var c = input(oc, 'mono');
        var l = input(labels[oc]);
        c.addEventListener('change', function () {
          var nv = c.value.trim();
          if (!nv || options.indexOf(nv) !== -1) { c.value = oc; return; }
          labels[nv] = labels[oc]; delete labels[oc];
          var ci = correct.indexOf(oc);
          if (ci !== -1) correct[ci] = nv;
          options[idx] = nv;
          drawOptions();
        });
        l.addEventListener('input', function () { labels[options[idx]] = l.value; });
        row.append(c, l);

        var isc = h('div', 'isc');
        if (data.mode === 'quiz') {
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = correct.indexOf(oc) !== -1;
          cb.title = 'Correct answer';
          cb.addEventListener('change', function () {
            var i2 = correct.indexOf(options[idx]);
            if (cb.checked && i2 === -1) correct.push(options[idx]);
            if (!cb.checked && i2 !== -1) correct.splice(i2, 1);
            spec.correct = correct.length ? correct : undefined;
            if (!correct.length) delete spec.correct; else spec.correct = correct;
          });
          isc.appendChild(cb);
        }
        row.appendChild(isc);

        var del = h('button', 'mini danger', '×');
        del.type = 'button';
        del.addEventListener('click', function () {
          options.splice(idx, 1);
          delete labels[oc];
          var ci2 = correct.indexOf(oc);
          if (ci2 !== -1) correct.splice(ci2, 1);
          drawOptions();
        });
        row.appendChild(del);
        rows.appendChild(row);
      });
      optWrap.appendChild(rows);

      var addOpt = h('button', 'mini', '+ option');
      addOpt.type = 'button';
      addOpt.addEventListener('click', function () {
        var n = 1;
        while (options.indexOf('opt' + n) !== -1) n++;
        options.push('opt' + n);
        drawOptions();
      });
      var wrapAdd = h('div');
      wrapAdd.style.marginTop = '.5rem';
      wrapAdd.appendChild(addOpt);
      optWrap.appendChild(wrapAdd);
    }

    kindSel.addEventListener('change', drawOptions);
    drawOptions();

    // save / delete
    var row = h('div', 'saverow');
    var save = h('button', 'primary', isNew ? 'Create question' : 'Save question');
    save.type = 'button';
    row.appendChild(save);
    var cancel = h('button', 'mini', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', function () { editing = null; render(); });
    row.appendChild(cancel);

    if (!isNew) {
      var del = h('button', 'mini danger', 'Delete');
      del.type = 'button';
      del.addEventListener('click', function () { doDelete(q, row); });
      row.appendChild(del);
    }
    box.appendChild(row);

    save.addEventListener('click', function () {
      save.disabled = true;
      var i18n = {};
      var entry = { prompt: prompt.value, help: help.value || null, labels: labels };
      if (explain) entry.explain_md = explain.value || null;
      i18n[activeLocale] = entry;
      // Preserve the other locale's wording, which this screen is not showing.
      if (!isNew) {
        Object.keys(q.i18n || {}).forEach(function (loc) {
          if (loc !== activeLocale) i18n[loc] = q.i18n[loc];
        });
      }
      var payload = {
        code: code.value.trim(), kind: kindSel.value,
        required: reqIn.checked, spec: spec, i18n: i18n
      };
      var p = isNew
        ? api('POST', '/' + encodeURIComponent(SLUG) + '/questions', payload)
        : api('PUT', '/' + encodeURIComponent(SLUG) + '/questions/' +
              encodeURIComponent(q.code), payload);
      p.then(function () { editing = null; load(); })
       .catch(function (e) { toast(row, e.message, false); save.disabled = false; });
    });

    return box;
  }

  function doDelete(q, row) {
    var force = '';
    if (q.answers) {
      if (!confirm('This question has ' + q.answers + ' collected answers.\n\n' +
                   'Deleting it deletes those answers too. This cannot be undone.\n\n' +
                   'Delete anyway?')) return;
      force = '?force=1';
    } else if (!confirm('Delete "' + q.code + '"?')) {
      return;
    }
    api('DELETE', '/' + encodeURIComponent(SLUG) + '/questions/' +
        encodeURIComponent(q.code) + force)
      .then(function () { editing = null; load(); })
      .catch(function (e) { toast(row, e.message, false); });
  }

  if (SLUG) load(); else listSurveys();
})();
