/* dobsinsky.xyz - app.js
   Everything degrades gracefully: if /api is unreachable (e.g. previewing
   the file locally), demo data is shown and trusted mode stays off. */

const API = '/api';
const $ = (s) => document.querySelector(s);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------- visitor id ---------------- */
function visitorId() {
  let v = localStorage.getItem('vid');
  if (!v) {
    v = (crypto.randomUUID ? crypto.randomUUID() : 'v-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).slice(0, 13);
    localStorage.setItem('vid', v);
  }
  return v;
}
const VID = visitorId();
$('#footer-vid').textContent = `(you are ${VID})`;

/* ---------------- clock + footer ---------------- */
const t0 = performance.now();
setInterval(() => {
  $('#clock').textContent = new Date().toLocaleTimeString('cs-CZ');
}, 1000);
$('#footer-date').textContent = new Date().toUTCString();
addEventListener('load', () => {
  $('#render-time').textContent = Math.round(performance.now() - t0);
});

/* ---------------- scroll-morphing background ---------------- */
/* section colors are read live from CSS vars so themes apply instantly */
const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim();
let currentBgKey = 'ink';
/* restore the saved theme; amber is the default.
 * This used to pick a random theme on every load, which also meant a theme
 * chosen from the terminal (`theme <name>`) was overwritten on the next
 * reload. Whatever setTheme() last wrote is what comes back. */
/* `amber` is the palette baked into :root, so it is represented by the ABSENCE
   of data-theme — that is separate from which theme is the default. Changing the
   default to mocha only changes what a first-time visitor gets. terminal.js
   reads this too (top-level const in a classic script is visible to later
   scripts). */
const DEFAULT_THEME = 'mocha';

(function () {
  const THEMES = ['amber', 'magma', 'mocha', 'latte', 'dracula', 'gruvbox', 'nord'];
  let saved;
  try { saved = localStorage.getItem('theme'); } catch (e) { saved = null; }
  const theme = THEMES.includes(saved) ? saved : DEFAULT_THEME;
  if (theme === 'amber') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
})();

window.__themeChosen = () => sessionStorage.setItem('themeOverride', '1');
window.__repaintBg = () => {
  const c = cssVar(currentBgKey) || cssVar('ink');
  if (window.gsap) gsap.killTweensOf('body');
  document.body.style.backgroundColor = c; // hard set - no tween race, no grey limbo
};
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  window.__repaintBg();
  /* Alt-tabbing away froze the hero mid-tween: requestAnimationFrame stops in a
     background tab, so ScrollTrigger's scrubbed progress was left wherever it
     was and the name stayed shifted left and faded even though the page was
     scrolled to the top. Recomputing on return puts every trigger back in sync
     with the actual scroll position. */
  if (window.ScrollTrigger) ScrollTrigger.refresh();
});

if (window.gsap && !reducedMotion) {
  gsap.registerPlugin(ScrollTrigger);

  document.querySelectorAll('.sec').forEach((sec) => {
    ScrollTrigger.create({
      trigger: sec,
      start: 'top 55%',
      end: 'bottom 55%',
      onEnter: () => { currentBgKey = sec.dataset.bg; gsap.to('body', { backgroundColor: cssVar(sec.dataset.bg), duration: 0.6 }); },
      onEnterBack: () => { currentBgKey = sec.dataset.bg; gsap.to('body', { backgroundColor: cssVar(sec.dataset.bg), duration: 0.6 }); },
    });
  });

  /* hero name: rows drift apart in 3D as you scroll */
  gsap.to('[data-depth="1"]', {
    // scrub: true, not a number. Smooth scrub eases toward the target on its own
    // ticker, which is exactly the state that gets stranded when the tab is
    // backgrounded; bound directly to scroll position it cannot drift.
    scrollTrigger: { trigger: '.sec--hero', start: 'top top', end: 'bottom top', scrub: true },
    xPercent: -12, rotateY: 14, z: -120, opacity: 0.25, ease: 'none',
  });
  gsap.to('[data-depth="2"]', {
    // scrub: true, not a number. Smooth scrub eases toward the target on its own
    // ticker, which is exactly the state that gets stranded when the tab is
    // backgrounded; bound directly to scroll position it cannot drift.
    scrollTrigger: { trigger: '.sec--hero', start: 'top top', end: 'bottom top', scrub: true },
    xPercent: 10, rotateY: -10, z: -60, opacity: 0.35, ease: 'none',
  });

  /* panels & projects tip up from the page plane */
  const reveal = (els) =>
    gsap.utils.toArray(els).forEach((el) => {
      gsap.from(el, {
        scrollTrigger: { trigger: el, start: 'top 88%' },
        rotateX: -18, y: 60, opacity: 0, transformOrigin: 'top center',
        duration: 0.7, ease: 'power3.out',
        // Hand the transform back to CSS when the reveal finishes. Without this
        // GSAP leaves an inline transform on the element forever, which beats
        // the stylesheet and kills the hover tilt on every card it touched.
        clearProps: 'transform',
      });
    });
  reveal('.panel');
  /* projects are injected later - observer below handles them */
  window.__reveal = reveal;
}

