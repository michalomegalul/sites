/* dobsinsky.xyz - terminal.js v2
   themes · snake · real neofetch · nano/vim · msg→ntfy · admin mode */

(() => {
  const API = '/api';
  const overlay = document.getElementById('term');
  const out = document.getElementById('term-out');
  const input = document.getElementById('term-in');
  const PROMPT = () => `${state.trusted ? 'michal' : 'guest'}@dobsinsky.xyz:~$`;

  const state = { trusted: false, history: [], hIdx: -1, ssh: 0, game: null, editor: null };

  /* expose hook so app.js can tell us we're trusted */
  window.__termTrusted = () => (state.trusted = true);

  /* ---------- output helpers ---------- */
  const print = (text = '', cls = '') => {
    const l = document.createElement('div');
    l.className = 'term__line ' + cls;
    l.textContent = text;
    out.appendChild(l);
    out.scrollTop = out.scrollHeight;
    return l;
  };
  const printHTML = (html) => {
    const l = document.createElement('div');
    l.className = 'term__line';
    l.innerHTML = html;
    out.appendChild(l);
    out.scrollTop = out.scrollHeight;
    return l;
  };

  /* ---------- fake fs (localStorage-backed for guests) ---------- */
  const baseFiles = {
    'about.txt':
      'Michal Dobšínský - Prague.\nJunior developer @ NIC.cz (the .cz registry).\nData analytics student @ VŠE.\nRequalifying as an electrician, because software\ncrashes are boring once you can also blow a fuse.',
    'todo.txt':
      '[ ] finish semester\n[ ] stop buying hard drives\n[x] buy another hard drive\n[ ] touch grass (blocked by: homelab)',
    '.secret': 'you found it. mail me the word "PTR" and I owe you a beer.',
  };
  const localFS = JSON.parse(localStorage.getItem('termfs') || '{}');
  const fsAll = () => ({ ...baseFiles, ...localFS });
  const fsSave = (name, content) => {
    localFS[name] = content;
    localStorage.setItem('termfs', JSON.stringify(localFS));
  };

  /* ---------- themes ---------- */
  const THEMES = ['amber', 'magma', 'mocha', 'latte', 'dracula', 'gruvbox', 'nord'];
  function setTheme(name) {
    if (name === 'amber') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = name;
    localStorage.setItem('theme', name);
    if (window.__themeChosen) window.__themeChosen();
    if (window.__repaintBg) window.__repaintBg();
  }

  /* ---------- commands ---------- */
  const cmds = {
    help() {
      const rows = [
        ['help', 'this'],
        ['whoami', 'who the server thinks you are'],
        ['neofetch', 'YOUR machine, actually'],
        ['theme <name|lucky>', '7 themes · lucky never rolls latte'],
        ['ls / cat / nano', 'poke around, edit scratch files'],
        ['vim', 'good luck'],
        ['msg <text>', 'send a message straight to my phone'],
        ['snake', 'wasd/arrows · q quits'],
        ['now', 'what I am doing right now'],
        ['projects / mail / dig / uptime', 'the cv stuff'],
        ['dig <domain> [type]', 'REAL dns lookup over DoH'],
        ['bonsai / pipes / matrix', 'terminal screensavers'],
        ['wpm', 'typing test'],
        ['slots [pay]', '5×5 · cloverpit-style · losing has consequences'],
        ['gh', 'my repos, live'],
        ['cowsay / fortune / sl', 'unix classics'],
        ['clear / exit', 'housekeeping'],
      ];
      rows.forEach(([c, d]) => print(`  ${c.padEnd(18)} ${d}`));
      if (state.trusted) {
        print('');
        print('admin:', 'term__accent');
        [['status', 'edit the NOW panel (live)'], ['pve', 'proxmox stats'], ['inbox', 'messages from visitors'], ['visitors', 'who was here'], ['tag <vid> <name> | <greeting>', 'tag a friend']].forEach(
          ([c, d]) => print(`  ${c.padEnd(18)} ${d}`, 'term__accent')
        );
      }
      print('there may be undocumented ones.', 'term__dim');
    },

    async whoami() {
      const vid = localStorage.getItem('vid') || 'unknown';
      print(`visitor id : ${vid}`);
      print(`network    : ${state.trusted ? 'TRUSTED - hello me (or someone on my LAN, hm)' : 'public internet'}`);
      const name = localStorage.getItem('fname');
      const ftheme = localStorage.getItem('ftheme');
      if (name) print(`known as   : ${name}`, 'term__accent');
      if (ftheme) print(`theme      : ${ftheme} (set by michal because he cares)`, 'term__dim');
    },

    async neofetch() {
      let gpu = null;
      try {
        const gl = document.createElement('canvas').getContext('webgl');
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        let raw = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
        const angle = raw.match(/ANGLE \((.+)\)/);
        if (angle) raw = angle[1];
        gpu = /or similar|SwiftShader|Generic|llvmpipe/i.test(raw)
          ? 'redacted - your browser lies to fingerprinters (good)'
          : raw.slice(0, 46);
      } catch {}
      const ua = navigator.userAgent;
      const os = /Windows NT 10/.test(ua) ? 'Windows 10/11' : /Linux/.test(ua) ? 'Linux (respect)' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : 'something exotic';
      const browser = /Firefox\//.test(ua) ? 'Firefox' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome-ish' : /Safari\//.test(ua) ? 'Safari' : '?';
      let batt = 'n/a';
      try {
        const b = await navigator.getBattery();
        batt = `${Math.round(b.level * 100)}%${b.charging ? ' (charging)' : ''}`;
      } catch {}
      let ip = 'api offline';
      try { ip = (await (await fetch(`${API}/ip`)).json()).ip; } catch {}
      const conn = navigator.connection
        ? `${navigator.connection.effectiveType || '?'} · ~${navigator.connection.downlink || '?'} Mbps${navigator.connection.saveData ? ' · data-saver' : ''}`
        : 'undisclosed';
      let quota = 'n/a';
      try {
        const est = await navigator.storage.estimate();
        quota = `${(est.usage / 2 ** 20).toFixed(1)} MiB used of ~${(est.quota / 2 ** 30).toFixed(0)} GiB this site may hoard`;
      } catch {}
      const dark = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      const pageUp = Math.round(performance.now() / 1000);
      const art = ['   ______________ ', '  |  __________  |', '  | |          | |', '  | |  you.exe | |', '  | |__________| |', '  |______________|', '     __|____|__   ', '    |__________|  '];
      const info = [
        `${(localStorage.getItem('vid') || 'visitor')}@your-machine`,
        '----------------------',
        `IP: ${ip}  (as my server sees you)`,
        `OS: ${os}`,
        `Browser: ${browser}`,
        navigator.connection ? `Connection: ${conn}` : null,
        `Resolution: ${screen.width}x${screen.height} @ ${devicePixelRatio}x · ${screen.colorDepth}-bit`,
        navigator.hardwareConcurrency ? `CPU threads: ${navigator.hardwareConcurrency}` : null,
        navigator.deviceMemory ? `RAM: ~${navigator.deviceMemory} GiB (browser-visible)` : null,
        gpu ? `GPU: ${gpu}` : null,
        batt !== 'n/a' ? `Battery: ${batt}` : null,
        `Touch: ${navigator.maxTouchPoints ? navigator.maxTouchPoints + '-point' : 'no'} · OS prefers ${dark} mode`,
        quota !== 'n/a' ? `Storage: ${quota}` : null,
        `Locale: ${navigator.language} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
        `Page uptime: ${pageUp}s · Theme: ${localStorage.getItem('theme') || DEFAULT_THEME}`,
      ].filter(Boolean);
      art.forEach((a, i) => print(a.padEnd(20) + (info[i] || ''), 'term__accent'));
      info.slice(art.length).forEach((l) => print(' '.repeat(20) + l, 'term__accent'));
      print('');
      print('(read by your own browser; only the IP line comes from my server - which already saw it anyway)', 'term__dim');
    },

    theme(args) {
      const t = (args[0] || '').toLowerCase();
      if (t === 'lucky') {
        // every theme has a chance. latte has exactly 0% chance. as requested.
        const pool = THEMES.filter((x) => x !== 'latte' && x !== (localStorage.getItem('theme') || DEFAULT_THEME));
        const pick = pool[(Math.random() * pool.length) | 0];
        setTheme(pick);
        print(`🎲 lucky roll: ${pick}  (latte odds: 0.000%)`, 'term__accent');
        return;
      }
      if (!THEMES.includes(t)) {
        print(`themes: ${THEMES.join(' · ')} · lucky   (current: ${localStorage.getItem('theme') || DEFAULT_THEME})`);
        return;
      }
      setTheme(t);
      print(`theme set: ${t} - the whole site, not just the shell. scroll around.`, 'term__accent');
    },
    color(args) { cmds.theme(args); },

    ls(args) {
      const all = args.includes('-a') || args.includes('-la');
      const names = Object.keys(fsAll()).filter((f) => all || !f.startsWith('.'));
      print(names.join('   '));
      if (!all) print('(there is more. you know the flag.)', 'term__dim');
    },

    cat(args) {
      const f = args[0];
      if (!f) return print('cat: missing operand');
      const fs = fsAll();
      if (fs[f]) return fs[f].split('\n').forEach((l) => print(l));
      print(`cat: ${f}: No such file or directory`);
    },

    nano(args) {
      const f = args[0];
      if (!f) return print('nano: which file? (new names are fine - saved in YOUR browser only)');
      if (f === 'now.json' || f === 'status') return cmds.status();
      openEditor(f, fsAll()[f] || '', (txt) => { fsSave(f, txt); print(`wrote ${f}${baseFiles[f] ? ' (your local copy)' : ''}`); });
    },

    vim(args) {
      print('opening vim…');
      openEditor(args[0] || 'untitled', '~\n~\n~      VIM - Vi IMproved\n~\n~      you are now trapped.\n~      type :q! to leave.\n~', null, true);
    },

    async msg(args) {
      const text = args.join(' ').trim();
      if (!text) return print('usage: msg <text> - lands on my phone via ntfy. be nice.');
      try {
        const r = await fetch(`${API}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vid: localStorage.getItem('vid'), text }),
        });
        if (r.status === 429) return print('slow down - limit is 5 messages/hour.', 'term__err');
        if (!r.ok) throw 0;
        print('delivered. if it was funny, you might get a greeting next visit.', 'term__accent');
      } catch {
        print('msg: api unreachable - use mail instead.', 'term__err');
      }
    },
    sendmessage(args) { cmds.msg(args); },

    snake() { startSnake(); },

    async now() {
      try {
        const n = await (await fetch(`${API}/now`)).json();
        Object.entries(n).forEach(([k, v]) => print(`${k.padEnd(11)}: ${v}`));
      } catch {
        print('working_on : this terminal, apparently');
      }
    },

    projects() { printHTML('see the <a href="#rec-txt">;; TXT section</a>, or github.com/michalomegalul'); },
    mail() { printHTML('dog560154@gmail.com - or scroll to <a href="#rec-mx">;; MX</a>'); },

    async uptime() {
      try {
        const d = await (await fetch(`${API}/proxmox`)).json();
        if (d.uptime) return print(`proxmox node up ${d.uptime}, ${d.lxc_running}/${d.lxc_total} containers running`);
        throw 0;
      } catch {
        print('up: long enough · load average: student, employee, electrician');
      }
    },

    cowsay(args) {
      const t = args.join(' ') || 'moo';
      print(' ' + '_'.repeat(t.length + 2));
      print(`< ${t} >`);
      print(' ' + '-'.repeat(t.length + 2));
      ['        \\   ^__^', '         \\  (oo)\\_______', '            (__)\\       )\\/\\', '                ||----w |', '                ||     ||'].forEach((l) => print(l));
    },

    fortune() {
      const f = [
        'It works on my container.',
        'DNS. It is always DNS.',
        '"dočasné řešení" - permanent since 2024.',
        'There is no cloud, just my Proxmox box.',
        'A clean desk is a sign of a full /tmp.',
        '99 little bugs in the code… 127 little bugs in the code.',
        'sudo make me a sandwich - but grounded, per ČSN 33 2000.',
      ];
      print(f[Math.floor(Math.random() * f.length)]);
    },

    sl() {
      const train = ['      ====        ________ ', '  _D _|  |_______/        \\__I_I_____===__|_', '   |(_)---  |   H\\________/ |   |        =|___ ___|', '   /     |  |   H  |  |     |   |         ||_| |_||', '  |      |  |   H  |__-------------------| [___] |', '  | ________|___H__/__|_____/[][]~\\_______|       |', '  |/ |   |-----------I_____I [][] []  D   |=======|'];
      const holder = print('', 'term__accent');
      let x = 44;
      const t = setInterval(() => {
        holder.textContent = train.map((l) => ' '.repeat(Math.max(0, x)) + l.slice(Math.max(0, -x))).join('\n');
        out.scrollTop = out.scrollHeight;
        if (--x < -70) { clearInterval(t); holder.textContent += '\n(this is why you should not typo ls)'; }
      }, 60);
    },

    echo(args) { print(args.join(' ')); },
    date() { print(new Date().toString()); },
    history() { state.history.forEach((h, i) => print(`  ${i + 1}  ${h}`)); },
    clear() { out.innerHTML = ''; },
    exit() { closeTerm(); },

    sudo(args) {
      if (args.join(' ').startsWith('rm -rf')) return cmds.rm(['-rf', '/']);
      print(`${state.trusted ? 'michal' : 'guest'} is not in the sudoers file. This incident will be reported.`);
      print('(it actually was. check visitors.log.)', 'term__dim');
    },

    rm(args) {
      if (args[0] === '-rf' && (args[1] === '/' || args[1] === '/*')) {
        const doom = ['/bin', '/boot', '/etc', '/home', '/srv', '/var', '/proc/michal'];
        let i = 0;
        const t = setInterval(() => {
          if (i < doom.length) return print(`removing ${doom[i++]} …`, 'term__err');
          clearInterval(t);
          print('');
          print('just kidding. this filesystem is read-only and so is my patience.', 'term__accent');
        }, 220);
        return;
      }
      print('rm: permission denied (good try)');
    },

    ssh() {
      state.ssh++;
      if (state.ssh === 1) return print('Permission denied (publickey).');
      if (state.ssh === 2) return print('Permission denied (publickey, also: stop it).');
      print('Connection closed by 100.64.0.1: fail2ban says hi.');
    },

    ping(args) {
      print(`PING ${args[0] || 'reality'}: 56 data bytes`);
      print('64 bytes: icmp_seq=0 ttl=42 time=0.001 ms (we are on the same machine)');
    },

    /* ---------- toys the people demanded ---------- */
    bonsai() {
      const W = 42, H = 15;
      const grid = Array.from({ length: H }, () => Array(W).fill(null));
      const put = (x, y, ch, c) => { if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = { ch, c }; };
      let tips = [{ x: W >> 1, y: H - 1, life: 11, trunk: true }];
      put(W >> 1, H - 1, '|', '#b8865a');
      runAnim((screen, stop) => {
        if (!tips.length) { stop(); print('bonsai: growth complete. very zen.', 'term__dim'); return; }
        const next = [];
        tips.forEach((t) => {
          if (t.life <= 0) {
            for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 1; dy++)
              if (Math.random() > 0.4) put(t.x + dx, t.y + dy, '&', Math.random() > 0.25 ? '#5fbf6e' : 'var(--signal)');
            return;
          }
          const lean = t.trunk ? [-1, 0, 0, 1][(Math.random() * 4) | 0] : (t.dir || 1) * (Math.random() > 0.3 ? 1 : 0);
          t.x += lean; t.y -= 1; t.life--;
          put(t.x, t.y, lean === 0 ? '|' : lean > 0 ? '\\' : '/', '#b8865a');
          next.push(t);
          if (t.trunk && t.life < 9 && Math.random() > 0.55)
            next.push({ x: t.x, y: t.y, life: 2 + ((Math.random() * 3) | 0), trunk: false, dir: Math.random() > 0.5 ? 1 : -1 });
        });
        tips = next;
        screen.innerHTML = grid.map((r) => r.map((c) => c ? `<span style="color:${c.c}">${c.ch}</span>` : ' ').join('')).join('\n') +
          '\n' + '─'.repeat(W) + '\n' + ' '.repeat((W >> 1) - 4) + '\\______/';
      }, 160);
    },

    pipes() {
      const W = 44, H = 14, COLORS = ['var(--signal)', '#5af78e', '#57c7ff', '#ff6ac1', '#f3f99d'];
      let grid, pipes, filled;
      const reset = () => {
        grid = Array.from({ length: H }, () => Array(W).fill(null));
        pipes = Array.from({ length: 3 }, () => ({ x: (Math.random() * W) | 0, y: (Math.random() * H) | 0, d: (Math.random() * 4) | 0, c: COLORS[(Math.random() * COLORS.length) | 0] }));
        filled = 0;
      };
      reset();
      const D = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      const CH = (a, b) => (a % 2 === b % 2) ? (a % 2 ? '─' : '│')
        : ((a === 0 && b === 1) || (a === 3 && b === 2)) ? '┌'
        : ((a === 0 && b === 3) || (a === 1 && b === 2)) ? '┐'
        : ((a === 2 && b === 1) || (a === 3 && b === 0)) ? '└' : '┘';
      runAnim((screen) => {
        pipes.forEach((p) => {
          const nd = Math.random() < 0.78 ? p.d : (p.d + (Math.random() > 0.5 ? 1 : 3)) % 4;
          if (!grid[p.y][p.x]) filled++;
          grid[p.y][p.x] = { ch: CH(p.d, nd), c: p.c };
          p.d = nd;
          p.x = (p.x + D[nd][0] + W) % W;
          p.y = (p.y + D[nd][1] + H) % H;
        });
        if (filled > W * H * 0.55) reset();
        screen.innerHTML = grid.map((r) => r.map((c) => c ? `<span style="color:${c.c}">${c.ch}</span>` : ' ').join('')).join('\n');
      }, 90);
    },

    matrix() {
      const W = 46, H = 14, CHARS = 'ｱｲｳｴｵｶｷｸｹｺ01ﾊﾋﾌﾍﾎZX10';
      const drops = Array.from({ length: W }, () => ({ y: -((Math.random() * H) | 0), speed: Math.random() > 0.5 ? 1 : 0.5, acc: 0 }));
      const grid = Array.from({ length: H }, () => Array(W).fill(' '));
      runAnim((screen) => {
        drops.forEach((d, x) => {
          d.acc += d.speed;
          if (d.acc >= 1) {
            d.acc = 0; d.y++;
            if (d.y >= 0 && d.y < H) grid[d.y][x] = CHARS[(Math.random() * CHARS.length) | 0];
            if (d.y - 7 >= 0 && d.y - 7 < H) grid[d.y - 7][x] = ' ';
            if (d.y - 7 > H) { d.y = -((Math.random() * 10) | 0); }
          }
        });
        screen.innerHTML = grid.map((r, y) =>
          r.map((c, x) => c === ' ' ? ' ' : `<span style="color:${drops[x].y === y ? '#d8ffd8' : '#3fae52'}">${c}</span>`).join('')
        ).join('\n');
      }, 70);
    },

    async dig(args) {
      if (!args[0]) {
        print(';; ANSWER SECTION:');
        print('dobsinsky.xyz.   300  IN  A     ask cloudflare');
        print('dobsinsky.xyz.   300  IN  MX    10 see-the-mx-section.');
        print('dobsinsky.xyz.   300  IN  TXT   "v=human1 role=dev reg=cz"');
        print('dobsinsky.xyz.   300  IN  PTR   .secret');
        print('');
        print('but this dig is real: try  dig nic.cz MX  or  dig vse.cz AAAA', 'term__dim');
        return;
      }
      const TYPES = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT', 28: 'AAAA', 33: 'SRV', 257: 'CAA' };
      const name = args[0], type = (args[1] || 'A').toUpperCase();
      print(`; <<>> dobsinsky-dig <<>> ${name} ${type}`, 'term__dim');
      try {
        const d = await (await fetch(
          `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
          { headers: { accept: 'application/dns-json' } }
        )).json();
        print(`;; status: ${['NOERROR', 'FORMERR', 'SERVFAIL', 'NXDOMAIN'][d.Status] ?? d.Status}`);
        if (d.Answer && d.Answer.length) {
          print(';; ANSWER SECTION:');
          d.Answer.forEach((a) => print(`${a.name.padEnd(30)} ${String(a.TTL).padStart(6)}  IN  ${(TYPES[a.type] || a.type + '').padEnd(6)} ${a.data}`));
        } else print(';; empty answer (no records of that type)');
        print(';; real query via 1.1.1.1 DNS-over-HTTPS, straight from your browser', 'term__dim');
      } catch { print('dig: resolver unreachable', 'term__err'); }
    },

    wpm() {
      const S = [
        'the proxmox host hums quietly while nineteen containers dream',
        'it is not a bug it is an undocumented load bearing feature',
        'always blame dns first and you will usually be right',
        'a junior developer a student and an electrician walk into a bar and they are the same person',
      ];
      state.wpm = { text: S[(Math.random() * S.length) | 0], start: null };
      print('type this, then Enter:', 'term__dim');
      print('  ' + state.wpm.text, 'term__accent');
    },

    async gh() {
      print('fetching live from api.github.com…', 'term__dim');
      try {
        let repos = JSON.parse(sessionStorage.getItem('ghrepos') || 'null');
        if (!repos) {
          repos = await (await fetch('https://api.github.com/users/michalomegalul/repos?per_page=100&sort=pushed')).json();
          if (!Array.isArray(repos)) throw 0;
          sessionStorage.setItem('ghrepos', JSON.stringify(repos.map((r) => ({ name: r.name, language: r.language, pushed_at: r.pushed_at }))));
          repos = JSON.parse(sessionStorage.getItem('ghrepos'));
        }
        repos.slice(0, 15).forEach((r) => print(`${r.name.padEnd(42)} ${(r.language || '-').padEnd(11)} ${r.pushed_at.slice(0, 10)}`));
        print(`… ${repos.length} repos total → github.com/michalomegalul`, 'term__dim');
      } catch { print('gh: rate limited or offline - github.com/michalomegalul', 'term__err'); }
    },

    tailscale() {
      if (!state.trusted) return print('tailscale: permission denied - and you would only see my toys anyway', 'term__err');
      print('fleet snapshot:', 'term__accent');
      [
        ['pve', 'linux', 'the mothership - active'],
        ['mdobsinsky-ntb', 'linux', 'notebook'],
        ['michal-pc', 'linux', 'desktop'],
        ['desktop-9mab56a', 'windows', 'the dual-boot regret'],
        ['ai-host', 'linux', 'gpu things'],
        ['zuzana-pc', 'linux', 'the better half, also on linux'],
        ['michal-tablet', 'android', ''],
        ['pixel-8-pro', 'android', 'pocket terminal'],
        ['pixel-9a', 'android', 'backup pocket terminal'],
      ].forEach(([n, os, note]) => print(`  ${n.padEnd(18)} ${os.padEnd(9)} ${note}`));
      print('(static snapshot - not live, relax)', 'term__dim');
    },
    ts(a) { cmds.tailscale(a); },

    slots(args) {
      if ((args[0] || '') === 'pay' || (args[0] || '') === 'paytable') return cmds.paytable();
      if (state.game) return print('one toy at a time.', 'term__dim');
      const SYM =    ['🍒', '🍋', '🍀', '🔔', '💰', '💎', '7️⃣'];
      const WEIGHT = [24,   22,   18,   14,   11,   7,    4];
      const VALUE =  [1,    1,    2,    3,    5,    8,    15];
      const COST = 3;
      let credits = parseInt(localStorage.getItem('slots') ?? '15', 10);
      if (credits < COST) return foreclose();
      credits -= COST;

      const roll = () => {
        let r = Math.random() * 100;
        for (let i = 0; i < SYM.length; i++) { r -= WEIGHT[i]; if (r <= 0) return i; }
        return 0;
      };
      const G = 5;
      const final = Array.from({ length: G }, () => Array.from({ length: G }, roll));

      /* paylines: rows, cols, diagonals long+short, V, Λ, zigzags = 22 lines */
      const LINES = [], LABEL = [];
      for (let r = 0; r < G; r++) { LINES.push(Array.from({ length: G }, (_, c) => [r, c])); LABEL.push('row ' + (r + 1)); }
      for (let c = 0; c < G; c++) { LINES.push(Array.from({ length: G }, (_, r) => [r, c])); LABEL.push('col ' + (c + 1)); }
      LINES.push(Array.from({ length: G }, (_, i) => [i, i])); LABEL.push('diag ↘');
      LINES.push(Array.from({ length: G }, (_, i) => [i, G - 1 - i])); LABEL.push('diag ↗');
      LINES.push([[1, 0], [2, 1], [3, 2], [4, 3]]); LABEL.push('diag ↘ low');
      LINES.push([[0, 1], [1, 2], [2, 3], [3, 4]]); LABEL.push('diag ↘ high');
      LINES.push([[3, 0], [2, 1], [1, 2], [0, 3]]); LABEL.push('diag ↗ high');
      LINES.push([[4, 1], [3, 2], [2, 3], [1, 4]]); LABEL.push('diag ↗ low');
      LINES.push([[0, 0], [1, 1], [2, 2], [1, 3], [0, 4]]); LABEL.push('V');
      LINES.push([[4, 0], [3, 1], [2, 2], [3, 3], [4, 4]]); LABEL.push('Λ');
      LINES.push([[1, 0], [2, 1], [1, 2], [2, 3], [1, 4]]); LABEL.push('zig hi');
      LINES.push([[3, 0], [2, 1], [3, 2], [2, 3], [3, 4]]); LABEL.push('zig lo');

      const screen = print('', 'term__accent');
      screen.style.lineHeight = '1.95'; // emoji are ~2ch wide; this makes the grid square
      const sub = print('', 'term__dim');
      const bar = '─'.repeat(3 * G + 1);
      let t = 0;
      state.game = setInterval(() => {
        t++;
        const view = final.map((row, r) =>
          row.map((sym, c) => (t > 8 + c * 3 ? SYM[sym] : SYM[(Math.random() * SYM.length) | 0]))
        );
        screen.textContent =
          '┌' + bar + '┐  credits: ' + credits + '\n' +
          view.map((row) => '│ ' + row.join(' ') + ' │').join('\n') +
          '\n└' + bar + '┘';
        if (t > 8 + (G - 1) * 3 + 2) {
          clearInterval(state.game); state.game = null;

          let win = 0; const hits = [];
          LINES.forEach((line, li) => {
            let best = { sym: -1, len: 0 };
            let cur = { sym: final[line[0][0]][line[0][1]], len: 1 };
            for (let i = 1; i < line.length; i++) {
              const sym = final[line[i][0]][line[i][1]];
              if (sym === cur.sym) cur.len++;
              else { if (cur.len > best.len) best = { ...cur }; cur = { sym, len: 1 }; }
            }
            if (cur.len > best.len) best = { ...cur };
            if (best.len >= 3) {
              let pay = VALUE[best.sym] * (best.len - 2);
              if (best.len === G) pay *= 3;
              win += pay;
              hits.push(`${SYM[best.sym]}×${best.len} ${LABEL[li]} +${pay}`);
            }
          });

          credits += win;
          localStorage.setItem('slots', credits);
          if (win) {
            sub.textContent = hits.join(' · ');
            print(`win +${win} · credits: ${credits}` + (win >= 30 ? '  🎉 JACKPOT' : ''), 'term__accent');
          } else {
            sub.textContent = 'no lines.';
            print(`credits: ${credits}. the house (LXC 117) always wins.`, 'term__dim');
          }
          if (credits < COST) foreclose();
          else input.focus();
        }
      }, 85);
    },

    paytable() {
      print('PAYTABLE - 5×5 · 22 paylines', 'term__accent');
      print('3+ matching in a row on a line pays value × (length - 2). full line ×3.');
      print('');
      print('lines:  5 rows ───   5 cols │││   2 diag ╲╱   4 short diag ╲╱');
      print('        V ╲╱   Λ ╱╲   zigzag hi ╱╲╱╲   zigzag lo ╲╱╲╱');
      print('');
      [['🍒 cherry', 1, 'common'], ['🍋 lemon', 1, 'common'], ['🍀 clover', 2, ''], ['🔔 bell', 3, ''], ['💰 treasure', 5, ''], ['💎 diamond', 8, 'rare'], ['7️⃣ seven', 15, 'jackpot tier']]
        .forEach(([n, v, note]) => print(`  ${String(n).padEnd(12)} ${String(v).padStart(3)}/line   ${note}`));
      print('');
      print('spin costs 3 credits. run out and the house forecloses on this website.', 'term__err');
    },

    cube() {
      if (!window.gsap) return print('cube: needs animations. your browser said no.', 'term__err');
      print('su -c "fold --form=cube /" … granted. hold on.', 'term__accent');
      setTimeout(() => {
        closeTerm();
        document.documentElement.style.perspective = '1400px';
        document.documentElement.style.overflow = 'hidden';
        gsap.timeline({
          onComplete: () => {
            gsap.set('body', { clearProps: 'all' });
            document.documentElement.style.perspective = '';
            document.documentElement.style.overflow = '';
          },
        })
          .to('body', { scale: 0.32, rotateX: 360, rotateY: 405, duration: 1.6, ease: 'power2.inOut', transformOrigin: '50% 50%' })
          .to('body', { x: '38vw', y: '-22vh', rotateY: '+=360', duration: 1.1, ease: 'power1.inOut' })
          .to('body', { x: '-38vw', y: '20vh', rotateX: '+=360', duration: 1.1, ease: 'power1.inOut' })
          .to('body', { x: 0, y: 0, scale: 1, rotateX: 720, rotateY: 1125, duration: 1.4, ease: 'back.out(1.2)' })
          .set('body', { rotateX: 0, rotateY: 0 });
      }, 600);
    },

    /* ---------- admin (trusted) ---------- */
    async status() {
      if (!state.trusted) return print('status: permission denied - public net', 'term__err');
      let current = '{}';
      try { current = JSON.stringify(await (await fetch(`${API}/now`)).json(), null, 2); } catch {}
      openEditor('now.json (LIVE)', current, async (txt) => {
        try {
          JSON.parse(txt);
          const r = await fetch(`${API}/now`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: txt });
          print(r.ok ? 'now.json updated - live immediately.' : 'save failed: ' + r.status, r.ok ? 'term__accent' : 'term__err');
          if (r.ok && window.__reloadNow) window.__reloadNow();
        } catch { print('not valid JSON, not saved.', 'term__err'); }
      });
    },

    async pve() {
      if (!state.trusted) return print('pve: permission denied', 'term__err');
      try {
        const d = await (await fetch(`${API}/proxmox`)).json();
        if (d.error) throw d.error;
        print(`CPU  ${String(d.cpu_pct).padStart(5)}%   load ${d.load} on ${d.cores} cores`);
        print(`RAM  ${String(d.mem_pct).padStart(5)}%   ${d.mem_used}/${d.mem_total} GiB`);
        d.disks.forEach((x) => print(`DISK ${String(x.pct).padStart(5)}%   ${x.name} ${x.used}/${x.total}`));
        print(`LXC  ${d.lxc_running}/${d.lxc_total} running · up ${d.uptime}`);
      } catch (e) { print('pve: ' + e, 'term__err'); }
    },

    async inbox() {
      if (!state.trusted) return print('inbox: permission denied', 'term__err');
      try {
        const ms = await (await fetch(`${API}/messages`)).json();
        if (!ms.length) return print('inbox empty. tell people about the msg command.');
        ms.forEach((m) => print(`[${m.when}] ${m.name || m.vid}: ${m.text}`));
      } catch { print('inbox: api error', 'term__err'); }
    },

    async visitors() {
      if (!state.trusted) return print('visitors: permission denied', 'term__err');
      try {
        const vs = await (await fetch(`${API}/visitors`)).json();
        vs.forEach((v) => print(`${v.vid}  ${String(v.visits).padStart(3)}×  last ${v.last_seen}  ${v.name || ''}`));
      } catch { print('visitors: api error', 'term__err'); }
    },

    async tag(args) {
      if (!state.trusted) return print('tag: permission denied', 'term__err');
      const [vid, ...rest] = args;
      const [name, greetAndTheme] = rest.join(' ').split('|').map((x) => x && x.trim());
      const [greeting, theme] = (greetAndTheme || '').split('/').map((x) => x && x.trim());
      if (!vid || !name) return print('usage: tag <vid> <name> | <greeting> / <theme>');
      try {
        await fetch(`${API}/tag`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vid, name, greeting: greeting || '', theme: theme || '' }) });
        print(`tagged ${vid} as ${name}${theme ? ' theme:' + theme : ''}`, 'term__accent');
      } catch { print('tag: api error', 'term__err'); }
    },
  };
  cmds.q = cmds.exit;

  /* ---------- foreclosure: gambling has consequences ---------- */
  function foreclose() {
    print('');
    print('credits: 0. insufficient funds. the house forecloses on your session.', 'term__err');
    const targets = [
      ['#rec-mx', ';; MX - your way of contacting me'],
      ['#rec-srv', ';; SRV'],
      ['#rec-txt', ';; TXT - everything I made'],
      ['#rec-a', ';; A - me'],
      ['.sec--hero', 'the hero. the name. everything.'],
      ['.statusbar', 'the status bar'],
    ];
    let i = 0;
    const step = () => {
      if (i < targets.length) {
        const [sel, label] = targets[i++];
        const el = document.querySelector(sel);
        print(`rm -rf ${label}`, 'term__err');
        if (el) {
          if (window.gsap) gsap.to(el, { opacity: 0, y: 60, duration: 0.45, onComplete: () => el.remove() });
          else el.remove();
        }
        setTimeout(step, 600);
      } else {
        print('rm -rf /dev/pts/0   # yes, this terminal', 'term__err');
        setTimeout(() => {
          localStorage.setItem('slots', 15); // debt forgiveness, but they must reload to learn that
          overlay.remove();
          const end = document.createElement('div');
          end.className = 'wasted';
          end.innerHTML = '<p>everything is gone.</p><p class="wasted__sub">you gambled away an entire website · debt cleared · F5 to respawn</p>';
          document.body.appendChild(end);
        }, 1100);
      }
    };
    setTimeout(step, 900);
  }

  /* ---------- editor ---------- */
  function openEditor(title, content, onSave, vimMode = false) {
    if (state.editor) return;
    const wrap = document.createElement('div');
    wrap.className = 'ted';
    wrap.innerHTML = `
      <div class="ted__bar"><span>${vimMode ? 'VIM' : 'GNU nano 7.fake'} - ${title}</span>
        <span class="ted__hint">${vimMode ? 'good luck' : '^S save · Esc cancel'}</span></div>
      <textarea class="ted__area" spellcheck="false"></textarea>`;
    out.appendChild(wrap);
    const area = wrap.querySelector('textarea');
    area.value = content;
    area.focus();
    out.scrollTop = out.scrollHeight;
    state.editor = wrap;

    const close = () => { wrap.remove(); state.editor = null; input.focus(); };
    area.addEventListener('input', () => {
      if (vimMode && area.value.includes(':q!')) { close(); print('you escaped vim. put it on your CV.'); }
    });
    area.addEventListener('keydown', (e) => {
      if (vimMode) { if (e.key === 'Escape') e.preventDefault(); return; } // not even esc helps
      if (e.key === 'Escape') { e.preventDefault(); close(); print('nano: cancelled'); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const v = area.value;
        close();
        if (onSave) onSave(v);
      }
    });
  }

  /* ---------- animation runner (q quits) ---------- */
  function runAnim(stepFn, ms) {
    if (state.game) return print('one toy at a time.', 'term__dim');
    const screen = print('', 'term__accent');
    print('q to quit', 'term__dim');
    const onKey = (e) => { if (e.key.toLowerCase() === 'q') stop(); };
    const stop = () => { clearInterval(state.game); state.game = null; removeEventListener('keydown', onKey, true); input.focus(); };
    addEventListener('keydown', onKey, true);
    state.game = setInterval(() => stepFn(screen, stop), ms);
  }

  /* ---------- snake ---------- */
  function startSnake() {
    if (state.game) return;
    const W = 26, H = 13;
    let snake = [[6, 6], [5, 6], [4, 6]], dir = [1, 0], nextDir = [1, 0], food = [14, 6], score = 0;
    const screen = print('', 'term__accent');
    print('wasd / arrows to steer · q to quit', 'term__dim');

    const draw = () => {
      const grid = Array.from({ length: H }, () => Array(W).fill(' '));
      grid[food[1]][food[0]] = '◆';
      snake.forEach(([x, y], i) => (grid[y][x] = i === 0 ? '█' : '▓'));
      screen.textContent =
        '┌' + '─'.repeat(W) + `┐ score: ${score}\n` +
        grid.map((r) => '│' + r.join('') + '│').join('\n') +
        '\n└' + '─'.repeat(W) + '┘';
      out.scrollTop = out.scrollHeight;
    };

    const tick = () => {
      dir = nextDir;
      const head = [(snake[0][0] + dir[0] + W) % W, (snake[0][1] + dir[1] + H) % H];
      if (snake.some(([x, y]) => x === head[0] && y === head[1])) {
        stop();
        print(`game over - score ${score}.` + (score > 9 ? ' respectable.' : ' the ◆ does not bite.'), 'term__err');
        return;
      }
      snake.unshift(head);
      if (head[0] === food[0] && head[1] === food[1]) {
        score++;
        do { food = [Math.floor(Math.random() * W), Math.floor(Math.random() * H)]; }
        while (snake.some(([x, y]) => x === food[0] && y === food[1]));
      } else snake.pop();
      draw();
    };

    const keys = { arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0] };
    const onKey = (e) => {
      const k = e.key.toLowerCase();
      if (k === 'q') { stop(); print('snake: quit. coward.', 'term__dim'); return; }
      const d = keys[k];
      if (d) { e.preventDefault(); if (d[0] !== -dir[0] || d[1] !== -dir[1]) nextDir = d; }
    };
    const stop = () => { clearInterval(state.game); state.game = null; removeEventListener('keydown', onKey, true); input.focus(); };
    addEventListener('keydown', onKey, true);
    draw();
    state.game = setInterval(tick, 130);
  }

  /* ---------- run loop ---------- */
  async function run(raw) {
    print(`${PROMPT()} ${raw}`, 'term__prompt');
    const trimmed = raw.trim();
    if (!trimmed) return;
    state.history.push(trimmed);
    state.hIdx = state.history.length;
    const tokens = (trimmed.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((t) => t.replace(/^['"]|['"]$/g, ''));
    const [cmd, ...args] = tokens;
    const fn = cmds[cmd.toLowerCase()];
    if (fn) return fn(args);
    print(`${cmd}: command not found - try 'help'`);
  }

  /* ---------- open/close ---------- */
  function openTerm() {
    document.body.classList.add('term-open');
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('term--open'));
    if (!out.dataset.booted) {
      out.dataset.booted = '1';
      print('dobsinsky.xyz pseudo-shell - unauthenticated session', 'term__dim');
      print("type 'help'. everything you do is logged. probably.", 'term__dim');
      print('');
    }
    input.focus();
  }
  function closeTerm() {
    document.body.classList.remove('term-open');
    overlay.classList.remove('term--open');
    setTimeout(() => (overlay.hidden = true), 250);
  }

  document.getElementById('term-open').addEventListener('click', openTerm);
  document.getElementById('term-close').addEventListener('click', closeTerm);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeTerm(); });

  /* Tab completion, the way a shell actually does it.
   *
   * The old version only rewrote the input when there was exactly one match, so
   * typing `s` and pressing Tab printed "snake ssh sudo sl slots" and left the
   * line untouched — which reads as broken. Now it always fills in as far as the
   * candidates agree, and only lists them when it cannot get further. Pressing
   * Tab again after that does nothing new, same as bash. */
  function commonPrefix(list) {
    if (!list.length) return '';
    let p = list[0];
    for (const s of list.slice(1)) {
      let i = 0;
      while (i < p.length && i < s.length && p[i] === s[i]) i++;
      p = p.slice(0, i);
      if (!p) break;
    }
    return p;
  }

  // Which words a given command completes to, beyond the command name itself.
  function argCandidates(cmd) {
    if (['cat', 'nano', 'vim'].includes(cmd)) return Object.keys(fsAll());
    if (['theme', 'color'].includes(cmd)) return THEMES.concat('lucky');
    if (cmd === 'tailscale' || cmd === 'ts') return ['status', 'ip', 'netcheck'];
    return null;
  }

  function complete() {
    const value = input.value;
    // A trailing space means "start a new word", so it must not be collapsed.
    const parts = value.split(/\s+/);
    const atNewWord = /\s$/.test(value);
    const frag = atNewWord ? '' : (parts.at(-1) || '');
    const first = (parts[0] || '').toLowerCase();

    const pool = (parts.length > 1 || atNewWord)
      ? argCandidates(first)
      : Object.keys(cmds);
    if (!pool) return;

    const hits = pool.filter((c) => c.startsWith(frag.toLowerCase())).sort();
    if (!hits.length) return;

    const head = atNewWord ? parts.filter(Boolean) : parts.slice(0, -1);
    const prefix = commonPrefix(hits);

    if (hits.length === 1) {
      input.value = head.concat(hits[0]).join(' ') + ' ';
    } else {
      if (prefix.length > frag.length) input.value = head.concat(prefix).join(' ');
      print(hits.join('   '), 'term__dim');
    }
  }

  addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
    const openCombo = (e.key === '~' && !typing) || (e.ctrlKey && e.altKey && e.key.toLowerCase() === 't');
    if (openCombo && overlay.hidden) { e.preventDefault(); openTerm(); }
    else if (e.key === 'Escape' && !overlay.hidden && !state.editor && !state.game) closeTerm();
  });

  input.addEventListener('keydown', (e) => {
    if (state.game) return; // game owns the keyboard
    if (state.wpm && !state.wpm.start && e.key.length === 1) state.wpm.start = performance.now();
    if (e.key === 'Enter') {
      if (state.wpm) {
        const typed = input.value; input.value = '';
        const secs = (performance.now() - state.wpm.start) / 1000;
        const target = state.wpm.text;
        let ok = 0;
        for (let i = 0; i < Math.min(typed.length, target.length); i++) if (typed[i] === target[i]) ok++;
        const acc = Math.round((ok / target.length) * 100);
        const wpm = Math.round((typed.length / 5) / (secs / 60));
        print(`${PROMPT()} ${typed}`, 'term__prompt');
        print(`${wpm} wpm · ${acc}% accuracy · ${secs.toFixed(1)}s` + (wpm > 80 ? ' - mechanical keyboard detected' : wpm < 25 ? ' - phone, right?' : ''), 'term__accent');
        state.wpm = null;
        return;
      }
      run(input.value); input.value = '';
    }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (state.hIdx > 0) input.value = state.history[--state.hIdx] || ''; }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (state.hIdx < state.history.length) input.value = state.history[++state.hIdx] || ''; }
    else if (e.key === 'Tab') {
      e.preventDefault();
      complete();
    }
  });
})();
