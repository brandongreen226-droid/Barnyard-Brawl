'use strict';
// Authoritative game simulation for one match.
const D = require('../shared/data.js');
const { Nav } = require('./nav.js');

const C = D.C;
const TICK = 30;
const DT = 1 / TICK;
const hyp = Math.hypot;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}
function pointAlong(path, dist) {
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1];
    const L = hyp(bx - ax, by - ay);
    if (dist <= L) return { x: ax + ((bx - ax) * dist) / L, y: ay + ((by - ay) * dist) / L, seg: i + 1 };
    dist -= L;
  }
  const l = path[path.length - 1];
  return { x: l[0], y: l[1], seg: path.length - 1 };
}

class Game {
  // roster: [{pid, name, team, champ, isBot}]   io: { send(pid, obj), broadcast(obj) }
  constructor(roster, io) {
    this.io = io;
    this.nav = new Nav();
    this.t = 0;
    this.tickN = 0;
    this.nextId = 1;
    this.units = new Map();
    this.champs = [];
    this.projs = [];
    this.zones = [];
    this.events = [];
    this.score = [0, 0];
    this.over = false;
    this.winner = -1;
    this.flags = [0, 1].map((tm) => ({ team: tm, state: 'home', x: D.BASES[tm].x, y: D.BASES[tm].y, carrier: 0, returnAt: 0 }));
    this.lanePaths = [{}, {}];
    for (const k of Object.keys(D.LANES)) {
      this.lanePaths[0][k] = D.LANES[k].map((p) => p.slice());
      this.lanePaths[1][k] = D.LANES[k].map((p) => p.slice()).reverse();
    }
    this.towers = D.TOWERS.map((td) => this.addTower(td));
    this.camps = D.CAMPS.map((c, i) => ({ i, type: c.type, x: c.x, y: c.y, def: D.CAMP_TYPES[c.type], members: [], respawnAt: D.CAMP_TYPES[c.type].first }));
    this.crops = D.CROPS.map((c) => ({ idx: c.idx, type: c.type, x: c.x, y: c.y, def: D.CROP_TYPES[c.type], ripe: true, regrowAt: 0 }));
    this.nextWave = C.WAVE_FIRST;
    this.wave = 0;
    this.goldAcc = 0;
    const laneOrder = ['mid', 'top', 'bot'];
    const counts = [0, 0];
    for (const p of roster) {
      const slot = counts[p.team]++;
      this.addChamp(p, slot, laneOrder[slot % 3]);
    }
    for (const tm of [0, 1]) {
      const bot = this.champs.find((c) => c.team === tm && c.isBot);
      if (bot) bot.bot.runner = true;
    }
    this.vis = [[], []];
  }

  id() { return this.nextId++; }
  get minute() { return this.t / 60; }

  // ---------------- creation ----------------
  baseUnit(kind, team, x, y, r) {
    return { id: this.id(), kind, team, x, y, r, ang: team === 1 ? Math.PI : 0, hp: 1, maxHp: 1, dead: false,
      slows: [], stunUntil: 0, rootUntil: 0, knock: null, attackCd: 0, windup: 0, windDur: 0, armor: 0 };
  }

  addTower(td) {
    const st = td.tier === 0 ? D.TOWER_STATS.base : D.TOWER_STATS.normal;
    const u = this.baseUnit('tower', td.team, td.x, td.y, td.r);
    Object.assign(u, { idx: td.idx, tier: td.tier, lane: td.lane, base: td.tier === 0, st, hp: st.hp, maxHp: st.hp, armor: st.armor, range: st.range, target: 0, rebuildAt: 0 });
    this.units.set(u.id, u);
    return u;
  }

  addChamp(p, slot, lane) {
    const def = D.CHAMPS[p.champ];
    const f = D.FOUNTAINS[p.team];
    const u = this.baseUnit('champ', p.team, f.x + (p.team === 0 ? 60 : -60), f.y + (slot - 1) * 70, 30);
    Object.assign(u, {
      pid: p.pid, name: p.name, champ: p.champ, def, isBot: !!p.isBot, wasBot: !!p.isBot, lane,
      level: 1, xp: 0, gold: C.START_GOLD, items: [], respawnAt: 0, slot,
      cds: { Q: 0, W: 0, E: 0, R: 0 }, buffs: [], shields: [], dash: null, recall: 0, recallStart: 0,
      harvest: null, path: [], cmd: null, repathAt: 0, flag: -1,
      k: 0, d: 0, a: 0, cs: 0, damagers: new Map(), hitChampAt: -10, lastHurt: -10, st: null,
      bot: { next: 0, retreat: false, runner: false, flagRun: false },
    });
    this.recalc(u);
    u.hp = u.st.maxHp;
    this.units.set(u.id, u);
    this.champs.push(u);
    return u;
  }

  spawnMinion(team, lane, type, offset) {
    const def = D.MINIONS[type];
    const path = this.lanePaths[team][lane];
    const p = pointAlong(path, 260 - offset * 42);
    const u = this.baseUnit('minion', team, p.x + (Math.random() - 0.5) * 20, p.y + (Math.random() - 0.5) * 20, def.r);
    const m = this.minute;
    Object.assign(u, { type, def, lane, wp: path, wi: Math.max(1, p.seg), hp: def.hp * (1 + 0.04 * m), ad: def.ad * (1 + 0.03 * m), armor: def.armor || 0, target: 0, scanAt: 0 });
    u.maxHp = u.hp;
    this.units.set(u.id, u);
  }

  spawnCamp(camp) {
    camp.members = [];
    const scale = 1 + 0.05 * this.minute;
    for (const [type, ox, oy] of camp.def.units) {
      const def = D.NEUTRALS[type];
      const u = this.baseUnit('neutral', 2, camp.x + ox, camp.y + oy, def.r);
      Object.assign(u, { type, def, camp: camp.i, hx: camp.x + ox, hy: camp.y + oy, hp: def.hp * scale, ad: def.ad * scale, aggro: 0, returning: false });
      u.maxHp = u.hp;
      u.ang = Math.PI / 2;
      this.units.set(u.id, u);
      camp.members.push(u);
    }
  }

  // ---------------- stats ----------------
  recalc(u) {
    const d = u.def, L = u.level - 1;
    const s = { maxHp: d.hp + d.hpL * L, ad: d.ad + d.adL * L, ap: 0, armor: d.armor + d.armorL * L, asPct: 0, ms: d.ms, msPct: 0, range: d.range, cdr: 0, ls: 0, regen: 2 + 0.25 * L };
    for (const id of u.items) {
      const it = D.ITEMS_BY_ID[id];
      for (const k in it.stats) {
        if (k === 'hp') s.maxHp += it.stats.hp; else s[k] = (s[k] || 0) + it.stats[k];
      }
    }
    for (const b of u.buffs) {
      if (!b.stats) continue;
      for (const k in b.stats) s[k] = (s[k] || 0) + b.stats[k];
    }
    s.as = Math.min(2.5, d.as * (1 + s.asPct / 100));
    s.ms = s.ms * (1 + s.msPct / 100);
    s.cdr = Math.min(40, s.cdr);
    const oldMax = u.st ? u.st.maxHp : s.maxHp;
    u.st = s;
    u.maxHp = s.maxHp;
    if (s.maxHp > oldMax) u.hp += s.maxHp - oldMax;
    u.hp = Math.min(u.hp, s.maxHp);
  }
  dmgVal(u, spec) {
    if (!spec) return 0;
    return (spec.b || 0) + (spec.l || 0) * (u.level - 1) + (spec.ad || 0) * u.st.ad + (spec.ap || 0) * u.st.ap + ((spec.hpPct || 0) / 100) * u.st.maxHp;
  }
  stunned(u) { return u.stunUntil > this.t; }
  rooted(u) { return u.rootUntil > this.t; }
  slowMul(u) {
    let m = 0;
    for (const s of u.slows) if (s.until > this.t && s.p > m) m = s.p;
    return 1 - m / 100;
  }
  speedOf(u) {
    if (this.rooted(u)) return 0;
    let ms = u.kind === 'champ' ? u.st.ms : u.def.ms;
    ms *= this.slowMul(u);
    if (u.kind === 'champ' && u.flag >= 0 && !u.items.includes('courier')) ms *= 1 - C.FLAG_SLOW / 100;
    return ms;
  }
  shieldOf(u) { let s = 0; if (u.shields) for (const x of u.shields) if (x.until > this.t) s += x.a; return s; }
  baseVulnerable(team) { return this.towers.some((tw) => tw.team === team && tw.tier === 1 && tw.dead); }