/* mouse tilt on cards (kept subtle) */
/* Writes CSS custom properties instead of an inline `transform`.
 *
 * The old version assigned el.style.transform directly, which put it in a fight
 * with GSAP's reveal tween on the same element — whichever wrote last won, and
 * the snap-back on mouseleave had no easing at all. That is what made the hover
 * feel broken. CSS owns the transform now and composes it from these vars, so
 * nothing overwrites anything and the return is eased.
 *
 * Reads are batched into one rAF: pointermove fires far more often than the
 * screen refreshes, and getBoundingClientRect forces layout.
 */
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

function attachTilt(el, holo) {
  if (reducedMotion) return;
  if (holo) el.classList.add('project--holo');

  let queued = false;
  let last = null;

  const apply = () => {
    queued = false;
    if (!last) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = clamp01((last.clientX - r.left) / r.width);
    const y = clamp01((last.clientY - r.top) / r.height);
    const s = el.style;
    s.setProperty('--rx', ((0.5 - y) * 8).toFixed(2) + 'deg');
    s.setProperty('--ry', ((x - 0.5) * 11).toFixed(2) + 'deg');
    // Glare sits under the cursor; the foil slides the opposite way, which is
    // what reads as light moving across a surface rather than a sticker.
    s.setProperty('--mx', (x * 100).toFixed(1) + '%');
    s.setProperty('--my', (y * 100).toFixed(1) + '%');
    s.setProperty('--bx', (85 - x * 70).toFixed(1) + '%');
    s.setProperty('--by', (85 - y * 70).toFixed(1) + '%');
    // Unitless, for hue-rotate and conic angles. The colour shifting with
    // viewing angle is the whole point of a hologram — without it you have a
    // sticker.
    s.setProperty('--hx', (x * 100).toFixed(1));
    s.setProperty('--hy', (y * 100).toFixed(1));
  };

  el.addEventListener('pointerenter', () => el.style.setProperty('--lift', '1'));
  el.addEventListener('pointermove', (e) => {
    last = e;
    if (!queued) {
      queued = true;
      requestAnimationFrame(apply);
    }
  });
  el.addEventListener('pointerleave', () => {
    const s = el.style;
    s.setProperty('--lift', '0');
    s.setProperty('--rx', '0deg');
    s.setProperty('--ry', '0deg');
  });
}
// Not `.forEach(attachTilt)` — forEach passes the index as the second argument,
// which would land in `holo` and foil every panel after the first.
document.querySelectorAll('[data-tilt]').forEach((el) => attachTilt(el));

/* ---------------- projects ---------------- */
async function loadProjects() {
  let data;
  try {
    data = await (await fetch('projects.json')).json();
  } catch {
    data = { featured: [], archive: [] };
  }
  /* One effect per featured card so they can be compared side by side. Index 0
     is the quiz and gets the Balatro-style holographic; the rest are
     alternatives. Collapse this to a single class once one wins. */
  const FX = ['fx-holo', 'fx-foil', 'fx-poly', 'fx-crt', 'fx-glass'];

  const card = (p, archive, i) => {
    const el = document.createElement('article');
    el.className = 'project'
      + (archive ? ' project--archive' : ' project--' + FX[i % FX.length]);
    el.innerHTML = `
      <h3 class="project__name">${p.name}</h3>
      <p class="project__stack">${p.stack}</p>
      <p class="project__desc">${p.desc}</p>
      ${p.url ? `<a class="project__link" href="${p.url}" target="_blank" rel="noopener">view source →</a>` : ''}
      ${archive ? '' : '<span class="project__foil" aria-hidden="true"></span><span class="project__glare" aria-hidden="true"></span>'}
    `;
    // Foil only on featured. A page where every card shimmers says nothing about
    // which ones matter — and the archive is dug live from GitHub, so it is a
    // long list.
    attachTilt(el, !archive);
    return el;
  };
  data.featured.forEach((p, i) => $('#projects-featured').appendChild(card(p, false, i)));

  /* archive: dug live from GitHub, newest first; falls back to projects.json */
  try {
    const featuredRepos = data.featured.map((p) => (p.url || '').split('/').pop().toLowerCase());
    const repos = await (await fetch('https://api.github.com/users/michalomegalul/repos?per_page=100&sort=pushed')).json();
    if (!Array.isArray(repos)) throw 0;
    repos
      .filter((r) => !r.fork && !featuredRepos.includes(r.name.toLowerCase()))
      .slice(0, 12)
      .forEach((r) =>
        $('#projects-archive').appendChild(
          card({
            name: r.name,
            stack: [(r.language || 'misc').toUpperCase(), 'pushed ' + r.pushed_at.slice(0, 10)].join(' · '),
            desc: r.description || 'no description. it knows what it did.',
            url: r.html_url,
          }, true)
        )
      );
    $('#archive-toggle').textContent = '$ cat ./archive - dug live from github';
  } catch {
    data.archive.forEach((p) => $('#projects-archive').appendChild(card(p, true)));
  }
  if (window.__reveal) window.__reveal('#projects-featured .project');
}
loadProjects();

