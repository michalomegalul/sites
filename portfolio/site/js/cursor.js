/* dobsinsky.dev - cursor.js
   A terminal caret that trails the mouse. Over a link it opens into a tag
   saying where the link resolves to. The native cursor stays as it is.
   Mouse devices only; touch or missing GSAP means nothing happens. */
(function () {
  if (!window.gsap || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const INTERACTIVE = 'a[href], button, [role="button"], summary';
  const SKIP = '#term, textarea, input, select';

  const tag = document.createElement('div');
  tag.className = 'cursor-tag';
  tag.setAttribute('aria-hidden', 'true');
  document.body.appendChild(tag);

  // Where does this element "resolve" to? Short, like a dig answer.
  const resolve = (el) => {
    if (el.matches('a[href]')) {
      const href = el.getAttribute('href');
      if (el.hasAttribute('download')) return '↓ ' + href.split('/').pop();
      if (href.startsWith('mailto:')) return '→ mailto';
      if (href.startsWith('#')) {
        const type = document.querySelector(href + ' .rec__type');
        return '→ ' + (type ? type.textContent.trim() : href.slice(1));
      }
      try {
        const url = new URL(href, location.href);
        if (url.host !== location.host) return '→ ' + url.host.replace(/^www\./, '');
        return '→ ' + (url.pathname === '/' ? '~' : url.pathname.slice(1));
      } catch (e) { return '→ link'; }
    }
    const text = (el.getAttribute('aria-label') || el.textContent || '').trim().toLowerCase();
    return '$ ' + (text.length > 18 ? text.slice(0, 17) + '.' : text || 'run');
  };

  const moveX = reduced ? (x) => gsap.set(tag, { x }) : gsap.quickTo(tag, 'x', { duration: 0.25, ease: 'power3' });
  const moveY = reduced ? (y) => gsap.set(tag, { y }) : gsap.quickTo(tag, 'y', { duration: 0.25, ease: 'power3' });

  let current = null;
  const setTarget = (el) => {
    if (el === current) return;
    current = el;
    tag.textContent = el ? resolve(el) : '';
    tag.classList.toggle('cursor-tag--open', !!el);
  };

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    // Offset down-right so it never sits under the pointer's hotspot.
    moveX(e.clientX + 14);
    moveY(e.clientY + 18);
    tag.classList.add('cursor-tag--on');
  }, { passive: true });

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch' || !(e.target instanceof Element)) return;
    const skip = !!e.target.closest(SKIP);
    tag.classList.toggle('cursor-tag--skip', skip);
    setTarget(skip ? null : e.target.closest(INTERACTIVE));
  });

  document.addEventListener('pointerout', (e) => {
    if (e.relatedTarget) return;
    tag.classList.remove('cursor-tag--on');
    setTarget(null);
  });
})();