  // ---------------- events ----------------
  // route: 'all' | 0 | 1 | 'pos' (only teams who can see the position)
  ev(obj, route, at) { this.events.push({ obj, route, x: at ? at.x : obj.x, y: at ? at.y : obj.y }); }
  fx(obj) { this.ev(obj, 'pos'); }

  // ---------------- combat ----------------
  damage(src, dst, amt, opts = {}) {
    if (!dst || dst.dead || !(amt > 0)) return 0;
    if (dst.kind === 'neutral' && dst.returning) return 0;
    if (dst.kind === 'tower' && dst.base && !this.baseVulnerable(dst.team)) return 0;
    if (src && src.kind === 'champ' && src.buffs.some((b) => b.bull)) amt *= 1.15;
    if (!opts.true) {
      const ar = dst.kind === 'champ' ? dst.st.armor : dst.armor;
      amt = (amt * 100) / (100 + Math.max(0, ar || 0));
    }
    const dealt = amt;
    if (dst.shields && dst.shields.length) {
      for (const s of dst.shields) {
        if (s.until <= this.t) continue;
        const a = Math.min(s.a, amt); s.a -= a; amt -= a;
        if (amt <= 0) break;
      }
    }
    dst.hp -= amt;
    if (src && src.kind === 'champ') {
      if (dst.kind === 'champ') { dst.damagers.set(src.id, this.t); src.hitChampAt = this.t; }
      if (opts.auto && src.st.ls > 0) this.heal(src, (dealt * src.st.ls) / 100, false);
    }
    if (dst.kind === 'champ') { dst.recall = 0; dst.harvest = null; dst.lastHurt = this.t; }
    if (dst.kind === 'neutral') this.aggroCamp(dst, src);
    if ((src && src.kind === 'champ' && !src.isBot) || (dst.kind === 'champ' && !dst.isBot)) {
      this.ev({ e: 'd', x: dst.x | 0, y: (dst.y - dst.r) | 0, a: Math.round(dealt), s: src ? src.id : 0, v: dst.id }, 'pos');
    }
    if (dst.hp <= 0) { dst.hp = 0; this.kill(dst, src); }
    return dealt;
  }

  heal(u, amt, show = true) {
    if (u.dead || !(amt > 0)) return;
    const before = u.hp;
    u.hp = Math.min(u.maxHp, u.hp + amt);
    if (show && u.kind === 'champ' && !u.isBot && u.hp - before >= 1) {
      this.ev({ e: 'd', x: u.x | 0, y: (u.y - u.r) | 0, a: Math.round(u.hp - before), h: 1, s: u.id, v: u.id }, 'pos');
    }
  }

