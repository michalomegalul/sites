/* Site config. Edit this file, not the app.
 *
 * Google Analytics is OPT-IN. Nothing from Google is requested until the
 * visitor ticks the analytics box on the consent screen; if they do not, no
 * script is loaded and no request leaves the origin.
 *
 * What we send: screen names and question codes (e.g. "pain_map"). What we
 * never send: answer values, free text, the response_id, or anything else that
 * could be joined back to a response. If you add events, keep that line.
 */
window.QUIZ_CONFIG = {
  // From Google Analytics → Admin → Data streams → Measurement ID.
  // Leave empty to disable analytics entirely.
  gaMeasurementId: '',

  // Passed to gtag as config. anonymize_ip truncates the address before
  // storage; ads signals are off because this is a health questionnaire and
  // must not feed advertising audiences.
  gaOptions: {
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    send_page_view: false
  },

  // Slug of the survey this deployment serves when the path has none.
  defaultSlug: 'endo-2026',
  defaultLocale: 'cs'
};
