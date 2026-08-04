/* Derives a whole palette from one accent colour.
 *
 * The editor gives the researcher a colour wheel — one choice, not eleven. That
 * is deliberate: the four hand-tuned palettes this replaces were each checked
 * against WCAG, and letting someone set `--ink` and `--bg` independently would
 * throw that away the first time anyone picked a pale yellow. So the wheel picks
 * a hue and this file derives the rest, clamping lightness until the contrast
 * floors below are met.
 *
 * Contrast floors, verified over all 360 hues by tools/palette.test.js, against
 * BOTH bg and bg-raised (surface sits darker than bg in light mode, lighter in
 * dark mode — whichever direction, it's the tighter of the two backgrounds):
 *   ink       >= 7.0  (WCAG AAA body text)
 *   ink-soft  >= 4.5  (AA — help text, counters)
 *   accent    >= 4.5  (AA — links, the eyebrow, the progress fill)
 *
 * --line and --focus are NOT in the object this returns — style.css defines
 * them once as `color-mix(in srgb, var(--ink) N%, transparent)` / `var(--accent)`,
 * which tracks whatever ink/accent apply() writes without needing its own entry.
 *
 * --pain-1/2/3 is NOT derived and never changes with the accent. It encodes
 * intensity on the body map, so it is data rather than decoration, and it has
 * to stay distinguishable from the accent or a selected region reads as a
 * painful one.
 *
 * Plain script, no module syntax: it is loaded in <head> before the stylesheet
 * so the palette is applied before first paint, and the CSP is script-src 'self'
 * with no 'unsafe-inline'.
 */
(function () {
  'use strict';

  function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }

  function hexToHsl(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    var n = parseInt(m[1], 16);
    var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2, h = 0, s = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: h, s: s * 100, l: l * 100 };
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
          : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return t.map(function (v) { return Math.round((v + m) * 255); });
  }

  function hex(h, s, l) {
    return '#' + hslToRgb(h, s, l).map(function (v) {
      return ('0' + v.toString(16)).slice(-2);
    }).join('');
  }

  function lum(rgb) {
    var a = rgb.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }

  function contrast(h1, s1, l1, h2, s2, l2) {
    var a = lum(hslToRgb(h1, s1, l1)), b = lum(hslToRgb(h2, s2, l2));
    var hi = Math.max(a, b), lo = Math.min(a, b);
    return (hi + 0.05) / (lo + 0.05);
  }

  /* Walk lightness in `step` until the colour clears `target` against the
     background. Returns the first L that passes, or the end of the range —
     the caller's floor is a target, and running off the end means pure black or
     white, which passes anyway. */
  function fit(h, s, startL, step, target, bg) {
    var l = startL;
    for (var i = 0; i < 100; i++) {
      if (contrast(h, s, l, bg.h, bg.s, bg.l) >= target) return l;
      l += step;
      if (l < 0 || l > 100) break;
    }
    return clamp(l, 0, 100);
  }

  function build(seed) {
    var c = hexToHsl(seed);
    if (!c) return null;
    var h = c.h;
    // A near-grey seed has no usable hue and a neon one is unreadable as body
    // text, so saturation is pulled into a band before anything is derived.
    var s = clamp(c.s, 22, 72);

    // ---- light ----
    // "Organic": a warm, visibly-tinted cream ground rather than a near-white
    // one, with card/surface areas a shade DARKER than the page (a filled
    // ground, not a lighter "elevated" panel). `lraised` is therefore always
    // the tighter contrast constraint of the two — closer to ink's lightness
    // than bg is — so every fit() below targets it: clearing it clears bg too.
    // palette.test.js checks both explicitly rather than assuming that.
    var lbg = { h: h, s: clamp(s * 0.95, 30, 60), l: 91 };
    var lraised = { h: h, s: clamp(s * 0.80, 26, 50), l: lbg.l - 6.5 };
    var lAccent = fit(h, s, 46, -1, 4.5, lraised);
    var lInk = fit(h, Math.min(s * 0.10, 9), 16, -1, 7.0, lraised);
    var lSoft = fit(h, Math.min(s * 0.16, 13), 46, -1, 4.5, lraised);

    var light = {
      bg: hex(lbg.h, lbg.s, lbg.l),
      'bg-raised': hex(lraised.h, lraised.s, lraised.l),
      ink: hex(h, Math.min(s * 0.10, 9), lInk),
      'ink-soft': hex(h, Math.min(s * 0.16, 13), lSoft),
      accent: hex(h, s, lAccent),
      'accent-2': hex(h, s, clamp(lAccent + 13, 0, 100)),
      'accent-bg': hex(h, Math.min(s * 0.55, 45), 94)
    };

    // ---- dark ----
    // Elevation keeps the conventional direction here (raised = lighter than
    // the page) — the mock has no dark half to invert against, and inverting
    // it would leave cards nearly invisible against an already-dark ground.
    var dbg = { h: h, s: Math.min(s * 0.28, 22), l: 9 };
    var draised = { h: h, s: Math.min(s * 0.30, 24), l: 14.5 };
    var dAccent = fit(h, s, 70, 1, 4.5, draised);
    var dInk = fit(h, Math.min(s * 0.14, 12), 93, 1, 7.0, draised);
    var dSoft = fit(h, Math.min(s * 0.14, 12), 66, 1, 4.5, draised);

    var dark = {
      bg: hex(dbg.h, dbg.s, dbg.l),
      'bg-raised': hex(draised.h, draised.s, draised.l),
      ink: hex(h, Math.min(s * 0.14, 12), dInk),
      'ink-soft': hex(h, Math.min(s * 0.14, 12), dSoft),
      accent: hex(h, s, dAccent),
      'accent-2': hex(h, s, clamp(dAccent - 13, 0, 100)),
      'accent-bg': hex(h, Math.min(s * 0.36, 30), 17)
    };

    return { light: light, dark: dark };
  }

  /* Writes the palette into a <style> element rather than onto the root's
     inline style: the dark half has to live inside a media query, which an
     inline style cannot express. */
  function apply(seed, doc) {
    doc = doc || document;
    var p = build(seed);
    if (!p) return null;

    var decls = function (o) {
      return Object.keys(o).map(function (k) { return '--' + k + ':' + o[k] + ';'; }).join('');
    };
    var css = ':root{' + decls(p.light) + '}'
            + '@media (prefers-color-scheme: dark){:root{' + decls(p.dark) + '}}';

    var el = doc.getElementById('quiz-palette');
    if (!el) {
      el = doc.createElement('style');
      el.id = 'quiz-palette';
      (doc.head || doc.documentElement).appendChild(el);
    }
    el.textContent = css;
    return p;
  }

  window.QuizPalette = {
    build: build, apply: apply, contrast: contrast, hexToHsl: hexToHsl, hex: hex
  };
})();
