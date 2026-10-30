'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const D = require('../shared/data.js');
const { Game, TICK } = require('./game.js');

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') { res.writeHead(200); res.end('ok'); return; }
  let file;
  if (url === '/' || url === '') file = path.join(ROOT, 'public', 'index.html');
  else if (url === '/shared/data.js') file = path.join(ROOT, 'shared', 'data.js');
  else file = path.join(ROOT, 'public', path.normalize(url).replace(/^([/\\])+/, ''));
  if (!file.startsWith(path.join(ROOT, 'public')) && !file.endsWith(path.join('shared', 'data.js'))) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();
let nextPid = 1;

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}
function send(ws, obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }
const CHAMP_IDS = Object.keys(D.CHAMPS);

class Room {
  constructor(code) {
    this.code = code;
    this.players = []; // {pid, name, team, champ, ready, bot, ws, connected}
    this.host = 0;
    this.state = 'lobby';
    this.game = null;
    this.loop = null;
    this.result = null;
  }
  teamCount(tm) { return this.players.filter((p) => p.team === tm).length; }
  takenChamps(tm, exceptPid) { return new Set(this.players.filter((p) => p.team === tm && p.pid !== exceptPid && p.champ).map((p) => p.champ)); }
  publicState() {
    return { t: 'room', code: this.code, host: this.host, state: this.state,
      players: this.players.map((p) => ({ pid: p.pid, name: p.name, team: p.team, champ: p.champ, ready: p.ready, bot: p.bot, connected: p.connected })) };
  }
  broadcast(obj) { const s = JSON.stringify(obj); for (const p of this.players) if (p.ws && p.ws.readyState === 1) p.ws.send(s); }
  sync() { this.broadcast(this.publicState()); }
  sendTo(pid, obj) { const p = this.players.find((x) => x.pid === pid); if (p) send(p.ws, obj); }

  start() {
    for (const p of this.players) {
      if (!p.champ) {
        const taken = this.takenChamps(p.team, p.pid);
        const free = CHAMP_IDS.filter((c) => !taken.has(c));
        p.champ = free[Math.floor(Math.random() * free.length)] || CHAMP_IDS[0];
      }
    }
    const roster = this.players.map((p) => ({ pid: p.pid, name: p.name, team: p.team, champ: p.champ, isBot: p.bot }));
    this.state = 'game';
    this.result = null;
    this.game = new Game(roster, {
      send: (pid, obj) => this.sendTo(pid, obj),
      broadcast: (obj) => this.broadcast(obj),
      end: (winner, board) => this.onEnd(winner, board),
    });
    for (const p of this.players) if (!p.bot) send(p.ws, this.game.startInfo(p.pid));
    this.sync();
    let last = Date.now(), acc = 0;
    const stepMs = 1000 / TICK;
    this.loop = setInterval(() => {
      const now = Date.now();
      acc += Math.min(250, now - last); last = now;
      try {
        while (acc >= stepMs && this.game && !this.game.over) { this.game.step(); acc -= stepMs; }
      } catch (e) { console.error('Game error', e); }
    }, stepMs / 2);
  }
  onEnd(winner, board) {
    clearInterval(this.loop); this.loop = null;
    this.result = { winner, board };
    this.broadcast({ t: 'end', winner, board, score: this.game.score });
    setTimeout(() => this.toLobby(), 100);
  }
  toLobby() {
    clearInterval(this.loop); this.loop = null;
    this.game = null;
    this.state = 'lobby';
    this.players = this.players.filter((p) => p.bot || p.connected);
    for (const p of this.players) if (!p.bot) p.ready = false;
    if (!this.players.some((p) => p.pid === this.host)) this.pickHost();
    this.sync();
  }
  pickHost() { const h = this.players.find((p) => !p.bot && p.connected); this.host = h ? h.pid : 0; }
  destroy() { clearInterval(this.loop); rooms.delete(this.code); }
}

