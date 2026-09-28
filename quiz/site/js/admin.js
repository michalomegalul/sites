/* Researcher dashboard.
 *
 * Reachable on LAN/Tailscale only. The API 404s these endpoints from the
 * public block, so on a public host this page renders an error and nothing else.
 *
 * Charting rules applied here (see admin.css for the palette):
 *  - every chart shows one measure, so every chart uses one hue;
 *  - nothing is coloured by rank — a filter cannot repaint the survivors;
 *  - no chart has two scales;
 *  - every chart has a table view, and values are labelled directly.
 */
(function () {
  'use strict';

  var SLUG = new URLSearchParams(location.search).get('slug') || 'endo-2026';
  var root = document.getElementById('root');
  document.getElementById('sub').textContent = SLUG;

  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function section(title, note) {
    var s = h('section');
    s.appendChild(h('h2', null, title));
    if (note) s.appendChild(h('p', 'note', note));
    return s;
  }

  /* Horizontal bars + a table of the same numbers. `rows` is
   * [{label, value, suffix}], already ordered by the caller. */
  function barChart(rows, opts) {
    opts = opts || {};
    var wrap = h('div');
    var max = rows.reduce(function (m, r) { return Math.max(m, r.value); }, 0);

    var bars = h('div', 'bars');
    rows.forEach(function (r) {
      var row = h('div', 'bar-row' + (r.value ? '' : ' zero'));
      row.appendChild(h('div', 'bar-label', r.label)).title = r.label;
      var track = h('div', 'bar-track');
      var fill = h('div', 'bar-fill');
      fill.style.width = (max ? (r.value / max) * 100 : 0) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(h('div', 'bar-val', r.suffix != null ? r.suffix : String(r.value)));
      row.title = r.label + ': ' + (r.suffix != null ? r.suffix : r.value);
      bars.appendChild(row);
    });
    wrap.appendChild(bars);

    // Table view — required so the numbers are never colour-only.
    var table = h('div', 'scroller');
    table.hidden = true;
    var t = h('table');
    var thead = h('tr');
    thead.appendChild(h('th', null, opts.labelHead || 'Item'));
    thead.appendChild(h('th', 'num', opts.valueHead || 'Count'));
    t.appendChild(thead);
    rows.forEach(function (r) {
      var tr = h('tr');
      tr.appendChild(h('td', null, r.label));
      tr.appendChild(h('td', 'num', r.suffix != null ? r.suffix : String(r.value)));
      t.appendChild(tr);
    });
    table.appendChild(t);

    var toggle = h('button', 'toggle', 'Table view');
    toggle.type = 'button';
    toggle.setAttribute('aria-pressed', 'false');
    toggle.addEventListener('click', function () {
      var on = table.hidden;
      table.hidden = !on;
      bars.hidden = on;
      toggle.setAttribute('aria-pressed', String(on));
    });

    var toggleRow = h('div');
    toggleRow.style.marginTop = '.6rem';
    toggleRow.appendChild(toggle);
    wrap.append(table, toggleRow);
    return wrap;
  }

  function tiles(list) {
    var wrap = h('div', 'tiles');
    list.forEach(function (item) {
      var tile = h('div', 'tile');
      tile.appendChild(h('div', 'k', item.k));
      tile.appendChild(h('div', 'v', item.v));
      if (item.x) tile.appendChild(h('div', 'x', item.x));
      wrap.appendChild(tile);
    });
    return wrap;
  }

  function render(stats, survey) {
    root.textContent = '';

    var labelOf = {}, promptOf = {}, specOf = {};
    (survey.questions || []).forEach(function (q) {
      promptOf[q.code] = q.prompt || q.code;
      labelOf[q.code] = q.labels || {};
      specOf[q.code] = q.spec || {};
    });

    // ---- headline numbers
    var started = stats.sources.reduce(function (a, s) { return a + Number(s.started); }, 0);
    var done = stats.sources.reduce(function (a, s) { return a + Number(s.completed); }, 0);
    var dur = stats.duration || {};
    root.appendChild(tiles([
      { k: 'Started', v: String(started) },
      { k: 'Completed', v: String(done) },
      { k: 'Completion', v: started ? Math.round((done / started) * 100) + '%' : '–' },
      { k: 'Median time', v: dur.median_minutes != null ? dur.median_minutes + ' min' : '–',
        x: dur.mean_minutes != null ? 'mean ' + dur.mean_minutes + ' min' : '' }
    ]));

    var bar = h('div', 'toolbar');
    [['Download wide CSV', 'wide'], ['Download long CSV', 'long']].forEach(function (d) {
      var a = h('a', 'dl', d[0]);
      a.href = '/api/admin/' + encodeURIComponent(SLUG) + '/export.csv?format=' + d[1];
      bar.appendChild(a);
    });
    var pr = h('a', 'dl', 'Printable blank form');
    pr.href = '/cs/s/' + encodeURIComponent(SLUG) + '/print';
    bar.appendChild(pr);
    root.appendChild(bar);

    root.appendChild(sharePanel(survey.locales || ['cs']));

    if (done < 5) {
      root.appendChild(h('div', 'warn',
        'Fewer than five completed responses. Percentages are not meaningful yet, ' +
        'and free-text answers are especially identifiable at this sample size.'));
    }

    // ---- where people give up
    var s1 = section('Where people stop',
      'Last question answered by everyone who started but never submitted. ' +
      'A spike is a question worth rewording. "(no answers)" means they consented and left immediately.');
    var drop = (stats.dropoff || []).slice().sort(function (a, b) { return a.position - b.position; });
    s1.appendChild(drop.length
      ? barChart(drop.map(function (d) {
          return { label: (d.position ? d.position / 10 + '. ' : '') + (promptOf[d.question] || d.question),
                   value: Number(d.abandoned_here) };
        }), { labelHead: 'Last question reached', valueHead: 'Abandoned' })
      : h('p', 'empty', 'No abandoned responses.'));
    root.appendChild(s1);

    // ---- funnel
    var s2 = section('How far people get',
      'Responses that reached each question, in order. The big steps down are where the survey is losing people.');
    s2.appendChild(barChart((stats.funnel || []).map(function (f) {
      return { label: (f.position / 10) + '. ' + (promptOf[f.question] || f.question),
               value: Number(f.reached) };
    }), { labelHead: 'Question', valueHead: 'Reached' }));
    root.appendChild(s2);

    // ---- sources
    var s3 = section('Where they came from',
      'Attribution from the ?src= code on the link. Unknown codes are not counted as a source.');
    s3.appendChild(barChart((stats.sources || []).map(function (s) {
      return { label: s.source, value: Number(s.started),
               suffix: s.started + ' → ' + s.completed };
    }).sort(function (a, b) { return b.value - a.value; }),
      { labelHead: 'Source', valueHead: 'Started → completed' }));
    root.appendChild(s3);

    // ---- body map
    // A graded "select the affected regions" question (spec.levels === 1,
    // added for the quiz — see 007_quiz_pain_location.sql) has no intensity
    // to average, so it is excluded here: this panel's "mean intensity 0–3"
    // framing is specific to the survey's tap-to-cycle pain map.
    var bodyQ = (survey.questions || []).filter(function (q) {
      return q.kind === 'bodymap' && ((q.spec || {}).levels || 3) !== 1;
    })[0];
    if (bodyQ) {
      var s4 = section('Pain map',
        'Shade shows how many respondents marked the region. Mean intensity (0–3) is written out ' +
        'rather than folded into the same shade — two measures on one scale cannot be read apart.');
      var byRegion = {};
      (stats.bodymap || []).forEach(function (b) {
        byRegion[b.region] = { respondents: Number(b.respondents), mean_intensity: b.mean_intensity };
      });
      var readout = h('div', 'readout', ' ');
      s4.appendChild(window.BodyMap.createHeat({
        regions: (bodyQ.spec || {}).regions,
        labels: bodyQ.labels || {},
        data: byRegion,
        onHover: function (code, d) {
          readout.textContent = code
            ? (bodyQ.labels[code] || code) + ' — ' +
              (d ? d.respondents + ' respondents, mean intensity ' + d.mean_intensity : 'nobody')
            : ' ';
        }
      }));
      var ramp = h('div', 'ramp');
      ramp.appendChild(h('span', null, 'none'));
      for (var i = 0; i < 5; i++) ramp.appendChild(h('i'));
      ramp.appendChild(h('span', null, 'most'));
      s4.append(ramp, readout);

      var rows = Object.keys(byRegion).map(function (code) {
        return { label: bodyQ.labels[code] || code, value: byRegion[code].respondents,
                 suffix: byRegion[code].respondents + '  (⌀ ' + byRegion[code].mean_intensity + ')' };
      }).sort(function (a, b) { return b.value - a.value; });
      if (rows.length) s4.appendChild(barChart(rows, { labelHead: 'Region', valueHead: 'Respondents (mean)' }));
      root.appendChild(s4);
    }

    // ---- awareness results (quiz-mode surveys only)
    if ((stats.knowledge || []).length) {
      var s4b = section('What people knew',
        'Share of completed responses answering each question correctly. ' +
        'A low bar is not a failure — it is the finding.');
      s4b.appendChild(barChart(stats.knowledge.map(function (k) {
        return { label: promptOf[k.question] || k.question,
                 value: Number(k.pct_correct),
                 suffix: k.pct_correct + '%  (' + k.correct + '/' + k.answered + ')' };
      }), { labelHead: 'Question', valueHead: 'Correct' }));
      root.appendChild(s4b);

      var hist = stats.score_hist || [];
      if (hist.length) {
        var outOf = Number(hist[0].out_of);
        var s4c = section('Score distribution',
          'How many correct answers each respondent got, out of ' + outOf + '.');
        // Every possible score gets a row, including the empty ones — gaps in
        // the distribution are part of its shape.
        var byScore = {};
        hist.forEach(function (r) { byScore[Number(r.score)] = Number(r.n); });
        var rows = [];
        for (var sc = 0; sc <= outOf; sc++) {
          rows.push({ label: sc + ' / ' + outOf, value: byScore[sc] || 0 });
        }
        s4c.appendChild(barChart(rows, { labelHead: 'Score', valueHead: 'Respondents' }));
        root.appendChild(s4c);
      }
    }

    // ---- per-question tallies
    var s5 = section('Answers', 'Completed responses only.');
    (survey.questions || []).forEach(function (q) {
      var tally = (stats.tallies || {})[q.code];
      if (!tally || !tally.length) return;
      var block = h('div');
      block.style.marginBottom = '1.75rem';
      block.appendChild(h('h2', null, promptOf[q.code])).style.textTransform = 'none';

      var counts = {};
      tally.forEach(function (row) { counts[row.option] = Number(row.n); });

      // Ordered by the question's own option order, never by size: the order
      // is part of the instrument, and reordering it hides the shape of a scale.
      var order = (q.spec || {}).options ||
        (q.kind === 'scale' ? rangeOf(q.spec) : Object.keys(counts));
      block.appendChild(barChart(order.map(function (code) {
        return { label: (q.labels || {})[code] || String(code), value: counts[code] || 0 };
      }), { labelHead: 'Answer', valueHead: 'Responses' }));
      s5.appendChild(block);
    });
    root.appendChild(s5);

    // ---- devices
    var s6 = section('Devices', 'Coarse browser/platform family. The full user-agent is never stored.');
    s6.appendChild(barChart((stats.devices || []).map(function (d) {
      return { label: d.ua_family || 'unknown', value: Number(d.n) };
    }), { labelHead: 'Device', valueHead: 'Responses' }));
    root.appendChild(s6);
  }

  // ---- share links
  // Type where the link is going ("Instagram story", "Gymnázium Brno"), get a
  // tagged public link to copy. The tag is registered as a source first, so
  // responses arriving through it show up under "Where they came from".
  var PUBLIC = ((window.QUIZ_CONFIG || {}).publicOrigin || location.origin).replace(/\/$/, '');

  function tagOf(text) {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  }

  function linkFor(locale, tag) {
    return PUBLIC + '/' + locale + '/s/' + encodeURIComponent(SLUG) + '?src=' + tag;
  }

  // navigator.clipboard needs a secure context, and the dashboard is served
  // over plain http on the internal hostname — fall back to a selection copy.
  function copy(text, btn) {
    var done = function () {
      var was = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = was; }, 1500);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done);
      return;
    }
    var ta = h('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } finally { ta.remove(); }
  }

  function linkRow(url, meta) {
    var row = h('div', 'share-row');
    var field = h('input', 'share-url');
    field.value = url;
    field.readOnly = true;
    field.addEventListener('focus', function () { field.select(); });
    var btn = h('button', 'toggle', 'Copy');
    btn.type = 'button';
    btn.addEventListener('click', function () { copy(url, btn); });
    row.appendChild(field);
    row.appendChild(btn);
    if (meta) row.appendChild(h('span', 'share-meta', meta));
    return row;
  }

  function sharePanel(locales) {
    var s = section('Share links',
      'Write where the link is going, e.g. "Instagram story" or "Gymnázium Brno". ' +
      'Each tag is counted separately under "Where they came from".');

    var form = h('form', 'share-form');
    var input = h('input', 'share-tag');
    input.placeholder = 'Where will you share it?';
    input.maxLength = 60;
    input.required = true;
    var lang = h('select', 'share-lang');
    locales.forEach(function (l) {
      var o = h('option', null, l === 'cs' ? 'Čeština' : l === 'en' ? 'English' : l);
      o.value = l;
      lang.appendChild(o);
    });
    var make = h('button', 'toggle', 'Create link');
    make.type = 'submit';
    var preview = h('span', 'share-meta');
    input.addEventListener('input', function () {
      var t = tagOf(input.value);
      preview.textContent = t ? 'tag: ' + t : '';
    });
    form.appendChild(input);
    form.appendChild(lang);
    form.appendChild(make);
    form.appendChild(preview);
    s.appendChild(form);

    var result = h('div');
    s.appendChild(result);

    var list = h('div', 'share-list');
    s.appendChild(list);

    function refresh() {
      get('/api/admin/' + encodeURIComponent(SLUG) + '/sources').then(function (r) {
        list.textContent = '';
        if (!r.sources.length) return;
        list.appendChild(h('p', 'note', 'Existing tags (' + lang.value + ' links):'));
        r.sources.forEach(function (src) {
          list.appendChild(linkRow(linkFor(lang.value, src.code),
            (src.label && src.label !== src.code ? src.label + ' · ' : '') +
            src.started + ' started · ' + src.completed + ' completed'));
        });
      }).catch(function () {});
    }
    lang.addEventListener('change', refresh);

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var tag = tagOf(input.value);
      result.textContent = '';
      if (!tag) {
        result.appendChild(h('p', 'warn', 'Use at least one letter or number.'));
        return;
      }
      make.disabled = true;
      fetch('/api/admin/' + encodeURIComponent(SLUG) + '/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: tag, label: input.value.trim() })
      }).then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      }).then(function (src) {
        var url = linkFor(lang.value, src.code);
        result.appendChild(linkRow(url, 'tag: ' + src.code));
        result.querySelector('.share-url').focus();
        input.value = '';
        preview.textContent = '';
        refresh();
      }).catch(function (e) {
        result.appendChild(h('p', 'warn', 'Could not create the link (' + e.message + ').'));
      }).then(function () { make.disabled = false; });
    });

    refresh();
    return s;
  }

  function rangeOf(spec) {
    var out = [];
    var min = (spec && spec.min != null) ? spec.min : 0;
    var max = (spec && spec.max != null) ? spec.max : 10;
    for (var v = min; v <= max; v++) out.push(String(v));
    return out;
  }

  function get(path) {
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    });
  }

  Promise.all([
    get('/api/admin/' + encodeURIComponent(SLUG) + '/stats'),
    get('/api/s/' + encodeURIComponent(SLUG) + '?locale=cs')
  ]).then(function (res) {
    render(res[0], res[1]);
  }).catch(function (e) {
    root.appendChild(h('div', 'warn',
      e.message === '404'
        ? 'Not available from this network. The dashboard answers only on LAN or Tailscale — ' +
          'open it via the internal hostname, not through the public domain.'
        : 'Could not load results (' + e.message + ').'));
  });
})();
