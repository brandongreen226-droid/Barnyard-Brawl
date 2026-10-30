/* Barnyard Brawl — browser client */
(() => {
  'use strict';
  const D = window.GameData;
  const C = D.C;
  const $ = (id) => document.getElementById(id);
  const hyp = Math.hypot;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const INTERP = 120; // ms of interpolation delay
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
      cam: { x: D.BASES[m.team].x, y: D.BASES[m.team].y, locked: true, zoom: 1 },
      mouse: { sx: VW / 2, sy: VH / 2, wx: 0, wy: 0, right: false, lastSend: 0 },
      held: [], cancelHeld: false, fx: [], nums: [], marker: null, facing: new Map(),
      sb: null, ended: false, feed: [], lastHud: 0, centerHold: false,
    };
    $('endScreen').classList.add('hidden');
    $('shop').classList.add('hidden');
    $('board').classList.add('hidden');
    $('chatlog').innerHTML = '';
    $('killfeed').innerHTML = '';
    buildAbilityBar();
    buildMinimapBg();
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
  function onSnap(s) {
    indexSnap(s);
    const sample = s.T - performance.now();
    if (G.offset === null || Math.abs(sample - G.offset) > 1000) G.offset = sample;
    else G.offset += (sample - G.offset) * 0.08;
    G.snaps.push(s);
    while (G.snaps.length > 40) G.snaps.shift();
    G.latest = s;
    if (s.me) G.me = s.me;
    for (const e of s.e) handleEvent(e);
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
  function addFx(f) { f.t0 = performance.now(); G.fx.push(f); }
  function handleEvent(e) {
    const mine = G.team;
    switch (e.e) {
      case 'd':
        if (e.s === G.you || e.v === G.you) {
          const col = e.h ? '#4ade80' : e.v === G.you ? '#f87171' : '#fde047';
          G.nums.push({ x: e.x + (Math.random() - 0.5) * 30, y: e.y, text: (e.h ? '+' : '') + e.a, col, t0: performance.now(), big: e.a >= 150 });
        }
        break;
      case 'fx': addFx(e); break;
      case 'lvl':
        addFx({ k: 'lvl', x: e.x, y: e.y, id: e.id });
        if (e.id === G.you) { showAnnounce(`Level ${e.l}!` + (e.l === C.R_LEVEL ? ' Ultimate (R) unlocked!' : ''), '#fde047'); }
        break;
      case 'crop':
        if (e.id === G.you) G.nums.push({ x: e.x, y: e.y - 30, text: `+${e.xp} XP  +${e.g}g`, col: '#86efac', t0: performance.now(), big: true });
        addFx({ k: 'ring', x: e.x, y: e.y, r: 70, c: '#86efac' });
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
        showAnnounce(e.tm === mine ? `Your ${e.tier === 0 ? 'base' : e.lane} Grain Silo was destroyed!` : `Enemy ${e.tier === 0 ? 'base' : e.lane} Grain Silo destroyed!`, e.tm === mine ? '#fca5a5' : '#86efac');
        if (e.tier === 1 && e.tm !== mine) setTimeout(() => showAnnounce("The enemy's base silo can now be attacked!", '#fde047'), 1200);
        break;
      case 'rebuild': showAnnounce(e.tm === mine ? 'Your base Grain Silo has been rebuilt.' : 'The enemy rebuilt their base silo.', '#e5e7eb'); break;
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
  function frameState() {
    const snaps = G.snaps;
    if (!snaps.length) return null;
    const rt = performance.now() + G.offset - INTERP;
    let a = snaps[0], b = snaps[0];
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].T <= rt) { a = snaps[i]; b = snaps[i + 1] || snaps[i]; break; }
    }
    const al = b === a ? 0 : clamp((rt - a.T) / (b.T - a.T), 0, 1);
    return { a, b, al };
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
      <li>Grain Silos (towers) attack enemies in range — and focus you if you hit a champion under them. The base silo by the flag is shielded until one of that team's inner silos falls; it rebuilds after ${D.TOWER_STATS.base.rebuild}s.</li>
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
    m.fillStyle = '#5d8f45'; m.fillRect(0, 0, 240, 140);
    m.fillStyle = '#4f9fd0'; m.fillRect(D.RIVER.x * MS, D.RIVER.y * MS, D.RIVER.w * MS, D.RIVER.h * MS);
    m.strokeStyle = '#c7a172'; m.lineWidth = C.LANE_WIDTH * MS; m.lineCap = 'round'; m.lineJoin = 'round';
    for (const k in D.LANES) { m.beginPath(); D.LANES[k].forEach(([x, y], i) => (i ? m.lineTo(x * MS, y * MS) : m.moveTo(x * MS, y * MS))); m.stroke(); }
    m.fillStyle = '#e0b84a';
    for (const w of D.WALLS) m.fillRect(w.x * MS, w.y * MS, w.w * MS, w.h * MS);
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
      m.fillRect(td.x * MS - 3, td.y * MS - 3, 6, 6); m.strokeRect(td.x * MS - 3, td.y * MS - 3, 6, 6);
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
  const tufts = [];
  (() => { let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); for (let i = 0; i < 2200; i++) tufts.push([rnd() * D.W, rnd() * D.H, rnd()]); })();
  const PV = {
    mud: { c: '#7c4a1e', r: 14 }, static: { c: '#67e8f9', r: 12, glow: 1 }, sting: { c: '#facc15', r: 8 }, bread: { emoji: '🍞', s: 30 },
    seed: { c: '#a16207', r: 5 }, bolt: { c: '#9ca3af', r: 7 }, tower: { r: 11, glow: 1 }, egg_s: { c: '#fef3c7', r: 8 },
    static_s: { c: '#67e8f9', r: 7 }, sting_s: { c: '#facc15', r: 6 }, bread_s: { c: '#d6a35c', r: 7 }, feather: { c: '#ffffff', r: 9 }, atk: { c: '#ffffff', r: 6 },
  };
  const ZONE_C = { mud: '#7c4a1e', honey: '#f59e0b' };

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
      const [x, y] = lerpPos(a.pMap.get(e[0]), e, al, 2, 3);
      projs.push({ vis: e[1], x, y, team: e[4] });
    }
    return { units, projs, s: b };
  }

  function draw() {
    requestAnimationFrame(draw);
    if (!G || !G.latest || S.screen !== 'game') return;
    const fsr = frameState();
    if (!fsr) return;
    const fs = buildFrame(fsr);
    G.curFrame = fs;
    const now = performance.now();
    const dt = Math.min(0.05, (now - (G.lastFrame || now)) / 1000);
    G.lastFrame = now;
    const meU = fs.units.find((u) => u.id === G.you);
    // camera
    const cam = G.cam;
    if ((cam.locked || G.centerHold) && meU) { cam.x = meU.x; cam.y = meU.y; }
    else if (!cam.locked) {
      const edge = 14, sp = 1300 * dt / cam.zoom;
      if (G.mouse.sx < edge) cam.x -= sp; if (G.mouse.sx > VW - edge) cam.x += sp;
      if (G.mouse.sy < edge) cam.y -= sp; if (G.mouse.sy > VH - edge) cam.y += sp;
    }
    cam.x = clamp(cam.x, 0, D.W); cam.y = clamp(cam.y, 0, D.H);
    updateMouseWorld();
    if (G.mouse.right && now - G.mouse.lastSend > 140) clickMove(false);

    const z = cam.zoom;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#2a3d22'; ctx.fillRect(0, 0, VW, VH);
    ctx.setTransform(DPR * z, 0, 0, DPR * z, DPR * (VW / 2 - cam.x * z), DPR * (VH / 2 - cam.y * z));
    const view = { x0: cam.x - VW / 2 / z - 100, y0: cam.y - VH / 2 / z - 100, x1: cam.x + VW / 2 / z + 100, y1: cam.y + VH / 2 / z + 100 };
    const inView = (x, y, pad = 0) => x > view.x0 - pad && x < view.x1 + pad && y > view.y0 - pad && y < view.y1 + pad;

    drawGround(view, inView, fs.s, now);
    drawZones(fs.s, now);
    drawTowerRanges(fs.s, meU);
    // sortable drawables: units + towers
    const list = fs.units.filter((u) => !u.dead && inView(u.x, u.y, 60));
    for (const u of list) u.sortY = u.y;
    D.TOWERS.forEach((td, i) => { if (inView(td.x, td.y, 120)) list.push({ kind: 'tower', td, tw: fs.s.tw[i], sortY: td.y, x: td.x, y: td.y }); });
    list.sort((p, q) => p.sortY - q.sortY);
    for (const u of list) {
      if (u.kind === 'tower') drawTower(u.td, u.tw);
      else if (u.kind === 'champ') drawChampBody(u, now);
      else drawCritter(u);
    }
    drawTowerShots(fs, meU);
    drawFlags(fs, now);
    for (const p of fs.projs) drawProj(p);
    drawFx(now);
    drawFog(fs, cam, z);
    // overlays above fog
    for (const u of list) {
      if (u.kind === 'tower') drawTowerBar(u.td, u.tw);
      else if (u.kind === 'champ') drawChampBar(u);
      else drawCritterBar(u);
    }
    drawIndicators(meU, fs);
    drawMarker(now);
    drawNums(now);
    // cursor
    const ht = hoverTarget();
    cv.style.cursor = ht ? (ht.enemy ? 'crosshair' : 'pointer') : 'default';
    if (ht && ht.enemy) {
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.arc(ht.x, ht.y, ht.r + 8, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
    if (!G.mmNext || now > G.mmNext) { G.mmNext = now + 90; drawMinimap(fs); }
  }
  requestAnimationFrame(draw);

  function drawGround(view, inView, s, now) {
    ctx.fillStyle = '#7cb35b';
    ctx.fillRect(Math.max(0, view.x0), Math.max(0, view.y0), Math.min(D.W, view.x1) - Math.max(0, view.x0), Math.min(D.H, view.y1) - Math.max(0, view.y0));
    // grass tufts
    ctx.strokeStyle = '#5f9a44'; ctx.lineWidth = 2; ctx.beginPath();
    for (const [x, y, r] of tufts) {
      if (!inView(x, y)) continue;
      ctx.moveTo(x - 4, y + 3); ctx.lineTo(x - 2 + r * 2, y - 5);
      ctx.moveTo(x + 2, y + 3); ctx.lineTo(x + 4 - r, y - 6);
    }
    ctx.stroke();
    // river
    const R = D.RIVER;
    ctx.fillStyle = '#4f9fd0'; roundRect(R.x, R.y - 60, R.w, R.h + 120, 90); ctx.fill();
    ctx.fillStyle = '#7cc0e6'; roundRect(R.x + 30, R.y - 30, R.w - 60, R.h + 60, 60); ctx.fill();
    // lanes
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const pass of [[C.LANE_WIDTH + 14, '#a98352'], [C.LANE_WIDTH, '#caa577']]) {
      ctx.strokeStyle = pass[1]; ctx.lineWidth = pass[0];
      for (const k in D.LANES) { ctx.beginPath(); D.LANES[k].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
    }
    // bases
    for (const tm of [0, 1]) {
      const b = D.BASES[tm], f = D.FOUNTAINS[tm];
      ctx.fillStyle = D.TEAM_COLORS[tm] + '2e'; ctx.beginPath(); ctx.arc(b.x, b.y, C.BASE_R, 0, 7); ctx.fill();
      ctx.fillStyle = D.TEAM_LIGHT[tm] + '88'; ctx.beginPath(); ctx.arc(f.x, f.y, C.FOUNTAIN_R, 0, 7); ctx.fill();
      ctx.strokeStyle = D.TEAM_COLORS[tm]; ctx.lineWidth = 4; ctx.stroke();
      drawSprite(ctx, '⛲', 54, f.x, f.y);
      // capture circle
      ctx.setLineDash([14, 10]); ctx.lineWidth = 5; ctx.strokeStyle = D.TEAM_COLORS[tm];
      ctx.beginPath(); ctx.arc(b.x, b.y, C.CAPTURE_R, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = D.TEAM_DARK[tm] + 'aa'; ctx.beginPath(); ctx.arc(b.x, b.y, 34, 0, 7); ctx.fill();
      if (tm === G.team) {
        ctx.font = 'bold 16px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
        ctx.fillText('CAPTURE HERE', b.x, b.y + C.CAPTURE_R + 22);
      }
    }
    // camps
    for (const c of D.CAMPS) {
      if (!inView(c.x, c.y)) continue;
      ctx.fillStyle = '#9c7b4e55'; ctx.beginPath(); ctx.arc(c.x, c.y, D.CAMP_TYPES[c.type].reward ? 110 : 80, 0, 7); ctx.fill();
    }
    // crops
    for (const c of D.CROPS) {
      if (!inView(c.x, c.y)) continue;
      const ripe = s.cr[c.idx] === '1';
      ctx.fillStyle = '#6b4a2b'; ctx.beginPath(); ctx.ellipse(c.x, c.y + 10, 46, 26, 0, 0, 7); ctx.fill();
      ctx.strokeStyle = '#4a3220'; ctx.lineWidth = 2;
      for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(c.x - 36, c.y + 10 + i * 10); ctx.lineTo(c.x + 36, c.y + 10 + i * 10); ctx.stroke(); }
      if (ripe) {
        const bob = Math.sin(now / 400 + c.idx) * 2;
        ctx.fillStyle = '#fde04733'; ctx.beginPath(); ctx.arc(c.x, c.y, 44, 0, 7); ctx.fill();
        const ic = D.CROP_TYPES[c.type].icon;
        drawSprite(ctx, ic, 26, c.x - 18, c.y + bob);
        drawSprite(ctx, ic, 30, c.x + 12, c.y - 4 + bob);
      } else {
        drawSprite(ctx, '🌱', 16, c.x - 14, c.y + 8); drawSprite(ctx, '🌱', 16, c.x + 14, c.y + 6);
      }
    }
    // walls (hay bales)
    for (const w of D.WALLS) {
      if (!inView(w.x + w.w / 2, w.y + w.h / 2, Math.max(w.w, w.h))) continue;
      ctx.fillStyle = '#00000033'; roundRect(w.x + 6, w.y + 8, w.w, w.h, 14); ctx.fill();
      ctx.fillStyle = '#e0b84a'; roundRect(w.x, w.y, w.w, w.h, 14); ctx.fill();
      ctx.strokeStyle = '#8a6a1c'; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = '#c99a2e'; ctx.lineWidth = 2; ctx.beginPath();
      if (w.w > w.h) for (let x = w.x + 22; x < w.x + w.w - 8; x += 22) { ctx.moveTo(x, w.y + 6); ctx.lineTo(x - 6, w.y + w.h - 6); }
      else for (let y = w.y + 22; y < w.y + w.h - 8; y += 22) { ctx.moveTo(w.x + 6, y); ctx.lineTo(w.x + w.w - 6, y - 6); }
      ctx.stroke();
    }
  }
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function relColor(team) { return team === G.team ? '#60a5fa' : '#ef4444'; }

  function drawZones(s) {
    for (const z of s.z) {
      const [, kind, x, y, r, team, prog, vis] = z;
      const rc = relColor(team);
      if (kind === 't') {
        ctx.fillStyle = rc + '22'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
        ctx.strokeStyle = rc; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = (vis && vis[0] === '#' ? vis : rc) + '66';
        ctx.beginPath(); ctx.arc(x, y, (r * prog) / 100, 0, 7); ctx.fill();
      } else if (kind === 'z') {
        ctx.fillStyle = (ZONE_C[vis] || '#a3a3a3') + '88'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
        ctx.setLineDash([10, 6]); ctx.strokeStyle = rc; ctx.lineWidth = 3; ctx.stroke(); ctx.setLineDash([]);
        if (vis === 'honey') drawSprite(ctx, '🍯', 26, x, y);
      } else if (kind === 'area') {
        ctx.setLineDash([12, 8]); ctx.strokeStyle = rc; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = rc + '11'; ctx.fill();
      }
    }
  }

  function drawTowerRanges(s, meU) {
    if (!meU || meU.dead) return;
    D.TOWERS.forEach((td, i) => {
      if (td.team === G.team || s.tw[i][0] <= 0) return;
      const st = td.tier === 0 ? D.TOWER_STATS.base : D.TOWER_STATS.normal;
      const d = hyp(meU.x - td.x, meU.y - td.y);
      if (d > st.range + 350) return;
      const targetingMe = s.tw[i][1] === G.you;
      ctx.strokeStyle = targetingMe ? '#ef4444' : '#ef444488'; ctx.lineWidth = targetingMe ? 5 : 3;
      ctx.setLineDash([16, 12]); ctx.beginPath(); ctx.arc(td.x, td.y, st.range, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    });
  }
  function drawTower(td, tw) {
    const alive = tw[0] > 0;
    const r = td.r;
    ctx.fillStyle = '#00000044'; ctx.beginPath(); ctx.ellipse(td.x + 6, td.y + 10, r + 4, r * 0.8, 0, 0, 7); ctx.fill();
    if (!alive) {
      ctx.fillStyle = '#6b6b6b'; ctx.beginPath(); ctx.arc(td.x, td.y, r * 0.8, 0, 7); ctx.fill();
      ctx.fillStyle = '#8a8a8a'; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(td.x + Math.cos(i * 1.3) * r * 0.5, td.y + Math.sin(i * 1.7) * r * 0.4, 10, 0, 7); ctx.fill(); }
      if (tw[3] > 0) { ctx.font = 'bold 14px "Trebuchet MS", sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(`rebuilding ${tw[3]}s`, td.x, td.y - r - 8); }
      return;
    }
    ctx.fillStyle = D.TEAM_DARK[td.team]; ctx.beginPath(); ctx.arc(td.x, td.y, r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = D.TEAM_COLORS[td.team]; ctx.beginPath(); ctx.arc(td.x, td.y - 6, r * 0.72, 0, 7); ctx.fill();
    ctx.fillStyle = '#e5e7eb'; ctx.beginPath(); ctx.arc(td.x, td.y - 12, r * 0.38, 0, 7); ctx.fill();
    ctx.strokeStyle = '#9ca3af'; ctx.lineWidth = 2; ctx.stroke();
    if (tw[2]) {
      ctx.fillStyle = '#93c5fd22'; ctx.strokeStyle = '#e0f2fe'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.arc(td.x, td.y, r + 18, 0, 7); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
      drawSprite(ctx, '🛡️', 22, td.x + r, td.y - r);
    }
  }
  function drawTowerBar(td, tw) {
    if (tw[0] <= 0) return;
    const st = td.tier === 0 ? D.TOWER_STATS.base : D.TOWER_STATS.normal;
    bar(td.x - 50, td.y - td.r - 24, 100, 9, tw[0] / st.hp, td.team === G.team ? '#3b82f6' : '#ef4444');
  }
  function bar(x, y, w, h, pct, col, sh) {
    ctx.fillStyle = '#000'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#333'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = col; ctx.fillRect(x, y, w * clamp(pct, 0, 1), h);
    if (sh) { ctx.fillStyle = '#f3f4f6'; ctx.fillRect(x + w * clamp(pct, 0, 1), y, w * sh, h); }
  }
  function drawTowerShots(fs, meU) {
    const s = fs.s;
    D.TOWERS.forEach((td, i) => {
      const tgt = s.tw[i][1];
      if (!tgt || s.tw[i][0] <= 0) return;
      const u = fs.units.find((x) => x.id === tgt);
      if (!u || u.kind !== 'champ') return;
      ctx.strokeStyle = tgt === G.you ? '#ef4444' : '#f8717199'; ctx.lineWidth = tgt === G.you ? 4 : 2;
      ctx.beginPath(); ctx.moveTo(td.x, td.y - 20); ctx.lineTo(u.x, u.y); ctx.stroke();
    });
    void meU;
  }
  function faceFlip(id, ang) {
    const c = Math.cos(ang);
    let f = G.facing.get(id);
    if (f === undefined) f = c > 0;
    if (c > 0.2) f = true; else if (c < -0.2) f = false;
    G.facing.set(id, f);
    return f;
  }
  function drawChampBody(u, now) {
    const def = u.info.def, isMe = u.id === G.you;
    ctx.fillStyle = '#00000044'; ctx.beginPath(); ctx.ellipse(u.x + 4, u.y + 22, 30, 12, 0, 0, 7); ctx.fill();
    if (isMe) { ctx.strokeStyle = '#fde047'; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(u.x, u.y + 20, 40, 16, 0, 0, 7); ctx.stroke(); }
    if (u.bits & 64) { ctx.strokeStyle = '#f97316aa'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(u.x, u.y, 40, 0, 7); ctx.stroke(); }
    if (u.bits & 4) { ctx.strokeStyle = '#a16207'; ctx.lineWidth = 6; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.ellipse(u.x, u.y + 18, 34, 12, 0, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = def.color; ctx.beginPath(); ctx.arc(u.x, u.y, u.r, 0, 7); ctx.fill();
    ctx.strokeStyle = D.TEAM_COLORS[u.team]; ctx.lineWidth = 5; ctx.stroke();
    if (u.bits & 512) { ctx.strokeStyle = '#f9fafbcc'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(u.x, u.y, u.r + 6, 0, 7); ctx.stroke(); }
    if (u.bits & 8) { ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(u.x, u.y, u.r + 3, 0, 7); ctx.stroke(); }
    drawSprite(ctx, def.icon, 40, u.x, u.y - 2, faceFlip(u.id, u.ang));
    if (u.bits & 256) { // buff sparkle
      const a = now / 300;
      for (let i = 0; i < 3; i++) { ctx.fillStyle = '#fef08a'; ctx.beginPath(); ctx.arc(u.x + Math.cos(a + i * 2.1) * 36, u.y + Math.sin(a + i * 2.1) * 36, 3, 0, 7); ctx.fill(); }
    }
    if (u.bits & 2) { // stunned stars
      const a = now / 200;
      for (let i = 0; i < 3; i++) drawSprite(ctx, '⭐', 14, u.x + Math.cos(a + i * 2.1) * 22, u.y - 44 + Math.sin(a + i * 2.1) * 6);
    }
    if (u.bits & 16) { // recall swirl
      ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(u.x, u.y, u.r + 12, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * u.rp) / 100); ctx.stroke();
    }
    if (u.hv) { ctx.strokeStyle = '#86efac'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(u.x, u.y, u.r + 12, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * u.hv) / 100); ctx.stroke(); }
  }
  function drawChampBar(u) {
    const isMe = u.id === G.you;
    const col = isMe ? '#22c55e' : u.team === G.team ? '#3b82f6' : '#ef4444';
    const w = 74, x = u.x - w / 2 + 8, y = u.y - u.r - 22;
    const tot = Math.max(u.mhp, u.hp + u.sh);
    bar(x, y, w, 9, u.hp / tot, col, u.sh / tot);
    ctx.fillStyle = '#111'; ctx.fillRect(x - 20, y - 4, 18, 16);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(x - 20, y - 4, 18, 16);
    ctx.font = 'bold 11px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText(u.lvl, x - 11, y + 8);
    ctx.font = 'bold 13px "Trebuchet MS", sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = '#000';
    const nm = u.info.name;
    ctx.strokeText(nm, u.x, y - 7); ctx.fillStyle = isMe ? '#fde047' : '#fff'; ctx.fillText(nm, u.x, y - 7);
  }
  function drawCritter(u) {
    const isN = u.kind === 'neutral';
    ctx.fillStyle = '#00000040'; ctx.beginPath(); ctx.ellipse(u.x + 3, u.y + u.r * 0.7, u.r, u.r * 0.45, 0, 0, 7); ctx.fill();
    ctx.fillStyle = isN ? (u.big ? '#fde68a' : '#e7d7b0') : D.TEAM_LIGHT[u.team];
    ctx.beginPath(); ctx.arc(u.x, u.y, u.r, 0, 7); ctx.fill();
    ctx.strokeStyle = isN ? '#8a6d3b' : D.TEAM_COLORS[u.team]; ctx.lineWidth = u.big ? 4 : 3; ctx.stroke();
    drawSprite(ctx, u.def.icon, Math.round(u.r * 1.55), u.x, u.y - 1, faceFlip(u.id, u.ang));
    if (u.stun) drawSprite(ctx, '💫', 14, u.x, u.y - u.r - 12);
  }
  function drawCritterBar(u) {
    const w = u.big ? 110 : u.kind === 'neutral' ? 52 : u.r * 2 + 8;
    const col = u.kind === 'neutral' ? '#f59e0b' : u.team === G.team ? '#60a5fa' : '#f87171';
    bar(u.x - w / 2, u.y - u.r - 10, w, u.big ? 8 : 4, u.hpPct / 100, col);
    if (u.big) {
      ctx.font = 'bold 13px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000';
      ctx.strokeText(u.def.name, u.x, u.y - u.r - 16); ctx.fillStyle = '#fde68a'; ctx.fillText(u.def.name, u.x, u.y - u.r - 16);
    }
  }
  function drawFlagShape(x, y, team, s, now) {
    const wave = Math.sin(now / 180 + x) * 4 * s;
    ctx.strokeStyle = '#3f2a14'; ctx.lineWidth = 4 * s;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 60 * s); ctx.stroke();
    ctx.fillStyle = D.TEAM_COLORS[team]; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * s;
    ctx.beginPath(); ctx.moveTo(x, y - 60 * s); ctx.quadraticCurveTo(x + 22 * s, y - 56 * s + wave, x + 44 * s, y - 48 * s + wave);
    ctx.lineTo(x, y - 34 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  function drawFlags(fs, now) {
    const s = fs.s;
    s.f.forEach((f, tm) => {
      if (f[0] === 1) {
        const c = fs.units.find((u) => u.id === f[3]);
        if (c) {
          drawFlagShape(c.x + 18, c.y - 10, tm, 0.9, now);
          ctx.strokeStyle = D.TEAM_COLORS[tm]; ctx.lineWidth = 3; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now / 150);
          ctx.beginPath(); ctx.arc(c.x, c.y, 46, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
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
  function drawProj(p) {
    const v = PV[p.vis] || PV.atk;
    if (v.emoji) { drawSprite(ctx, v.emoji, v.s, p.x, p.y); return; }
    const col = p.vis === 'tower' ? D.TEAM_LIGHT[p.team] : v.c;
    if (v.glow) { ctx.fillStyle = col + '55'; ctx.beginPath(); ctx.arc(p.x, p.y, v.r * 2, 0, 7); ctx.fill(); }
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, v.r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#000a'; ctx.lineWidth = 2; ctx.stroke();
  }
  function drawFx(now) {
    G.fx = G.fx.filter((f) => now - f.t0 < 700);
    for (const f of G.fx) {
      const age = (now - f.t0) / 1000;
      const col = f.c && f.c[0] === '#' ? f.c : '#ffffff';
      if (f.k === 'cone') {
        if (age > 0.35) continue;
        const half = (f.arc * Math.PI) / 360;
        ctx.globalAlpha = 0.55 * (1 - age / 0.35);
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.arc(f.x, f.y, f.r, f.a - half, f.a + half); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (f.k === 'ring') {
        if (age > 0.45) continue;
        ctx.globalAlpha = 1 - age / 0.45; ctx.strokeStyle = col; ctx.lineWidth = 8;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.4 + (age / 0.45) * 0.6), 0, 7); ctx.stroke();
        ctx.fillStyle = col + '33'; ctx.fill(); ctx.globalAlpha = 1;
      } else if (f.k === 'boom') {
        if (age > 0.35) continue;
        ctx.globalAlpha = 0.6 * (1 - age / 0.35); ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      } else if (f.k === 'blink') {
        if (age > 0.4) continue;
        ctx.globalAlpha = 1 - age / 0.4; ctx.fillStyle = '#ffffff';
        for (const [x, y] of [[f.x, f.y], [f.x2, f.y2]]) { ctx.beginPath(); ctx.arc(x, y, 20 + age * 80, 0, 7); ctx.fill(); }
        ctx.globalAlpha = 1;
      } else if (f.k === 'hit') {
        if (age > 0.15) continue;
        ctx.fillStyle = '#fff'; ctx.globalAlpha = 1 - age / 0.15;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.big ? 26 : 14, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      } else if (f.k === 'buff' || f.k === 'lvl') {
        if (age > 0.6) continue;
        const u = G.curFrame.units.find((x) => x.id === f.id);
        const x = u ? u.x : f.x, y = u ? u.y : f.y;
        ctx.globalAlpha = 1 - age / 0.6; ctx.strokeStyle = f.k === 'lvl' ? '#fde047' : '#a7f3d0'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(x, y - age * 40, 30 + age * 30, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
  }
  function drawFog(fs, cam, z) {
    const w = fogCv.width, h = fogCv.height, sc = 0.5 * z;
    fctx.globalCompositeOperation = 'source-over';
    fctx.clearRect(0, 0, w, h);
    fctx.fillStyle = 'rgba(10,16,30,0.55)';
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
      const g = fctx.createRadialGradient(sx, sy, rr * 0.82, sx, sy, rr);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      fctx.fillStyle = g; fctx.beginPath(); fctx.arc(sx, sy, rr, 0, 7); fctx.fill();
    }
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fogCv, 0, 0, VW, VH);
    ctx.restore();
  }
  function drawIndicators(meU) {
    if (!meU || meU.dead || !G.held.length) return;
    const k = G.held[G.held.length - 1];
    const a = meU.info.def.abilities[k];
    const mx = G.mouse.wx, my = G.mouse.wy;
    let dx = mx - meU.x, dy = my - meU.y;
    const len = hyp(dx, dy) || 1; dx /= len; dy /= len;
    const ang = Math.atan2(dy, dx);
    const reach = Math.min(len, a.range || 0);
    const tx = meU.x + dx * reach, ty = meU.y + dy * reach;
    const ready = G.me && G.me.cd[KEYS.indexOf(k)] <= 0 && !(k === 'R' && G.me.lvl < C.R_LEVEL);
    const col = ready ? '#ffffff' : '#f87171';
    ctx.strokeStyle = col; ctx.fillStyle = col + '26'; ctx.lineWidth = 3;
    if (a.range) { ctx.setLineDash([6, 8]); ctx.beginPath(); ctx.arc(meU.x, meU.y, a.range, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    const rect = (L, W) => {
      ctx.save(); ctx.translate(meU.x, meU.y); ctx.rotate(ang);
      ctx.beginPath(); ctx.rect(0, -W / 2, L, W); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(L, -W / 2 - 8); ctx.lineTo(L + 20, 0); ctx.lineTo(L, W / 2 + 8); ctx.closePath(); ctx.fill();
      ctx.restore();
    };
    const circ = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke(); };
    switch (a.type) {
      case 'skillshot': rect(a.range, a.width); if (a.explode) circ(meU.x + dx * a.range, meU.y + dy * a.range, a.explode); break;
      case 'cone': {
        const half = (a.arc * Math.PI) / 360;
        ctx.beginPath(); ctx.moveTo(meU.x, meU.y); ctx.arc(meU.x, meU.y, a.range, ang - half, ang + half); ctx.closePath(); ctx.fill(); ctx.stroke();
        break;
      }
      case 'ground_aoe': case 'zone': circ(tx, ty, a.radius); break;
      case 'barrage': circ(tx, ty, a.radius); break;
      case 'self_aoe': circ(meU.x, meU.y, a.radius); break;
      case 'dash': rect(a.range, 60); break;
      case 'leap': ctx.beginPath(); ctx.moveTo(meU.x, meU.y); ctx.lineTo(tx, ty); ctx.stroke(); circ(tx, ty, a.land.r); break;
      case 'blink': ctx.beginPath(); ctx.moveTo(meU.x, meU.y); ctx.lineTo(tx, ty); ctx.stroke(); circ(tx, ty, 32); break;
      case 'targeted': case 'ally': {
        let best = null, bd = a.type === 'ally' ? Infinity : 220;
        for (const u of G.curFrame.units) {
          if (u.dead) continue;
          if (a.type === 'targeted' ? u.team === G.team : (u.kind !== 'champ' || u.team !== G.team)) continue;
          if (a.type === 'ally' && hyp(u.x - meU.x, u.y - meU.y) > a.range && u.id !== G.you) continue;
          if (a.type === 'targeted' && hyp(u.x - meU.x, u.y - meU.y) > a.range + u.r) continue;
          let d = hyp(u.x - mx, u.y - my);
          if (a.type === 'targeted' && u.kind === 'champ') d -= 60;
          if (d < bd) { bd = d; best = u; }
        }
        if (best) { ctx.lineWidth = 5; ctx.strokeStyle = a.type === 'ally' ? '#86efac' : '#ef4444'; ctx.beginPath(); ctx.arc(best.x, best.y, best.r + 10, 0, 7); ctx.stroke(); }
        break;
      }
      case 'buff': ctx.beginPath(); ctx.arc(meU.x, meU.y, 50, 0, 7); ctx.stroke(); break;
    }
    ctx.font = 'bold 15px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#000';
    const lbl = `${a.icon} ${a.name}${ready ? '' : ' (not ready)'}`;
    ctx.strokeText(lbl, meU.x, meU.y + 60); ctx.fillStyle = col; ctx.fillText(lbl, meU.x, meU.y + 60);
  }
  function drawMarker(now) {
    const m = G.marker;
    if (!m) return;
    const age = (now - m.t0) / 1000;
    if (age > 0.4) { G.marker = null; return; }
    ctx.strokeStyle = m.atk ? '#ef4444' : '#4ade80'; ctx.lineWidth = 3; ctx.globalAlpha = 1 - age / 0.4;
    ctx.beginPath(); ctx.arc(m.x, m.y, 22 * (1 - age / 0.4) + 4, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
  }
  function drawNums(now) {
    G.nums = G.nums.filter((n) => now - n.t0 < 900);
    ctx.textAlign = 'center';
    for (const n of G.nums) {
      const age = (now - n.t0) / 900;
      ctx.globalAlpha = 1 - age * age;
      ctx.font = `bold ${n.big ? 22 : 16}px "Trebuchet MS", sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = '#000';
      ctx.strokeText(n.text, n.x, n.y - age * 50); ctx.fillStyle = n.col; ctx.fillText(n.text, n.x, n.y - age * 50);
    }
    ctx.globalAlpha = 1;
  }

  connect();
})();