function joinRoom(ws, room, name) {
  if (room.state === 'game') {
    const old = room.players.find((p) => !p.bot && !p.connected && p.name.toLowerCase() === name.toLowerCase());
    if (!old) return send(ws, { t: 'err', m: 'That game is already in progress.' });
    old.ws = ws; old.connected = true;
    ws.pid = old.pid; ws.room = room;
    const u = room.game.champs.find((c) => c.pid === old.pid);
    if (u) u.isBot = u.wasBot;
    send(ws, { t: 'joined', pid: old.pid, code: room.code });
    room.sync();
    send(ws, room.game.startInfo(old.pid));
    return;
  }
  const humans = room.players.length;
  if (humans >= 6) return send(ws, { t: 'err', m: 'Room is full (3 vs 3).' });
  const team = room.teamCount(0) <= room.teamCount(1) ? 0 : 1;
  if (room.teamCount(team) >= 3) return send(ws, { t: 'err', m: 'Room is full (3 vs 3).' });
  const pid = nextPid++;
  room.players.push({ pid, name, team, champ: null, ready: false, bot: false, ws, connected: true });
  ws.pid = pid; ws.room = room;
  if (!room.host) room.host = pid;
  send(ws, { t: 'joined', pid, code: room.code });
  room.sync();
}

function cleanName(n) { return String(n || '').replace(/[<>]/g, '').trim().slice(0, 16) || 'Farmer'; }

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const room = ws.room;
    if (m.t === 'ping') return send(ws, { t: 'pong', c: m.c });
    if (m.t === 'create') {
      if (room) return;
      const r = new Room(makeCode());
      rooms.set(r.code, r);
      return joinRoom(ws, r, cleanName(m.name));
    }
    if (m.t === 'join') {
      if (room) return;
      const r = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!r) return send(ws, { t: 'err', m: 'No room with that code.' });
      return joinRoom(ws, r, cleanName(m.name));
    }
    if (!room) return;
    const me = room.players.find((p) => p.pid === ws.pid);
    if (!me) return;
    if (room.state === 'game') {
      if (room.game) room.game.input(me.pid, m);
      return;
    }
    const isHost = room.host === me.pid;
    switch (m.t) {
      case 'team': {
        const tm = m.team === 1 ? 1 : 0;
        if (tm === me.team || room.teamCount(tm) >= 3) return;
        me.team = tm;
        if (me.champ && room.takenChamps(tm, me.pid).has(me.champ)) me.champ = null;
        me.ready = false;
        break;
      }
      case 'champ': {
        if (!D.CHAMPS[m.champ] || room.takenChamps(me.team, me.pid).has(m.champ)) return;
        me.champ = m.champ;
        break;
      }
      case 'ready': me.ready = !!m.v; break;
      case 'addBot': {
        if (!isHost) return;
        const tm = m.team === 1 ? 1 : 0;
        if (room.teamCount(tm) >= 3) return;
        const taken = room.takenChamps(tm);
        const free = CHAMP_IDS.filter((c) => !taken.has(c));
        const champ = free[Math.floor(Math.random() * free.length)];
        room.players.push({ pid: nextPid++, name: 'Bot ' + D.CHAMPS[champ].name, team: tm, champ, ready: true, bot: true, ws: null, connected: true });
        break;
      }
      case 'removeBot': {
        if (!isHost) return;
        room.players = room.players.filter((p) => !(p.bot && p.pid === m.pid));
        break;
      }
      case 'start': {
        if (!isHost) return;
        const notReady = room.players.filter((p) => !p.bot && p.pid !== me.pid && !p.ready);
        if (notReady.length) return send(ws, { t: 'err', m: 'Waiting for: ' + notReady.map((p) => p.name).join(', ') });
        room.start();
        return;
      }
      default: return;
    }
    room.sync();
  });
  ws.on('close', () => {
    const room = ws.room;
    if (!room) return;
    const me = room.players.find((p) => p.pid === ws.pid);
    if (!me || me.ws !== ws) return;
    if (room.state === 'lobby') {
      room.players = room.players.filter((p) => p !== me);
    } else {
      me.connected = false; me.ws = null;
      const u = room.game && room.game.champs.find((c) => c.pid === me.pid);
      if (u) u.isBot = true; // a bot takes over until they rejoin
    }
    if (!room.players.some((p) => !p.bot && p.connected)) { room.destroy(); return; }
    if (room.host === me.pid) room.pickHost();
    room.sync();
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 25000);

server.listen(PORT, () => console.log(`Barnyard Brawl server listening on http://localhost:${PORT}`));
