/* Barnyard Brawl — browser client */
(() => {
  'use strict';
  const D = window.GameData;
  const C = D.C;
  const $ = (id) => document.getElementById(id);
  const hyp = Math.hypot;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const INTERP = 100; // ms the view trails the server (smooths network jitter)
  const KEYS = ['Q', 'W', 'E', 'R'];
  const TYPE_LABEL = { skillshot: 'Skillshot', cone: 'Cone', ground_aoe: 'Area (delayed)', barrage: 'Area barrage', self_aoe: 'Around you', zone: 'Ground zone', buff: 'Self buff', ally: 'Ally / self', dash: 'Dash', leap: 'Leap', blink: 'Blink', targeted: 'Targeted' };

  // ---------------- state ----------------
  const S = { ws: null, pid: 0, code: '', name: '', room: null, screen: 'home', wantLobby: false, reconnecting: false };
  let G = null; // game state

  // ---------------- emoji sprites ----------------
  const sprites = new Map();
  function sprite(ch, size) {
    const key = ch + '|' + size;
    let c = sprites.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    const pad = Math.ceil(size * 1.35);
    c.width = pad; c.height = pad;
    const x = c.getContext('2d');
    x.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(ch, pad / 2, pad / 2 + size * 0.06);
    sprites.set(key, c);
    return c;
  }
  function drawSprite(ctx, ch, size, x, y, flip) {
    const s = sprite(ch, size);
    if (flip) { ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(s, -s.width / 2, -s.height / 2); ctx.restore(); }
    else ctx.drawImage(s, x - s.width / 2, y - s.height / 2);
  }

  // ---------------- networking ----------------
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}`);
    S.ws = ws;
    ws.onopen = () => {
      if (S.reconnecting && S.code) send({ t: 'join', code: S.code, name: S.name });
      S.reconnecting = false;
      $('homeErr').textContent = '';
    };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMsg(m); };
    ws.onclose = () => {
      if (S.code) {
        S.reconnecting = true;
        showAnnounce('Connection lost — reconnecting…', '#fde68a');
        setTimeout(connect, 2000);
      } else {
        $('homeErr').textContent = 'Disconnected from server. Retrying…';
        setTimeout(connect, 2000);
      }
    };
  }
  function send(obj) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(obj)); }
  setInterval(() => send({ t: 'ping', c: performance.now() }), 2000);

  function onMsg(m) {
    switch (m.t) {
      case 'pong': { const ms = Math.round(performance.now() - m.c); $('ping').textContent = `ping ${ms} ms`; break; }
      case 'err':
        if (S.screen === 'home') $('homeErr').textContent = m.m; else $('lobbyErr').textContent = m.m;
        if (m.m.includes('in progress') || m.m.includes('No room')) { S.code = ''; }
        setTimeout(() => { $('lobbyErr').textContent = ''; }, 4000);
        break;
      case 'joined':
        S.pid = m.pid; S.code = m.code;
        history.replaceState(null, '', '?room=' + m.code);
        break;
      case 'room':
        S.room = m;
        if (m.state === 'lobby' && (S.screen === 'home' || (S.screen === 'game' && !G))) showScreen('lobby');
        if (S.screen === 'lobby') renderLobby();
        break;
      case 'start': startGame(m); break;
      case 's': if (G) onSnap(m); break;
      case 'sb': if (G) { G.sb = m.p; if (!$('board').classList.contains('hidden')) renderBoard(); } break;
      case 'end': if (G) onEnd(m); break;
    }
  }

  function showScreen(name) {
    S.screen = name;
    for (const id of ['home', 'lobby', 'game']) $(id).classList.toggle('hidden', id !== name);
    if (name === 'lobby') renderLobby();
  }

  // ---------------- home ----------------
  $('nameIn').value = localStorage.getItem('bb_name') || '';
  const qp = new URLSearchParams(location.search).get('room');
  if (qp) $('codeIn').value = qp.toUpperCase();
  function getName() {
    const n = $('nameIn').value.trim() || 'Farmer' + Math.floor(Math.random() * 900 + 100);
    localStorage.setItem('bb_name', n);
    S.name = n.slice(0, 16);
    return S.name;
  }
  $('createBtn').onclick = () => send({ t: 'create', name: getName() });
  $('joinBtn').onclick = () => {
    const code = $('codeIn').value.trim().toUpperCase();
    if (code.length !== 4) { $('homeErr').textContent = 'Enter the 4-letter room code.'; return; }
    send({ t: 'join', code, name: getName() });
  };
  $('codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinBtn').click(); });
  $('nameIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') ($('codeIn').value ? $('joinBtn') : $('createBtn')).click(); });

  // ---------------- lobby ----------------
  let hoverChamp = null;
  function myLobby() { return S.room && S.room.players.find((p) => p.pid === S.pid); }
  function renderLobby() {
    const r = S.room;
    if (!r) return;
    const me = myLobby();
    const isHost = r.host === S.pid;
    $('roomCode').textContent = r.code;
    document.querySelectorAll('.host-only').forEach((el) => el.classList.toggle('hidden', !isHost));
    $('readyBtn').classList.toggle('hidden', isHost);
    for (const tm of [0, 1]) {
      const list = r.players.filter((p) => p.team === tm);
      let html = '';
      for (let i = 0; i < 3; i++) {
        const p = list[i];
        if (!p) { html += '<div class="slot empty"><span class="em">·</span><span class="nm">Open slot</span></div>'; continue; }
        const ch = p.champ ? D.CHAMPS[p.champ] : null;
        const tags = (p.pid === r.host ? ' 👑' : '') + (p.bot ? ' 🤖' : '') + (!p.connected ? ' (away)' : '');
        const rd = p.bot || p.pid === r.host ? '' : `<span class="rd ${p.ready ? 'ok' : ''}">${p.ready ? 'Ready' : 'Not ready'}</span>`;
        const x = isHost && p.bot ? `<button class="x" data-rm="${p.pid}">✕</button>` : '';
        html += `<div class="slot ${p.pid === S.pid ? 'me' : ''}"><span class="em">${ch ? ch.icon : '❔'}</span><span class="nm">${esc(p.name)}${tags}<br><small>${ch ? esc(ch.name + ' · ' + ch.role) : 'Picking…'}</small></span>${rd}${x}</div>`;
      }
      $('team' + tm).innerHTML = html;
    }
    document.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => send({ t: 'removeBot', pid: +b.dataset.rm }); });
    document.querySelectorAll('.switch').forEach((b) => { b.classList.toggle('hidden', !me || me.team === +b.dataset.team); });
    const taken = new Set(r.players.filter((p) => me && p.team === me.team && p.pid !== S.pid && p.champ).map((p) => p.champ));
    let g = '';
    for (const id of Object.keys(D.CHAMPS)) {
      const c = D.CHAMPS[id];
      g += `<div class="champ-card ${me && me.champ === id ? 'sel' : ''} ${taken.has(id) ? 'taken' : ''}" data-c="${id}"><div class="em">${c.icon}</div><div class="nm">${c.name}</div><div class="rl">${c.role}</div></div>`;
    }
    $('champGrid').innerHTML = g;
    document.querySelectorAll('.champ-card').forEach((el) => {
      el.onclick = () => { if (!el.classList.contains('taken')) send({ t: 'champ', champ: el.dataset.c }); };
      el.onmouseenter = () => { hoverChamp = el.dataset.c; renderChampInfo(); };
      el.onmouseleave = () => { hoverChamp = null; renderChampInfo(); };
    });
    renderChampInfo();
    $('readyBtn').textContent = me && me.ready ? '✓ Ready' : 'Ready';
    $('readyBtn').classList.toggle('on', !!(me && me.ready));
  }
  function renderChampInfo() {
    const me = myLobby();
    const id = hoverChamp || (me && me.champ);
    if (!id) { $('champInfo').innerHTML = '<i>Hover a champion to see their abilities. Click to pick.</i>'; return; }
    const c = D.CHAMPS[id];
    let h = `<b style="font-size:17px">${c.icon} ${c.name}, ${c.title}</b> — ${c.role} · ${c.ranged ? 'Ranged' : 'Melee'} · HP ${c.hp} · Speed ${c.ms}<div class="abl">`;
    for (const k of KEYS) {
      const a = c.abilities[k];
      h += `<div class="ab-i"><b>${k} · ${a.icon} ${a.name}</b><small>${TYPE_LABEL[a.type]} · ${a.cd}s${k === 'R' ? ' · unlocks Lv ' + C.R_LEVEL : ''}</small><br>${a.desc}</div>`;
    }
    $('champInfo').innerHTML = h + '</div>';
  }
  $('readyBtn').onclick = () => { const me = myLobby(); send({ t: 'ready', v: !(me && me.ready) }); };
  $('startBtn').onclick = () => send({ t: 'start' });
  document.querySelectorAll('.switch').forEach((b) => { b.onclick = () => send({ t: 'team', team: +b.dataset.team }); });
  document.querySelectorAll('.addbot').forEach((b) => { b.onclick = () => send({ t: 'addBot', team: +b.dataset.team }); });
  $('leaveBtn').onclick = () => { S.code = ''; history.replaceState(null, '', location.pathname); location.reload(); };
  $('copyLink').onclick = () => {
    const link = location.origin + location.pathname + '?room=' + S.room.code;
    (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(
      () => { $('copyLink').textContent = 'Copied!'; setTimeout(() => { $('copyLink').textContent = 'Copy invite link'; }, 1500); },
      () => prompt('Share this link:', link));
  };

  // ---------------- game start ----------------
  const cv = $('cv');
  const ctx = cv.getContext('2d');
  const fogCv = document.createElement('canvas');
  const fctx = fogCv.getContext('2d');
  let VW = 0, VH = 0, DPR = 1;
  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    VW = window.innerWidth; VH = window.innerHeight;
    cv.width = VW * DPR; cv.height = VH * DPR;
    fogCv.width = Math.ceil(VW / 2); fogCv.height = Math.ceil(VH / 2);
  }
  window.addEventListener('resize', resize);
  resize();

  function startGame(m) {
    const info = new Map();
    for (const p of m.players) info.set(p.id, Object.assign({ def: D.CHAMPS[p.champ] }, p));
    G = {
      you: m.you, team: m.team, info, towerIds: m.towers, snaps: [], latest: null, offset: null,
      cam: { x: D.BASES[m.team].x, y: D.BASES[m.team].y, locked: true, zoom: 1, snap: true },
      mouse: { sx: VW / 2, sy: VH / 2, wx: 0, wy: 0, right: false, lastSend: 0 },
      held: [], cancelHeld: false, nums: [], marker: null, anim: new Map(), evq: [], projAng: new Map(), rt: null,
      sb: null, ended: false, feed: [], lastHud: 0, centerHold: false,
    };
    $('endScreen').classList.add('hidden');
    $('shop').classList.add('hidden');
    $('board').classList.add('hidden');
    $('chatlog').innerHTML = '';
    $('killfeed').innerHTML = '';
    buildAbilityBar();
    buildMinimapBg();
    Art.clearParts();
    showScreen('game');
    const me = info.get(G.you);
    if (me) {
      $('pEmoji').textContent = me.def.icon;
      showAnnounce(`You are ${me.def.name} on ${D.TEAM_NAMES[me.team]}! Capture the enemy flag 🚩`, D.TEAM_LIGHT[me.team]);
    }
  }

  function indexSnap(s) {
    s.cMap = new Map(); for (const e of s.c) s.cMap.set(e[0], e);
    s.mMap = new Map(); for (const e of s.m) s.mMap.set(e[0], e);
    s.pMap = new Map(); for (const e of s.p) s.pMap.set(e[0], e);
  }
  // visual events are replayed in sync with the (slightly delayed) interpolated world
  const VISUAL = new Set(['d', 'fx', 'cast', 'atk', 'lvl', 'crop']);
  function onSnap(s) {
    indexSnap(s);
    s.recv = performance.now();
    G.snaps.push(s);
    while (G.snaps.length > 60) G.snaps.shift();
    G.latest = s;
    if (s.me) G.me = s.me;
    for (const e of s.e) {
      if (VISUAL.has(e.e)) G.evq.push({ T: s.T, e });
      else handleEvent(e);
      if (e.e === 'kill') G.evq.push({ T: s.T, e: { e: 'puff', v: e.v } });
    }
    updateHud();
  }

  // ---------------- events ----------------
  function nameOf(id) { const i = G.info.get(id); return i ? i.name : '?'; }
  function champLabel(id) { const i = G.info.get(id); return i ? `<span class="c${i.team}">${i.def.icon} ${esc(i.name)}</span>` : '?'; }
  function showAnnounce(text, color) {
    const el = document.createElement('div');
    el.className = 'a'; el.textContent = text; el.style.color = color || '#fff';
    const box = $('announce');
    box.appendChild(el);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => el.remove(), 3200);
  }
  function feed(html) {
    const el = document.createElement('div');
    el.className = 'k'; el.innerHTML = html;
    $('killfeed').appendChild(el);
    while ($('killfeed').children.length > 6) $('killfeed').removeChild($('killfeed').firstChild);
    setTimeout(() => el.remove(), 9000);
  }
  function chatLine(html) {
    const el = document.createElement('div');
    el.innerHTML = html;
    $('chatlog').appendChild(el);
    while ($('chatlog').children.length > 8) $('chatlog').removeChild($('chatlog').firstChild);
    setTimeout(() => el.remove(), 20000);
  }
  function getAnim(id, team) {
    let a = G.anim.get(id);
    if (!a) { const f = team === 1 ? -1 : 1; a = { face: f, faceT: f, walk: Math.random() * 6, move: 0, lx: null, ly: null, pose: null, poseT0: 0, poseDur: 0.45, flash: 0, lastHp: null, faceLock: 0, leap: null }; G.anim.set(id, a); }
    return a;
  }
  function setPose(id, pose, dur, ang) {
    const info = G.info.get(id);
    const a = getAnim(id, info ? info.team : 0);
    a.pose = pose; a.poseT0 = performance.now(); a.poseDur = dur;
    if (ang !== undefined && Math.abs(Math.cos(ang)) > 0.15) { a.faceT = Math.cos(ang) > 0 ? 1 : -1; a.faceLock = a.poseT0 + dur * 1000; }
    return a;
  }
  function handleEvent(e) {
    const mine = G.team;
    switch (e.e) {
      case 'd':
        if (e.s === G.you || e.v === G.you) {
          const col = e.h ? '#4ade80' : e.v === G.you ? '#f87171' : '#fde047';
          G.nums.push({ x: e.x + (Math.random() - 0.5) * 30, y: e.y, text: (e.h ? '+' : '') + e.a, col, t0: performance.now(), big: e.a >= 150 });
        }
        break;
      case 'fx':
        if (e.k === 'hit') Art.hit(e.x, e.y, e.big);
        else if (e.k === 'boom' || e.k === 'land') Art.boom(e.c, e.x, e.y, e.r);
        else if (e.k === 'blink') for (const [x, y] of [[e.x, e.y], [e.x2, e.y2]]) Art.spawn({ k: 'ring', x, y, r0: 10, r1: 70, c: '#60a5fa', w: 8, life: 0.5, fill: '#93c5fd' });
        else if (e.k === 'buff') Art.spawn({ k: 'ring', x: e.x, y: e.y, r0: 20, r1: 60, c: '#d1fae5', w: 4, life: 0.4 });
        break;
      case 'cast': {
        const info = G.info.get(e.id);
        if (!info) break;
        const ab = info.def.abilities[e.k];
        Art.castFx(e, info.champ, ab);
        const a = setPose(e.id, Art.POSES[info.champ][e.k], 0.45, e.a);
        const dist = Math.hypot(e.tx - e.x, e.ty - e.y);
        if (ab.type === 'leap') a.leap = { t0: performance.now(), dur: Math.max(0.15, dist / ab.speed), h: 45 + dist * 0.12 };
        if (ab.type === 'dash' || ab.type === 'targeted') a.pose = null;
        break;
      }
      case 'atk': {
        const info = G.info.get(e.id);
        const u = G.curFrame && G.curFrame.units.find((x) => x.id === e.id);
        setPose(e.id, 'atk', 0.25, u ? Math.atan2(e.ty - u.y, e.tx - u.x) : undefined);
        void info;
        break;
      }
      case 'puff': { const a = G.anim.get(e.v); if (a && a.lx !== null) Art.puff(a.lx, a.ly); break; }
      case 'lvl':
        Art.spawn({ k: 'ring', x: e.x, y: e.y, r0: 20, r1: 90, c: '#fde047', w: 6, life: 0.7 });
        for (let i = 0; i < 10; i++) Art.spawn({ k: 'star', c: '#fde047', x: e.x + (Math.random() - 0.5) * 60, y: e.y, vy: -90 - Math.random() * 60, s: 6, spin: 4, life: 0.9 });
        if (e.id === G.you) { showAnnounce(`Level ${e.l}!` + (e.l === C.R_LEVEL ? ' Ultimate (R) unlocked!' : ''), '#fde047'); }
        break;
      case 'crop':
        if (e.id === G.you) G.nums.push({ x: e.x, y: e.y - 30, text: `+${e.xp} XP  +${e.g}g`, col: '#86efac', t0: performance.now(), big: true });
        for (let i = 0; i < 10; i++) Art.spawn({ k: 'feather', c: '#a3e635', x: e.x, y: e.y, vx: (Math.random() - 0.5) * 200, vy: -100 - Math.random() * 100, g: 300, spin: 6, s: 6, life: 0.7 });
        break;
      case 'kill': {
        const kt = e.kt;
        const killer = e.k ? champLabel(e.k) : `<span class="c${kt === 2 ? 2 : kt}">${esc(e.kn)}</span>`;
        feed(`${killer} ⚔️ ${champLabel(e.v)}`);
        if (e.v === G.you) showAnnounce(`You were slain by ${e.kn}`, '#f87171');
        else if (e.k === G.you) showAnnounce(`You slew ${nameOf(e.v)}!`, '#fde047');
        break;
      }
      case 'flag': {
        const ours = e.ft === mine;
        const who = e.by ? nameOf(e.by) : '';
        if (e.a === 'taken') showAnnounce(ours ? `⚠️ Your flag was taken by ${who}!` : `🚩 ${who} grabbed the enemy flag! Bring it home!`, ours ? '#f87171' : '#86efac');
        if (e.a === 'dropped') showAnnounce(ours ? '🚩 Your flag was dropped — touch it to return it!' : '🚩 The enemy flag was dropped — pick it up!', '#fde68a');
        if (e.a === 'returned') showAnnounce(ours ? `✅ ${who} returned your flag.` : 'The enemy returned their flag.', ours ? '#86efac' : '#fca5a5');
        if (e.a === 'reset') showAnnounce(ours ? 'Your flag returned to base.' : 'The enemy flag returned to their base.', '#e5e7eb');
        if (e.a === 'captured') showAnnounce(ours ? `💥 The enemy captured your flag!` : `🎉 CAPTURE! ${who} scored for your team!`, ours ? '#f87171' : '#fde047');
        feed(`🚩 ${e.by ? champLabel(e.by) : ''} <span>${e.a}</span> <span class="c${e.ft}">${D.TEAM_NAMES[e.ft]} flag</span>`);
        break;
      }
      case 'needflag': if (e.id === G.you) showAnnounce('Your own flag must be at home to score! Get it back!', '#fde68a'); break;
      case 'msg': if (e.id === G.you) showAnnounce(e.m, '#fde68a'); break;
      case 'tower':
        showAnnounce(e.tm === mine ? `Your flag's Grain Silo was destroyed! It rebuilds in ${D.TOWER_STATS.base.rebuild / 60} min.` : 'Enemy Grain Silo destroyed — their flag is exposed!', e.tm === mine ? '#fca5a5' : '#86efac');
        break;
      case 'rebuild': showAnnounce(e.tm === mine ? 'Your Grain Silo has been rebuilt.' : 'The enemy rebuilt their Grain Silo.', '#e5e7eb'); break;
      case 'obj': {
        const def = D.CAMP_TYPES[e.k], n = D.NEUTRALS[e.k];
        showAnnounce(`${e.tm === mine ? 'Your team' : 'Enemy team'} took the ${n.icon} ${n.name}! ${def.desc}`, e.tm === mine ? '#86efac' : '#fca5a5');
        break;
      }
      case 'objspawn': { const n = D.NEUTRALS[e.k]; showAnnounce(`The ${n.icon} ${n.name} has appeared in the river!`, '#fde68a'); break; }
      case 'chat': chatLine(`${champLabel(e.id)}: ${esc(e.m)}`); break;
      case 'win': break;
    }
  }

  // ---------------- interpolation ----------------
  // A smooth render clock that trails the server by INTERP ms and gently speeds up / slows down
  // instead of jumping, so movement stays fluid even when packets arrive unevenly.
  function frameState(now, dtMs) {
    const snaps = G.snaps;
    if (!snaps.length) return null;
    const L = G.latest;
    const target = L.T + (now - L.recv) - INTERP;
    if (G.rt == null || Math.abs(G.rt - target) > 400) G.rt = target;
    else G.rt += dtMs * (1 + clamp((target - G.rt) / 250, -0.12, 0.12));
    const rt = G.rt;
    let a = snaps[0], b = snaps[0];
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].T <= rt) { a = snaps[i]; b = snaps[i + 1] || snaps[i]; break; }
    }
    const al = b === a ? 0 : clamp((rt - a.T) / (b.T - a.T), 0, 1);
    return { a, b, al, rt };
  }
  function lerpPos(prev, cur, al, xi, yi) {
    if (!prev) return [cur[xi], cur[yi]];
    const dx = cur[xi] - prev[xi], dy = cur[yi] - prev[yi];
    if (dx * dx + dy * dy > 300 * 300) return [cur[xi], cur[yi]];
    return [prev[xi] + dx * al, prev[yi] + dy * al];
  }
  // ---------------- input ----------------
  function screenToWorld(sx, sy) {
    const z = G.cam.zoom;
    return [(sx - VW / 2) / z + G.cam.x, (sy - VH / 2) / z + G.cam.y];
  }
  function updateMouseWorld() { const [x, y] = screenToWorld(G.mouse.sx, G.mouse.sy); G.mouse.wx = x; G.mouse.wy = y; }
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  $('minimap').addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('mousemove', (e) => { if (!G) return; G.mouse.sx = e.clientX; G.mouse.sy = e.clientY; });
  cv.addEventListener('mousedown', (e) => {
    if (!G) return;
    G.mouse.sx = e.clientX; G.mouse.sy = e.clientY;
    updateMouseWorld();
    if (e.button === 2) {
      G.mouse.right = true;
      clickMove(true);
    } else if (e.button === 0 && G.held.length) {
      // left click while aiming casts immediately
      castHeld(G.held[G.held.length - 1]);
    }
  });
  window.addEventListener('mouseup', (e) => { if (G && e.button === 2) G.mouse.right = false; });
  cv.addEventListener('wheel', (e) => {
    if (!G) return;
    G.cam.zoom = clamp(G.cam.zoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.6, 1.3);
    e.preventDefault();
  }, { passive: false });
  function clickMove(marker) {
    send({ t: 'move', x: Math.round(G.mouse.wx), y: Math.round(G.mouse.wy) });
    G.mouse.lastSend = performance.now();
    if (marker) {
      const tgt = hoverTarget();
      G.marker = { x: G.mouse.wx, y: G.mouse.wy, t0: performance.now(), atk: !!(tgt && tgt.enemy) };
    }
  }
  function castHeld(k) {
    G.held = G.held.filter((x) => x !== k);
    updateMouseWorld();
    send({ t: 'cast', k, x: Math.round(G.mouse.wx), y: Math.round(G.mouse.wy) });
  }
  function typing() { return document.activeElement === $('chatIn'); }
  window.addEventListener('keydown', (e) => {
    if (!G || S.screen !== 'game') return;
    if (e.key === 'Enter') {
      const ci = $('chatIn');
      if (typing()) {
        if (ci.value.trim()) send({ t: 'chat', m: ci.value.trim() });
        ci.value = ''; ci.blur(); ci.classList.add('hidden');
      } else { ci.classList.remove('hidden'); ci.focus(); }
      e.preventDefault();
      return;
    }
    if (typing()) { if (e.key === 'Escape') { $('chatIn').blur(); $('chatIn').classList.add('hidden'); } return; }
    const k = e.key.toUpperCase();
    if (KEYS.includes(k)) { if (!e.repeat && !G.held.includes(k)) G.held.push(k); e.preventDefault(); return; }
    if (e.repeat && k !== ' ') return;
    switch (k) {
      case 'S': send({ t: 'stop' }); break;
      case 'B': send({ t: 'recall' }); break;
      case 'P': toggleShop(); break;
      case 'H': $('help').classList.toggle('hidden'); renderHelp(); break;
      case 'Y': G.cam.locked = !G.cam.locked; showAnnounce(G.cam.locked ? 'Camera locked' : 'Camera unlocked (move mouse to screen edge)', '#e5e7eb'); break;
      case ' ': G.centerHold = true; e.preventDefault(); break;
      case 'TAB': $('board').classList.remove('hidden'); renderBoard(); e.preventDefault(); break;
      case 'ESCAPE': G.held = []; for (const id of ['shop', 'help', 'board']) $(id).classList.add('hidden'); break;
    }
  });
  window.addEventListener('keyup', (e) => {
    if (!G || S.screen !== 'game' || typing()) return;
    const k = e.key.toUpperCase();
    if (KEYS.includes(k) && G.held.includes(k)) castHeld(k);
    if (k === 'TAB') { $('board').classList.add('hidden'); e.preventDefault(); }
    if (k === ' ') G.centerHold = false;
  });
  window.addEventListener('blur', () => { if (G) { G.held = []; G.mouse.right = false; G.centerHold = false; } });
  $('shopBtn').onclick = () => toggleShop();
  $('recallBtn').onclick = () => send({ t: 'recall' });
  const mm = $('minimap');
  function mmToWorld(e) { const r = mm.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * D.W, ((e.clientY - r.top) / r.height) * D.H]; }
  mm.addEventListener('mousedown', (e) => {
    if (!G) return;
    const [x, y] = mmToWorld(e);
    if (e.button === 2) { send({ t: 'move', x: Math.round(x), y: Math.round(y) }); G.marker = { x, y, t0: performance.now() }; }
    else { G.cam.locked = false; G.cam.x = x; G.cam.y = y; G.mmDrag = true; }
  });
  mm.addEventListener('mousemove', (e) => { if (G && G.mmDrag) { const [x, y] = mmToWorld(e); G.cam.x = x; G.cam.y = y; } });
  window.addEventListener('mouseup', () => { if (G) G.mmDrag = false; });

  function hoverTarget() {
    const fs = G.curFrame;
    if (!fs) return null;
    const mx = G.mouse.wx, my = G.mouse.wy;
    let best = null, bd = Infinity;
    for (const u of fs.units) {
      if (u.team === G.team) continue;
      const d = hyp(u.x - mx, u.y - my);
      if (d < u.r + 28 && d < bd) { bd = d; best = u; }
    }
    if (best) return Object.assign({ enemy: true }, best);
    const cr = G.latest && G.latest.cr;
    if (cr) for (const c of D.CROPS) if (cr[c.idx] === '1' && hyp(c.x - mx, c.y - my) < 50) return { crop: c };
    return null;
  }

  // ---------------- HUD ----------------
  function myChampEntry() { return G.latest && G.latest.cMap.get(G.you); }
  function buildAbilityBar() {
    const me = G.info.get(G.you);
    let h = '';
    for (const k of KEYS) {
      const a = me.def.abilities[k];
      h += `<div class="ab" data-k="${k}"><span class="key">${k}</span>${a.icon}<div class="cdo" style="height:0"></div><div class="cdt"></div></div>`;
    }
    $('abilities').innerHTML = h;
    document.querySelectorAll('#abilities .ab').forEach((el) => {
      el.onmouseenter = () => showTip(el, abilityTip(el.dataset.k));
      el.onmouseleave = hideTip;
    });
  }
  function dmgText(spec) {
    if (!spec || !G.me) return '';
    const st = G.me.st, L = G.me.lvl - 1;
    const v = (spec.b || 0) + (spec.l || 0) * L + (spec.ad || 0) * st.ad + (spec.ap || 0) * st.ap;
    const parts = [];
    if (spec.ad) parts.push(`${Math.round(spec.ad * 100)}% AD`);
    if (spec.ap) parts.push(`${Math.round(spec.ap * 100)}% AP`);
    if (spec.hpPct) parts.push(`${spec.hpPct}% max HP`);
    return `<b>${Math.round(v)}</b>${parts.length ? ' (' + parts.join(' + ') + ')' : ''}`;
  }
  function abilityTip(k) {
    const a = G.info.get(G.you).def.abilities[k];
    let h = `<b>[${k}] ${a.icon} ${a.name}</b><br><small>${TYPE_LABEL[a.type]} · Cooldown ${a.cd}s${a.range ? ' · Range ' + a.range : ''}</small><br>${a.desc}`;
    const spec = a.dmg || (a.land && a.land.dmg) || a.tick;
    if (spec) h += `<br>Damage: ${dmgText(spec)}${a.tick ? ' per ½s' : ''}`;
    if (a.allyHeal) h += `<br>Heal: ${dmgText(a.allyHeal)}`;
    if (a.shield) h += `<br>Shield: ${dmgText(a.shield)}`;
    if (a.heal) h += `<br>Heal: ${dmgText(a.heal)}`;
    if (a.hot) h += `<br>Heal over time: ${dmgText(a.hot)}`;
    if (k === 'R') h += `<br><i>Unlocks at level ${C.R_LEVEL}</i>`;
    return h;
  }
  function showTip(el, html) {
    const t = $('tooltip');
    t.innerHTML = html; t.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    t.style.left = Math.max(6, Math.min(VW - 290, r.left)) + 'px';
    t.style.top = (r.top - t.offsetHeight - 10) + 'px';
  }
  function hideTip() { $('tooltip').classList.add('hidden'); }

  function fmtTime(s) { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  function updateHud() {
    const s = G.latest, me = s.me, ce = myChampEntry();
    if (!me) return;
    $('sc0').textContent = s.sc[0]; $('sc1').textContent = s.sc[1];
    $('timer').textContent = fmtTime(s.T / 1000) + `  ·  first to ${C.CAPTURES_TO_WIN}`;
    const fl = (tm) => {
      const f = s.f[tm];
      const label = tm === G.team ? 'Your flag' : 'Enemy flag';
      if (f[0] === 0) return `<span class="home">${label}: at home</span>`;
      if (f[0] === 1) return `<span class="taken">${label}: carried by ${esc(nameOf(f[3]))}</span>`;
      return `<span class="dropped">${label}: dropped (${f[4]}s)</span>`;
    };
    $('flagstat').innerHTML = fl(G.team) + '<br>' + fl(1 - G.team);
    // abilities
    const lvl = me.lvl;
    document.querySelectorAll('#abilities .ab').forEach((el, i) => {
      const k = KEYS[i];
      const locked = k === 'R' && lvl < C.R_LEVEL;
      const cd = me.cd[i], max = me.cdm[i] || 1;
      el.classList.toggle('locked', locked);
      el.classList.toggle('ready', !locked && cd <= 0);
      el.classList.toggle('held', G.held.includes(k));
      el.querySelector('.cdo').style.height = locked ? '0' : `${clamp(cd / max, 0, 1) * 100}%`;
      el.querySelector('.cdt').textContent = locked ? '🔒' : cd > 0 ? (cd < 1 ? cd.toFixed(1) : Math.ceil(cd)) : '';
    });
    if (ce) {
      const hp = ce[3], mhp = ce[4], sh = ce[5];
      const tot = Math.max(mhp, hp + sh);
      $('hpFill').style.width = `${(hp / tot) * 100}%`;
      $('shFill').style.left = `${(hp / tot) * 100}%`;
      $('shFill').style.width = `${(sh / tot) * 100}%`;
      $('hpTxt').textContent = `${hp} / ${mhp}` + (sh ? ` (+${sh})` : '');
      const dead = ce[7] & 1;
      $('death').classList.toggle('hidden', !dead);
      if (dead) $('death').innerHTML = `💀 Respawning in ${ce[11]}s<br><small style="font-size:15px">You can shop while dead (P)</small>`;
      const recall = ce[7] & 16, harvest = ce[10];
      const ch = $('chanbar');
      if (recall || harvest) {
        ch.classList.remove('hidden');
        ch.querySelector('.lbl').textContent = recall ? 'Recalling…' : 'Harvesting…';
        ch.querySelector('.fill').style.width = (recall ? ce[9] : harvest) + '%';
      } else ch.classList.add('hidden');
    }
    $('xpFill').style.width = lvl >= C.MAX_LEVEL ? '100%' : `${(me.xp / me.xn) * 100}%`;
    $('pLvl').textContent = lvl;
    $('gold').textContent = `💰 ${me.g}`;
    const items = me.it;
    let ih = '';
    for (let i = 0; i < 6; i++) {
      const it = items[i] && D.ITEMS_BY_ID[items[i]];
      ih += `<div class="slotI" ${it ? `data-it="${it.id}"` : ''}>${it ? it.icon : ''}</div>`;
    }
    if ($('inv').dataset.k !== items.join(',')) {
      $('inv').innerHTML = ih; $('inv').dataset.k = items.join(',');
      $('inv').querySelectorAll('[data-it]').forEach((el) => { el.onmouseenter = () => showTip(el, itemTip(D.ITEMS_BY_ID[el.dataset.it])); el.onmouseleave = hideTip; });
    }
    const st = me.st;
    $('stats').innerHTML = `⚔️ AD ${st.ad} · ✨ AP ${st.ap}<br>🛡️ Armor ${st.armor} · ⏱️ AS ${st.as}<br>👟 Speed ${st.ms} · 🎯 Range ${st.range}<br>⏳ CDR ${st.cdr}% · 🩸 LS ${st.ls}%<br>🗡️ ${scoreLine()}`;
    // objective timers
    const ob = s.ob || [];
    const names = D.CAMPS.filter((c) => D.CAMP_TYPES[c.type].reward).map((c) => D.NEUTRALS[c.type]);
    $('objtimers').innerHTML = names.map((n, i) => `${n.icon} ${n.name}: ${ob[i] ? fmtTime(ob[i]) : '<b style="color:#86efac">up</b>'}`).join('<br>');
    if (!$('shop').classList.contains('hidden')) renderShop();
  }
  function scoreLine() {
    if (!G.sb) return '0/0/0';
    const r = G.sb.find((x) => x[0] === G.you);
    return r ? `${r[2]}/${r[3]}/${r[4]} · CS ${r[5]}` : '';
  }
  function itemTip(it) {
    const st = Object.entries(it.stats).map(([k, v]) => `+${v} ${D.STAT_NAMES[k]}`).join('<br>');
    return `<b>${it.icon} ${it.name}</b> — ${it.cost}g<br>${st}${it.desc ? '<br><i>' + it.desc + '</i>' : ''}`;
  }
  function toggleShop() { $('shop').classList.toggle('hidden'); renderShop(true); }
  let shopKey = '';
  function renderShop(force) {
    if (!G.me) return;
    const me = G.me;
    const key = me.g + '|' + me.it.join(',') + '|' + me.sh;
    if (!force && key === shopKey) return;
    shopKey = key;
    let h = `<h2>🏪 Farm Supply Store <button class="small" id="shopClose" style="float:right">Close (P)</button></h2>`;
    h += `<div class="shop-note ${me.sh ? '' : 'bad'}">${me.sh ? 'Click an item to buy. Click one of your items to sell it (60% refund).' : 'Return to your base (or be dead) to shop.'}  💰 ${me.g} gold</div>`;
    h += '<div class="myitems">';
    for (let i = 0; i < 6; i++) { const it = me.it[i] && D.ITEMS_BY_ID[me.it[i]]; h += `<div class="slotI" data-sell="${i}" title="${it ? 'Sell ' + it.name : ''}">${it ? it.icon : ''}</div>`; }
    h += '</div><div class="shop-grid">';
    for (const it of D.ITEMS) {
      const can = me.sh && me.g >= it.cost && me.it.length < 6;
      const st = Object.entries(it.stats).map(([k, v]) => `+${v} ${D.STAT_NAMES[k]}`).join(', ');
      h += `<div class="item ${can ? '' : 'cant'}" data-buy="${it.id}"><span class="ic">${it.icon}</span><span class="tx"><b>${it.name}</b><br>${st}${it.desc ? '<br><i>' + it.desc + '</i>' : ''}</span><span class="cost">${it.cost}g</span></div>`;
    }
    h += '</div>';
    $('shop').innerHTML = h;
    $('shopClose').onclick = () => $('shop').classList.add('hidden');
    $('shop').querySelectorAll('[data-buy]').forEach((el) => { el.onclick = () => send({ t: 'buy', id: el.dataset.buy }); });
    $('shop').querySelectorAll('[data-sell]').forEach((el) => { el.onclick = () => { if (me.it[+el.dataset.sell]) send({ t: 'sell', slot: +el.dataset.sell }); }; });
  }
  function boardHtml(rows) {
    let h = '<table><tr><th>Player</th><th>Lvl</th><th>K / D / A</th><th>CS</th><th>Items</th><th></th></tr>';
    for (const tm of [0, 1]) {
      for (const r of rows) {
        const i = G.info.get(r[0]);
        if (!i || i.team !== tm) continue;
        h += `<tr class="r${tm} ${r[0] === G.you ? 'me' : ''}"><td>${i.def.icon} ${esc(i.name)}${r[8] ? ' 🤖' : ''}</td><td>${r[1]}</td><td>${r[2]} / ${r[3]} / ${r[4]}</td><td>${r[5]}</td><td>${r[6].map((x) => D.ITEMS_BY_ID[x].icon).join(' ')}</td><td>${r[7] ? '💀 ' + r[7] + 's' : ''}</td></tr>`;
      }
    }
    return h + '</table>';
  }
  function renderBoard() {
    if (!G.sb) return;
    const s = G.latest ? G.latest.sc : [0, 0];
    $('board').innerHTML = `<h2>🔵 ${D.TEAM_NAMES[0]} ${s[0]} — ${s[1]} ${D.TEAM_NAMES[1]} 🔴</h2>` + boardHtml(G.sb);
  }
  function renderHelp() {
    $('help').innerHTML = `<h2>How to play <button class="small" style="float:right" onclick="document.getElementById('help').classList.add('hidden')">Close</button></h2><ul>
      <li><b>Goal:</b> carry the enemy flag 🚩 to <b>your own</b> flag stand while your flag is at home. First to ${C.CAPTURES_TO_WIN} captures wins.</li>
      <li>Slain carriers drop the flag. Touch your own dropped flag to return it; it also returns alone after ${C.FLAG_RETURN}s. Carriers move ${C.FLAG_SLOW}% slower (Courier's Boots remove this), can't recall, and are always visible.</li>
      <li><b>Right-click</b> ground to move, an enemy to attack, or a ripe crop to harvest (stand still to finish).</li>
      <li><b>Q W E R</b>: hold to aim, release to cast (or left-click while holding). R unlocks at level ${C.R_LEVEL}.</li>
      <li><b>B</b> recall to base · <b>P</b> shop (in base) · <b>S</b> stop · <b>Tab</b> scoreboard · <b>Enter</b> team chat</li>
      <li><b>Space</b> center camera · <b>Y</b> lock/unlock camera · mouse wheel zoom · minimap: left-click look, right-click move</li>
      <li>Each flag is guarded by one Grain Silo. It attacks enemies in range and focuses you if you hit a champion near it. It can always be attacked, and rebuilds ${D.TOWER_STATS.base.rebuild / 60} minutes after it falls.</li>
      <li><b>Tall grass</b> 🌿: enemies can't see you inside unless they're in the same patch. Attacking from it reveals you for a moment.</li>
      <li>Jungle: 🦝 Raccoons, 🦃 Turkeys and 🐺 Coyotes give gold & XP. River bosses: 🦢 Golden Goose (team gold) and 🐂 Prize Bull (team damage buff).</li>
      <li>Crops: 🥕 Carrots, 🌽 Corn, 🌾 Wheat and the valuable 🎃 Giant Pumpkins in the river regrow over time.</li></ul>`;
  }
  function onEnd(m) {
    G.ended = true;
    const won = m.winner === G.team;
    $('endScreen').innerHTML = `<h1>${won ? '🏆 Victory!' : '🌧️ Defeat'}</h1><h2>${D.TEAM_NAMES[m.winner]} wins ${m.score[m.winner]} – ${m.score[1 - m.winner]}</h2>${boardHtml(m.board)}<br><button class="big" id="backLobby">Back to lobby</button>`;
    $('endScreen').classList.remove('hidden');
    $('backLobby').onclick = () => { G = null; showScreen('lobby'); };
  }

  // ---------------- minimap ----------------
  let mmBg = null;
  const MS = 240 / D.W;
  function buildMinimapBg() {
    mmBg = document.createElement('canvas');
    mmBg.width = 240; mmBg.height = 140;
    const m = mmBg.getContext('2d');
    m.fillStyle = '#1a2e24'; m.fillRect(0, 0, 240, 140);
    m.fillStyle = '#145566'; m.fillRect(D.RIVER.x * MS, D.RIVER.y * MS, D.RIVER.w * MS, D.RIVER.h * MS);
    m.strokeStyle = '#4a3d2c'; m.lineWidth = C.LANE_WIDTH * MS; m.lineCap = 'round'; m.lineJoin = 'round';
    for (const k in D.LANES) { m.beginPath(); D.LANES[k].forEach(([x, y], i) => (i ? m.lineTo(x * MS, y * MS) : m.moveTo(x * MS, y * MS))); m.stroke(); }
    m.fillStyle = '#0b1f17';
    for (const w of D.WALLS) m.fillRect(w.x * MS - 1, w.y * MS - 1, w.w * MS + 2, w.h * MS + 2);
    m.fillStyle = '#3f7d3a';
    for (const b of D.BRUSHES) m.fillRect(b.x * MS, b.y * MS, b.w * MS, b.h * MS);
    for (const tm of [0, 1]) { m.fillStyle = D.TEAM_COLORS[tm] + '55'; m.beginPath(); m.arc(D.BASES[tm].x * MS, D.BASES[tm].y * MS, C.BASE_R * MS, 0, 7); m.fill(); }
  }
  function drawMinimap(fs) {
    const m = mm.getContext('2d');
    m.drawImage(mmBg, 0, 0);
    const s = G.latest;
    s.tw.forEach((tw, i) => {
      const td = D.TOWERS[i];
      m.fillStyle = tw[0] > 0 ? D.TEAM_COLORS[td.team] : '#555';
      m.strokeStyle = '#000'; m.lineWidth = 1;
      m.fillRect(td.x * MS - 4, td.y * MS - 4, 8, 8); m.strokeRect(td.x * MS - 4, td.y * MS - 4, 8, 8);
    });
    for (const c of D.CROPS) if (s.cr[c.idx] === '1') { m.fillStyle = '#fde047'; m.fillRect(c.x * MS - 1, c.y * MS - 1, 2.5, 2.5); }
    for (const u of fs.units) {
      if (u.kind === 'champ') continue;
      m.fillStyle = u.team === 2 ? '#fbbf24' : D.TEAM_LIGHT[u.team];
      m.fillRect(u.x * MS - 1, u.y * MS - 1, u.big ? 4 : 2, u.big ? 4 : 2);
    }
    for (const u of fs.units) {
      if (u.kind !== 'champ' || u.dead) continue;
      m.beginPath(); m.arc(u.x * MS, u.y * MS, u.id === G.you ? 5 : 4, 0, 7);
      m.fillStyle = D.TEAM_COLORS[u.team]; m.fill();
      m.lineWidth = u.id === G.you ? 2 : 1; m.strokeStyle = u.id === G.you ? '#fde047' : '#fff'; m.stroke();
    }
    s.f.forEach((f, tm) => {
      m.fillStyle = D.TEAM_COLORS[tm]; m.strokeStyle = '#fff'; m.lineWidth = 1;
      const x = f[1] * MS, y = f[2] * MS - 4;
      m.beginPath(); m.moveTo(x, y - 4); m.lineTo(x + 7, y - 1); m.lineTo(x, y + 2); m.closePath(); m.fill(); m.stroke();
      m.beginPath(); m.moveTo(x, y - 5); m.lineTo(x, y + 7); m.stroke();
    });
    const z = G.cam.zoom;
    m.strokeStyle = '#fff'; m.lineWidth = 1;
    m.strokeRect((G.cam.x - VW / 2 / z) * MS, (G.cam.y - VH / 2 / z) * MS, (VW / z) * MS, (VH / z) * MS);
  }

  // ---------------- world rendering ----------------
  const TILE_W = 800, TILE_H = 700;
  const tiles = new Map();
  let DECOR = null;
  function getTile(ix, iy, force) {
    const key = ix + ',' + iy;
    let t = tiles.get(key);
    if (t || !force) return t || null;
    if (!DECOR) DECOR = Art.buildDecor(D);
    t = document.createElement('canvas'); t.width = TILE_W; t.height = TILE_H;
    Art.paintTile(t.getContext('2d'), D, DECOR, ix * TILE_W, iy * TILE_H, TILE_W, TILE_H);
    tiles.set(key, t);
    return t;
  }
  function warmTiles() { // paint one off-screen tile per frame so later scrolling never hitches
    for (let iy = 0; iy * TILE_H < D.H; iy++) for (let ix = 0; ix * TILE_W < D.W; ix++) if (!tiles.has(ix + ',' + iy)) { getTile(ix, iy, true); return; }
  }
  // tall grass blades
  const BLADES = D.BRUSHES.map((b) => {
    let seed = b.idx * 97 + 13; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = Math.round((b.w * b.h) / 70), out = [];
    for (let i = 0; i < n; i++) {
      const x = b.x + 6 + r() * (b.w - 12), y = b.y + 10 + r() * (b.h - 10);
      out.push([x, y, 22 + r() * 22, (r() - 0.5) * 10, r() * 6, ['#1f5a32', '#2d7340', '#3a8a4a', '#24653a'][Math.floor(r() * 4)]]);
    }
    out.sort((p, q) => p[1] - q[1]);
    return out;
  });
  const flies = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), ph: Math.random() * 6, sp: 0.3 + Math.random() * 0.7 }));
  const AURA = { cow: '#86efac', pig: '#ef4444', goat: '#fb923c', horse: '#bae6fd', bee: '#fbbf24', sheep: '#f9a8d4', chicken: '#fde68a', duck: '#7dd3fc' };

  function buildFrame(fsr) {
    const { a, b, al } = fsr;
    const units = [];
    for (const e of b.c) {
      const info = G.info.get(e[0]);
      if (!info) continue;
      const [x, y] = lerpPos(a.cMap.get(e[0]), e, al, 1, 2);
      units.push({ kind: 'champ', id: e[0], team: info.team, info, x, y, r: 30, hp: e[3], mhp: e[4], sh: e[5], lvl: e[6], bits: e[7], ang: e[8] / 100, rp: e[9], hv: e[10], dead: e[7] & 1 });
    }
    for (const e of b.m) {
      const [x, y] = lerpPos(a.mMap.get(e[0]), e, al, 3, 4);
      const def = D.MINIONS[e[1]] || D.NEUTRALS[e[1]];
      units.push({ kind: D.MINIONS[e[1]] ? 'minion' : 'neutral', id: e[0], type: e[1], def, team: e[2], x, y, r: def.r, hpPct: e[5], stun: e[6], ang: e[7] / 100, big: !!def.big });
    }
    const projs = [];
    for (const e of b.p) {
      const prev = a.pMap.get(e[0]);
      const [x, y] = lerpPos(prev, e, al, 2, 3);
      let ang = 0;
      if (prev && (prev[2] !== e[2] || prev[3] !== e[3])) ang = Math.atan2(e[3] - prev[3], e[2] - prev[2]);
      else { const o = G.projAng.get(e[0]); if (o !== undefined) ang = o; }
      G.projAng.set(e[0], ang);
      projs.push({ id: e[0], vis: e[1], x, y, team: e[4], ang });
    }
    if (G.projAng.size > 400) G.projAng.clear();
    return { units, projs, s: b };
  }

  function draw() {
    requestAnimationFrame(draw);
    if (!G || !G.latest || S.screen !== 'game') return;
    const now = performance.now();
    const dtMs = Math.min(100, now - (G.lastFrame || now));
    const dt = dtMs / 1000;
    G.lastFrame = now;
    const fsr = frameState(now, dtMs);
    if (!fsr) return;
    const fs = buildFrame(fsr);
    G.curFrame = fs;
    while (G.evq.length && G.evq[0].T <= fsr.rt) handleEvent(G.evq.shift().e);
    if (G.evq.length > 400) G.evq.splice(0, G.evq.length - 400);
    const meU = fs.units.find((u) => u.id === G.you);
    // camera
    const cam = G.cam;
    if ((cam.locked || G.centerHold) && meU) {
      if (cam.snap) { cam.x = meU.x; cam.y = meU.y; cam.snap = false; }
      const k = Math.min(1, dt * 14);
      cam.x += (meU.x - cam.x) * k; cam.y += (meU.y - cam.y) * k;
    } else if (!cam.locked) {
      const edge = 14, sp = 1300 * dt / cam.zoom;
      if (G.mouse.sx < edge) cam.x -= sp; if (G.mouse.sx > VW - edge) cam.x += sp;
      if (G.mouse.sy < edge) cam.y -= sp; if (G.mouse.sy > VH - edge) cam.y += sp;
    }
    cam.x = clamp(cam.x, 0, D.W); cam.y = clamp(cam.y, 0, D.H);
    updateMouseWorld();
    if (G.mouse.right && now - G.mouse.lastSend > 120) clickMove(false);

    const z = cam.zoom;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#0b1510'; ctx.fillRect(0, 0, VW, VH);
    ctx.setTransform(DPR * z, 0, 0, DPR * z, DPR * (VW / 2 - cam.x * z), DPR * (VH / 2 - cam.y * z));
    const view = { x0: cam.x - VW / 2 / z, y0: cam.y - VH / 2 / z, x1: cam.x + VW / 2 / z, y1: cam.y + VH / 2 / z };
    const inView = (x, y, pad = 0) => x > view.x0 - pad && x < view.x1 + pad && y > view.y0 - pad && y < view.y1 + pad;

    // ground tiles
    for (let iy = Math.max(0, Math.floor(view.y0 / TILE_H)); iy * TILE_H < Math.min(D.H, view.y1); iy++) {
      for (let ix = Math.max(0, Math.floor(view.x0 / TILE_W)); ix * TILE_W < Math.min(D.W, view.x1); ix++) {
        const t = getTile(ix, iy, true);
        ctx.drawImage(t, ix * TILE_W, iy * TILE_H);
      }
    }
    warmTiles();
    drawWater(view, now);
    drawBasesDyn(fs.s, now, inView);
    drawCrops(fs.s, now, inView);
    for (const zn of fs.s.z) if (inView(zn[2], zn[3], zn[4] + 300)) Art.zone(ctx, zn, relColor(zn[5]), now, sprite);
    drawTowerRanges(fs.s, meU);
    const list = fs.units.filter((u) => !u.dead && inView(u.x, u.y, 80));
    for (const u of list) u.sortY = u.y;
    D.TOWERS.forEach((td, i) => { if (inView(td.x, td.y, 200)) list.push({ kind: 'tower', td, tw: fs.s.tw[i], sortY: td.y + 30, x: td.x, y: td.y }); });
    list.sort((p, q) => p.sortY - q.sortY);
    for (const u of list) {
      if (u.kind === 'tower') drawTower(u.td, u.tw, now);
      else if (u.kind === 'champ') drawChampBody(u, now, dt);
      else drawCritter(u, now, dt);
    }
    drawTowerShots(fs);
    drawFlags(fs, now);
    for (const p of fs.projs) if (inView(p.x, p.y, 50)) Art.proj(ctx, p.vis, p.x, p.y, p.ang, p.team, now, sprite, D.TEAM_LIGHT[p.team]);
    Art.updateDraw(ctx, dt, sprite);
    drawBrush(fs, now, inView);
    drawAmbience(view, now, dt);
    drawFog(fs, cam, z);
    // screen-space vignette
    ctx.save(); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (!G.vig || G.vig.w !== VW || G.vig.h !== VH) {
      const g = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.45, VW / 2, VH / 2, Math.max(VW, VH) * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
      G.vig = { w: VW, h: VH, g };
    }
    ctx.fillStyle = G.vig.g; ctx.fillRect(0, 0, VW, VH);
    ctx.restore();
    // overlays above fog
    for (const u of list) {
      if (u.kind === 'tower') drawTowerBar(u.td, u.tw);
      else if (u.kind === 'champ') drawChampBar(u);
      else drawCritterBar(u);
    }
    drawIndicators(meU);
    drawMarker(now);
    drawNums(now);
    const ht = hoverTarget();
    cv.style.cursor = ht ? (ht.enemy ? 'crosshair' : 'pointer') : 'default';
    if (ht && ht.enemy) {
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.ellipse(ht.x, ht.y + 18, ht.r + 10, (ht.r + 10) * 0.45, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
    if (!G.mmNext || now > G.mmNext) { G.mmNext = now + 90; drawMinimap(fs); }
  }
  requestAnimationFrame(draw);

  function relColor(team) { return team === G.team ? '#60a5fa' : '#ef4444'; }

  function drawWater(view, now) {
    const R = D.RIVER;
    if (view.x1 < R.x || view.x0 > R.x + R.w) return;
    const t = now / 1000;
    ctx.save();
    ctx.strokeStyle = 'rgba(165,243,252,0.18)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const y = R.y - 40 + ((i * 97 + t * 40) % (R.h + 80));
      if (y < view.y0 - 20 || y > view.y1 + 20) continue;
      const x = R.x + 40 + ((i * 53) % (R.w - 80));
      ctx.beginPath(); ctx.moveTo(x - 18, y); ctx.quadraticCurveTo(x, y - 5 + Math.sin(t * 2 + i) * 3, x + 18, y); ctx.stroke();
    }
    ctx.restore();
  }
  function drawBasesDyn(s, now, inView) {
    for (const tm of [0, 1]) {
      const b = D.BASES[tm], f = D.FOUNTAINS[tm];
      if (!inView(b.x, b.y, 700)) continue;
      const pulse = 0.5 + 0.5 * Math.sin(now / 400);
      ctx.save();
      ctx.shadowColor = D.TEAM_COLORS[tm]; ctx.shadowBlur = 14;
      ctx.setLineDash([16, 12]); ctx.lineWidth = 4; ctx.strokeStyle = D.TEAM_COLORS[tm];
      ctx.globalAlpha = 0.6 + 0.3 * pulse;
      ctx.beginPath(); ctx.arc(b.x, b.y, C.CAPTURE_R, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
      ctx.fillStyle = '#44403c'; ctx.beginPath(); ctx.ellipse(b.x, b.y + 10, 40, 22, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#1c1917'; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = D.TEAM_COLORS[tm] + '88'; ctx.beginPath(); ctx.ellipse(b.x, b.y + 8, 28, 14, 0, 0, 7); ctx.fill();
      if (tm === G.team) {
        ctx.font = 'bold 15px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#e0f2fe';
        ctx.fillText('CAPTURE HERE', b.x, b.y + C.CAPTURE_R + 22);
      }
      // fountain sparkle
      for (let i = 0; i < 3; i++) {
        const a = now / 700 + i * 2.1;
        ctx.fillStyle = D.TEAM_LIGHT[tm]; ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * 26, f.y + Math.sin(a) * 16 - 6, 3, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      }
    }
  }
  function drawCrops(s, now, inView) {
    for (const c of D.CROPS) {
      if (!inView(c.x, c.y, 60)) continue;
      const ripe = s.cr[c.idx] === '1';
      ctx.fillStyle = '#2a1d12'; ctx.beginPath(); ctx.ellipse(c.x, c.y + 10, 46, 26, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#3d2a1a'; ctx.lineWidth = 3;
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(c.x - 36, c.y + 10 + i * 10); ctx.lineTo(c.x + 36, c.y + 10 + i * 10); ctx.stroke(); }
      if (ripe) {
        const bob = Math.sin(now / 400 + c.idx) * 2;
        const g = ctx.createRadialGradient(c.x, c.y, 5, c.x, c.y, 60);
        g.addColorStop(0, `rgba(253,224,71,${0.25 + 0.1 * Math.sin(now / 300 + c.idx)})`); g.addColorStop(1, 'rgba(253,224,71,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, 60, 0, 7); ctx.fill();
        const ic = D.CROP_TYPES[c.type].icon;
        drawSprite(ctx, ic, 26, c.x - 18, c.y + bob);
        drawSprite(ctx, ic, 30, c.x + 12, c.y - 4 + bob);
      } else {
        drawSprite(ctx, '🌱', 16, c.x - 14, c.y + 8); drawSprite(ctx, '🌱', 16, c.x + 14, c.y + 6);
      }
    }
  }
  function myTeamBrushes(fs) {
    const set = new Set();
    for (const u of fs.units) if (u.team === G.team && !u.dead) { const b = D.brushAt(u.x, u.y); if (b >= 0) set.add(b); }
    return set;
  }
  function drawBrush(fs, now, inView) {
    const occ = myTeamBrushes(fs);
    G.occ = occ;
    const t = now / 1000;
    for (const b of D.BRUSHES) {
      if (!inView(b.x + b.w / 2, b.y + b.h / 2, Math.max(b.w, b.h))) continue;
      const seeIn = occ.has(b.idx);
      ctx.save();
      ctx.globalAlpha = seeIn ? 0.4 : 0.97;
      ctx.fillStyle = 'rgba(10,30,18,0.6)';
      ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2 + 6, b.w / 2 + 6, b.h / 2 + 4, 0, 0, 7); ctx.fill();
      for (const [x, y, h, lean, ph, col] of BLADES[b.idx]) {
        const sw = Math.sin(t * 1.6 + ph + x * 0.01) * 4 + lean;
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.quadraticCurveTo(x + sw * 0.4, y - h * 0.6, x + sw, y - h); ctx.quadraticCurveTo(x + sw * 0.3, y - h * 0.5, x + 4, y); ctx.fill();
      }
      ctx.restore();
    }
  }
  function drawAmbience(view, now, dt) {
    const t = now / 1000;
    // drifting mist
    ctx.save();
    for (let i = 0; i < 6; i++) {
      const mx = ((i * 900 + t * 18 * (i % 2 ? 1 : -1)) % (D.W + 800) + D.W + 800) % (D.W + 800) - 400;
      const my = 300 + (i * 460) % (D.H - 600);
      if (mx < view.x0 - 500 || mx > view.x1 + 500 || my < view.y0 - 400 || my > view.y1 + 400) continue;
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, 420);
      g.addColorStop(0, 'rgba(180,210,230,0.07)'); g.addColorStop(1, 'rgba(180,210,230,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(mx, my, 520, 300, 0, 0, 7); ctx.fill();
    }
    // fireflies (live in view space)
    const w = view.x1 - view.x0, h = view.y1 - view.y0;
    for (const f of flies) {
      f.x += Math.cos(t * f.sp + f.ph) * 0.0006; f.y += Math.sin(t * f.sp * 1.3 + f.ph) * 0.0006;
      const x = view.x0 + (((f.x % 1) + 1) % 1) * w, y = view.y0 + (((f.y % 1) + 1) % 1) * h;
      const a = 0.35 + 0.35 * Math.sin(t * 3 + f.ph * 5);
      ctx.fillStyle = `rgba(217,249,157,${a})`; ctx.shadowColor = '#d9f99d'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.fill();
    }
    ctx.restore();
    void dt;
  }

  function drawTowerRanges(s, meU) {
    if (!meU || meU.dead) return;
    D.TOWERS.forEach((td, i) => {
      if (td.team === G.team || s.tw[i][0] <= 0) return;
      const st = D.TOWER_STATS.base;
      const d = Math.hypot(meU.x - td.x, meU.y - td.y);
      if (d > st.range + 350) return;
      const targetingMe = s.tw[i][1] === G.you;
      ctx.strokeStyle = targetingMe ? '#ef4444' : 'rgba(239,68,68,0.45)'; ctx.lineWidth = targetingMe ? 4 : 2;
      ctx.setLineDash([16, 12]); ctx.beginPath(); ctx.arc(td.x, td.y, st.range, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    });
  }
  function drawTower(td, tw, now) {
    const alive = tw[0] > 0, x = td.x, y = td.y;
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(x + 10, y + 34, 56, 22, 0, 0, 7); ctx.fill();
    if (!alive) {
      ctx.fillStyle = '#3f3f46';
      for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.arc(x + Math.cos(i * 1.3) * 30, y + 16 + Math.sin(i * 1.7) * 14, 14 - i, 0, 7); ctx.fill(); }
      if (tw[3] > 0) { ctx.font = 'bold 15px "Trebuchet MS", sans-serif'; ctx.fillStyle = '#e5e7eb'; ctx.textAlign = 'center'; ctx.fillText(`rebuilding ${tw[3]}s`, x, y - 20); }
      return;
    }
    const col = D.TEAM_COLORS[td.team], dark = D.TEAM_DARK[td.team];
    const behind = G.curFrame.units.some((u) => !u.dead && (u.kind === 'champ') && Math.abs(u.x - x) < 70 && u.y < y + 25 && u.y > y - 150);
    ctx.save();
    if (behind) ctx.globalAlpha = 0.45;
    const g = ctx.createLinearGradient(x - 40, 0, x + 40, 0);
    g.addColorStop(0, '#44403c'); g.addColorStop(0.45, '#78716c'); g.addColorStop(1, '#292524');
    ctx.fillStyle = g; Art.rr(ctx, x - 38, y - 70, 76, 104, 10); ctx.fill(); ctx.strokeStyle = '#0c0a09'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = dark; ctx.fillRect(x - 38, y - 30, 76, 12); ctx.fillRect(x - 38, y + 8, 76, 10);
    ctx.fillStyle = col; ctx.fillRect(x - 38, y - 27, 76, 4);
    ctx.fillStyle = '#57534e'; ctx.beginPath(); ctx.ellipse(x, y - 70, 38, 18, 0, Math.PI, 0); ctx.fill(); ctx.stroke();
    const p = 0.6 + 0.4 * Math.sin(now / 300);
    ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 24 * p;
    ctx.fillStyle = D.TEAM_LIGHT[td.team]; ctx.beginPath(); ctx.arc(x, y - 92, 13, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x - 4, y - 96, 4, 0, 7); ctx.fill();
    ctx.restore();
    ctx.restore();
  }
  function drawTowerBar(td, tw) {
    if (tw[0] <= 0) return;
    bar(td.x - 50, td.y - 125, 100, 9, tw[0] / D.TOWER_STATS.base.hp, td.team === G.team ? '#3b82f6' : '#ef4444');
  }
  function bar(x, y, w, h, pct, col, sh) {
    ctx.fillStyle = '#000'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#333'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = col; ctx.fillRect(x, y, w * clamp(pct, 0, 1), h);
    if (sh) { ctx.fillStyle = '#f3f4f6'; ctx.fillRect(x + w * clamp(pct, 0, 1), y, w * sh, h); }
  }
  function drawTowerShots(fs) {
    const s = fs.s;
    D.TOWERS.forEach((td, i) => {
      const tgt = s.tw[i][1];
      if (!tgt || s.tw[i][0] <= 0) return;
      const u = fs.units.find((x) => x.id === tgt);
      if (!u || u.kind !== 'champ') return;
      ctx.strokeStyle = tgt === G.you ? 'rgba(239,68,68,0.9)' : 'rgba(248,113,113,0.5)'; ctx.lineWidth = tgt === G.you ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(td.x, td.y - 92); ctx.lineTo(u.x, u.y); ctx.stroke();
    });
  }
  function stepAnim(u, a, dt, now) {
    if (a.lx === null) { a.lx = u.x; a.ly = u.y; }
    const dx = u.x - a.lx, dy = u.y - a.ly, d = Math.hypot(dx, dy);
    a.lx = u.x; a.ly = u.y;
    const sp = dt > 0 ? d / dt : 0;
    const mv = d > 200 ? 0 : clamp(sp / 280, 0, 1);
    a.move += ((mv > 0.1 ? mv : 0) - a.move) * Math.min(1, dt * 10);
    if (d < 200) a.walk += d * 0.085;
    if (now > a.faceLock && Math.abs(dx) > 0.3 && d < 200) a.faceT = dx > 0 ? 1 : -1;
    a.face += (a.faceT - a.face) * Math.min(1, dt * 12);
    if (u.hp !== undefined) { if (a.lastHp !== null && u.hp < a.lastHp - 1) a.flash = 1; a.lastHp = u.hp; }
    a.flash = Math.max(0, a.flash - dt * 6);
  }
  function drawChampBody(u, now, dt) {
    const info = u.info, champ = info.champ, isMe = u.id === G.you;
    const a = getAnim(u.id, u.team);
    stepAnim(u, a, dt, now);
    let pose = null, poseP = 0, z = 0;
    const pt = (now - a.poseT0) / 1000;
    if (a.leap && (now - a.leap.t0) / 1000 < a.leap.dur) {
      const p = (now - a.leap.t0) / 1000 / a.leap.dur;
      z = Math.sin(Math.PI * p) * a.leap.h; pose = 'leap'; poseP = p;
    } else if (u.bits & 128) { pose = 'charge'; Art.trail(champ, u.x, u.y, dt); }
    else if (a.pose && pt < a.poseDur) { pose = a.pose; poseP = pt / a.poseDur; }
    const hover = Art.HOVER[champ] || 0;
    const inBrush = D.brushAt(u.x, u.y) >= 0;
    // ground: shadow + team ring
    const sh = 1 - Math.min(0.5, (z + hover) / 200);
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(u.x, u.y + 24, 30 * sh, 11 * sh, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = isMe ? '#fde047' : D.TEAM_COLORS[u.team]; ctx.lineWidth = isMe ? 3.5 : 2.5;
    ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.ellipse(u.x, u.y + 24, 34, 13, 0, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    if (u.bits & 4) { ctx.strokeStyle = '#65a30d'; ctx.lineWidth = 4; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.ellipse(u.x, u.y + 22, 30, 11, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    if (u.bits & 8) { ctx.fillStyle = 'rgba(56,189,248,0.25)'; ctx.beginPath(); ctx.ellipse(u.x, u.y + 24, 32, 12, 0, 0, 7); ctx.fill(); }
    if (u.bits & 64) { ctx.strokeStyle = 'rgba(249,115,22,0.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(u.x, u.y + 24, 40, 16, 0, 0, 7); ctx.stroke(); }
    if (u.bits & 256) { // active buff aura
      const c = AURA[champ] || '#fff', p = 0.5 + 0.5 * Math.sin(now / 150);
      ctx.save(); ctx.globalAlpha = 0.25 + 0.2 * p; ctx.fillStyle = c; ctx.shadowColor = c; ctx.shadowBlur = 20;
      ctx.beginPath(); ctx.ellipse(u.x, u.y, 38, 34, 0, 0, 7); ctx.fill(); ctx.restore();
      if (champ === 'bee') for (let i = 0; i < 4; i++) { const an = now / 200 + i * 1.57; drawSprite(ctx, '🐝', 12, u.x + Math.cos(an) * 40, u.y - 20 + Math.sin(an) * 18); }
      if (champ === 'horse' && a.move > 0.3) for (let i = 0; i < 3; i++) { ctx.strokeStyle = 'rgba(224,242,254,0.6)'; ctx.lineWidth = 2; const yy = u.y - 20 + i * 12; ctx.beginPath(); ctx.moveTo(u.x - a.face * 34, yy); ctx.lineTo(u.x - a.face * (60 + i * 8), yy); ctx.stroke(); }
    }
    Art.drawChamp(ctx, champ, u.x, u.y, { face: a.face, walk: a.walk, move: a.move, t: now / 1000, pose, poseP, z, flash: a.flash, alpha: inBrush ? 0.65 : 1 });
    if (u.bits & 512) { // wool shield puffs
      ctx.save(); ctx.globalAlpha = 0.85;
      for (let i = 0; i < 9; i++) { const an = now / 600 + i * 0.7; ctx.fillStyle = '#f8fafc'; ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(u.x + Math.cos(an) * 40, u.y - 4 + Math.sin(an) * 30, 8, 0, 7); ctx.fill(); ctx.stroke(); }
      ctx.restore();
    }
    if (u.bits & 2) { const an = now / 200; for (let i = 0; i < 3; i++) drawSprite(ctx, '⭐', 14, u.x + Math.cos(an + i * 2.1) * 22, u.y - 52 - z + Math.sin(an + i * 2.1) * 6); }
    if (u.bits & 16) { // recall swirl
      ctx.save(); ctx.strokeStyle = '#60a5fa'; ctx.shadowColor = '#60a5fa'; ctx.shadowBlur = 12; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(u.x, u.y, 44, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * u.rp) / 100); ctx.stroke();
      for (let i = 0; i < 2; i++) Art.spawn({ k: 'spark', c: '#93c5fd', x: u.x + (Math.random() - 0.5) * 60, y: u.y + 20, vy: -120, s: 4, rot: Math.PI / 2, life: 0.4 });
      ctx.restore();
    }
    if (u.hv) { ctx.strokeStyle = '#86efac'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(u.x, u.y, 44, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * u.hv) / 100); ctx.stroke(); }
  }
  function drawChampBar(u) {
    const isMe = u.id === G.you;
    const col = isMe ? '#22c55e' : u.team === G.team ? '#3b82f6' : '#ef4444';
    const a = G.anim.get(u.id);
    const z = a && a.leap && (performance.now() - a.leap.t0) / 1000 < a.leap.dur ? Math.sin(Math.PI * (performance.now() - a.leap.t0) / 1000 / a.leap.dur) * a.leap.h : 0;
    const w = 74, x = u.x - w / 2 + 8, y = u.y - 62 - z - (Art.HOVER[u.info.champ] ? 10 : 0);
    const tot = Math.max(u.mhp, u.hp + u.sh);
    bar(x, y, w, 9, u.hp / tot, col, u.sh / tot);
    ctx.fillStyle = '#111'; ctx.fillRect(x - 20, y - 4, 18, 16);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(x - 20, y - 4, 18, 16);
    ctx.font = 'bold 11px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText(u.lvl, x - 11, y + 8);
    ctx.font = 'bold 13px "Trebuchet MS", sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = '#000';
    const nm = u.info.name;
    ctx.strokeText(nm, u.x, y - 7); ctx.fillStyle = isMe ? '#fde047' : '#fff'; ctx.fillText(nm, u.x, y - 7);
  }
  function drawCritter(u, now, dt) {
    const a = getAnim(u.id, u.team);
    stepAnim(u, a, dt, now);
    const isN = u.kind === 'neutral';
    const hop = Math.abs(Math.sin(a.walk * 0.7)) * 7 * a.move;
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(u.x, u.y + u.r * 0.75, u.r * (1 - hop / 30), u.r * 0.4, 0, 0, 7); ctx.fill();
    if (!isN) { ctx.strokeStyle = D.TEAM_COLORS[u.team]; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.ellipse(u.x, u.y + u.r * 0.75, u.r + 3, u.r * 0.45, 0, 0, 7); ctx.stroke(); }
    else if (u.big) {
      ctx.save(); ctx.shadowColor = '#fde047'; ctx.shadowBlur = 18; ctx.strokeStyle = 'rgba(253,224,71,0.7)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(u.x, u.y + u.r * 0.75, u.r + 8, u.r * 0.5, 0, 0, 7); ctx.stroke(); ctx.restore();
    }
    const s = sprite(u.def.icon, Math.round(u.r * 1.8));
    ctx.save();
    ctx.translate(u.x, u.y - hop);
    ctx.rotate(Math.sin(a.walk * 0.7) * 0.1 * a.move);
    ctx.scale(-a.face, 1);
    if (a.flash > 0) ctx.globalAlpha = 1;
    ctx.drawImage(s, -s.width / 2, -s.height / 2);
    ctx.restore();
    if (a.flash > 0) { ctx.save(); ctx.globalAlpha = 0.4 * a.flash; ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(u.x, u.y - hop, u.r, 0, 7); ctx.fill(); ctx.restore(); }
    if (u.stun) drawSprite(ctx, '💫', 14, u.x, u.y - u.r - 12);
  }
  function drawCritterBar(u) {
    const w = u.big ? 110 : u.kind === 'neutral' ? 52 : u.r * 2 + 8;
    const col = u.kind === 'neutral' ? '#f59e0b' : u.team === G.team ? '#60a5fa' : '#f87171';
    bar(u.x - w / 2, u.y - u.r - 14, w, u.big ? 8 : 4, u.hpPct / 100, col);
    if (u.big) {
      ctx.font = 'bold 13px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000';
      ctx.strokeText(u.def.name, u.x, u.y - u.r - 20); ctx.fillStyle = '#fde68a'; ctx.fillText(u.def.name, u.x, u.y - u.r - 20);
    }
  }
  function drawFlagShape(x, y, team, s, now) {
    const wave = Math.sin(now / 180 + x) * 4 * s;
    ctx.strokeStyle = '#d6d3d1'; ctx.lineWidth = 4 * s;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 60 * s); ctx.stroke();
    ctx.save(); ctx.shadowColor = D.TEAM_COLORS[team]; ctx.shadowBlur = 16;
    ctx.fillStyle = D.TEAM_COLORS[team]; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * s;
    ctx.beginPath(); ctx.moveTo(x, y - 60 * s); ctx.quadraticCurveTo(x + 22 * s, y - 56 * s + wave, x + 44 * s, y - 48 * s + wave);
    ctx.lineTo(x, y - 34 * s); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  function drawFlags(fs, now) {
    const s = fs.s;
    s.f.forEach((f, tm) => {
      if (f[0] === 1) {
        const c = fs.units.find((u) => u.id === f[3]);
        if (c) {
          const a = G.anim.get(c.id);
          drawFlagShape(c.x - (a ? a.face : 1) * 16, c.y - 14, tm, 0.9, now);
          ctx.strokeStyle = D.TEAM_COLORS[tm]; ctx.lineWidth = 3; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now / 150);
          ctx.beginPath(); ctx.ellipse(c.x, c.y + 24, 48, 18, 0, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
        }
        return;
      }
      if (f[0] === 2) {
        const p = 1 + Math.sin(now / 200) * 0.15;
        ctx.strokeStyle = '#fde047'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(f[1], f[2], 50 * p, 0, 7); ctx.stroke();
        ctx.font = 'bold 15px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeStyle = '#000';
        ctx.strokeText(`${f[4]}s`, f[1], f[2] + 30); ctx.fillText(`${f[4]}s`, f[1], f[2] + 30);
      }
      drawFlagShape(f[1], f[2] + 12, tm, 1.3, now);
    });
  }
  function drawFog(fs, cam, z) {
    const w = fogCv.width, h = fogCv.height, sc = 0.5 * z;
    fctx.globalCompositeOperation = 'source-over';
    fctx.clearRect(0, 0, w, h);
    fctx.fillStyle = 'rgba(4,8,14,0.62)';
    fctx.fillRect(0, 0, w, h);
    fctx.globalCompositeOperation = 'destination-out';
    const toS = (x, y) => [(x - cam.x) * sc + w / 2, (y - cam.y) * sc + h / 2];
    const src = [[D.BASES[G.team].x, D.BASES[G.team].y, C.VISION_BASE]];
    for (const u of fs.units) {
      if (u.team !== G.team || u.dead) continue;
      src.push([u.x, u.y, u.kind === 'champ' ? C.VISION_CHAMP : C.VISION_MINION]);
    }
    fs.s.tw.forEach((tw, i) => { const td = D.TOWERS[i]; if (td.team === G.team && tw[0] > 0) src.push([td.x, td.y, C.VISION_TOWER]); });
    for (const [x, y, r] of src) {
      const [sx, sy] = toS(x, y), rr = r * sc;
      if (sx < -rr || sy < -rr || sx > w + rr || sy > h + rr) continue;
      const g = fctx.createRadialGradient(sx, sy, rr * 0.8, sx, sy, rr);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      fctx.fillStyle = g; fctx.beginPath(); fctx.arc(sx, sy, rr, 0, 7); fctx.fill();
    }
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fogCv, 0, 0, VW, VH);
    ctx.restore();
  }
  // Minimal aiming guides: thin, faint outlines. The spell graphics themselves do the talking.
  function drawIndicators(meU) {
    if (!meU || meU.dead || !G.held.length) return;
    const k = G.held[G.held.length - 1];
    const a = meU.info.def.abilities[k];
    const mx = G.mouse.wx, my = G.mouse.wy;
    let dx = mx - meU.x, dy = my - meU.y;
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const ang = Math.atan2(dy, dx);
    const reach = Math.min(len, a.range || 0);
    const tx = meU.x + dx * reach, ty = meU.y + dy * reach;
    const ready = G.me && G.me.cd[KEYS.indexOf(k)] <= 0 && !(k === 'R' && G.me.lvl < C.R_LEVEL);
    const col = ready ? 'rgba(255,255,255,0.55)' : 'rgba(248,113,113,0.6)';
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = 1.5;
    if (a.range) { ctx.globalAlpha = 0.45; ctx.setLineDash([2, 10]); ctx.beginPath(); ctx.arc(meU.x, meU.y, a.range, 0, 7); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; }
    const lane = (L, W) => {
      ctx.save(); ctx.translate(meU.x, meU.y); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(30, -W / 2); ctx.lineTo(L, -W / 2); ctx.moveTo(30, W / 2); ctx.lineTo(L, W / 2);
      ctx.moveTo(L - 12, -W / 2 - 8); ctx.lineTo(L + 4, 0); ctx.lineTo(L - 12, W / 2 + 8); ctx.stroke(); ctx.restore();
    };
    const circ = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); };
    switch (a.type) {
      case 'skillshot': lane(a.range, a.width); if (a.explode) circ(meU.x + dx * a.range, meU.y + dy * a.range, a.explode); break;
      case 'cone': {
        const half = (a.arc * Math.PI) / 360;
        ctx.beginPath(); ctx.moveTo(meU.x + Math.cos(ang - half) * 30, meU.y + Math.sin(ang - half) * 30);
        ctx.lineTo(meU.x + Math.cos(ang - half) * a.range, meU.y + Math.sin(ang - half) * a.range);
        ctx.arc(meU.x, meU.y, a.range, ang - half, ang + half);
        ctx.lineTo(meU.x + Math.cos(ang + half) * 30, meU.y + Math.sin(ang + half) * 30); ctx.stroke();
        break;
      }
      case 'ground_aoe': case 'zone': case 'barrage': circ(tx, ty, a.radius); break;
      case 'self_aoe': circ(meU.x, meU.y, a.radius); break;
      case 'dash': lane(a.range, 50); break;
      case 'leap': case 'blink':
        ctx.setLineDash([6, 8]); ctx.beginPath(); ctx.moveTo(meU.x, meU.y); ctx.lineTo(tx, ty); ctx.stroke(); ctx.setLineDash([]);
        circ(tx, ty, a.type === 'leap' ? a.land.r : 28); break;
      case 'targeted': case 'ally': {
        let best = null, bd = a.type === 'ally' ? Infinity : 220;
        for (const u of G.curFrame.units) {
          if (u.dead) continue;
          if (a.type === 'targeted' ? u.team === G.team : (u.kind !== 'champ' || u.team !== G.team)) continue;
          if (a.type === 'ally' && Math.hypot(u.x - meU.x, u.y - meU.y) > a.range && u.id !== G.you) continue;
          if (a.type === 'targeted' && Math.hypot(u.x - meU.x, u.y - meU.y) > a.range + u.r) continue;
          let d = Math.hypot(u.x - mx, u.y - my);
          if (a.type === 'targeted' && u.kind === 'champ') d -= 60;
          if (d < bd) { bd = d; best = u; }
        }
        if (best) { ctx.lineWidth = 3; ctx.strokeStyle = a.type === 'ally' ? 'rgba(134,239,172,0.9)' : 'rgba(239,68,68,0.9)'; ctx.beginPath(); ctx.ellipse(best.x, best.y + 18, best.r + 12, (best.r + 12) * 0.45, 0, 0, 7); ctx.stroke(); }
        break;
      }
      case 'buff': ctx.beginPath(); ctx.ellipse(meU.x, meU.y + 20, 44, 18, 0, 0, 7); ctx.stroke(); break;
    }
    ctx.restore();
  }
  function drawMarker(now) {
    const m = G.marker;
    if (!m) return;
    const age = (now - m.t0) / 1000;
    if (age > 0.4) { G.marker = null; return; }
    ctx.strokeStyle = m.atk ? '#ef4444' : '#4ade80'; ctx.lineWidth = 3; ctx.globalAlpha = 1 - age / 0.4;
    ctx.beginPath(); ctx.ellipse(m.x, m.y, 22 * (1 - age / 0.4) + 4, (22 * (1 - age / 0.4) + 4) * 0.5, 0, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
  }
  function drawNums(now) {
    G.nums = G.nums.filter((n) => now - n.t0 < 900);
    ctx.textAlign = 'center';
    for (const n of G.nums) {
      const age = (now - n.t0) / 900;
      ctx.globalAlpha = 1 - age * age;
      ctx.font = `bold ${n.big ? 22 : 16}px "Trebuchet MS", sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = '#000';
      ctx.strokeText(n.text, n.x, n.y - 30 - age * 50); ctx.fillStyle = n.col; ctx.fillText(n.text, n.x, n.y - 30 - age * 50);
    }
    ctx.globalAlpha = 1;
  }
  connect();
})();