$('#archive-toggle').addEventListener('click', () => {
  const arc = $('#projects-archive');
  const open = arc.hidden;
  arc.hidden = !open;
  $('#archive-toggle').setAttribute('aria-expanded', String(open));
  $('#archive-toggle').textContent = open
    ? '$ rm -rf ./visibility - hide it again'
    : '$ cat ./archive - the less polished stuff';
});

/* ---------------- NOW panel ---------------- */
async function loadNow() {
  try {
    const now = await (await fetch(`${API}/now`)).json();
    $('#now-output').textContent = [
      `$ cat /proc/michal/status`,
      `working_on : ${now.working_on}`,
      `listening  : ${now.listening}`,
      `playing    : ${now.playing}`,
      `reading    : ${now.reading}`,
      `mood       : ${now.mood}`,
      `updated    : ${now.updated}`,
    ].join('\n');
  } catch {
    $('#now-output').textContent =
      `$ cat /proc/michal/status\n` +
      `working_on : this very website\n` +
      `listening  : server fans\n` +
      `playing    : ARAM, probably losing\n` +
      `mood       : caffeinated\n` +
      `updated    : (api offline - demo data)`;
  }
}
loadNow();
window.__reloadNow = loadNow;

/* last GitHub push (public API, no key needed) */
async function loadCommit() {
  try {
    const ev = await (
      await fetch('https://api.github.com/users/michalomegalul/events/public?per_page=10')
    ).json();
    const push = ev.find((e) => e.type === 'PushEvent');
    if (!push) throw 0;
    const msg = push.payload.commits.at(-1).message.split('\n')[0].slice(0, 60);
    const repo = push.repo.name.split('/')[1];
    const when = new Date(push.created_at).toLocaleDateString('cs-CZ');
    $('#last-commit').textContent = `last push → ${repo}: "${msg}" (${when})`;
  } catch {
    $('#last-commit').textContent = 'last push → unavailable';
  }
}
loadCommit();

/* ---------------- public vitals ---------------- */
const bar = (pct) => {
  const n = Math.round(pct / 10);
  return '▓'.repeat(n) + '░'.repeat(10 - n) + ' ' + String(pct).padStart(5) + '%';
};
async function loadPulse() {
  try {
    const d = await (await fetch(`${API}/pulse`)).json();
    if (d.error) throw 0;
    const lines = [
      `cpu   ${bar(d.cpu_pct)}`,
      `ram   ${bar(d.mem_pct)}`,
      ...d.disks.map((x) => `${x.name.slice(0, 5).padEnd(5)} ${bar(x.pct)}`),
      ``,
      `lxc   ${d.lxc_running}/${d.lxc_total} running · up ${d.uptime}`,
    ];
    $('#pulse-output').textContent = lines.join('\n');
  } catch {
    $('#pulse-output').textContent = [
      'cpu   ▓▓░░░░░░░░  23.0%',
      'ram   ▓▓▓▓▓▓░░░░  61.4%',
      'media ▓▓▓▓▓▓▓▓░░  84.2%',
      '',
      '(api offline - demo numbers)',
    ].join('\n');
  }
}
loadPulse();
setInterval(loadPulse, 30000);

