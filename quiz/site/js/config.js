/* Site config. Edit this file, not the app.
 *
 * There is no analytics here, and that is deliberate rather than unfinished.
 * Google Analytics was wired in and then removed: `v_dropoff` and the funnel
 * views on the dashboard already answer "where do people give up" more
 * precisely than GA can, without a third-party script in a page where people
 * disclose symptoms. Nothing on this site now makes a request off-origin — see
 * the CSP in nginx.conf, which no longer allow-lists anything external.
 *
 * If you are ever tempted to add a tag back: the reason not to is in the README
 * under Analytics. A GA client ID plus a timestamp, combined with knowing who
 * was sent a link and when, is a re-identification path the survey data alone
 * does not have.
 */
window.QUIZ_CONFIG = {
  // Locales the landing page offers. Survey pages use the survey's own
  // `locales` column instead, so a survey that exists in one language only
  // never shows a switcher to a language it has no text for.
  locales: ['cs', 'en'],
  defaultLocale: 'cs'
};
