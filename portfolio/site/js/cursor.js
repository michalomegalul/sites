/* dobsinsky.dev - cursor.js
   A terminal caret that trails the mouse. Over a link it opens into a tag
   saying where the link resolves to. Type anywhere and the caret takes the
   text: a shell command runs in the shell, anything else searches the page.
   The native cursor stays as it is. Mouse devices only; touch or missing
   GSAP means nothing happens. */
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

  let current = null; // hovered interactive element
  let skip = false;   // pointer is over the shell or a form field
  let active = false; // the mouse has been used, so the caret is showing
  let buffer = '';    // what has been typed into the caret
  let hits = [];      // search matches for the buffer, as Ranges
  let hitIdx = -1;
  let hint = '';      // one-off "you can type here" message

  const render = () => {
    tag.textContent = '';
    if (buffer) {
      const text = document.createElement('span');
      text.textContent = '$ ' + buffer;
      const meta = document.createElement('span');
      meta.className = 'cursor-tag__meta';
      meta.textContent = describe();
      tag.append(text, meta);
    } else if (hint) {
      tag.textContent = hint;
    } else if (current) {
      tag.textContent = resolve(current);
    }
    tag.classList.toggle('cursor-tag--open', !!(buffer || hint || current));
    tag.classList.toggle('cursor-tag--typing', !!buffer);
    tag.classList.toggle('cursor-tag--skip', skip && !buffer);
  };

  /* ---------- typing ---------- */

  const firstWord = () => buffer.trim().split(/\s+/)[0] || '';
  const isCommand = () => !!(window.__term && firstWord() && window.__term.isCommand(firstWord()));

  const describe = () => {
    if (isCommand()) return '↵ run';
    if (buffer.trim().length < 2) return '';
    if (!hits.length) return 'no match';
    return hitIdx < 0 ? `↵ find (${hits.length})` : `${hitIdx + 1}/${hits.length} ↵`;
  };

  // Visible page text only: not the shell, not this tag, not the aria-hidden
  // marquee duplicates, not hidden sections.
  const searchable = (node) => {
    const el = node.parentElement;
    if (!el || el.closest('#term, .cursor-tag, script, style, [aria-hidden="true"], [hidden]')) return false;
    return el.getClientRects().length > 0;
  };

  const findHits = () => {
    hits = [];
    hitIdx = -1;
    const q = buffer.trim().toLowerCase();
    if (q.length < 2 || isCommand()) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (searchable(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    for (let n = walker.nextNode(); n && hits.length < 200; n = walker.nextNode()) {
      const text = n.nodeValue.toLowerCase();
      for (let i = text.indexOf(q); i !== -1 && hits.length < 200; i = text.indexOf(q, i + q.length)) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + q.length);
        hits.push(r);
      }
    }
  };

  const canHighlight = !!(window.CSS && CSS.highlights && window.Highlight);
  const clearHighlight = () => { if (canHighlight) CSS.highlights.delete('caret-find'); };

  const jump = () => {
    if (!hits.length) return;
    hitIdx = (hitIdx + 1) % hits.length;
    const r = hits[hitIdx];
    if (canHighlight) CSS.highlights.set('caret-find', new Highlight(r));
    const box = r.getBoundingClientRect();
    window.scrollTo({
      top: window.scrollY + box.top - window.innerHeight / 3,
      behavior: reduced ? 'auto' : 'smooth',
    });
  };

  const complete = () => {
    if (!window.__term || /\s/.test(buffer)) return;
    const matches = window.__term.names().filter((c) => c.startsWith(buffer.toLowerCase())).sort();
    if (matches.length === 1) buffer = matches[0] + ' ';
  };

  const reset = () => {
    buffer = '';
    hits = [];
    hitIdx = -1;
    clearHighlight();
  };

  addEventListener('keydown', (e) => {
    if (!active || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const term = document.getElementById('term');
    if (term && !term.hidden) return;
    const focus = document.activeElement;
    if (focus && (focus.matches('input, textarea, select') || focus.isContentEditable)) return;

    const k = e.key;
    if (k === 'Escape') {
      if (!buffer) return;
      reset();
    } else if (k === 'Enter') {
      if (!buffer) return;
      if (isCommand()) {
        const line = buffer.trim();
        reset();
        window.__term.exec(line);
      } else {
        jump();
      }
    } else if (k === 'Backspace') {
      if (!buffer) return;
      buffer = buffer.slice(0, -1);
      findHits();
      if (!buffer) clearHighlight();
    } else if (k === 'Tab') {
      if (!buffer) return;
      complete();
      findHits();
    } else if (k.length === 1) {
      // `~` belongs to the shell shortcut, and a leading space should still
      // scroll the page like it always did.
      if (k === '~' || (k === ' ' && !buffer)) return;
      if (buffer.length >= 40) return;
      buffer += k;
      clearHighlight();
      findHits();
    } else {
      return;
    }
    e.preventDefault();
    hint = '';
    render();
  });

  /* ---------- pointer ---------- */

  // Once per visit: the first time the mouse rests on empty space, say that
  // typing does something. Otherwise nobody would ever find out.
  let hinted = false;
  try { hinted = sessionStorage.getItem('caretHint') === '1'; } catch (e) { /* storage blocked */ }
  let restTimer = null;
  const armHint = () => {
    if (hinted) return;
    clearTimeout(restTimer);
    restTimer = setTimeout(() => {
      if (current || skip || buffer) return;
      hinted = true;
      try { sessionStorage.setItem('caretHint', '1'); } catch (e) { /* storage blocked */ }
      hint = 'type to search / run';
      render();
      setTimeout(() => { hint = ''; render(); }, 2600);
    }, 1500);
  };

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    // Offset down-right so it never sits under the pointer's hotspot.
    moveX(e.clientX + 14);
    moveY(e.clientY + 18);
    active = true;
    tag.classList.add('cursor-tag--on');
    armHint();
  }, { passive: true });

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch' || !(e.target instanceof Element)) return;
    skip = !!e.target.closest(SKIP);
    const next = skip ? null : e.target.closest(INTERACTIVE);
    if (next === current && !skip) return;
    current = next;
    render();
  });

  document.addEventListener('pointerout', (e) => {
    if (e.relatedTarget) return;
    tag.classList.remove('cursor-tag--on');
    current = null;
    render();
  });
})();