/* ---------------- analytics: opt-in, same rule as the quiz ---------------- */
/* One GA4 property covers both sites. Nothing is requested from Google until
   the visitor clicks allow — that is why the tag is injected here rather than
   sitting in a <script> in the head. The footer says as much, so it has to
   stay true. */
const GA_ID = 'G-M93DGR0VS8';

function enableGA() {
  if (window.__gaOn || !GA_ID) return;
  window.__gaOn = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  gtag('js', new Date());
  gtag('config', GA_ID, {
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID);
  document.head.appendChild(s);
}

(function consentGate() {
  let choice = null;
  try { choice = localStorage.getItem('ga'); } catch (e) { /* private mode */ }
  if (choice === 'yes') return enableGA();
  if (choice === 'no') return;

  const bar = $('#consent');
  if (!bar) return;
  bar.hidden = false;
  const decide = (v) => {
    try { localStorage.setItem('ga', v); } catch (e) { /* ignore */ }
    bar.hidden = true;
    if (v === 'yes') enableGA();
  };
  $('#consent-yes').addEventListener('click', () => decide('yes'));
  $('#consent-no').addEventListener('click', () => decide('no'));
})();

/* ---------------- crowdsec: what the edge turned away ---------------- */
const compact = (n) =>
  n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n);

const row = (label, n) => `${label.padEnd(14)}${String(n).padStart(7)}`;

/* Fills both the slim header chip and the DEFENCE panel from one pass. The two
   halves fail independently: CrowdSec can be absent while the visit counter
   works, and vice versa, so each is reported on its own. */
async function loadDefence() {
  const [cs, vis] = await Promise.all([
    fetch(`${API}/crowdsec`).then((r) => r.json()).catch(() => ({ error: 1 })),
    fetch(`${API}/visits`).then((r) => r.json()).catch(() => ({ error: 1 })),
  ]);

  if (!cs.error) {
    const el = $('#crowdsec-stat');
    el.textContent = `⛨ ${compact(cs.blocked_now)} BLOCKED · ${compact(cs.events_7d)}/7D`;
    el.title =
      `${cs.blocked_now} IPs currently blocked by CrowdSec\n` +
      `${cs.alerts_24h} alerts in the last 24h, ${cs.alerts_7d} in the last 7 days\n` +
      `${cs.events_7d} malicious requests turned away this week`;
    el.hidden = false;
    $('#crowdsec-sep').hidden = false;
  }
  /* Header chip stays hidden when CrowdSec is unreachable. A defence counter
     showing an invented number is worse than no counter — unlike VITALS, this
     one gets no demo fallback. */

  const lines = ['crowdsec  · community blocklist'];
  lines.push(
    ...(cs.error
      ? ['  (not reporting)']
      : [
          row('  blocked now', cs.blocked_now),
          row('  alerts 24h', cs.alerts_24h),
          row('  alerts 7d', cs.alerts_7d),
          row('  requests 7d', cs.events_7d),
        ])
  );
  lines.push('', 'nginx     · 30 req/min per ip on /api/');
  lines.push('cloudflare· bot fight mode + waf');
  lines.push('', 'visitors  · first-party, no third party');
  lines.push(
    ...(vis.error
      ? ['  (not reporting)']
      : [
          row('  people', vis.people),
          row('  visits', vis.visits),
          row('  active 7d', vis.people_7d),
        ])
  );
  $('#defence-output').textContent = lines.join('\n');
}
loadDefence();
setInterval(loadDefence, 120000);

/* ---------------- steam: latest game ---------------- */
async function loadSteam() {
  try {
    const d = await (await fetch(`${API}/steam`)).json();
    if (!d.games || !d.games.length) throw 0;
    const g = d.games[0];
    $('#steam-now').textContent = `▶ currently grinding: ${g.name}` + (g.hours_2w ? ` - ${g.hours_2w}h in the last two weeks` : '');
    $('#steam-now').hidden = false;
  } catch { /* stays hidden */ }
}
loadSteam();

/* ---------------- trusted mode + friend greeting ---------------- */
async function whoami() {
  try {
    const res = await fetch(`${API}/whoami`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vid: VID, ua: navigator.userAgent }),
    });
    const me = await res.json();

    if (me.name) localStorage.setItem('fname', me.name);
    if (me.theme) {
      localStorage.setItem('ftheme', me.theme);
      if (!sessionStorage.getItem('themeOverride')) {
        if (me.theme === 'amber') delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = me.theme;
        if (window.__repaintBg) window.__repaintBg();
      }
    }
    if (me.greeting) {
      const g = $('#friend-greeting');
      g.textContent = me.greeting;
      g.hidden = false;
    }

    if (me.trusted) enterTrustedMode();
  } catch {
    /* api offline - stay public */
  }
}
whoami();

