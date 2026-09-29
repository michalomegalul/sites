/* Interactive body map - the centrepiece question.
 *
 * SPEC: named anatomical regions, never freehand coordinates, because the
 * thesis needs tables and charts and coordinates cannot be tabulated. Tapping a
 * region cycles 0 → 1 → 2 → 3 → 0.
 *
 * Region set deliberately includes referral sites, not just the obvious ones:
 * shoulders are in here because diaphragmatic lesions refer pain there and a
 * plain checkbox list never catches it.
 *
 * Sides are named from the RESPONDENT's point of view. In the front view the
 * respondent's left is on the viewer's right; in the back view it is on the
 * viewer's left. The coordinates below already account for that - check it
 * before moving anything.
 */
(function () {
  'use strict';

  var SVG = 'http://www.w3.org/2000/svg';

  // A stylised figure built from primitives rather than one hand-drawn path:
  // easier to keep symmetrical, and it scales cleanly on a small screen.
  var SILHOUETTE = [
    ['ellipse', { cx: 100, cy: 34, rx: 24, ry: 28 }],           // head
    ['rect', { x: 90, y: 56, width: 20, height: 22, rx: 9 }],   // neck
    ['path', { d: 'M60 96 Q60 78 100 78 Q140 78 140 96 L136 160 Q133 200 126 238 Q100 248 74 238 Q67 200 64 160 Z' }],
    ['rect', { x: 37, y: 92, width: 22, height: 132, rx: 11 }], // arm
    ['rect', { x: 141, y: 92, width: 22, height: 132, rx: 11 }],
    ['rect', { x: 74, y: 228, width: 24, height: 198, rx: 12 }],// leg
    ['rect', { x: 102, y: 228, width: 24, height: 198, rx: 12 }]
  ];

  var FRONT = [
    ['shoulder-r',        { cx: 66,  cy: 97,  rx: 17, ry: 13 }],
    ['shoulder-l',        { cx: 134, cy: 97,  rx: 17, ry: 13 }],
    ['ribs-r',            { cx: 81,  cy: 140, rx: 17, ry: 17 }],
    ['ribs-l',            { cx: 119, cy: 140, rx: 17, ry: 17 }],
    ['abdomen-upper',     { cx: 100, cy: 172, rx: 25, ry: 15 }],
    ['abdomen-lower-r',   { cx: 84,  cy: 203, rx: 17, ry: 16 }],
    ['abdomen-lower-l',   { cx: 116, cy: 203, rx: 17, ry: 16 }],
    ['pelvis-suprapubic', { cx: 100, cy: 230, rx: 21, ry: 13 }],
    ['groin-r',           { cx: 85,  cy: 254, rx: 13, ry: 12 }],
    ['groin-l',           { cx: 115, cy: 254, rx: 13, ry: 12 }],
    ['thigh-r',           { cx: 86,  cy: 306, rx: 14, ry: 36 }],
    ['thigh-l',           { cx: 114, cy: 306, rx: 14, ry: 36 }]
  ];

  var BACK = [
    ['shoulder-l',  { cx: 66,  cy: 97,  rx: 17, ry: 13 }],
    ['shoulder-r',  { cx: 134, cy: 97,  rx: 17, ry: 13 }],
    ['back-lower',  { cx: 100, cy: 185, rx: 28, ry: 24 }],
    ['sacrum',      { cx: 100, cy: 224, rx: 19, ry: 15 }],
    ['buttock-l',   { cx: 74,  cy: 264, rx: 18, ry: 19 }],
    ['buttock-r',   { cx: 126, cy: 264, rx: 18, ry: 19 }],
    ['coccyx',      { cx: 100, cy: 252, rx: 10, ry: 11 }],
    ['rectal-deep', { cx: 100, cy: 284, rx: 14, ry: 12 }]
  ];

  function el(name, attrs, cls) {
    var node = document.createElementNS(SVG, name);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    if (cls) node.setAttribute('class', cls);
    return node;
  }

  function buildView(shapes, allowed) {
    var svg = el('svg', {
      viewBox: '0 0 200 440',
      role: 'group',
      'aria-label': 'body map'
    });
    var body = el('g', {}, 'body-silhouette');
    SILHOUETTE.forEach(function (s) { body.appendChild(el(s[0], s[1])); });
    svg.appendChild(body);

    shapes.forEach(function (r) {
      // A view only draws regions the question's spec actually declares, so a
      // survey with a reduced region set still renders correctly.
      if (allowed && allowed.indexOf(r[0]) === -1) return;
      var node = el('ellipse', r[1], 'region');
      node.setAttribute('data-region', r[0]);
      node.setAttribute('data-level', '0');
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'button');
      node.appendChild(el('title'));
      svg.appendChild(node);
    });
    return svg;
  }

  /* create({ regions, labels, levels, value, onChange, t, readonly }) → element
   *
   * `value` is the SPEC shape: { "pelvis-suprapubic": 3, "sacrum": 2 }.
   * Regions at zero are absent from the object rather than stored as 0.
   */
  function create(opts) {
    var t = opts.t;
    var labels = opts.labels || {};
    var levels = opts.levels || 3;
    var value = Object.assign({}, opts.value || {});
    // A graded quiz question (spec `levels: 1`) is tap-to-select, not
    // tap-to-cycle-intensity: a region is either the answer or it is not.
    // Distinct from the survey's pain map, which is data ("how bad, where")
    // rather than a right/wrong answer - see 007_quiz_pain_location.sql.
    var selectMode = levels === 1;
    var levelNames = selectMode
      ? [t.bodyNotSelected, t.bodySelected]
      : [t.painNone, t.painMild, t.painMod, t.painSevere];

    var wrap = document.createElement('div');
    wrap.className = selectMode ? 'bodymap bodymap--select' : 'bodymap';

    var stage = document.createElement('div');
    var frontSvg = buildView(FRONT, opts.regions);
    stage.appendChild(frontSvg);

    // A question restricted to front-only regions (every graded quiz map so
    // far) has nothing to show on the back view, so the toggle - and the
    // view it would switch to - is simply not built rather than built empty.
    var backCodes = BACK.map(function (r) { return r[0]; });
    var hasBack = !opts.regions || opts.regions.some(function (code) {
      return backCodes.indexOf(code) !== -1;
    });
    var toggle = null, backSvg = null, frontBtn = null, backBtn = null;
    if (hasBack) {
      toggle = document.createElement('div');
      toggle.className = 'view-toggle';
      frontBtn = document.createElement('button');
      backBtn = document.createElement('button');
      frontBtn.type = backBtn.type = 'button';
      frontBtn.textContent = t.bodyFront;
      backBtn.textContent = t.bodyBack;
      toggle.append(frontBtn, backBtn);
      backSvg = buildView(BACK, opts.regions);
      stage.appendChild(backSvg);
    }

    var hint = document.createElement('p');
    hint.className = 'bodymap-hint';
    hint.textContent = selectMode ? t.bodyHintSelect : t.bodyHint;

    var legend = null;
    if (!selectMode) {
      legend = document.createElement('div');
      legend.className = 'legend';
      legend.innerHTML =
        '<span><i class="swatch l1"></i>' + t.painMild + '</span>' +
        '<span><i class="swatch l2"></i>' + t.painMod + '</span>' +
        '<span><i class="swatch l3"></i>' + t.painSevere + '</span>';
    }

    var picked = document.createElement('ul');
    picked.className = 'picked';

    var live = document.createElement('div');
    live.setAttribute('aria-live', 'polite');
    live.className = 'hp';

    // "No pain in any of these areas" - without this a required body map is a
    // dead end for anyone with nothing to mark, and an empty map is otherwise
    // indistinguishable from an unanswered one. Only meaningful for the
    // intensity map: a graded select question has a right answer, not a "no
    // pain" state, so it is not offered here.
    var noneLabel = null, noneInput = null;
    if (!selectMode) {
      noneLabel = document.createElement('label');
      noneLabel.className = 'check';
      noneInput = document.createElement('input');
      noneInput.type = 'checkbox';
      var noneMark = document.createElement('span');
      noneMark.className = 'mark';
      var noneText = document.createElement('span');
      noneText.className = 'check-text';
      noneText.textContent = t.bodyNone;
      noneLabel.append(noneInput, noneMark, noneText);
      noneInput.checked = !!opts.answered && !Object.keys(value).length;

      noneInput.addEventListener('change', function () {
        if (!noneInput.checked) return;
        value = {};
        paint();
        if (opts.onChange) opts.onChange({});
      });
    }

    [toggle, hint, stage, legend, picked, noneLabel, live].forEach(function (node) {
      if (node) wrap.appendChild(node);
    });

    function label(code) { return labels[code] || code; }

    function paint() {
      // Shoulders appear in both views and share one code, so every matching
      // node is updated, not just the one that was tapped.
      wrap.querySelectorAll('.region').forEach(function (node) {
        var code = node.getAttribute('data-region');
        var lvl = value[code] || 0;
        node.setAttribute('data-level', String(lvl));
        var text = t.regionState(label(code), levelNames[lvl]);
        node.setAttribute('aria-label', text);
        node.querySelector('title').textContent = text;
      });

      picked.textContent = '';
      var codes = Object.keys(value).sort(function (a, b) {
        return value[b] - value[a] || label(a).localeCompare(label(b));
      });
      if (!codes.length) {
        var empty = document.createElement('li');
        empty.textContent = t.bodyEmpty;
        empty.style.background = 'transparent';
        empty.style.border = '0';
        picked.appendChild(empty);
      } else {
        codes.forEach(function (code) {
          var li = document.createElement('li');
          // In select mode every listed code is selected by definition, so
          // the level suffix would just repeat "Selected" down the list.
          li.textContent = selectMode ? label(code) : (label(code) + ' · ' + levelNames[value[code]]);
          picked.appendChild(li);
        });
      }
    }

    function cycle(code) {
      if (opts.readonly) return;
      var next = ((value[code] || 0) + 1) % (levels + 1);
      if (next === 0) delete value[code];
      else value[code] = next;
      if (noneInput) noneInput.checked = false;
      paint();
      live.textContent = t.regionState(label(code), levelNames[next]);
      if (opts.onChange) opts.onChange(Object.assign({}, value));
    }

    wrap.addEventListener('click', function (e) {
      var node = e.target.closest('.region');
      if (node) cycle(node.getAttribute('data-region'));
    });
    wrap.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var node = e.target.closest && e.target.closest('.region');
      if (!node) return;
      e.preventDefault();
      cycle(node.getAttribute('data-region'));
    });

    if (hasBack) {
      var show = function (front) {
        // toggleAttribute, not `.hidden =`: `hidden` is an HTMLElement
        // property; on an SVGElement assigning it only sets an inert expando,
        // so the `.bodymap svg[hidden]` rule never matched and both views showed.
        frontSvg.toggleAttribute('hidden', !front);
        backSvg.toggleAttribute('hidden', front);
        frontBtn.setAttribute('aria-pressed', String(front));
        backBtn.setAttribute('aria-pressed', String(!front));
      };
      frontBtn.addEventListener('click', function () { show(true); });
      backBtn.addEventListener('click', function () { show(false); });
      show(true);
    }

    paint();
    return wrap;
  }

  /* Static, unfilled, both views side by side - the printable appendix.
   * Skips the back view entirely when the question's regions are all
   * front-facing, same as create() - an empty second silhouette in a print
   * appendix is confusing, not neutral. */
  function createPrint(opts) {
    var wrap = document.createElement('div');
    wrap.className = 'bodymap';
    wrap.style.display = 'flex';
    wrap.style.gap = '1rem';
    var backCodes = BACK.map(function (r) { return r[0]; });
    var hasBack = !opts.regions || opts.regions.some(function (code) {
      return backCodes.indexOf(code) !== -1;
    });
    var front = buildView(FRONT, opts.regions);
    var views = hasBack ? [front, buildView(BACK, opts.regions)] : [front];
    views.forEach(function (svg) {
      svg.querySelectorAll('.region').forEach(function (n) {
        n.removeAttribute('tabindex');
        n.removeAttribute('role');
        var code = n.getAttribute('data-region');
        n.querySelector('title').textContent = (opts.labels || {})[code] || code;
      });
      wrap.appendChild(svg);
    });
    return wrap;
  }

  /* Researcher heat map. Both views at once, no interaction beyond hover.
   *
   * Colour encodes ONE thing - how many respondents marked the region - on a
   * single-hue sequential ramp (see admin.css). Mean intensity is a second
   * measure and is written as text rather than folded into the same colour,
   * because two measures on one scale cannot be read back apart.
   *
   * data: { region: { respondents, mean_intensity } }
   */
  function createHeat(opts) {
    var data = opts.data || {};
    var labels = opts.labels || {};
    var max = 0;
    Object.keys(data).forEach(function (k) {
      if (data[k].respondents > max) max = data[k].respondents;
    });

    var wrap = document.createElement('div');
    wrap.className = 'bodymap heat';

    [buildView(FRONT, opts.regions), buildView(BACK, opts.regions)].forEach(function (svg) {
      svg.querySelectorAll('.region').forEach(function (node) {
        node.removeAttribute('tabindex');
        node.setAttribute('role', 'img');
        var code = node.getAttribute('data-region');
        var d = data[code];
        var n = d ? d.respondents : 0;
        // Five buckets: 0 recedes to the surface, 1–4 climb the ramp.
        var step = (!n || !max) ? 0 : Math.max(1, Math.ceil((n / max) * 4));
        node.setAttribute('data-heat', String(step));
        var text = (labels[code] || code) + ' - ' + n +
          (d ? ' (⌀ ' + d.mean_intensity + ')' : '');
        node.querySelector('title').textContent = text;
        node.setAttribute('aria-label', text);
        if (opts.onHover) {
          node.addEventListener('mouseenter', function () { opts.onHover(code, d); });
          node.addEventListener('mouseleave', function () { opts.onHover(null, null); });
        }
      });
      wrap.appendChild(svg);
    });
    return wrap;
  }

  window.BodyMap = {
    create: create, createPrint: createPrint, createHeat: createHeat,
    FRONT: FRONT, BACK: BACK
  };
})();
