/* dobsinsky.dev - cursor.js
   Viewfinder cursor for mouse devices. Touch, missing GSAP or a failure
   anywhere in here leaves the native cursor alone. */
(function () {
  if (!window.gsap || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const NS = 'http://www.w3.org/2000/svg';
  const CORNERS = [
    { d: 'M4 0H0v4h1V1h3V0Z', dir: [1, 1] },
    { d: 'M28 1V0h4v4h-1V1h-3Z', dir: [-1, 1] },
    { d: 'M28 31h3v-3h1v4h-4v-1Z', dir: [-1, -1] },
    { d: 'M1 28v3h3v1H0v-4h1Z', dir: [1, -1] },
  ];
  const INTERACTIVE = 'a[href], button, [role="button"], summary, select, label, input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"]';
  const NATIVE = '#term, textarea, input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"])';

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', '32');
  svg.setAttribute('height', '32');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('cursor');
  const groups = CORNERS.map((c) => {
    const g = document.createElementNS(NS, 'g');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', c.d);
    g.appendChild(p);
    svg.appendChild(g);
    return g;
  });
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('cx', '16');
  dot.setAttribute('cy', '16');
  dot.setAttribute('r', '2');
  svg.appendChild(dot);

  gsap.set(svg, { xPercent: -50, yPercent: -50, opacity: 0 });
  document.body.appendChild(svg);

  let moveX = null;
  let moveY = null;
  let ready = false;   // intro finished, lag follow allowed
  let started = false; // first pointer position seen
  let inside = true;
  let hovering = false;
  let native = false;
  let lx = 0;
  let ly = 0;

  const show = () => gsap.to(svg, { opacity: 1, duration: 0.2, overwrite: 'auto' });
  const hide = () => gsap.to(svg, { opacity: 0, duration: 0.2, overwrite: 'auto' });
  const visible = () => inside && !native;

  const intro = () => {
    if (reduced) { ready = true; return; }
    groups.forEach((g, i) => {
      const [dx, dy] = CORNERS[i].dir;
      gsap.set(g, { x: -dx * 120, y: -dy * 120, opacity: 0 });
      gsap.to(g, { opacity: 1, duration: 0.3, delay: Math.random() * 0.4 });
      gsap.to(g, { x: 0, y: 0, duration: 0.9, ease: 'expo.out', delay: 0.05 });
    });
    gsap.delayedCall(1.2, () => {
      moveX = gsap.quickTo(svg, 'x', { duration: 0.4 });
      moveY = gsap.quickTo(svg, 'y', { duration: 0.4 });
      moveX(lx);
      moveY(ly);
      ready = true;
    });
  };

  const setHover = (on) => {
    if (on === hovering) return;
    hovering = on;
    if (reduced) return;
    groups.forEach((g, i) => {
      const [dx, dy] = CORNERS[i].dir;
      gsap.to(g, {
        x: on ? dx * 6 : 0,
        y: on ? dy * 6 : 0,
        duration: 0.55,
        ease: 'expo.out',
        overwrite: true,
        delay: on ? 0.1 + Math.random() * 0.2 : 0,
      });
    });
  };

  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    lx = e.clientX;
    ly = e.clientY;
    if (ready && moveX) {
      moveX(lx);
      moveY(ly);
    } else {
      gsap.set(svg, { x: lx, y: ly });
    }
    if (!inside) {
      inside = true;
      if (visible()) show();
    }
    if (!started) {
      started = true;
      document.documentElement.classList.add('has-cursor');
      if (visible()) show();
      intro();
    }
  }, { passive: true });

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch' || !(e.target instanceof Element)) return;
    const n = !!e.target.closest(NATIVE);
    if (n !== native) {
      native = n;
      if (started) (visible() ? show : hide)();
    }
    setHover(!n && !!e.target.closest(INTERACTIVE));
  });

  document.addEventListener('pointerout', (e) => {
    if (e.relatedTarget) return;
    inside = false;
    hide();
    setHover(false);
  });
})();