  applyFx(src, e, fx, ox, oy) {
    if (!fx || e.dead || e.kind === 'tower') return;
    const t = this.t;
    if (fx.slow) e.slows.push({ p: fx.slow.p, until: t + fx.slow.d });
    if (fx.root) e.rootUntil = Math.max(e.rootUntil, t + fx.root);
    if (fx.stun) {
      e.stunUntil = Math.max(e.stunUntil, t + fx.stun);
      this.interrupt(e);
    }
    if (fx.knock && !(e.def && e.def.big)) {
      let dx = e.x - ox, dy = e.y - oy;
      let d = hyp(dx, dy);
      if (d < 1) { const a = Math.random() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); d = 1; }
      const dur = 0.25;
      e.knock = { vx: ((dx / d) * fx.knock) / dur, vy: ((dy / d) * fx.knock) / dur, left: dur };
      this.interrupt(e);
    }
  }
  interrupt(e) {
    e.windup = 0;
    if (e.kind === 'champ') { e.recall = 0; e.harvest = null; e.dash = null; }
  }

  enemiesNear(team, x, y, r) {
    const out = [];
    for (const e of this.units.values()) {
      if (e.dead || e.team === team || e.kind === 'tower') continue;
      if (e.kind === 'neutral' && e.returning) continue;
      if (hyp(e.x - x, e.y - y) <= r + e.r) out.push(e);
    }
    return out;
  }

  kill(dst, src) {
    const t = this.t;
    if (dst.kind === 'champ') {
      dst.dead = true;
      dst.respawnAt = t + D.respawnTime(dst.level);
      dst.d++;
      Object.assign(dst, { cmd: null, path: [], dash: null, knock: null, recall: 0, harvest: null, windup: 0, slows: [], shields: [] });
      dst.buffs = dst.buffs.filter((b) => b.bull);
      const killer = src && src.kind === 'champ' ? src : null;
      if (killer) { killer.k++; killer.gold += 300; }
      for (const [id, tm] of dst.damagers) {
        if (t - tm > 10 || (killer && id === killer.id)) continue;
        const a = this.units.get(id);
        if (a && a.team !== dst.team) { a.a++; a.gold += 120; }
      }
      dst.damagers.clear();
      this.shareXp(1 - dst.team, dst.x, dst.y, 120 + 25 * dst.level, killer);
      if (dst.flag >= 0) this.dropFlag(dst);
      const kn = !src ? 'Fountain' : src.kind === 'champ' ? src.name : src.kind === 'tower' ? 'Grain Silo' : src.def.name;
      this.ev({ e: 'kill', k: src && src.kind === 'champ' ? src.id : 0, kn, kt: src ? src.team : 2, v: dst.id }, 'all');
    } else if (dst.kind === 'minion') {
      dst.dead = true;
      this.units.delete(dst.id);
      if (src && src.kind === 'champ') { src.gold += dst.def.gold; src.cs++; }
      this.shareXp(1 - dst.team, dst.x, dst.y, dst.def.xp, null);
    } else if (dst.kind === 'neutral') {
      dst.dead = true;
      this.units.delete(dst.id);
      const camp = this.camps[dst.camp];
      if (src && src.kind === 'champ') {
        src.gold += dst.def.gold; src.cs++;
        this.shareXp(src.team, dst.x, dst.y, dst.def.xp, src);
      }
      if (camp.members.every((m) => m.dead)) {
        camp.respawnAt = t + camp.def.respawn;
        if (src && src.kind === 'champ' && camp.def.reward) this.campReward(camp, src.team);
      }
    } else if (dst.kind === 'tower') {
      dst.dead = true;
      dst.hp = 0;
      dst.target = 0;
      for (const c of this.champs) if (c.team !== dst.team) c.gold += 150;
      if (dst.base) dst.rebuildAt = t + D.TOWER_STATS.base.rebuild;
      this.ev({ e: 'tower', tm: dst.team, tier: dst.tier, lane: dst.lane }, 'all');
    }
  }

  campReward(camp, team) {
    if (camp.def.reward === 'goose') {
      for (const c of this.champs) if (c.team === team) c.gold += 120;
    } else if (camp.def.reward === 'bull') {
      for (const c of this.champs) if (c.team === team) {
        c.buffs = c.buffs.filter((b) => !b.bull);
        c.buffs.push({ bull: true, until: this.t + 120, stats: { msPct: 10 } });
      }
    }
    this.ev({ e: 'obj', k: camp.def.reward, tm: team }, 'all');
  }

  shareXp(team, x, y, amt, must) {
    const got = this.champs.filter((c) => c.team === team && !c.dead && (c === must || hyp(c.x - x, c.y - y) < 1300));
    if (!got.length) return;
    const each = (amt / got.length) * (1 + 0.2 * (got.length - 1));
    for (const c of got) this.grantXp(c, each);
  }

  grantXp(u, amt) {
    if (u.level >= C.MAX_LEVEL) return;
    u.xp += amt;
    while (u.level < C.MAX_LEVEL && u.xp >= D.xpToNext(u.level)) {
      u.xp -= D.xpToNext(u.level);
      u.level++;
      this.recalc(u);
      this.ev({ e: 'lvl', id: u.id, l: u.level, x: u.x | 0, y: u.y | 0 }, 'pos');
    }
    if (u.level >= C.MAX_LEVEL) u.xp = 0;
  }

  // ---------------- attacks ----------------
  attackLogic(u, T, ad, as, range, ranged, vis) {
    const d = hyp(T.x - u.x, T.y - u.y);
    const reach = range + u.r + T.r;
    if (d > reach) { u.windup = 0; return false; }
    u.ang = Math.atan2(T.y - u.y, T.x - u.x);
    if (u.windup > 0) {
      u.windup -= DT;
      if (u.windup <= 0) {
        u.windup = 0;
        this.hitAttack(u, T, ad, ranged, vis);
        u.attackCd = 1 / as - u.windDur;
      }
    } else if (u.attackCd <= 0) {
      u.windDur = Math.min(0.22, 0.3 / as);
      u.windup = u.windDur;
    }
    return true;
  }

  hitAttack(u, T, ad, ranged, vis) {
    if (ranged) {
      this.projs.push({ id: this.id(), homing: true, owner: u.id, team: u.team, x: u.x, y: u.y, target: T.id, speed: 1500, dmg: ad, vis: vis || 'atk' });
    } else {
      this.damage(u, T, ad, { auto: true });
      this.fx({ e: 'fx', k: 'hit', x: T.x | 0, y: T.y | 0 });
    }
  }

  // ---------------- abilities ----------------
  cast(u, key, tx, ty) {
    if (u.dead || this.over || this.stunned(u) || u.knock || u.dash) return;
    const ab = u.def.abilities[key];
    if (!ab) return;
    if (key === 'R' && u.level < C.R_LEVEL) return;
    if (u.cds[key] > 0) return;
    if (!isFinite(tx) || !isFinite(ty)) return;
    let dx = tx - u.x, dy = ty - u.y;
    let len = hyp(dx, dy);
    if (len < 1) { dx = Math.cos(u.ang); dy = Math.sin(u.ang); len = 1; tx = u.x + dx; ty = u.y + dy; }
    const nx = dx / len, ny = dy / len;
    const ok = this.execAbility(u, ab, nx, ny, tx, ty, len);
    if (ok === false) return;
    u.cds[key] = ab.cd * (1 - u.st.cdr / 100);
    u.ang = Math.atan2(ny, nx);
    u.recall = 0;
    u.harvest = null;
  }

  execAbility(u, ab, nx, ny, tx, ty, len) {
    const t = this.t;
    const reach = Math.min(len, ab.range || 0);
    const px = u.x + nx * reach, py = u.y + ny * reach;
    switch (ab.type) {
      case 'skillshot':
        this.projs.push({ id: this.id(), owner: u.id, team: u.team, x: u.x + nx * u.r, y: u.y + ny * u.r, vx: nx * ab.speed, vy: ny * ab.speed,
          left: ab.range, w: ab.width, dmg: this.dmgVal(u, ab.dmg), fxs: ab.fx, pierce: !!ab.pierce, explode: ab.explode || 0, vis: ab.vis, hit: new Set() });
        return true;
      case 'cone': {
        const a = Math.atan2(ny, nx), half = ((ab.arc * Math.PI) / 180) / 2;
        const dmg = this.dmgVal(u, ab.dmg);
        for (const e of this.enemiesNear(u.team, u.x, u.y, ab.range)) {
          if (hyp(e.x - u.x, e.y - u.y) > e.r + 10 && angDiff(Math.atan2(e.y - u.y, e.x - u.x), a) > half + 0.12) continue;
          this.damage(u, e, dmg);
          this.applyFx(u, e, ab.fx, u.x, u.y);
        }
        this.fx({ e: 'fx', k: 'cone', x: u.x | 0, y: u.y | 0, a: +a.toFixed(2), r: ab.range, arc: ab.arc, c: ab.vis });
        return true;
      }
      case 'ground_aoe':
        this.zones.push({ id: this.id(), kind: 't', owner: u.id, team: u.team, x: px, y: py, r: ab.radius, start: t, at: t + ab.delay, dmg: this.dmgVal(u, ab.dmg), fxs: ab.fx, vis: ab.vis });
        return true;
      case 'barrage': {
        const dmg = this.dmgVal(u, ab.dmg);
        for (let i = 0; i < ab.n; i++) {
          const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * ab.radius;
          const at = t + ab.delay + (i * ab.dur) / ab.n;
          this.zones.push({ id: this.id(), kind: 't', owner: u.id, team: u.team, x: px + Math.cos(a) * rr, y: py + Math.sin(a) * rr, r: ab.aoe, start: at - ab.delay, at, dmg, fxs: ab.fx, vis: ab.vis });
        }
        this.zones.push({ id: this.id(), kind: 'area', owner: u.id, team: u.team, x: px, y: py, r: ab.radius, start: t, until: t + ab.delay + ab.dur, vis: ab.vis });
        return true;
      }
      case 'self_aoe': {
        if (ab.dmg || ab.fx) {
          const dmg = this.dmgVal(u, ab.dmg);
          for (const e of this.enemiesNear(u.team, u.x, u.y, ab.radius)) {
            if (dmg) this.damage(u, e, dmg);
            this.applyFx(u, e, ab.fx, u.x, u.y);
          }
        }
        if (ab.allyHeal) {
          const h = this.dmgVal(u, ab.allyHeal);
          for (const c of this.champs) if (c.team === u.team && !c.dead && hyp(c.x - u.x, c.y - u.y) <= ab.radius + c.r) this.heal(c, h);
        }
        this.fx({ e: 'fx', k: 'ring', x: u.x | 0, y: u.y | 0, r: ab.radius, c: ab.vis });
        return true;
      }
      case 'zone':
        this.zones.push({ id: this.id(), kind: 'z', owner: u.id, team: u.team, x: px, y: py, r: ab.radius, start: t, until: t + ab.dur,
          tickDmg: ab.tick ? this.dmgVal(u, ab.tick) : 0, nextTick: t, slow: ab.slow || 0, vis: ab.vis });
        return true;
      case 'buff': {
        const b = { until: t + ab.dur, stats: ab.stats || null };
        if (ab.hot) b.hot = this.dmgVal(u, ab.hot) / ab.dur;
        u.buffs.push(b);
        if (ab.heal) this.heal(u, this.dmgVal(u, ab.heal));
        if (ab.cleanse) { u.slows = []; u.rootUntil = 0; }
        this.recalc(u);
        this.fx({ e: 'fx', k: 'buff', x: u.x | 0, y: u.y | 0, id: u.id });
        return true;
      }
      case 'ally': {
        let best = u, bd = hyp(tx - u.x, ty - u.y);
        for (const c of this.champs) {
          if (c.team !== u.team || c.dead || c === u) continue;
          if (hyp(c.x - u.x, c.y - u.y) > ab.range) continue;
          const d = hyp(tx - c.x, ty - c.y);
          if (d < bd) { bd = d; best = c; }
        }
        if (ab.shield) best.shields.push({ a: this.dmgVal(u, ab.shield), until: t + ab.dur });
        if (ab.stats) { best.buffs.push({ until: t + ab.dur, stats: ab.stats }); this.recalc(best); }
        this.fx({ e: 'fx', k: 'buff', x: best.x | 0, y: best.y | 0, id: best.id });
        return true;
      }
      case 'dash':
        u.dash = { nx, ny, left: ab.range, speed: ab.speed, dmg: ab.dmg ? this.dmgVal(u, ab.dmg) : 0, fxs: ab.fx, stopOnHit: !!ab.stopOnHit, hit: new Set(), time: 0 };
        u.windup = 0;
        return true;
      case 'leap':
        u.dash = { nx, ny, left: Math.max(60, reach), speed: ab.speed, land: { r: ab.land.r, dmg: this.dmgVal(u, ab.land.dmg), fxs: ab.land.fx }, hit: new Set(), time: 0 };
        u.windup = 0;
        return true;
      case 'blink': {
        const ox = u.x, oy = u.y;
        let bx = px, by = py;
        for (let i = 0; i < 20 && this.nav.blocked(bx, by); i++) { bx -= nx * 20; by -= ny * 20; }
        u.x = bx; u.y = by;
        this.nav.pushOut(u);
        u.path = []; if (u.cmd && u.cmd.type !== 'attack') u.cmd = null;
        this.fx({ e: 'fx', k: 'blink', x: ox | 0, y: oy | 0, x2: u.x | 0, y2: u.y | 0 });
        return true;
      }
      case 'targeted': {
        let best = null, bd = 220;
        for (const e of this.units.values()) {
          if (e.dead || e.team === u.team || e.kind === 'tower') continue;
          if (!this.canSee(u.team, e)) continue;
          if (hyp(e.x - u.x, e.y - u.y) > ab.range + e.r) continue;
          let d = hyp(e.x - tx, e.y - ty);
          if (e.kind === 'champ') d -= 60; // prefer champions
          if (d < bd) { bd = d; best = e; }
        }
        if (!best) return false;
        u.dash = { target: best.id, speed: ab.speed, dmg: this.dmgVal(u, ab.dmg), fxs: ab.fx, time: 0 };
        u.windup = 0;
        return true;
      }
    }
    return false;
  }

  // ---------------- movement helpers ----------------
  moveAlong(u, step) {
    while (step > 0 && u.path.length) {
      const p = u.path[0];
      const dx = p.x - u.x, dy = p.y - u.y, d = hyp(dx, dy);
      if (d > 0.01) u.ang = Math.atan2(dy, dx);
      if (d <= step) { u.x = p.x; u.y = p.y; step -= d; u.path.shift(); }
      else { u.x += (dx / d) * step; u.y += (dy / d) * step; step = 0; }
    }
    this.nav.pushOut(u);
  }
  moveToward(u, x, y, speed) {
    const dx = x - u.x, dy = y - u.y, d = hyp(dx, dy);
    if (d < 1) return;
    const step = Math.min(d, speed * DT);
    u.x += (dx / d) * step; u.y += (dy / d) * step;
    u.ang = Math.atan2(dy, dx);
    this.nav.pushOut(u);
  }
  stepKnock(u) {
    u.x += u.knock.vx * DT; u.y += u.knock.vy * DT;
    u.knock.left -= DT;
    this.nav.pushOut(u);
    if (u.knock.left <= 0) u.knock = null;
  }
  stepDash(u) {
    const d = u.dash;
    d.time += DT;
    if (d.target) {
      const T = this.units.get(d.target);
      if (!T || T.dead || d.time > 1.2) { u.dash = null; return; }
      const dx = T.x - u.x, dy = T.y - u.y, dd = hyp(dx, dy), reach = u.r + T.r + 6;
      u.ang = Math.atan2(dy, dx);
      if (dd <= reach + d.speed * DT) {
        if (dd > reach) { u.x += (dx / dd) * (dd - reach); u.y += (dy / dd) * (dd - reach); }
        this.damage(u, T, d.dmg);
        this.applyFx(u, T, d.fxs, u.x, u.y);
        this.fx({ e: 'fx', k: 'hit', x: T.x | 0, y: T.y | 0, big: 1 });
        u.dash = null;
        if (!T.dead) { u.cmd = { type: 'attack', target: T.id }; u.path = []; }
        this.nav.pushOut(u);
        return;
      }
      u.x += (dx / dd) * d.speed * DT; u.y += (dy / dd) * d.speed * DT;
      return;
    }
    const step = Math.min(d.speed * DT, d.left);
    u.x += d.nx * step; u.y += d.ny * step; d.left -= step;
    u.ang = Math.atan2(d.ny, d.nx);
    if (d.land) {
      u.x = clamp(u.x, u.r, D.W - u.r); u.y = clamp(u.y, u.r, D.H - u.r);
      if (d.left <= 0) {
        if (this.nav.blocked(u.x, u.y)) { const p = this.nav.nearestFree(u.x, u.y); u.x = p.x; u.y = p.y; }
        this.nav.pushOut(u);
        for (const e of this.enemiesNear(u.team, u.x, u.y, d.land.r)) {
          this.damage(u, e, d.land.dmg);
          this.applyFx(u, e, d.land.fxs, u.x, u.y);
        }
        this.fx({ e: 'fx', k: 'ring', x: u.x | 0, y: u.y | 0, r: d.land.r, c: '#e5e7eb' });
        u.dash = null; u.path = [];
      }
      return;
    }
    if (d.dmg || d.fxs) {
      for (const e of this.enemiesNear(u.team, u.x, u.y, u.r + 20)) {
        if (d.hit.has(e.id)) continue;
        d.hit.add(e.id);
        if (d.dmg) this.damage(u, e, d.dmg);
        this.applyFx(u, e, d.fxs, u.x - d.nx * 60, u.y - d.ny * 60);
        this.fx({ e: 'fx', k: 'hit', x: e.x | 0, y: e.y | 0, big: 1 });
        if (d.stopOnHit) { d.left = 0; break; }
      }
    }
    if (this.nav.pushOut(u)) d.left = 0;
    if (d.left <= 0) { u.dash = null; u.path = []; }
  }

  // ---------------- per-unit updates ----------------
  updateChamp(u) {
    const t = this.t;
    if (u.dead) {
      if (t >= u.respawnAt) {
        const f = D.FOUNTAINS[u.team];
        u.dead = false; u.x = f.x + (u.team === 0 ? 60 : -60); u.y = f.y + (u.slot - 1) * 70;
        this.recalc(u); u.hp = u.st.maxHp; u.cmd = null; u.path = [];
        this.ev({ e: 'spawn', id: u.id }, u.team);
      }
      return;
    }
    const nb = u.buffs.length;
    u.buffs = u.buffs.filter((b) => b.until > t);
    if (u.slows.length) u.slows = u.slows.filter((s) => s.until > t);
    if (u.shields.length) u.shields = u.shields.filter((s) => s.until > t && s.a > 0.5);
    this.recalc(u);
    void nb;
    let regen = u.st.regen;
    for (const b of u.buffs) if (b.hot) regen += b.hot;
    const f = D.FOUNTAINS[u.team];
    if (hyp(u.x - f.x, u.y - f.y) < C.FOUNTAIN_R + 60) regen += u.st.maxHp * 0.15;
    u.hp = Math.min(u.st.maxHp, u.hp + regen * DT);
    const ef = D.FOUNTAINS[1 - u.team];
    if (hyp(u.x - ef.x, u.y - ef.y) < C.FOUNTAIN_R + u.r) { this.damage(null, u, 600 * DT, { true: true }); if (u.dead) return; }
    for (const k in u.cds) if (u.cds[k] > 0) u.cds[k] = Math.max(0, u.cds[k] - DT);
    u.attackCd -= DT;

    if (u.knock) { this.stepKnock(u); return; }
    if (u.dash) { this.stepDash(u); return; }
    if (this.stunned(u)) { u.windup = 0; return; }
    if (u.recall) {
      if (t >= u.recall) {
        u.recall = 0;
        this.fx({ e: 'fx', k: 'blink', x: u.x | 0, y: u.y | 0, x2: (f.x + (u.team === 0 ? 60 : -60)) | 0, y2: f.y | 0 });
        u.x = f.x + (u.team === 0 ? 60 : -60); u.y = f.y + (u.slot - 1) * 70;
        u.path = []; u.cmd = null;
      }
      return;
    }
    if (u.harvest) {
      const crop = this.crops[u.harvest.crop];
      if (!crop.ripe) { u.harvest = null; }
      else if (t >= u.harvest.until) {
        crop.ripe = false; crop.regrowAt = t + crop.def.regrow;
        const xp = crop.def.xp * (1 + 0.06 * this.minute);
        this.grantXp(u, xp);
        u.gold += crop.def.gold;
        this.ev({ e: 'crop', id: u.id, c: crop.idx, xp: Math.round(xp), g: crop.def.gold, x: crop.x, y: crop.y }, 'pos');
        u.harvest = null;
      }
      return;
    }

    const cmd = u.cmd;
    const speed = this.speedOf(u);
    if (cmd && cmd.type === 'attack') {
      const T = this.units.get(cmd.target);
      if (!T || T.dead || !this.canSee(u.team, T)) { u.cmd = null; u.windup = 0; u.path = []; return; }
      const inRange = this.attackLogic(u, T, u.st.ad, u.st.as, u.st.range, !!u.def.ranged, u.def.atk || 'atk');
      if (inRange) { u.path = []; }
      else if (speed > 0) {
        if (t >= u.repathAt || !u.path.length) {
          u.path = this.nav.los(u.x, u.y, T.x, T.y) ? [{ x: T.x, y: T.y }] : this.nav.findPath(u.x, u.y, T.x, T.y);
          u.repathAt = t + 0.3;
        }
        this.moveAlong(u, speed * DT);
      }
      return;
    }
    if (cmd && cmd.type === 'harvest') {
      const crop = this.crops[cmd.crop];
      if (!crop.ripe) { u.cmd = null; u.path = []; return; }
      if (hyp(crop.x - u.x, crop.y - u.y) <= C.HARVEST_R + u.r) {
        u.cmd = null; u.path = [];
        u.harvest = { crop: crop.idx, until: t + crop.def.time, total: crop.def.time };
        return;
      }
      if (!u.path.length) u.path = this.nav.findPath(u.x, u.y, crop.x, crop.y);
      if (speed > 0) this.moveAlong(u, speed * DT);
      return;
    }
    if (u.path.length && speed > 0) {
      this.moveAlong(u, speed * DT);
      if (!u.path.length) u.cmd = null;
    }
  }

  updateMinion(m) {
    const t = this.t;
    if (m.slows.length) m.slows = m.slows.filter((s) => s.until > t);
    m.attackCd -= DT;
    if (m.knock) { this.stepKnock(m); return; }
    if (this.stunned(m)) { m.windup = 0; return; }
    let T = m.target ? this.units.get(m.target) : null;
    if (T && (T.dead || hyp(T.x - m.x, T.y - m.y) > 800)) { T = null; m.target = 0; }
    if (t >= m.scanAt) {
      m.scanAt = t + 0.25;
      let pri = null;
      for (const c of this.champs) {
        if (c.team === m.team || c.dead) continue;
        if (c.hitChampAt > t - 1.5 && hyp(c.x - m.x, c.y - m.y) < 550 && this.canSee(m.team, c)) { pri = c; break; }
      }
      if (pri) T = pri;
      else if (!T || T.kind === 'champ' || hyp(T.x - m.x, T.y - m.y) > m.def.range + m.r + T.r + 60) {
        let best = null, bd = 550, bestC = null, bdc = 550;
        for (const e of this.units.values()) {
          if (e.dead || e.team === m.team || e.team === 2) continue;
          const d = hyp(e.x - m.x, e.y - m.y) - e.r;
          if (e.kind === 'champ') { if (d < bdc && this.canSee(m.team, e)) { bdc = d; bestC = e; } }
          else if (d < bd) { bd = d; best = e; }
        }
        T = best || bestC || null;
      }
      m.target = T ? T.id : 0;
    }
    const speed = this.speedOf(m);
    if (T) {
      const ok = this.attackLogic(m, T, m.ad, m.def.as, m.def.range, !!m.def.ranged, m.def.vis);
      if (!ok && speed > 0) this.moveToward(m, T.x, T.y, speed);
      return;
    }
    if (m.wi < m.wp.length && speed > 0) {
      const [wx, wy] = m.wp[m.wi];
      if (hyp(wx - m.x, wy - m.y) < 50) m.wi++;
      else this.moveToward(m, wx, wy, speed);
    }
  }

  updateNeutral(n) {
    const t = this.t;
    if (n.slows.length) n.slows = n.slows.filter((s) => s.until > t);
    n.attackCd -= DT;
    if (n.knock) { this.stepKnock(n); return; }
    if (this.stunned(n)) { n.windup = 0; return; }
    if (n.returning) {
      this.moveToward(n, n.hx, n.hy, 450);
      n.hp = Math.min(n.maxHp, n.hp + n.maxHp * 0.25 * DT);
      if (hyp(n.x - n.hx, n.y - n.hy) < 8) { n.returning = false; n.hp = n.maxHp; n.ang = Math.PI / 2; }
      return;
    }
    if (n.aggro) {
      const T = this.units.get(n.aggro);
      if (!T || T.dead || hyp(n.x - n.hx, n.y - n.hy) > 700) {
        n.aggro = 0; n.returning = true; n.windup = 0; n.slows = [];
        for (const m of this.camps[n.camp].members) if (!m.dead && m.aggro) { m.aggro = 0; m.returning = true; }
        return;
      }
      const ok = this.attackLogic(n, T, n.ad, n.def.as, n.def.range, !!n.def.ranged, n.def.vis);
      if (!ok) { const sp = this.speedOf(n); if (sp > 0) this.moveToward(n, T.x, T.y, sp); }
      return;
    }
    if (n.hp < n.maxHp) n.hp = Math.min(n.maxHp, n.hp + n.maxHp * 0.02 * DT);
  }

  aggroCamp(n, src) {
    if (!src || src.kind !== 'champ' || n.returning) return;
    for (const m of this.camps[n.camp].members) if (!m.dead && !m.returning && !m.aggro) m.aggro = src.id;
  }

  updateTower(tw) {
    const t = this.t;
    if (tw.dead) {
      if (tw.base && tw.rebuildAt && t >= tw.rebuildAt) {
        tw.dead = false; tw.hp = tw.maxHp; tw.rebuildAt = 0;
        this.ev({ e: 'rebuild', tm: tw.team }, 'all');
      }
      return;
    }
    tw.attackCd -= DT;
    const inR = (e) => e && !e.dead && e.kind !== 'neutral' && e.team !== tw.team && hyp(e.x - tw.x, e.y - tw.y) <= tw.range + e.r;
    let T = tw.target ? this.units.get(tw.target) : null;
    let pri = null;
    for (const c of this.champs) if (c.team !== tw.team && c.hitChampAt > t - 1.5 && inR(c)) { pri = c; break; }
    if (pri) T = pri;
    else if (!inR(T)) {
      T = null;
      let bd = Infinity, bc = null, bcd = Infinity;
      for (const e of this.units.values()) {
        if (!inR(e) || e.kind === 'tower') continue;
        const d = hyp(e.x - tw.x, e.y - tw.y);
        if (e.kind === 'champ') { if (d < bcd) { bcd = d; bc = e; } }
        else if (d < bd) { bd = d; T = e; }
      }
      if (!T) T = bc;
    }
    tw.target = T ? T.id : 0;
    if (T && tw.attackCd <= 0) {
      const champ = T.kind === 'champ';
      const dmg = champ ? tw.st.ad + tw.st.adPerMin * this.minute : T.maxHp * 0.3;
      this.projs.push({ id: this.id(), homing: true, owner: tw.id, team: tw.team, x: tw.x, y: tw.y - 30, target: T.id, speed: 1300, dmg, tru: !champ, vis: 'tower' });
      tw.attackCd = 1 / tw.st.as;
    }
  }

  updateProjs() {
    const keep = [];
    for (const p of this.projs) {
      const src = this.units.get(p.owner) || null;
      if (p.homing) {
        const T = this.units.get(p.target);
        if (!T || T.dead) continue;
        const dx = T.x - p.x, dy = T.y - p.y, d = hyp(dx, dy);
        const step = p.speed * DT;
        if (d <= step + T.r * 0.5) {
          this.damage(src, T, p.dmg, { auto: true, true: !!p.tru });
          continue;
        }
        p.x += (dx / d) * step; p.y += (dy / d) * step;
        keep.push(p);
        continue;
      }
      const step = Math.min(p.left, hyp(p.vx, p.vy) * DT);
      const sp = hyp(p.vx, p.vy);
      p.x += (p.vx / sp) * step; p.y += (p.vy / sp) * step; p.left -= step;
      let alive = true;
      for (const e of this.enemiesNear(p.team, p.x, p.y, p.w / 2)) {
        if (p.hit.has(e.id)) continue;
        if (p.explode) { this.explode(src, p); alive = false; break; }
        p.hit.add(e.id);
        this.damage(src, e, p.dmg);
        this.applyFx(src, e, p.fxs, p.x - p.vx, p.y - p.vy);
        this.fx({ e: 'fx', k: 'hit', x: e.x | 0, y: e.y | 0 });
        if (!p.pierce) { alive = false; break; }
      }
      if (alive && p.left <= 0) { if (p.explode) this.explode(src, p); alive = false; }
      if (alive) keep.push(p);
    }
    this.projs = keep;
  }
  explode(src, p) {
    for (const e of this.enemiesNear(p.team, p.x, p.y, p.explode)) {
      this.damage(src, e, p.dmg);
      this.applyFx(src, e, p.fxs, p.x, p.y);
    }
    this.fx({ e: 'fx', k: 'boom', x: p.x | 0, y: p.y | 0, r: p.explode, c: '#fbbf24' });
  }

  updateZones() {
    const t = this.t, keep = [];
    for (const z of this.zones) {
      const src = this.units.get(z.owner) || null;
      if (z.kind === 't') {
        if (t >= z.at) {
          for (const e of this.enemiesNear(z.team, z.x, z.y, z.r)) {
            this.damage(src, e, z.dmg);
            this.applyFx(src, e, z.fxs, z.x, z.y);
          }
          this.fx({ e: 'fx', k: 'boom', x: z.x | 0, y: z.y | 0, r: z.r, c: z.vis });
          continue;
        }
      } else if (z.kind === 'z') {
        if (t >= z.until) continue;
        const inside = this.enemiesNear(z.team, z.x, z.y, z.r);
        for (const e of inside) if (z.slow) e.slows.push({ p: z.slow, until: t + 0.25 });
        if (z.tickDmg && t >= z.nextTick) {
          z.nextTick = t + 0.5;
          for (const e of inside) this.damage(src, e, z.tickDmg);
        }
      } else if (z.kind === 'area') {
        if (t >= z.until) continue;
      }
      keep.push(z);
    }
    this.zones = keep;
  }

  // ---------------- flags ----------------
  flagHome(f) { f.state = 'home'; f.x = D.BASES[f.team].x; f.y = D.BASES[f.team].y; f.carrier = 0; }
  dropFlag(u) {
    const f = this.flags[u.flag];
    u.flag = -1;
    const p = this.nav.blocked(u.x, u.y) ? this.nav.nearestFree(u.x, u.y) : { x: u.x, y: u.y };
    f.state = 'dropped'; f.x = p.x; f.y = p.y; f.carrier = 0; f.returnAt = this.t + C.FLAG_RETURN;
    this.ev({ e: 'flag', a: 'dropped', ft: f.team, by: u.id }, 'all');
  }
  updateFlags() {
    for (const f of this.flags) {
      if (f.state === 'carried') {
        const c = this.units.get(f.carrier);
        if (!c || c.dead) { if (c) { c.flag = f.team; this.dropFlag(c); } else this.flagHome(f); }
        else { f.x = c.x; f.y = c.y; }
      } else if (f.state === 'dropped' && this.t >= f.returnAt) {
        this.flagHome(f);
        this.ev({ e: 'flag', a: 'reset', ft: f.team, by: 0 }, 'all');
      }
    }
    for (const u of this.champs) {
      if (u.dead || u.dash && u.dash.land) continue;
      for (const f of this.flags) {
        if (f.state === 'carried') continue;
        if (hyp(u.x - f.x, u.y - f.y) > C.FLAG_PICK_R + u.r) continue;
        if (f.team !== u.team) {
          if (u.flag < 0) {
            f.state = 'carried'; f.carrier = u.id; u.flag = f.team; u.recall = 0;
            this.ev({ e: 'flag', a: 'taken', ft: f.team, by: u.id }, 'all');
          }
        } else if (f.state === 'dropped') {
          this.flagHome(f);
          u.gold += 50;
          this.ev({ e: 'flag', a: 'returned', ft: f.team, by: u.id }, 'all');
        }
      }
      if (u.flag >= 0) {
        const b = D.BASES[u.team];
        if (hyp(u.x - b.x, u.y - b.y) < C.CAPTURE_R) {
          if (this.flags[u.team].state === 'home') {
            const ft = u.flag;
            this.flagHome(this.flags[ft]);
            u.flag = -1;
            this.score[u.team]++;
            u.gold += 250;
            for (const c of this.champs) if (c.team === u.team && c !== u) c.gold += 100;
            this.ev({ e: 'flag', a: 'captured', ft, by: u.id }, 'all');
            if (this.score[u.team] >= C.CAPTURES_TO_WIN) this.finish(u.team);
          } else if (!u.capWarnAt || this.t - u.capWarnAt > 3) {
            u.capWarnAt = this.t;
            this.ev({ e: 'needflag', id: u.id }, u.team);
          }
        }
      }
    }
  }

  finish(team) {
    if (this.over) return;
    this.over = true;
    this.winner = team;
    this.ev({ e: 'win', tm: team }, 'all');
    this.sendSnapshots();
    this.io.end(team, this.scoreboard());
  }

  // ---------------- vision ----------------
  computeVision() {
    for (const tm of [0, 1]) {
      const s = [[D.BASES[tm].x, D.BASES[tm].y, C.VISION_BASE]];
      for (const u of this.units.values()) {
        if (u.team !== tm || u.dead) continue;
        if (u.kind === 'champ') s.push([u.x, u.y, C.VISION_CHAMP]);
        else if (u.kind === 'minion') s.push([u.x, u.y, C.VISION_MINION]);
        else if (u.kind === 'tower') s.push([u.x, u.y, C.VISION_TOWER]);
      }
      this.vis[tm] = s;
    }
  }
  seesPoint(team, x, y, r = 0) {
    for (const s of this.vis[team]) {
      const rr = s[2] + r;
      const dx = s[0] - x, dy = s[1] - y;
      if (dx * dx + dy * dy <= rr * rr) return true;
    }
    return false;
  }
  canSee(team, e) {
    if (e.team === team) return true;
    if (e.kind === 'tower') return true;
    if (e.kind === 'champ' && e.flag >= 0) return true;
    return this.seesPoint(team, e.x, e.y, e.r);
  }

  // ---------------- input ----------------
  input(pid, m) {
    const u = this.champs.find((c) => c.pid === pid);
    if (!u || this.over) return;
    switch (m.t) {
      case 'move': {
        const x = +m.x, y = +m.y;
        if (!isFinite(x) || !isFinite(y)) return;
        this.cmdClick(u, clamp(x, 0, D.W), clamp(y, 0, D.H));
        break;
      }
      case 'cast': if (['Q', 'W', 'E', 'R'].includes(m.k)) this.cast(u, m.k, +m.x, +m.y); break;
      case 'stop': u.cmd = null; u.path = []; u.harvest = null; break;
      case 'recall': this.startRecall(u); break;
      case 'buy': this.buy(u, String(m.id)); break;
      case 'sell': this.sell(u, m.slot | 0); break;
      case 'chat': {
        const text = String(m.m || '').slice(0, 140).trim();
        if (text) this.ev({ e: 'chat', from: u.name, id: u.id, m: text }, u.team);
        break;
      }
    }
  }
  cmdClick(u, x, y) {
    if (u.dead) return;
    u.recall = 0; u.harvest = null;
    let best = null, bd = Infinity;
    for (const e of this.units.values()) {
      if (e.team === u.team || e.dead) continue;
      if (!this.canSee(u.team, e)) continue;
      const d = hyp(e.x - x, e.y - y);
      if (d < e.r + 28 && d < bd) { best = e; bd = d; }
    }
    if (best) {
      if (!u.cmd || u.cmd.target !== best.id) u.windup = 0;
      u.cmd = { type: 'attack', target: best.id };
      u.path = [];
      return;
    }
    for (const c of this.crops) {
      if (c.ripe && hyp(c.x - x, c.y - y) < 50) {
        u.cmd = { type: 'harvest', crop: c.idx };
        u.path = this.nav.findPath(u.x, u.y, c.x, c.y);
        return;
      }
    }
    u.cmd = { type: 'move' };
    u.windup = 0;
    u.path = this.nav.findPath(u.x, u.y, x, y);
  }
  startRecall(u) {
    if (u.dead || u.recall || u.dash) return;
    if (u.flag >= 0) { this.ev({ e: 'msg', id: u.id, m: "You can't recall while carrying a flag!" }, u.team); return; }
    u.recall = this.t + C.RECALL_TIME; u.recallStart = this.t;
    u.cmd = null; u.path = []; u.harvest = null; u.windup = 0;
  }
  canShop(u) {
    const f = D.FOUNTAINS[u.team];
    return u.dead || hyp(u.x - f.x, u.y - f.y) < C.SHOP_R;
  }
  buy(u, id) {
    const it = D.ITEMS_BY_ID[id];
    if (!it || !this.canShop(u) || u.items.length >= 6 || u.gold < it.cost) return false;
    if (id === 'courier' && u.items.includes('courier')) return false;
    u.gold -= it.cost;
    u.items.push(id);
    this.recalc(u);
    return true;
  }
  sell(u, slot) {
    if (!this.canShop(u) || slot < 0 || slot >= u.items.length) return;
    const it = D.ITEMS_BY_ID[u.items[slot]];
    u.items.splice(slot, 1);
    u.gold += Math.floor(it.cost * 0.6);
    this.recalc(u);
  }

  // ---------------- bots ----------------
  botThink(u) {
    const b = u.bot, t = this.t;
    if (t < b.next) return;
    b.next = t + 0.25 + Math.random() * 0.1;
    if (u.dead) { this.botShop(u); return; }
    if (u.dash || u.knock) return;
    const et = 1 - u.team, home = D.FOUNTAINS[u.team], myBase = D.BASES[u.team];
    const hpPct = u.hp / u.st.maxHp;
    const atHome = hyp(u.x - home.x, u.y - home.y) < C.SHOP_R - 40;
    if (atHome) this.botShop(u);
    const enemies = this.champs.filter((c) => c.team === et && !c.dead && this.canSee(u.team, c) && hyp(c.x - u.x, c.y - u.y) < 950)
      .sort((a, c) => hyp(a.x - u.x, a.y - u.y) - hyp(c.x - u.x, c.y - u.y));
    const foe = enemies[0] || null;
    const foeD = foe ? hyp(foe.x - u.x, foe.y - u.y) : Infinity;

    if (u.flag >= 0) {
      if (foe && foeD < 500) this.botAbilities(u, foe, true);
      this.botGo(u, myBase.x, myBase.y);
      return;
    }
    const twc = this.enemyTowerCovering(u.team, u.x, u.y);
    if (twc && (twc.target === u.id || b.retreat) && !(b.flagRun && hpPct > 0.6)) {
      const dx = u.x - twc.x, dy = u.y - twc.y, dl = hyp(dx, dy) || 1;
      u.recall = 0;
      this.botGo(u, twc.x + (dx / dl) * (twc.range + 150), twc.y + (dy / dl) * (twc.range + 150));
      return;
    }
    if (b.retreat) {
      if (hpPct > 0.92) b.retreat = false;
      else {
        if (atHome) { u.cmd = null; u.path = []; return; }
        if (u.recall) return;
        if (!foe || foeD > 1000) { this.startRecall(u); return; }
        this.botAbilities(u, foe, true);
        this.botGo(u, home.x, home.y);
        return;
      }
    }
    if (hpPct < 0.28 && !(foe && foe.flag >= 0)) { b.retreat = true; return; }
    if (u.recall) return;

    if (foe && foeD < 750 && (hpPct > 0.45 || foe.hp / foe.st.maxHp < hpPct || foe.flag >= 0)) {
      const tw = this.enemyTowerCovering(u.team, foe.x, foe.y);
      if (!tw || foe.hp < foe.st.maxHp * 0.3 || foe.flag >= 0) {
        this.botAbilities(u, foe, false);
        this.botAttack(u, foe);
        return;
      }
    }
    const ownFlag = this.flags[u.team], enFlag = this.flags[et];
    if (ownFlag.state === 'carried') {
      const c = this.units.get(ownFlag.carrier);
      if (c && hyp(c.x - u.x, c.y - u.y) < 3500) { if (hyp(c.x - u.x, c.y - u.y) < 900) this.botAbilities(u, c, false); this.botAttack(u, c); return; }
    }
    if (ownFlag.state === 'dropped' && hyp(ownFlag.x - u.x, ownFlag.y - u.y) < 3000) { this.botGo(u, ownFlag.x, ownFlag.y); return; }
    if (enFlag.state === 'dropped' && hyp(enFlag.x - u.x, enFlag.y - u.y) < 2000) { this.botGo(u, enFlag.x, enFlag.y); return; }
    if (enFlag.state === 'carried') {
      const c = this.units.get(enFlag.carrier);
      if (c && hyp(c.x - u.x, c.y - u.y) < 2200) { this.botGo(u, c.x + (u.team ? 120 : -120), c.y + 60); return; }
    }
    const ebt = this.towers.find((tw) => tw.team === et && tw.base);
    const enemiesAlive = this.champs.filter((c) => c.team === et && !c.dead).length;
    if (enFlag.state === 'home' && !b.flagRun) {
      if (ebt.dead || (b.runner && (enemiesAlive === 0 || (t > 600 && Math.random() < 0.0015)))) b.flagRun = true;
      if (hyp(enFlag.x - u.x, enFlag.y - u.y) < 900) b.flagRun = true;
    }
    if (b.flagRun) {
      if (enFlag.state !== 'home' || hpPct < 0.5) b.flagRun = false;
      else { this.botGo(u, enFlag.x, enFlag.y); return; }
    }
    if (u.harvest) return;
    if (!foe) {
      const crop = this.crops.find((c) => c.ripe && hyp(c.x - u.x, c.y - u.y) < 550);
      if (crop) { if (!(u.cmd && u.cmd.type === 'harvest')) this.cmdClick(u, crop.x, crop.y); return; }
    }
    this.botLane(u);
  }

  enemyTowerCovering(team, x, y) {
    for (const tw of this.towers) if (tw.team !== team && !tw.dead && hyp(tw.x - x, tw.y - y) < tw.range + 40) return tw;
    return null;
  }
  botLane(u) {
    const dir = u.team === 0 ? 1 : -1;
    let enemyMinion = null, emd = 650;
    let front = null, best = -Infinity;
    for (const m of this.units.values()) {
      if (m.kind !== 'minion') continue;
      const d = hyp(m.x - u.x, m.y - u.y);
      if (m.team !== u.team) { if (d < emd && this.canSee(u.team, m)) { emd = d; enemyMinion = m; } }
      else if (m.lane === u.lane) {
        const prog = m.wi * 10000 - hyp(m.wp[Math.min(m.wi, m.wp.length - 1)][0] - m.x, m.wp[Math.min(m.wi, m.wp.length - 1)][1] - m.y);
        if (prog > best) { best = prog; front = m; }
      }
    }
    const tw = this.enemyTowerCovering(u.team, u.x, u.y) || (enemyMinion && this.enemyTowerCovering(u.team, enemyMinion.x, enemyMinion.y));
    const alliesUnder = (tower) => {
      let n = 0;
      for (const m of this.units.values()) if (m.kind === 'minion' && m.team === u.team && hyp(m.x - tower.x, m.y - tower.y) < tower.range) n++;
      return n;
    };
    if (tw && alliesUnder(tw) >= 1 && tw.target !== u.id) {
      if (enemyMinion && !enemyMinion.dead) { this.botAttack(u, enemyMinion); return; }
      if (!tw.base || this.baseVulnerable(tw.team)) { this.botAttack(u, tw); return; }
    }
    if (enemyMinion && !tw) { this.botAttack(u, enemyMinion); return; }
    let gx, gy;
    if (front) { gx = front.x - dir * 140; gy = front.y; }
    else {
      const own = this.towers.filter((x) => x.team === u.team && !x.dead && x.lane === u.lane).sort((a, c) => dir * (c.x - a.x))[0];
      if (own) { gx = own.x + dir * 200; gy = own.y + (u.lane === 'top' ? 100 : u.lane === 'bot' ? -100 : 90); }
      else { gx = D.BASES[u.team].x + dir * 300; gy = D.BASES[u.team].y; }
    }
    const cover = this.enemyTowerCovering(u.team, gx, gy);
    if (cover && alliesUnder(cover) < 2) { gx = cover.x - dir * (cover.range + 120); }
    this.botGo(u, gx, gy);
  }
  botAttack(u, T) {
    if (u.cmd && u.cmd.type === 'attack' && u.cmd.target === T.id) return;
    u.recall = 0; u.harvest = null; u.windup = 0;
    u.cmd = { type: 'attack', target: T.id }; u.path = [];
  }
  botGo(u, x, y) {
    if (hyp(x - u.x, y - u.y) < 40) { if (u.cmd && u.cmd.type === 'move') { u.cmd = null; u.path = []; } return; }
    if (u.cmd && u.cmd.type === 'move' && u.goal && hyp(u.goal.x - x, u.goal.y - y) < 90 && u.path.length) return;
    u.goal = { x, y };
    u.recall = 0; u.harvest = null;
    u.cmd = { type: 'move' };
    u.path = this.nav.findPath(u.x, u.y, x, y);
  }
  botAbilities(u, T, fleeing) {
    if (!T) return;
    const home = D.FOUNTAINS[u.team];
    const d = hyp(T.x - u.x, T.y - u.y);
    const hpPct = u.hp / u.st.maxHp;
    const hx = home.x - u.x, hy = home.y - u.y, hl = hyp(hx, hy) || 1;
    const awayX = u.x + (hx / hl) * 500, awayY = u.y + (hy / hl) * 500;
    for (const k of ['R', 'Q', 'E', 'W']) {
      if (u.cds[k] > 0 || (k === 'R' && u.level < C.R_LEVEL)) continue;
      const ab = u.def.abilities[k];
      let tx = null, ty = null;
      switch (ab.type) {
        case 'skillshot': case 'ground_aoe': case 'zone': case 'barrage': case 'cone':
          if (d < ab.range * 0.9) { tx = T.x; ty = T.y; }
          break;
        case 'targeted':
          if (!fleeing && d < ab.range) { tx = T.x; ty = T.y; }
          break;
        case 'self_aoe':
          if (ab.allyHeal) { if (hpPct < 0.5) { tx = u.x; ty = u.y; } }
          else if (d < ab.radius * 0.85) { tx = T.x; ty = T.y; }
          break;
        case 'dash':
          if (ab.dmg && !fleeing && d < ab.range * 0.9) { tx = T.x; ty = T.y; }
          else if (!ab.dmg && fleeing && d < 550) { tx = awayX; ty = awayY; }
          break;
        case 'leap':
          if (!fleeing && d < ab.range) { tx = T.x; ty = T.y; }
          else if (fleeing && d < 550) { tx = awayX; ty = awayY; }
          break;
        case 'blink':
          if (fleeing && d < 550 && hpPct < 0.45) { tx = awayX; ty = awayY; }
          break;
        case 'buff':
          if (d < 650 && (!(ab.hot || ab.heal) || hpPct < 0.75 || ab.stats)) { tx = u.x; ty = u.y; }
          break;
        case 'ally':
          if (d < 900) { tx = u.x; ty = u.y; }
          break;
      }
      if (tx !== null) {
        const before = u.cds[k];
        this.cast(u, k, tx, ty);
        if (u.cds[k] !== before) break;
      }
    }
  }
  botShop(u) {
    const build = D.BUILDS[u.def.role] || D.BUILDS.Fighter;
    for (let i = 0; i < 3; i++) {
      const next = build[u.items.length];
      if (!next) return;
      if (!this.buy(u, next)) return;
    }
  }

  // ---------------- main tick ----------------
  step() {
    if (this.over) return;
    this.t += DT;
    this.tickN++;
    const t = this.t;
    if (t >= this.nextWave) {
      this.wave++;
      this.nextWave += C.WAVE_EVERY;
      const types = ['chick', 'chick', 'chick', 'mouse', 'mouse'];
      if (this.wave % 3 === 0) types.push('tractor');
      for (const tm of [0, 1]) for (const lane of ['top', 'mid', 'bot']) types.forEach((ty, i) => this.spawnMinion(tm, lane, ty, i));
    }
    for (const camp of this.camps) {
      if (camp.respawnAt && t >= camp.respawnAt && camp.members.every((m) => m.dead)) {
        camp.respawnAt = 0;
        this.spawnCamp(camp);
        if (camp.def.reward) this.ev({ e: 'objspawn', k: camp.def.reward }, 'all');
      }
    }
    for (const c of this.crops) if (!c.ripe && t >= c.regrowAt) c.ripe = true;
    this.goldAcc += DT;
    if (this.goldAcc >= 1) { this.goldAcc -= 1; if (t > 15) for (const c of this.champs) c.gold += C.PASSIVE_GOLD; }

    this.computeVision();
    for (const u of this.champs) if (u.isBot) this.botThink(u);
    for (const u of this.champs) this.updateChamp(u);
    for (const u of [...this.units.values()]) {
      if (u.dead) continue;
      if (u.kind === 'minion') this.updateMinion(u);
      else if (u.kind === 'neutral') this.updateNeutral(u);
    }
    for (const tw of this.towers) this.updateTower(tw);
    this.updateProjs();
    this.updateZones();
    this.updateFlags();
    this.separate();
    if (this.over) return;
    if (this.tickN % 2 === 0) this.sendSnapshots();
    if (this.tickN % TICK === 0) this.io.broadcast({ t: 'sb', p: this.scoreboard(), sc: this.score });
  }

  separate() {
    const ms = [];
    for (const u of this.units.values()) if (!u.dead && (u.kind === 'minion' || u.kind === 'neutral')) ms.push(u);
    for (let i = 0; i < ms.length; i++) {
      const a = ms[i];
      for (let j = i + 1; j < ms.length; j++) {
        const b = ms[j];
        const dx = b.x - a.x, dy = b.y - a.y, rr = a.r + b.r;
        if (Math.abs(dx) > rr || Math.abs(dy) > rr) continue;
        const d = hyp(dx, dy);
        if (d >= rr || d < 0.01) continue;
        const push = (rr - d) / 2;
        a.x -= (dx / d) * push; a.y -= (dy / d) * push;
        b.x += (dx / d) * push; b.y += (dy / d) * push;
      }
    }
  }

  // ---------------- networking ----------------
  scoreboard() {
    return this.champs.map((u) => [u.id, u.level, u.k, u.d, u.a, u.cs, u.items, u.dead ? Math.ceil(u.respawnAt - this.t) : 0, u.isBot ? 1 : 0]);
  }
  startInfo(pid) {
    const me = this.champs.find((c) => c.pid === pid);
    return {
      t: 'start', you: me ? me.id : 0, team: me ? me.team : 0,
      players: this.champs.map((u) => ({ id: u.id, name: u.name, champ: u.champ, team: u.team, bot: u.wasBot })),
      towers: this.towers.map((tw) => tw.id),
    };
  }
  buildTeamSnap(tm) {
    const t = this.t;
    const c = [], m = [], p = [], z = [];
    for (const u of this.champs) {
      if (u.team !== tm && (u.dead || !this.canSee(tm, u))) continue;
      let bits = 0;
      if (u.dead) bits |= 1;
      if (this.stunned(u)) bits |= 2;
      if (this.rooted(u)) bits |= 4;
      if (this.slowMul(u) < 0.99) bits |= 8;
      if (u.recall) bits |= 16;
      if (u.flag >= 0) bits |= 32;
      if (u.buffs.some((b) => b.bull)) bits |= 64;
      if (u.dash) bits |= 128;
      if (u.buffs.some((b) => !b.bull)) bits |= 256;
      const sh = this.shieldOf(u);
      if (sh > 0) bits |= 512;
      const rp = u.recall ? Math.round(((t - u.recallStart) / C.RECALL_TIME) * 100) : 0;
      const hp = u.harvest ? Math.round((1 - (u.harvest.until - t) / u.harvest.total) * 100) : 0;
      c.push([u.id, u.x | 0, u.y | 0, Math.ceil(u.hp), Math.round(u.st.maxHp), Math.round(sh), u.level, bits, Math.round(u.ang * 100), rp, hp,
        u.dead ? Math.ceil(u.respawnAt - t) : 0]);
    }
    for (const u of this.units.values()) {
      if (u.dead || (u.kind !== 'minion' && u.kind !== 'neutral')) continue;
      if (u.team !== tm && !this.canSee(tm, u)) continue;
      c.length; // noop
      m.push([u.id, u.type, u.team, u.x | 0, u.y | 0, Math.max(1, Math.round((u.hp / u.maxHp) * 100)), this.stunned(u) ? 1 : 0, Math.round(u.ang * 100)]);
    }
    for (const q of this.projs) {
      if (q.team !== tm && !this.seesPoint(tm, q.x, q.y, 30)) continue;
      p.push([q.id, q.vis || 'atk', q.x | 0, q.y | 0, q.team]);
    }
    for (const q of this.zones) {
      if (q.team !== tm && !this.seesPoint(tm, q.x, q.y, q.r)) continue;
      let prog = 0;
      if (q.kind === 't') prog = Math.round(clamp((t - q.start) / (q.at - q.start || 1), 0, 1) * 100);
      else prog = Math.round(clamp((q.until - t) / (q.until - q.start || 1), 0, 1) * 100);
      if (q.kind === 't' && t < q.start) continue;
      z.push([q.id, q.kind, q.x | 0, q.y | 0, q.r, q.team, prog, q.vis || '']);
    }
    const tw = this.towers.map((x) => [Math.ceil(x.hp), x.target && this.canSee(tm, this.units.get(x.target) || { team: -1, x: 0, y: 0, r: 0 }) ? x.target : 0,
      x.base && !this.baseVulnerable(x.team) ? 1 : 0, x.dead && x.rebuildAt ? Math.ceil(x.rebuildAt - t) : 0]);
    const f = this.flags.map((x) => [x.state === 'home' ? 0 : x.state === 'carried' ? 1 : 2, x.x | 0, x.y | 0, x.carrier, x.state === 'dropped' ? Math.ceil(x.returnAt - t) : 0]);
    const cr = this.crops.map((x) => (x.ripe ? '1' : '0')).join('');
    const e = [];
    for (const ev of this.events) {
      if (ev.route === 'all' || ev.route === tm || (ev.route === 'pos' && this.seesPoint(tm, ev.x, ev.y, 60))) e.push(ev.obj);
    }
    const camps = this.camps.filter((cp) => cp.def.reward).map((cp) => (cp.members.some((x) => !x.dead) ? 0 : Math.max(0, Math.ceil(cp.respawnAt - t))));
    return { t: 's', T: Math.round(t * 1000), c, m, p, z, tw, f, cr, sc: this.score, e, ob: camps };
  }
  sendSnapshots() {
    const parts = [this.buildTeamSnap(0), this.buildTeamSnap(1)];
    this.events = [];
    for (const u of this.champs) {
      if (!u.pid || u.isBot) continue;
      const me = {
        id: u.id, g: Math.floor(u.gold), xp: Math.floor(u.xp), xn: D.xpToNext(u.level), lvl: u.level,
        cd: ['Q', 'W', 'E', 'R'].map((k) => +u.cds[k].toFixed(2)),
        cdm: ['Q', 'W', 'E', 'R'].map((k) => +(u.def.abilities[k].cd * (1 - u.st.cdr / 100)).toFixed(1)),
        it: u.items, sh: this.canShop(u) ? 1 : 0,
        st: { ad: Math.round(u.st.ad), ap: Math.round(u.st.ap), armor: Math.round(u.st.armor), as: +u.st.as.toFixed(2), ms: Math.round(this.speedOf(u)), range: u.st.range, cdr: u.st.cdr, ls: u.st.ls },
      };
      this.io.send(u.pid, Object.assign({}, parts[u.team], { me }));
    }
  }
}

module.exports = { Game, TICK, DT };