function enterTrustedMode() {
  if (window.__termTrusted) window.__termTrusted();
  $('#conn-status').textContent = 'TRUSTED NET';
  $('#conn-status').dataset.state = 'trusted';
  $('#rec-srv').hidden = false;
  $('#nav-srv').hidden = false;
  // On the LAN the quiz link goes to the internal listener, which serves the
  // same chooser plus the admin block. IP:port rather than quiz.internal, since
  // that name needs a DNS record that does not exist. Over the tunnel this
  // address is unreachable, which is why the public link is the default.
  $('#nav-quiz').href = 'http://192.168.4.37:8081/';
  $('#nav-quiz').title = 'chooser + dashboard + editor (LAN only)';
  if (window.ScrollTrigger) ScrollTrigger.refresh();
  loadPve();
  loadServices();
  loadVisitors();
  setInterval(loadPve, 15000);
}

/* ---------------- proxmox stats ---------------- */
async function loadPve() {
  try {
    const d = await (await fetch(`${API}/proxmox`)).json();
    const box = $('#pve-stats');
    box.innerHTML = '';
    const stat = (label, value, pct, sub) => {
      const warn = pct > 85 ? ' class="warn"' : '';
      box.insertAdjacentHTML(
        'beforeend',
        `<div class="stat">
          <p class="stat__label">${label}</p>
          <p class="stat__value">${value}</p>
          <div class="stat__bar"><i${warn} style="width:${pct}%"></i></div>
          <p class="stat__sub">${sub}</p>
        </div>`
      );
    };
    stat('CPU', d.cpu_pct + '%', d.cpu_pct, `${d.cores} cores · load ${d.load}`);
    stat('RAM', d.mem_pct + '%', d.mem_pct, `${d.mem_used} / ${d.mem_total} GiB`);
    d.disks.forEach((disk) => stat('DISK ' + disk.name, disk.pct + '%', disk.pct, `${disk.used} / ${disk.total}`));
    stat('LXC', `${d.lxc_running}/${d.lxc_total}`, (d.lxc_running / d.lxc_total) * 100, `uptime ${d.uptime}`);
  } catch {
    $('#pve-stats').innerHTML = '<p class="dig-line">;; proxmox api unreachable</p>';
  }
}

/* ---------------- service links ---------------- */
async function loadServices() {
  try {
    const svcs = await (await fetch(`${API}/services`)).json();
    $('#service-links').innerHTML = svcs
      .map((s) => `<a class="svc" href="${s.url}"><span>${s.name}</span><small>${s.note || ''}</small></a>`)
      .join('');
  } catch {}
}

/* ---------------- visitor admin (trusted only) ---------------- */
async function loadVisitors() {
  try {
    const vs = await (await fetch(`${API}/visitors`)).json();
    $('#visitors-list').innerHTML = vs
      .map(
        (v) => `
      <div class="visitor" data-vid="${v.vid}">
        <span class="visitor__vid">${v.vid}</span>
        <span>${v.name || 'unknown'} · ${v.visits}x · last ${v.last_seen}</span>
        <small class="visitor__ua">${v.ua || ''}</small>
        <input placeholder="name" value="${v.name || ''}" data-f="name">
        <input placeholder="greeting" value="${v.greeting || ''}" data-f="greeting">
        <input placeholder="theme" value="${v.theme || ''}" data-f="theme" style="width:6rem">
        <button>tag</button>
      </div>`
      )
      .join('');

    $('#visitors-list').addEventListener('click', async (e) => {
      if (e.target.tagName !== 'BUTTON') return;
      const row = e.target.closest('.visitor');
      await fetch(`${API}/tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vid: row.dataset.vid,
          name: row.querySelector('[data-f="name"]').value,
          greeting: row.querySelector('[data-f="greeting"]').value,
          theme: (row.querySelector('[data-f="theme"]') || {}).value || '',
        }),
      });
      e.target.textContent = 'tagged ✓';
      setTimeout(() => (e.target.textContent = 'tag'), 1500);
    });
  } catch {}
}

/* ---------------- copy email ---------------- */
$('#mx-copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText('dog560154@gmail.com');
  $('#mx-copy').textContent = 'copied ✓';
  setTimeout(() => ($('#mx-copy').textContent = 'copy address'), 1500);
});
