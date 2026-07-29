/* Applies the stored palette before first paint.
 *
 * A separate file rather than an inline <script> in the head: the nginx CSP is
 * `script-src 'self'` with no 'unsafe-inline', so an inline block would be
 * blocked outright and every reload would flash the default palette. Loaded
 * synchronously in <head>, before the stylesheet, so there is no flash of the
 * wrong colour on navigation.
 *
 * THEMES is the single source of truth for which palettes exist — app.js reads
 * it to build the picker, and style.css must carry a matching
 * :root[data-theme="…"] block for each. The allow-list check also means a
 * tampered localStorage value cannot write an arbitrary attribute.
 */
(function () {
  'use strict';

  // `rose` is the base :root palette, so it is represented by no attribute at
  // all. Keep the swatch colours in step with --accent in each palette.
  window.QUIZ_THEMES = [
    { id: 'rose',  swatch: '#8d3f66' },
    { id: 'plum',  swatch: '#5b3f8d' },
    { id: 'sage',  swatch: '#3d6b4f' },
    { id: 'slate', swatch: '#37546f' }
  ];
  window.QUIZ_THEME_KEY = 'quiz:theme';

  window.quizApplyTheme = function (id) {
    if (id && id !== 'rose' && /^[a-z]+$/.test(id)) {
      document.documentElement.dataset.theme = id;
    } else {
      delete document.documentElement.dataset.theme;
    }
  };

  var stored = null;
  try { stored = localStorage.getItem(window.QUIZ_THEME_KEY); } catch (e) { /* private mode */ }
  var known = window.QUIZ_THEMES.some(function (t) { return t.id === stored; });
  window.quizApplyTheme(known ? stored : 'rose');
})();
