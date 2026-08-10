/* Applies the survey's accent colour AND the light/dark mode before first
 * paint.
 *
 * The accent is a property of the SURVEY, set by the researcher in the editor —
 * respondents no longer choose it. That is the point: a questionnaire should
 * look the same to everyone filling it in, and a palette picker in the header
 * was decoration competing with the question on a screen the SPEC reserves for
 * one question at a time.
 *
 * The authoritative value arrives with GET /api/s/{slug}, which is one round
 * trip too late to paint with. So the last-seen accent is cached per survey and
 * replayed here, before the stylesheet: a returning respondent sees the right
 * colours immediately, and app.js corrects the cache if the researcher changed
 * it since. A first-time visitor briefly gets the default palette, which is the
 * honest trade — the alternative is blocking first paint on a network call.
 *
 * Light/dark mode is a separate, simpler choice: not per-survey, not
 * server-authoritative, just a respondent preference. Default is light
 * regardless of the OS/browser's prefers-color-scheme — style.css keys dark
 * off `[data-theme="dark"]` alone, no media query — so a first-time visitor
 * on a dark-mode OS still gets the warm cream ground the survey was designed
 * against, and only sees dark if they ask for it via the switch in the site
 * bar (rendered by app.js's renderThemeToggle).
 *
 * A separate file rather than an inline <script> because the CSP is
 * script-src 'self' with no 'unsafe-inline'. Loads after palette.js, which
 * does the derivation and the contrast clamping.
 */
(function () {
  'use strict';

  var MODE_KEY = 'quiz:theme-mode';

  function getMode() {
    var m = null;
    try { m = localStorage.getItem(MODE_KEY); } catch (e) { /* private mode */ }
    return m === 'dark' ? 'dark' : 'light';
  }

  function applyMode(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    var meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute('content', mode);
  }

  window.QuizTheme = {
    getMode: getMode,
    setMode: function (mode) {
      mode = mode === 'dark' ? 'dark' : 'light';
      try { localStorage.setItem(MODE_KEY, mode); } catch (e) { /* private mode */ }
      applyMode(mode);
    }
  };

  applyMode(getMode());

  var PREFIX = 'quiz:accent:';

  function slugFromPath() {
    var m = location.pathname.match(/^\/[a-z]{2}\/s\/([a-z0-9-]+)/);
    return m ? m[1] : null;
  }

  window.QUIZ_ACCENT_KEY = function (slug) { return PREFIX + slug; };

  /* Called by app.js once the survey has loaded. Writing the cache here rather
     than in theme.js is deliberate — only the API's answer is authoritative,
     and caching a guess would make the next load wrong for longer. */
  window.quizSetAccent = function (slug, accent) {
    try {
      if (accent) localStorage.setItem(PREFIX + slug, accent);
      else localStorage.removeItem(PREFIX + slug);
    } catch (e) { /* private mode */ }
    apply(accent);
  };

  function apply(accent) {
    var el = document.getElementById('quiz-palette');
    if (!accent) {
      // Back to the stylesheet's built-in palette. Removing the element is not
      // the same as writing an empty one — an empty <style> still wins nothing,
      // but leaving a stale one would keep the old colours.
      if (el) el.remove();
      return;
    }
    if (window.QuizPalette) window.QuizPalette.apply(accent);
  }

  var slug = slugFromPath();
  if (!slug) return;                       // the chooser keeps the default palette
  var cached = null;
  try { cached = localStorage.getItem(PREFIX + slug); } catch (e) { /* ignore */ }
  if (cached) apply(cached);
})();
