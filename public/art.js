/* Barnyard Brawl — art: animated champions, spell effects, forest map */
(() => {
  'use strict';
  const TAU = Math.PI * 2;
  const OUT = '#1c1917';
  const rnd = (a, b) => a + Math.random() * (b - a);
  const ease = (p) => Math.sin(Math.PI * Math.min(1, Math.max(0, p)));

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function ell(ctx, x, y, rx, ry, rot) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot || 0, 0, TAU); }
  function fs(ctx, fill, stroke, lw) { if (fill) { ctx.fillStyle = fill; ctx.fill(); } if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); } }

  // ------------------------------------------------------------------ poses
  const POSES = {
    cow: { Q: 'spray', W: 'eat', E: 'charge', R: 'rear' },
    pig: { Q: 'throw', W: 'stomp', E: 'charge', R: 'rear' },
    chicken: { Q: 'throw', W: 'flap', E: 'flap', R: 'flap' },
    goat: { Q: 'butt', W: 'eat', E: 'stomp', R: 'butt' },
    horse: { Q: 'buck', W: 'rear', E: 'leap', R: 'charge' },
    sheep: { Q: 'throw', W: 'cast', E: 'cast', R: 'rear' },
    bee: { Q: 'throw', W: 'throw', E: 'charge', R: 'flap' },
    duck: { Q: 'throw', W: 'leap', E: 'quack', R: 'flap' },
  };
  function mods(name, p) {
    const m = { rot: 0, pivot: 'c', hx: 0, hy: 0, hr: 0, fl: 0, bl: 0, lean: 0, sq: 1, wing: 0, mouth: 0 };
    const b = ease(p);
    switch (name) {
      case 'spray': m.hx = 6 * b; m.hy = -7 * b; m.hr = -0.35 * b; m.mouth = b; m.rot = -0.1 * b; m.pivot = 'b'; break;
      case 'eat': m.hx = 4 * b; m.hy = 16 * b; m.hr = 0.6 * b + Math.sin(p * 30) * 0.08 * b; break;
      case 'charge': m.rot = 0.12; m.pivot = 'f'; m.hx = 6; m.hr = 0.25; m.lean = 4; m.wing = -0.5; break;
      case 'rear': m.rot = -0.5 * b; m.pivot = 'b'; m.fl = -1.0 * b; m.hr = -0.3 * b; m.mouth = b; m.wing = -1.2 * b; break;
      case 'throw': m.hx = 8 * b; m.hy = -4 * b; m.rot = 0.12 * b; m.pivot = 'f'; m.wing = -1.2 * b; m.mouth = b; break;
      case 'stomp': m.sq = 1 - 0.18 * b; m.fl = -0.5 * ease(p * 2); break;
      case 'flap': m.wing = -1.4 * Math.abs(Math.sin(p * Math.PI * 4)); m.hy = -4 * b; m.sq = 1 + 0.05 * b; break;
      case 'butt': m.hx = 14 * b; m.hy = 6 * b; m.hr = 0.5 * b; m.rot = 0.15 * b; m.pivot = 'f'; m.lean = 6 * b; break;
      case 'buck': m.rot = 0.45 * b; m.pivot = 'f'; m.bl = 1.3 * b; m.hr = 0.3 * b; break;
      case 'leap': m.fl = -0.8; m.bl = 0.8; m.rot = -0.25 + 0.5 * p; m.wing = -1.2; break;
      case 'cast': m.hy = -6 * b; m.sq = 1 + 0.06 * b; m.wing = -0.8 * b; m.mouth = b; break;
      case 'quack': m.hx = 10 * b; m.mouth = b; m.hr = -0.2 * b; m.rot = 0.1 * b; m.pivot = 'f'; m.wing = -0.6 * b; break;
      case 'atk': m.hx = 9 * b; m.lean = 6 * b; m.rot = 0.1 * b; m.pivot = 'f'; m.mouth = b; m.wing = -0.7 * b; break;
    }
    return m;
  }

  // ------------------------------------------------------------------ body parts
  function leg(ctx, x, y, len, w, ang, color, hoof) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    rr(ctx, -w / 2, -2, w, len + 2, w / 2); fs(ctx, color, OUT, 2);
    if (hoof) { rr(ctx, -w / 2, len - 4, w, 5, 2); fs(ctx, hoof); }
    ctx.restore();
  }
  function eye(ctx, x, y, r) {
    ell(ctx, x, y, r, r); fs(ctx, '#fff'); ell(ctx, x + r * 0.25, y, r * 0.6, r * 0.6); fs(ctx, '#111');
    ell(ctx, x + r * 0.45, y - r * 0.35, r * 0.22, r * 0.22); fs(ctx, '#fff');
  }

  // generic four-legged animal (facing right, feet at y = 0)
  function quad(ctx, s, cfg) {
    const m = s.m, L = cfg.legLen, bw = cfg.bw, bh = cfg.bh;
    const sw = Math.sin(s.walk) * 0.55 * s.move;
    const bob = -Math.abs(Math.cos(s.walk)) * 2.2 * s.move;
    const fx = bw * 0.3, bx = -bw * 0.3, hipY = -L + 2;
    ctx.save();
    ctx.translate(m.lean, bob);
    ctx.scale(1, m.sq);
    const px = m.pivot === 'f' ? fx : m.pivot === 'b' ? bx : 0;
    ctx.translate(px, hipY); ctx.rotate(m.rot); ctx.translate(-px, -hipY);
    leg(ctx, fx + 5, hipY, L, cfg.legW, -sw + m.fl, cfg.legFar, cfg.hoof);
    leg(ctx, bx + 5, hipY, L, cfg.legW, sw + m.bl, cfg.legFar, cfg.hoof);
    cfg.tail(ctx, bx - bw * 0.18, hipY - bh * 0.55, s);
    cfg.body(ctx, 0, hipY - bh * 0.38, bw, bh, s);
    leg(ctx, fx - 2, hipY, L, cfg.legW, sw + m.fl, cfg.leg, cfg.hoof);
    leg(ctx, bx - 2, hipY, L, cfg.legW, -sw + m.bl, cfg.leg, cfg.hoof);
    ctx.save();
    ctx.translate(fx + bw * 0.2 + m.hx, hipY - bh * 0.72 + m.hy + (cfg.headDy || 0));
    ctx.rotate(m.hr);
    cfg.head(ctx, s);
    ctx.restore();
    ctx.restore();
  }

  const SPECIES = {
    cow: (ctx, s) => quad(ctx, s, {
      legLen: 15, legW: 7, bw: 56, bh: 30, leg: '#f8fafc', legFar: '#d6d3d1', hoof: '#292524',
      tail: (c, x, y, st) => {
        const sw = Math.sin(st.t * 3) * 4;
        c.strokeStyle = OUT; c.lineWidth = 3; c.beginPath(); c.moveTo(x + 4, y); c.quadraticCurveTo(x - 8, y + 4, x - 6 + sw, y + 18); c.stroke();
        ell(c, x - 6 + sw, y + 20, 4, 5); fs(c, '#292524');
      },
      body: (c, x, y, w, h) => {
        ell(c, x, y, w / 2, h / 2); fs(c, '#f8fafc', OUT, 2.5);
        c.save(); ell(c, x, y, w / 2, h / 2); c.clip();
        ell(c, x - 12, y - 6, 10, 7, 0.3); fs(c, '#1f2937'); ell(c, x + 10, y + 5, 8, 6, -0.4); fs(c, '#1f2937'); ell(c, x - 2, y + 10, 5, 4); fs(c, '#1f2937');
        c.restore();
        ell(c, x - 2, y + h / 2 - 1, 7, 4); fs(c, '#f9a8d4', OUT, 1.5);
      },
      head: (c, st) => {
        ell(c, -2, -8, 4, 2.5, -0.5); fs(c, '#fef3c7', OUT, 1.5); ell(c, 6, -9, 4, 2.5, 0.5); fs(c, '#fef3c7', OUT, 1.5);
        ell(c, -6, -2, 6, 3.5, 0.5); fs(c, '#a8a29e', OUT, 1.5);
        ell(c, 2, 0, 11, 10); fs(c, '#f8fafc', OUT, 2.5);
        ell(c, 0, -2, 5, 4); fs(c, '#1f2937');
        eye(c, 4, -2, 2.6);
        ell(c, 10, 6 + st.m.mouth * 2, 7, 5 + st.m.mouth * 2); fs(c, '#f9a8d4', OUT, 2);
        ell(c, 9, 5, 1.2, 1.2); fs(c, '#831843'); ell(c, 13, 5, 1.2, 1.2); fs(c, '#831843');
      },
    }),
    pig: (ctx, s) => quad(ctx, s, {
      legLen: 11, legW: 8, bw: 58, bh: 34, leg: '#f9a8d4', legFar: '#f472b6', hoof: '#9d174d',
      tail: (c, x, y, st) => {
        c.strokeStyle = '#be185d'; c.lineWidth = 2.5; c.beginPath();
        for (let i = 0; i <= 20; i++) { const a = i / 20 * TAU * 1.5 + st.t * 4; const r = 5 - i * 0.15; const px = x - 4 - i * 0.5 + Math.cos(a) * r, py = y + Math.sin(a) * r; i ? c.lineTo(px, py) : c.moveTo(px, py); }
        c.stroke();
      },
      body: (c, x, y, w, h) => { ell(c, x, y, w / 2, h / 2); fs(c, '#f9a8d4', OUT, 2.5); ell(c, x - 6, y - 6, w / 3, h / 5, -0.1); fs(c, '#fbcfe8'); },
      head: (c, st) => {
        ell(c, 0, 0, 13, 12); fs(c, '#f9a8d4', OUT, 2.5);
        c.beginPath(); c.moveTo(-6, -9); c.lineTo(-1, -18); c.lineTo(3, -10); c.closePath(); fs(c, '#f472b6', OUT, 1.5);
        eye(c, 4, -3, 2.6);
        ell(c, 13, 3, 5, 6 + st.m.mouth); fs(c, '#f472b6', OUT, 2);
        ell(c, 13, 1, 1.3, 1.6); fs(c, '#831843'); ell(c, 13, 5, 1.3, 1.6); fs(c, '#831843');
      },
    }),
    goat: (ctx, s) => quad(ctx, s, {
      legLen: 17, legW: 6, bw: 50, bh: 26, leg: '#e7e5e4', legFar: '#a8a29e', hoof: '#292524', headDy: -4,
      tail: (c, x, y) => { c.beginPath(); c.moveTo(x + 4, y + 2); c.lineTo(x - 6, y - 8); c.lineTo(x, y + 4); c.closePath(); fs(c, '#d6d3d1', OUT, 1.5); },
      body: (c, x, y, w, h) => { ell(c, x, y, w / 2, h / 2); fs(c, '#d6d3d1', OUT, 2.5); ell(c, x - 4, y - 5, w / 3, h / 5); fs(c, '#e7e5e4'); },
      head: (c, st) => {
        c.strokeStyle = '#57534e'; c.lineWidth = 4; c.beginPath(); c.moveTo(-2, -8); c.quadraticCurveTo(-12, -24, -16, -8); c.stroke();
        ell(c, 4, 0, 13, 8, 0.5); fs(c, '#e7e5e4', OUT, 2.5);
        ell(c, -4, -2, 6, 3, -0.4); fs(c, '#a8a29e', OUT, 1.5);
        eye(c, 3, -3, 2.4);
        c.beginPath(); c.moveTo(8, 7); c.lineTo(10, 18 + st.m.mouth * 2); c.lineTo(13, 8); fs(c, '#f5f5f4', OUT, 1.5);
        ell(c, 14, 4, 1.2, 1.2); fs(c, '#292524');
      },
    }),
    horse: (ctx, s) => quad(ctx, s, {
      legLen: 22, legW: 7, bw: 58, bh: 28, leg: '#a16207', legFar: '#713f12', hoof: '#1c1917', headDy: -10,
      tail: (c, x, y, st) => {
        const sw = Math.sin(st.t * 4 + st.walk) * 5;
        c.beginPath(); c.moveTo(x + 6, y - 2); c.quadraticCurveTo(x - 14, y + 2, x - 10 + sw, y + 26); c.quadraticCurveTo(x - 2, y + 10, x + 6, y + 6); fs(c, '#3f1d0b', OUT, 1.5);
      },
      body: (c, x, y, w, h) => { ell(c, x, y, w / 2, h / 2); fs(c, '#b45309', OUT, 2.5); ell(c, x - 6, y - 6, w / 3, h / 5); fs(c, '#d97706'); },
      head: (c, st) => {
        c.beginPath(); c.moveTo(-14, 16); c.lineTo(-6, -6); c.lineTo(6, -2); c.lineTo(-2, 18); c.closePath(); fs(c, '#b45309', OUT, 2);
        c.beginPath(); c.moveTo(-8, -8); c.quadraticCurveTo(-22, 0, -16, 18); c.lineTo(-10, 14); c.quadraticCurveTo(-14, 2, -3, -6); fs(c, '#3f1d0b');
        ell(c, 6, -2, 14, 8, 0.45); fs(c, '#b45309', OUT, 2.5);
        c.beginPath(); c.moveTo(-2, -9); c.lineTo(0, -17); c.lineTo(4, -9); fs(c, '#b45309', OUT, 1.5);
        eye(c, 3, -5, 2.4);
        ell(c, 15, 4 + st.m.mouth, 6, 5); fs(c, '#92400e', OUT, 1.5);
        ell(c, 17, 2, 1.2, 1.2); fs(c, '#1c1917');
      },
    }),
    sheep: (ctx, s) => quad(ctx, s, {
      legLen: 13, legW: 6, bw: 54, bh: 32, leg: '#292524', legFar: '#1c1917', hoof: null,
      tail: (c, x, y) => { ell(c, x, y + 2, 6, 6); fs(c, '#f8fafc', OUT, 1.5); },
      body: (c, x, y, w, h) => {
        const pts = [[-20, -4], [-12, -11], [-2, -13], [9, -11], [18, -5], [20, 5], [10, 11], [-2, 13], [-14, 10], [-22, 4]];
        c.beginPath(); for (const [px, py] of pts) { c.moveTo(x + px + 9, y + py); c.arc(x + px, y + py, 9, 0, TAU); } fs(c, '#f8fafc', OUT, 2);
        ell(c, x, y, w / 2 - 6, h / 2 - 4); fs(c, '#f8fafc');
        c.fillStyle = '#e2e8f0'; for (const [px, py] of [[-8, -2], [6, 3], [-2, 6]]) { c.beginPath(); c.arc(x + px, y + py, 4, 0, TAU); c.fill(); }
      },
      head: (c, st) => {
        ell(c, -2, -9, 9, 6); fs(c, '#f8fafc', OUT, 1.5);
        ell(c, 4, 0, 10, 9, 0.3); fs(c, '#292524', OUT, 2);
        ell(c, -6, 1, 6, 3, 0.6); fs(c, '#292524', OUT, 1.5);
        ell(c, 4, -2, 3, 3); fs(c, '#fff'); ell(c, 5, -2, 1.6, 1.6); fs(c, '#111');
        ell(c, 11, 5 + st.m.mouth, 2.5, 1.2 + st.m.mouth); fs(c, '#f9a8d4');
      },
    }),
    chicken: (ctx, s) => bird(ctx, s, {
      body: '#fffbeb', wingC: '#fde68a', legC: '#f59e0b', bw: 40, bh: 32, L: 14,
      head: (c, st) => {
        c.beginPath(); c.moveTo(-4, -9); c.arc(-3, -11, 3.5, 0, TAU); c.moveTo(1, -12); c.arc(1, -12, 4, 0, TAU); c.moveTo(5, -10); c.arc(5, -10, 3.2, 0, TAU); fs(c, '#ef4444', OUT, 1.5);
        ell(c, 0, 0, 10, 10); fs(c, '#fffbeb', OUT, 2.5);
        eye(c, 3, -2, 2.4);
        const o = st.m.mouth * 4;
        c.beginPath(); c.moveTo(8, -1); c.lineTo(17, 1 - o * 0.3); c.lineTo(9, 3); fs(c, '#f59e0b', OUT, 1.5);
        c.beginPath(); c.moveTo(8, 4); c.lineTo(15, 4 + o); c.lineTo(8, 6); fs(c, '#f59e0b', OUT, 1.5);
        ell(c, 7, 9, 3, 4); fs(c, '#ef4444', OUT, 1.5);
      },
      tail: (c, x, y) => { c.beginPath(); c.moveTo(x, y + 6); c.lineTo(x - 14, y - 12); c.lineTo(x - 8, y - 2); c.lineTo(x - 16, y - 4); c.lineTo(x + 2, y + 10); fs(c, '#fde68a', OUT, 1.5); },
    }),
    duck: (ctx, s) => bird(ctx, s, {
      body: '#a16207', wingC: '#78350f', legC: '#fb923c', bw: 44, bh: 28, L: 10, belly: '#d6d3d1',
      head: (c, st) => {
        ell(c, 0, 0, 11, 10); fs(c, '#15803d', OUT, 2.5);
        ell(c, -2, -4, 5, 3); fs(c, '#22c55e');
        c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.arc(-1, 6, 9, 0.3, 2.6); c.stroke();
        eye(c, 3, -2, 2.4);
        const o = st.m.mouth * 5;
        c.beginPath(); c.moveTo(7, -1); c.quadraticCurveTo(20, -2 - o * 0.4, 21, 2 - o * 0.4); c.lineTo(8, 3); fs(c, '#fb923c', OUT, 1.5);
        c.beginPath(); c.moveTo(8, 4); c.quadraticCurveTo(18, 5 + o, 19, 7 + o); c.lineTo(8, 7); fs(c, '#f97316', OUT, 1.5);
      },
      tail: (c, x, y) => { c.beginPath(); c.moveTo(x + 2, y + 2); c.lineTo(x - 12, y - 8); c.lineTo(x + 4, y + 10); fs(c, '#78350f', OUT, 1.5); },
    }),
    bee: (ctx, s) => {
      const m = s.m, t = s.t;
      ctx.save();
      ctx.translate(m.hx * 0.5 + m.lean, -20 + Math.sin(t * 6) * 3);
      ctx.rotate(0.18 * s.move + m.rot * 0.5);
      // legs
      c3(ctx);
      function c3(c) { c.strokeStyle = OUT; c.lineWidth = 2; for (const lx of [-6, 0, 6]) { c.beginPath(); c.moveTo(lx, 8); c.lineTo(lx - 3, 15 + Math.sin(t * 8 + lx) * 2); c.stroke(); } }
      // back wing
      const flap = 0.35 + 0.65 * Math.abs(Math.sin(t * 40));
      ctx.save(); ctx.globalAlpha *= 0.75; ell(ctx, -4, -16 * flap, 9, 15 * flap, -0.3); fs(ctx, '#e0f2fe', '#7dd3fc', 1.5); ctx.restore();
      // stinger
      ctx.beginPath(); ctx.moveTo(-19, 2); ctx.lineTo(-29, 4); ctx.lineTo(-19, 7); fs(ctx, '#292524');
      // body
      ell(ctx, -4, 3, 17, 12); fs(ctx, '#facc15', OUT, 2.5);
      ctx.save(); ell(ctx, -4, 3, 17, 12); ctx.clip();
      ctx.fillStyle = '#1c1917'; for (const sx of [-14, -6, 2]) ctx.fillRect(sx, -10, 4, 26);
      ctx.restore();
      ell(ctx, -4, 3, 17, 12); fs(ctx, null, OUT, 2.5);
      // head
      ell(ctx, 15, 0, 9, 9); fs(ctx, '#292524', OUT, 2);
      eye(ctx, 17, -2, 2.6);
      ctx.strokeStyle = OUT; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(16, -8); ctx.quadraticCurveTo(20, -18, 25, -18); ctx.moveTo(12, -8); ctx.quadraticCurveTo(13, -19, 17, -21); ctx.stroke();
      ell(ctx, 25, -18, 2, 2); fs(ctx, '#292524'); ell(ctx, 17, -21, 2, 2); fs(ctx, '#292524');
      // crown
      ctx.beginPath(); ctx.moveTo(10, -8); ctx.lineTo(11, -14); ctx.lineTo(14, -10); ctx.lineTo(16, -15); ctx.lineTo(18, -10); ctx.lineTo(21, -13); ctx.lineTo(20, -7); fs(ctx, '#fbbf24', OUT, 1);
      // front wing
      ctx.save(); ctx.globalAlpha *= 0.8; ell(ctx, 2, -14 * flap, 9, 16 * flap, 0.25); fs(ctx, '#f0f9ff', '#7dd3fc', 1.5); ctx.restore();
      ctx.restore();
    },
  };

  function bird(ctx, s, cfg) {
    const m = s.m, L = cfg.L, bw = cfg.bw, bh = cfg.bh;
    const sw = Math.sin(s.walk) * 0.6 * s.move;
    const bob = -Math.abs(Math.cos(s.walk)) * 3 * s.move;
    ctx.save();
    ctx.translate(m.lean, bob);
    ctx.scale(1, m.sq);
    // legs
    ctx.strokeStyle = cfg.legC; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (const [lx, a] of [[-3, sw], [5, -sw]]) {
      const fx = lx + Math.sin(a) * L, fy = -2 + Math.cos(a) * 2;
      ctx.beginPath(); ctx.moveTo(lx, -L); ctx.lineTo(fx, fy); ctx.lineTo(fx + 6, fy); ctx.moveTo(fx, fy); ctx.lineTo(fx - 3, fy + 1); ctx.stroke();
    }
    const cy = -L - bh * 0.45;
    ctx.translate(0, cy); ctx.rotate(m.rot * 0.7); ctx.translate(0, -cy);
    cfg.tail(ctx, -bw * 0.4, cy - 4, s);
    ell(ctx, 0, cy, bw / 2, bh / 2); fs(ctx, cfg.body, OUT, 2.5);
    if (cfg.belly) { ell(ctx, 4, cy + 6, bw / 3, bh / 4); fs(ctx, cfg.belly); }
    // wing
    ctx.save(); ctx.translate(-4, cy - 3); ctx.rotate(m.wing + (s.move ? Math.sin(s.walk * 2) * 0.08 : 0));
    ell(ctx, -4, 4, 14, 9, 0.2); fs(ctx, cfg.wingC, OUT, 2);
    ctx.restore();
    // head
    ctx.save(); ctx.translate(bw * 0.36 + m.hx, cy - bh * 0.55 + m.hy); ctx.rotate(m.hr); cfg.head(ctx, s); ctx.restore();
    ctx.restore();
  }

  // public: draw a champion. st: {face (-1..1), walk, move (0..1), t, pose, poseP, z, flash, alpha}
  function drawChamp(ctx, champ, x, y, st) {
    const fn = SPECIES[champ];
    if (!fn) return;
    const s = { walk: st.walk, move: st.move, t: st.t, m: mods(st.pose, st.poseP || 0) };
    ctx.save();
    if (st.alpha !== undefined) ctx.globalAlpha *= st.alpha;
    ctx.translate(x, y + 24 - (st.z || 0));
    ctx.scale(Math.abs(st.face) < 0.12 ? 0.12 * Math.sign(st.face || 1) : st.face, 1);
    fn(ctx, s);
    ctx.restore();
    if (st.flash > 0) {
      ctx.save(); ctx.globalAlpha = 0.45 * st.flash; ctx.globalCompositeOperation = 'lighter';
      ell(ctx, x, y - (st.z || 0) - 2, 30, 24); fs(ctx, '#ffffff'); ctx.restore();
    }
  }
  const HOVER = { bee: 20 };

  // ------------------------------------------------------------------ particles
  const parts = [];
  function spawn(p) {
    p.age = -(p.delay || 0);
    p.life = p.life || 0.5;
    parts.push(p);
    return p;
  }
  function updateDraw(ctx, dt, sprite) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age >= p.life) { parts.splice(i, 1); continue; }
      if (p.age < 0) continue;
      if (p.follow) { const f = p.follow(); if (f) { p.ox = f.x; p.oy = f.y; } }
      p.x += (p.vx || 0) * dt; p.y += (p.vy || 0) * dt;
      if (p.drag) { p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt; }
      if (p.g) p.vy += p.g * dt;
      if (p.spin) p.rot = (p.rot || 0) + p.spin * dt;
      const k = p.age / p.life;
      const a = p.fadeIn ? Math.min(1, k * 5) * (1 - k) : 1 - k * k;
      ctx.save();
      ctx.globalAlpha = Math.max(0, a) * (p.alpha || 1);
      const px = p.x + (p.ox || 0), py = p.y + (p.oy || 0);
      switch (p.k) {
        case 'drop': {
          const sp = Math.hypot(p.vx || 0, p.vy || 0), ang = Math.atan2(p.vy || 0, p.vx || 1);
          ell(ctx, px, py, p.s * (1 + Math.min(1.5, sp / 600)), p.s, ang); fs(ctx, p.c, p.oc, 1); break;
        }
        case 'blob': ell(ctx, px, py, p.s, p.s * 0.85); fs(ctx, p.c, p.oc, 1.5); break;
        case 'dust': ell(ctx, px, py, p.s * (0.6 + k * 0.9), p.s * (0.45 + k * 0.6)); fs(ctx, p.c || '#a8a29e'); break;
        case 'feather':
          ctx.translate(px, py); ctx.rotate(p.rot || 0); ell(ctx, 0, 0, p.s, p.s * 0.35); fs(ctx, p.c || '#fff', '#a8a29e', 1);
          ctx.beginPath(); ctx.moveTo(-p.s, 0); ctx.lineTo(p.s, 0); ctx.strokeStyle = '#a8a29e'; ctx.stroke(); break;
        case 'spark':
          ctx.translate(px, py); ctx.rotate(p.rot || 0); ctx.strokeStyle = p.c; ctx.lineWidth = p.w || 3; ctx.lineCap = 'round';
          ctx.shadowColor = p.c; ctx.shadowBlur = 8; ctx.beginPath(); ctx.moveTo(-p.s, 0); ctx.lineTo(p.s, 0); ctx.stroke(); break;
        case 'ring': {
          const r = p.r0 + (p.r1 - p.r0) * (1 - (1 - k) * (1 - k));
          ctx.strokeStyle = p.c; ctx.lineWidth = (p.w || 6) * (1 - k * 0.6); ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.stroke();
          if (p.fill) { ctx.globalAlpha *= 0.25; ctx.fillStyle = p.fill; ctx.fill(); }
          break;
        }
        case 'arc': { // crescent shockwave in a direction
          const r = p.r0 + (p.r1 - p.r0) * k;
          ctx.strokeStyle = p.c; ctx.lineWidth = (p.w || 10) * (1 - k * 0.5); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.arc(px, py, r, p.a - p.half, p.a + p.half); ctx.stroke(); break;
        }
        case 'text':
          ctx.font = `900 ${Math.round(p.s * (1 + k * 0.3))}px "Trebuchet MS", sans-serif`; ctx.textAlign = 'center';
          ctx.lineWidth = 5; ctx.strokeStyle = '#000'; ctx.strokeText(p.text, px, py - k * 30); ctx.fillStyle = p.c; ctx.fillText(p.text, px, py - k * 30); break;
        case 'glyph':
          ctx.font = `bold ${p.s}px "Trebuchet MS", sans-serif`; ctx.textAlign = 'center'; ctx.fillStyle = p.c;
          ctx.shadowColor = p.c; ctx.shadowBlur = 6; ctx.fillText(p.text, px, py); break;
        case 'sprite': if (sprite) { ctx.translate(px, py); ctx.rotate(p.rot || 0); const sp = sprite(p.text, p.s); ctx.drawImage(sp, -sp.width / 2, -sp.height / 2); } break;
        case 'bolt': {
          ctx.strokeStyle = p.c; ctx.lineWidth = p.w || 3; ctx.shadowColor = p.c; ctx.shadowBlur = 10; ctx.beginPath();
          const n = 6; ctx.moveTo(p.x, p.y);
          for (let j = 1; j <= n; j++) { const q = j / n; ctx.lineTo(p.x + (p.x2 - p.x) * q + (j < n ? rnd(-12, 12) : 0), p.y + (p.y2 - p.y) * q + (j < n ? rnd(-12, 12) : 0)); }
          ctx.stroke(); break;
        }
        case 'star':
          ctx.translate(px, py); ctx.rotate(p.rot || 0); ctx.fillStyle = p.c || '#fde047'; ctx.beginPath();
          for (let j = 0; j < 10; j++) { const r = j % 2 ? p.s * 0.45 : p.s; const an = (j / 10) * TAU; j ? ctx.lineTo(Math.cos(an) * r, Math.sin(an) * r) : ctx.moveTo(r, 0); }
          ctx.closePath(); ctx.fill(); break;
        case 'heart':
          ctx.translate(px, py); ctx.scale(p.s / 10, p.s / 10); ctx.fillStyle = p.c || '#f472b6'; ctx.beginPath();
          ctx.moveTo(0, 4); ctx.bezierCurveTo(-10, -4, -5, -12, 0, -6); ctx.bezierCurveTo(5, -12, 10, -4, 0, 4); ctx.fill(); break;
        case 'shard':
          ctx.translate(px, py); ctx.rotate(p.rot || 0); ctx.beginPath(); ctx.moveTo(-p.s, -p.s * 0.6); ctx.lineTo(p.s, 0); ctx.lineTo(-p.s * 0.4, p.s * 0.7); ctx.closePath(); fs(ctx, p.c, OUT, 1); break;
        case 'cone': { // filled translucent wedge (used under sprays)
          ctx.fillStyle = p.c; ctx.globalAlpha *= 0.13; ctx.beginPath(); ctx.moveTo(px, py); ctx.arc(px, py, p.r * Math.min(1, k * 3), p.a - p.half, p.a + p.half); ctx.closePath(); ctx.fill(); break;
        }
        case 'wave': { // sound wave arcs
          const r = p.r1 * k;
          ctx.strokeStyle = p.c; ctx.lineWidth = 5; ctx.lineCap = 'round';
          for (let j = 0; j < 3; j++) { const rr2 = r - j * 40; if (rr2 <= 0) continue; ctx.beginPath(); ctx.arc(px, py, rr2, p.a - p.half, p.a + p.half); ctx.stroke(); }
          break;
        }
      }
      ctx.restore();
    }
  }
  function clearParts() { parts.length = 0; }

  // burst helper
  function burst(n, x, y, f) { for (let i = 0; i < n; i++) spawn(f(i, x, y)); }

  // ------------------------------------------------------------------ spell visuals
  // ctx: {x,y,a,tx,ty,range,ab,champ,id, follow()}
  const SPELLS = {
    'cow.Q': (e, ab) => {
      const half = ab.arc * Math.PI / 360;
      spawn({ k: 'cone', x: e.x, y: e.y, r: ab.range, a: e.a, half, c: '#f8fafc', life: 0.35 });
      burst(80, e.x, e.y, (i) => {
        const an = e.a + rnd(-half, half), sp = (ab.range / 0.32) * rnd(0.55, 1);
        return { k: 'drop', x: e.x + Math.cos(e.a) * 26, y: e.y - 10 + Math.sin(e.a) * 26, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, drag: 1.2, s: rnd(3, 7), c: i % 4 ? '#ffffff' : '#e0f2fe', oc: '#cbd5e1', life: rnd(0.3, 0.42), delay: rnd(0, 0.1) };
      });
    },
    'cow.W': (e) => burst(14, e.x, e.y, (i) => ({ k: 'feather', c: '#86efac', x: e.x + Math.cos(i) * 30, y: e.y + 10, vx: Math.cos(i * 1.7) * 30, vy: -70, spin: 4, s: 7, life: 0.9, delay: i * 0.05 })),
    'cow.R': (e, ab) => {
      spawn({ k: 'ring', x: e.x, y: e.y, r0: 30, r1: ab.radius, c: '#fde68a', w: 16, life: 0.45, fill: '#fde68a' });
      spawn({ k: 'ring', x: e.x, y: e.y, r0: 20, r1: ab.radius * 0.8, c: '#fff7ed', w: 8, life: 0.5, delay: 0.06 });
      spawn({ k: 'text', x: e.x, y: e.y - 60, text: 'MOO!', s: 46, c: '#fde68a', life: 0.8 });
      burst(26, e.x, e.y, (i) => { const an = i / 26 * TAU; return { k: 'dust', x: e.x + Math.cos(an) * 40, y: e.y + Math.sin(an) * 30, vx: Math.cos(an) * 700, vy: Math.sin(an) * 520, drag: 3, s: 22, c: '#78716c', life: 0.6 }; });
    },
    'pig.Q': (e) => burst(8, e.x, e.y, () => ({ k: 'blob', x: e.x + Math.cos(e.a) * 24, y: e.y + Math.sin(e.a) * 24, vx: Math.cos(e.a + rnd(-0.5, 0.5)) * 200, vy: Math.sin(e.a + rnd(-0.5, 0.5)) * 200, g: 300, s: rnd(3, 5), c: '#78350f', life: 0.4 })),
    'pig.W': (e) => burst(10, e.x, e.y, (i) => {
      const t = rnd(0.25, 0.35);
      return { k: 'blob', x: e.x, y: e.y - 20, vx: (e.tx - e.x) / t + rnd(-80, 80), vy: (e.ty - e.y) / t - 300 + rnd(-60, 60), g: 1800, s: rnd(6, 10), c: '#78350f', oc: '#451a03', life: t, delay: i * 0.02 };
    }),
    'pig.R': (e) => {
      burst(8, e.x, e.y, (i) => ({ k: 'sprite', text: '🍄', s: 22, x: e.x + Math.cos(i * 0.8) * 40, y: e.y + Math.sin(i * 0.8) * 30, vy: -50, life: 0.9, delay: i * 0.04 }));
      spawn({ k: 'ring', x: e.x, y: e.y, r0: 20, r1: 90, c: '#ef4444', w: 8, life: 0.5 });
    },
    'chicken.Q': (e) => burst(6, e.x, e.y, () => ({ k: 'feather', x: e.x, y: e.y - 20, vx: rnd(-80, 80), vy: rnd(-120, -40), spin: rnd(-6, 6), s: 6, life: 0.7 })),
    'chicken.W': (e, ab) => {
      burst(40, e.x, e.y, (i) => { const an = i / 40 * TAU + rnd(-0.1, 0.1), sp = ab.radius / 0.35 * rnd(0.7, 1); return { k: 'feather', x: e.x, y: e.y - 10, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, drag: 4, spin: rnd(-10, 10), s: rnd(6, 9), life: rnd(0.5, 0.7) }; });
      spawn({ k: 'ring', x: e.x, y: e.y, r0: 20, r1: ab.radius, c: '#ffffff', w: 4, life: 0.35 });
    },
    'chicken.E': (e) => {
      for (const [x, y] of [[e.x, e.y], [e.tx, e.ty]]) burst(12, x, y, () => ({ k: 'feather', x, y: y - 10, vx: rnd(-160, 160), vy: rnd(-160, 100), drag: 3, spin: rnd(-8, 8), s: 7, life: 0.6 }));
    },
    'chicken.R': (e) => burst(16, e.x, e.y, () => ({ k: 'feather', x: e.x, y: e.y - 20, vx: rnd(-200, 200), vy: rnd(-260, -60), drag: 2, spin: rnd(-8, 8), s: 8, life: 0.8 })),
    'goat.W': (e) => {
      spawn({ k: 'sprite', text: '🥫', s: 26, x: e.x + 20, y: e.y - 40, vy: -40, spin: 3, life: 0.8 });
      burst(10, e.x, e.y, () => ({ k: 'star', c: '#86efac', x: e.x + rnd(-30, 30), y: e.y + rnd(-20, 20), vy: -80, s: 5, life: 0.7 }));
    },
    'goat.E': (e) => { for (const [x, y] of [[e.x, e.y], [e.tx, e.ty]]) burst(10, x, y, () => ({ k: 'dust', x, y: y + 18, vx: rnd(-150, 150), vy: rnd(-60, 40), drag: 3, s: 16, life: 0.5 })); },
    'goat.R': (e) => burst(10, e.x, e.y, () => ({ k: 'dust', c: '#ef4444', x: e.x + rnd(-14, 14), y: e.y - 30, vx: rnd(-60, 60), vy: rnd(-140, -60), s: 12, life: 0.7, alpha: 0.7 })),
    'horse.Q': (e, ab) => {
      const half = ab.arc * Math.PI / 360;
      spawn({ k: 'arc', x: e.x, y: e.y, r0: 40, r1: ab.range, a: e.a, half, c: '#fbbf24', w: 14, life: 0.3 });
      spawn({ k: 'arc', x: e.x, y: e.y, r0: 30, r1: ab.range * 0.8, a: e.a, half: half * 0.8, c: '#fff7ed', w: 6, life: 0.3, delay: 0.04 });
      burst(12, e.x, e.y, () => { const an = e.a + rnd(-half, half); return { k: 'dust', x: e.x, y: e.y + 10, vx: Math.cos(an) * 600, vy: Math.sin(an) * 600, drag: 5, s: 16, life: 0.45 }; });
    },
    'horse.W': (e) => spawn({ k: 'ring', x: e.x, y: e.y, r0: 30, r1: 70, c: '#bae6fd', w: 5, life: 0.4 }),
    'horse.R': (e) => spawn({ k: 'text', x: e.x, y: e.y - 60, text: 'NEIGH!', s: 34, c: '#fde047', life: 0.7 }),
    'sheep.W': () => {},
    'sheep.R': (e, ab) => {
      spawn({ k: 'ring', x: e.x, y: e.y, r0: 30, r1: ab.radius, c: '#86efac', w: 10, life: 0.6, fill: '#86efac' });
      burst(24, e.x, e.y, (i) => { const an = i / 24 * TAU; return { k: 'heart', c: i % 2 ? '#f472b6' : '#fda4af', x: e.x, y: e.y, vx: Math.cos(an) * ab.radius / 0.6, vy: Math.sin(an) * ab.radius / 0.6, drag: 2.5, s: 12, life: 0.8 }; });
    },
    'bee.W': (e) => burst(8, e.x, e.y, (i) => {
      const t = rnd(0.25, 0.35);
      return { k: 'blob', x: e.x, y: e.y - 20, vx: (e.tx - e.x) / t + rnd(-60, 60), vy: (e.ty - e.y) / t - 300, g: 1800, s: rnd(5, 8), c: '#f59e0b', oc: '#b45309', life: t, delay: i * 0.02 };
    }),
    'bee.R': (e) => burst(10, e.x, e.y, () => ({ k: 'star', c: '#fbbf24', x: e.x + rnd(-30, 30), y: e.y - 20 + rnd(-20, 20), vy: -60, s: 6, spin: 4, life: 0.7 })),
    'duck.E': (e, ab) => {
      const half = ab.arc * Math.PI / 360;
      spawn({ k: 'wave', x: e.x, y: e.y - 10, r1: ab.range, a: e.a, half, c: '#a5f3fc', life: 0.4 });
      spawn({ k: 'cone', x: e.x, y: e.y, r: ab.range, a: e.a, half, c: '#a5f3fc', life: 0.3 });
      spawn({ k: 'text', x: e.x + Math.cos(e.a) * 60, y: e.y - 40, text: 'QUACK!', s: 30, c: '#a5f3fc', life: 0.7 });
    },
    'duck.R': (e) => spawn({ k: 'text', x: e.x, y: e.y - 60, text: 'Incoming!', s: 22, c: '#fca5a5', life: 0.8 }),
  };
  // generic dash trail / blink
  function castFx(ev, champ, ab) {
    const fn = SPELLS[champ + '.' + ev.k];
    if (fn) fn(ev, ab);
    if (ab.type === 'blink' && !fn) for (const [x, y] of [[ev.x, ev.y], [ev.tx, ev.ty]]) burst(10, x, y, () => ({ k: 'dust', x, y: y + 18, vx: rnd(-150, 150), vy: rnd(-60, 40), drag: 3, s: 16, life: 0.5 }));
  }
  function trail(champ, x, y, dt) {
    if (Math.random() > dt * 40) return;
    if (champ === 'horse') spawn({ k: 'spark', c: '#fde047', x: x + rnd(-20, 20), y: y + rnd(-20, 20), s: rnd(5, 9), rot: rnd(0, 6), life: 0.25 });
    if (champ === 'bee') { spawn({ k: 'spark', c: '#fef08a', x: x + rnd(-10, 10), y: y - 20 + rnd(-8, 8), s: 6, rot: rnd(0, 6), life: 0.2 }); return; }
    spawn({ k: 'dust', x: x + rnd(-14, 14), y: y + 20, vx: rnd(-30, 30), vy: rnd(-30, 0), s: rnd(12, 18), c: '#78716c', life: 0.5, alpha: 0.8 });
  }
  // impact / landing / explosion visuals keyed by vis name
  function boom(vis, x, y, r) {
    switch (vis) {
      case 'egg': case 'eggrain':
        spawn({ k: 'blob', x, y, s: r * 0.55, c: '#fef9c3', oc: '#fde68a', life: 0.9, fadeIn: false });
        spawn({ k: 'blob', x: x + 4, y: y + 2, s: r * 0.22, c: '#facc15', life: 0.9 });
        burst(8, x, y, () => ({ k: 'shard', c: '#fffbeb', x, y, vx: rnd(-220, 220), vy: rnd(-260, 60), g: 600, spin: rnd(-10, 10), s: 6, life: 0.6 }));
        burst(10, x, y, () => ({ k: 'drop', c: '#fde047', x, y, vx: rnd(-r * 3, r * 3), vy: rnd(-r * 3, r * 3), drag: 5, s: 4, life: 0.5 }));
        break;
      case 'lullaby':
        burst(10, x, y, (i) => ({ k: 'glyph', text: i % 2 ? 'z' : '♪', s: 22, c: '#c4b5fd', x: x + rnd(-r, r) * 0.7, y: y + rnd(-r, r) * 0.5, vy: -60, life: 1.0, delay: i * 0.03 }));
        spawn({ k: 'ring', x, y, r0: r * 0.3, r1: r, c: '#c4b5fd', w: 8, life: 0.5, fill: '#a78bfa' });
        break;
      case 'duckdive':
        spawn({ k: 'ring', x, y, r0: 20, r1: r, c: '#bae6fd', w: 14, life: 0.5, fill: '#38bdf8' });
        burst(30, x, y, () => ({ k: 'drop', c: '#7dd3fc', x, y, vx: rnd(-r * 3, r * 3), vy: rnd(-r * 3, r * 2), g: 900, s: rnd(4, 7), life: 0.7 }));
        burst(14, x, y, () => ({ k: 'feather', c: '#a16207', x, y, vx: rnd(-300, 300), vy: rnd(-300, 100), drag: 3, spin: rnd(-8, 8), s: 8, life: 0.8 }));
        break;
      case 'bread':
        burst(16, x, y, () => ({ k: 'shard', c: '#d6a35c', x, y, vx: rnd(-r * 3, r * 3), vy: rnd(-r * 3, r * 2), g: 500, spin: rnd(-8, 8), s: 5, life: 0.6 }));
        spawn({ k: 'ring', x, y, r0: 10, r1: r, c: '#fbbf24', w: 8, life: 0.35, fill: '#fbbf24' });
        break;
      case 'hoof':
        spawn({ k: 'ring', x, y, r0: 20, r1: r, c: '#d6d3d1', w: 10, life: 0.4 });
        burst(14, x, y, (i) => { const an = i / 14 * TAU; return { k: 'dust', x, y: y + 10, vx: Math.cos(an) * 400, vy: Math.sin(an) * 300, drag: 4, s: 18, life: 0.5 }; });
        break;
      case 'splash':
        spawn({ k: 'ring', x, y, r0: 20, r1: r, c: '#7dd3fc', w: 8, life: 0.4, fill: '#38bdf8' });
        burst(22, x, y, () => ({ k: 'drop', c: '#bae6fd', x, y, vx: rnd(-r * 3, r * 3), vy: rnd(-r * 3.5, r), g: 1000, s: rnd(3, 6), life: 0.6 }));
        break;
      default:
        spawn({ k: 'ring', x, y, r0: 10, r1: r || 60, c: '#ffffff', w: 6, life: 0.3 });
    }
  }
  function hit(x, y, big) {
    burst(big ? 7 : 4, x, y, () => ({ k: 'spark', c: '#ffffff', x, y, vx: rnd(-200, 200), vy: rnd(-200, 200), drag: 6, s: big ? 8 : 5, rot: rnd(0, 6), life: 0.18 }));
    if (big) spawn({ k: 'star', c: '#fde047', x, y: y - 30, s: 12, spin: 6, vy: -40, life: 0.4 });
  }
  function puff(x, y) {
    burst(14, x, y, () => ({ k: 'dust', c: '#e7e5e4', x: x + rnd(-20, 20), y: y + rnd(-20, 20), vx: rnd(-80, 80), vy: rnd(-120, 0), s: 18, life: 0.7 }));
    burst(6, x, y, () => ({ k: 'star', c: '#fde047', x, y: y - 20, vx: rnd(-160, 160), vy: rnd(-200, -40), g: 300, s: 8, spin: 5, life: 0.7 }));
  }

  // ------------------------------------------------------------------ projectiles
  function proj(ctx, vis, x, y, ang, team, now, sprite, teamLight) {
    switch (vis) {
      case 'mud':
        ell(ctx, x, y, 14, 12); fs(ctx, '#78350f', '#451a03', 2.5); ell(ctx, x - 4, y - 4, 4, 3); fs(ctx, '#a16207');
        if (Math.random() < 0.5) spawn({ k: 'blob', x: x + rnd(-6, 6), y: y + rnd(-6, 6), vx: -Math.cos(ang) * 40, vy: -Math.sin(ang) * 40 + 30, s: 4, c: '#78350f', life: 0.35 });
        break;
      case 'static': {
        ctx.save(); ctx.shadowColor = '#67e8f9'; ctx.shadowBlur = 18;
        ell(ctx, x, y, 11, 11); fs(ctx, '#ecfeff', '#22d3ee', 3); ctx.restore();
        ctx.strokeStyle = '#a5f3fc'; ctx.lineWidth = 2; ctx.beginPath();
        for (let i = 0; i < 4; i++) { const a = rnd(0, TAU); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 12 + rnd(-4, 4), y + Math.sin(a) * 12 + rnd(-4, 4)); ctx.lineTo(x + Math.cos(a) * 22, y + Math.sin(a) * 22); }
        ctx.stroke();
        if (Math.random() < 0.6) spawn({ k: 'spark', c: '#67e8f9', x, y, s: 5, rot: rnd(0, 6), vx: -Math.cos(ang) * 80, vy: -Math.sin(ang) * 80, life: 0.2 });
        break;
      }
      case 'sting': case 'sting_s': {
        const L = vis === 'sting' ? 26 : 14;
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
        ctx.strokeStyle = 'rgba(250,204,21,0.35)'; ctx.lineWidth = vis === 'sting' ? 8 : 4; ctx.beginPath(); ctx.moveTo(-L * 2.5, 0); ctx.lineTo(0, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(L / 2, 0); ctx.lineTo(-L / 2, -L * 0.18); ctx.lineTo(-L / 2, L * 0.18); ctx.closePath(); fs(ctx, '#292524', '#facc15', 2);
        ctx.restore();
        break;
      }
      case 'bread': if (sprite) { ctx.save(); ctx.translate(x, y); ctx.rotate(now / 90); const s = sprite('🍞', 30); ctx.drawImage(s, -s.width / 2, -s.height / 2); ctx.restore(); } break;
      case 'bread_s': rr(ctx, x - 5, y - 4, 10, 8, 3); fs(ctx, '#d6a35c', '#78350f', 1.5); break;
      case 'egg_s': ell(ctx, x, y, 7, 9, ang + Math.PI / 2); fs(ctx, '#fffbeb', '#a8a29e', 1.5); break;
      case 'static_s':
        ctx.save(); ctx.shadowColor = '#67e8f9'; ctx.shadowBlur = 10; ell(ctx, x, y, 6, 6); fs(ctx, '#cffafe', '#22d3ee', 2); ctx.restore(); break;
      case 'seed': ell(ctx, x, y, 4, 3, ang); fs(ctx, '#a16207', '#451a03', 1); break;
      case 'bolt': ell(ctx, x, y, 6, 6); fs(ctx, '#9ca3af', '#374151', 2); break;
      case 'feather': ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ell(ctx, 0, 0, 10, 4); fs(ctx, '#fef3c7', '#d6d3d1', 1); ctx.restore(); break;
      case 'tower': {
        const c = teamLight;
        ctx.save(); ctx.shadowColor = c; ctx.shadowBlur = 20; ell(ctx, x, y, 11, 11); fs(ctx, '#fff', c, 4); ctx.restore();
        if (Math.random() < 0.8) spawn({ k: 'spark', c, x, y, s: 6, rot: ang, life: 0.18 });
        break;
      }
      default: ell(ctx, x, y, 5, 5); fs(ctx, '#ffffff', '#000', 1.5);
    }
  }

  // ------------------------------------------------------------------ zones (telegraphs, pools)
  function zone(ctx, z, rel, now, sprite) {
    const [, kind, x, y, r, , prog, vis, ox, oy] = z;
    const p = prog / 100;
    const t = now / 1000;
    if (kind === 't') {
      // faint outline so the area is readable, the spell itself is the main cue
      ctx.strokeStyle = rel; ctx.globalAlpha = 0.35; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      if (vis === 'egg' || vis === 'eggrain') {
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ell(ctx, x, y, r * (0.25 + 0.75 * p), r * (0.18 + 0.55 * p)); ctx.fill();
        const ex = ox + (x - ox) * p, ey = oy + (y - oy) * p - Math.sin(Math.PI * p) * (vis === 'egg' ? 220 : 0);
        ctx.save(); ctx.translate(ex, ey); ctx.rotate(t * 8);
        ell(ctx, 0, 0, vis === 'egg' ? 13 : 10, vis === 'egg' ? 17 : 13); fs(ctx, '#fffbeb', '#a8a29e', 2); ctx.restore();
      } else if (vis === 'lullaby') {
        ctx.fillStyle = 'rgba(167,139,250,0.18)'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(167,139,250,0.35)'; ctx.beginPath(); ctx.arc(x, y, r * p, 0, TAU); ctx.fill();
        ctx.font = 'bold 22px "Trebuchet MS", sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ddd6fe';
        for (let i = 0; i < 6; i++) { const a = t * 2 + i * TAU / 6; ctx.fillText(i % 2 ? '♪' : '♫', x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85 + 7); }
      } else if (vis === 'duckdive') {
        ctx.fillStyle = `rgba(0,0,0,${0.15 + 0.3 * p})`; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        ctx.fillStyle = `rgba(239,68,68,${0.1 + 0.2 * p})`; ctx.beginPath(); ctx.arc(x, y, r * p, 0, TAU); ctx.fill();
        if (sprite) {
          for (let i = 0; i < 3; i++) {
            const a = t * 3 + i * TAU / 3, rr2 = r * (1 - p) + 10;
            const s = sprite('🦆', Math.round(22 + 26 * p));
            ctx.save(); ctx.globalAlpha = 0.5 + 0.5 * p;
            ctx.drawImage(s, x + Math.cos(a) * rr2 - s.width / 2, y + Math.sin(a) * rr2 * 0.6 - s.height / 2 - (1 - p) * 120);
            ctx.restore();
          }
        }
      } else {
        ctx.fillStyle = rel + '33'; ctx.beginPath(); ctx.arc(x, y, r * p, 0, TAU); ctx.fill();
      }
    } else if (kind === 'z') {
      if (vis === 'mud') {
        ctx.fillStyle = 'rgba(69,26,3,0.75)'; ctx.beginPath();
        for (let i = 0; i <= 24; i++) { const a = i / 24 * TAU; const rr2 = r * (0.92 + 0.08 * Math.sin(a * 5 + t)); i ? ctx.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2 * 0.8) : ctx.moveTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2 * 0.8); }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(120,53,15,0.8)'; ell(ctx, x - r * 0.2, y - r * 0.15, r * 0.5, r * 0.3); ctx.fill();
        for (let i = 0; i < 6; i++) {
          const ph = (t * 0.8 + i * 0.37) % 1, a = i * 2.3;
          ctx.strokeStyle = `rgba(214,163,92,${1 - ph})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.4, 3 + ph * 8, 0, TAU); ctx.stroke();
        }
      } else if (vis === 'honey') {
        ctx.fillStyle = 'rgba(217,119,6,0.7)'; ell(ctx, x, y, r, r * 0.8); ctx.fill();
        ctx.fillStyle = 'rgba(251,191,36,0.75)'; ell(ctx, x - r * 0.15, y - r * 0.15, r * 0.7, r * 0.5); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.45)'; ell(ctx, x - r * 0.35, y - r * 0.3, r * 0.2, r * 0.08, -0.4); ctx.fill();
      } else {
        ctx.fillStyle = rel + '33'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = rel; ctx.globalAlpha = 0.35; ctx.lineWidth = 2; ctx.setLineDash([8, 8]); ctx.beginPath(); ell(ctx, x, y, r, vis === 'mud' || vis === 'honey' ? r * 0.8 : r); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    } else if (kind === 'area') {
      ctx.strokeStyle = rel; ctx.globalAlpha = 0.3; ctx.lineWidth = 2; ctx.setLineDash([10, 10]); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------ forest map tiles
  function seeded(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }
  function buildDecor(D) {
    const r = seeded(4242);
    const dec = { mush: [], stones: [], trees: [], fences: [], hay: [], scare: [], lanterns: [], stumps: [], pumpkins: [] };
    const free = (x, y, pad) => {
      for (const w of D.WALLS) if (x > w.x - pad && x < w.x + w.w + pad && y > w.y - pad && y < w.y + w.h + pad) return false;
      for (const b of D.BRUSHES) if (x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad) return false;
      for (const c of D.CAMPS) if (Math.hypot(c.x - x, c.y - y) < 120 + pad) return false;
      for (const c of D.CROPS) if (Math.hypot(c.x - x, c.y - y) < 80 + pad) return false;
      for (const b of D.BASES) if (Math.hypot(b.x - x, b.y - y) < D.C.BASE_R + pad) return false;
      if (x > D.RIVER.x - 40 && x < D.RIVER.x + D.RIVER.w + 40) return false;
      return true;
    };
    const onLane = (x, y, pad) => {
      for (const k in D.LANES) {
        const P = D.LANES[k];
        for (let i = 0; i < P.length - 1; i++) {
          const [ax, ay] = P[i], [bx, by] = P[i + 1], dx = bx - ax, dy = by - ay;
          const tt = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
          if (Math.hypot(ax + dx * tt - x, ay + dy * tt - y) < D.C.LANE_WIDTH / 2 + pad) return true;
        }
      }
      return false;
    };
    // trees fill each wall
    for (const w of D.WALLS) {
      const big = Math.min(w.w, w.h);
      const n = Math.max(2, Math.round(Math.max(w.w, w.h) / (big * 0.75)));
      for (let i = 0; i < n; i++) {
        const q = n === 1 ? 0.5 : i / (n - 1);
        const x = w.w > w.h ? w.x + big / 2 + q * (w.w - big) : w.x + w.w / 2;
        const y = w.w > w.h ? w.y + w.h / 2 : w.y + big / 2 + q * (w.h - big);
        dec.trees.push([x + (r() - 0.5) * 10, y + (r() - 0.5) * 10, big * 0.62 + r() * 12, r()]);
      }
    }
    // border forest: trees around the outer edge
    for (let x = 60; x < D.W; x += 110) { dec.trees.push([x + r() * 30, 30 + r() * 20, 60 + r() * 20, r()]); dec.trees.push([x + r() * 30, D.H - 30 - r() * 20, 60 + r() * 20, r()]); }
    for (let y = 60; y < D.H; y += 110) { if (Math.abs(y - 1400) < 200) continue; dec.trees.push([25 + r() * 20, y + r() * 30, 55 + r() * 20, r()]); dec.trees.push([D.W - 25 - r() * 20, y + r() * 30, 55 + r() * 20, r()]); }
    for (let i = 0; i < 420; i++) {
      const x = r() * D.W, y = r() * D.H;
      if (!free(x, y, 10) || onLane(x, y, 0)) continue;
      const k = r();
      if (k < 0.45) dec.mush.push([x, y, r() < 0.5 ? '#67e8f9' : '#c084fc', 3 + r() * 4]);
      else if (k < 0.75) dec.stones.push([x, y, 6 + r() * 10]);
      else if (k < 0.85) dec.stumps.push([x, y, 10 + r() * 6]);
      else if (k < 0.93) dec.pumpkins.push([x, y]);
      else dec.lanterns.push([x, y]);
    }
    for (let i = 0; i < 60; i++) {
      const x = 500 + r() * (D.W - 1000), y = r() * D.H;
      if (!free(x, y, 30) || !onLane(x, y, 30) || onLane(x, y, -10)) continue;
      dec.fences.push([x, y, r() < 0.5 ? 0 : Math.PI / 2 * 0.15]);
    }
    for (let i = 0; i < 40; i++) {
      const x = r() * D.W, y = r() * D.H;
      if (!free(x, y, 40) || onLane(x, y, 20)) continue;
      if (dec.hay.length < 14 && r() < 0.6) dec.hay.push([x, y]); else if (dec.scare.length < 6) dec.scare.push([x, y]);
    }
    return dec;
  }

  function tree(ctx, x, y, R, v) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ell(ctx, x + 8, y + 12, R, R * 0.8); ctx.fill();
    const cols = v < 0.5 ? ['#0b1f17', '#123323', '#1c4a31', '#2a6a44'] : ['#0e1a24', '#14303a', '#1d4650', '#2c6668'];
    ell(ctx, x, y, R, R * 0.95); fs(ctx, cols[0]);
    ell(ctx, x - R * 0.15, y - R * 0.12, R * 0.8, R * 0.75); fs(ctx, cols[1]);
    ell(ctx, x - R * 0.28, y - R * 0.25, R * 0.5, R * 0.45); fs(ctx, cols[2]);
    ell(ctx, x - R * 0.36, y - R * 0.36, R * 0.22, R * 0.2); fs(ctx, cols[3]);
  }

  function paintTile(tctx, D, dec, tx, ty, TW, TH) {
    const ctx = tctx;
    ctx.save();
    ctx.translate(-tx, -ty);
    const inT = (x, y, pad) => x > tx - pad && x < tx + TW + pad && y > ty - pad && y < ty + TH + pad;
    // ground
    ctx.fillStyle = '#1a2e24'; ctx.fillRect(tx, ty, TW, TH);
    const r = seeded(1 + Math.floor(tx * 7 + ty * 13));
    for (let i = 0; i < 70; i++) {
      const x = tx + r() * TW, y = ty + r() * TH, R = 40 + r() * 120;
      ctx.fillStyle = r() < 0.5 ? 'rgba(36,66,46,0.45)' : 'rgba(14,30,24,0.5)'; ell(ctx, x, y, R, R * 0.7, r() * 3); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(80,140,90,0.35)'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i < 260; i++) { const x = tx + r() * TW, y = ty + r() * TH; ctx.moveTo(x, y); ctx.lineTo(x + r() * 4 - 2, y - 6 - r() * 4); }
    ctx.stroke();
    // river
    const R = D.RIVER;
    if (inT(R.x + R.w / 2, R.y + R.h / 2, R.h)) {
      ctx.fillStyle = '#0a2a36'; rr(ctx, R.x - 14, R.y - 80, R.w + 28, R.h + 160, 100); ctx.fill();
      ctx.fillStyle = '#0f4150'; rr(ctx, R.x, R.y - 60, R.w, R.h + 120, 90); ctx.fill();
      ctx.fillStyle = '#145566'; rr(ctx, R.x + 30, R.y - 30, R.w - 60, R.h + 60, 60); ctx.fill();
      ctx.fillStyle = 'rgba(103,232,249,0.08)';
      for (let i = 0; i < 40; i++) { ell(ctx, R.x + 30 + r() * (R.w - 60), R.y + r() * R.h, 20 + r() * 30, 4 + r() * 4); ctx.fill(); }
      // lily pads
      for (let i = 0; i < 30; i++) { const x = R.x + 20 + r() * (R.w - 40), y = R.y + r() * R.h; ctx.fillStyle = '#1f5f3a'; ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, 9, 0.4, TAU - 0.1); ctx.closePath(); ctx.fill(); }
    }
    // lanes (dirt paths)
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [w, c] of [[D.C.LANE_WIDTH + 24, '#1c1a14'], [D.C.LANE_WIDTH, '#3d3326'], [D.C.LANE_WIDTH - 70, '#4a3d2c']]) {
      ctx.strokeStyle = c; ctx.lineWidth = w;
      for (const k in D.LANES) { ctx.beginPath(); D.LANES[k].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
    }
    ctx.fillStyle = 'rgba(120,100,70,0.5)';
    for (let i = 0; i < 300; i++) {
      const x = tx + r() * TW, y = ty + r() * TH;
      ell(ctx, x, y, 2 + r() * 3, 1.5 + r() * 2); ctx.fill();
    }
    // bases: mossy stone clearings + barns
    for (const tm of [0, 1]) {
      const b = D.BASES[tm], f = D.FOUNTAINS[tm];
      if (!inT(b.x, b.y, 900)) continue;
      const g = ctx.createRadialGradient(b.x, b.y, 50, b.x, b.y, D.C.BASE_R);
      g.addColorStop(0, '#3a4a3a'); g.addColorStop(1, 'rgba(40,60,45,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, D.C.BASE_R, 0, TAU); ctx.fill();
      ctx.strokeStyle = D.TEAM_COLORS[tm] + '55'; ctx.lineWidth = 6; ctx.setLineDash([30, 20]);
      ctx.beginPath(); ctx.arc(b.x, b.y, D.C.BASE_R - 20, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      // barn behind fountain
      const bx = tm === 0 ? f.x - 90 : f.x + 90, by = f.y - 260, dir = tm === 0 ? 1 : -1;
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; rr(ctx, bx - 80 + 10, by - 40 + 14, 160, 120, 8); ctx.fill();
      ctx.fillStyle = tm === 0 ? '#1e3a8a' : '#7f1d1d'; rr(ctx, bx - 80, by - 40, 160, 120, 8); ctx.fill();
      ctx.strokeStyle = '#0c0a09'; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(bx - 80, by + 20); ctx.lineTo(bx + 80, by + 20); ctx.moveTo(bx, by - 40); ctx.lineTo(bx, by + 80); ctx.stroke();
      ctx.fillStyle = '#f8fafc'; rr(ctx, bx - 22, by - 12, 44, 30, 4); ctx.fill();
      ctx.strokeStyle = '#0c0a09'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(bx - 22, by - 12); ctx.lineTo(bx + 22, by + 18); ctx.moveTo(bx + 22, by - 12); ctx.lineTo(bx - 22, by + 18); ctx.stroke();
      // second barn below
      const by2 = f.y + 260;
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; rr(ctx, bx - 60 + 10, by2 - 40 + 14, 120, 90, 8); ctx.fill();
      ctx.fillStyle = tm === 0 ? '#1e40af' : '#991b1b'; rr(ctx, bx - 60, by2 - 40, 120, 90, 8); ctx.fill();
      ctx.strokeStyle = '#0c0a09'; ctx.lineWidth = 4; ctx.stroke();
      // silo decoration
      ctx.fillStyle = '#57534e'; ctx.beginPath(); ctx.arc(bx + dir * 110, by + 10, 34, 0, TAU); ctx.fill(); ctx.strokeStyle = '#0c0a09'; ctx.stroke();
      ctx.fillStyle = '#a8a29e'; ctx.beginPath(); ctx.arc(bx + dir * 110 - 6, by + 2, 18, 0, TAU); ctx.fill();
      // fountain = glowing well
      const gg = ctx.createRadialGradient(f.x, f.y, 10, f.x, f.y, D.C.FOUNTAIN_R);
      gg.addColorStop(0, D.TEAM_LIGHT[tm] + 'aa'); gg.addColorStop(0.6, D.TEAM_COLORS[tm] + '44'); gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(f.x, f.y, D.C.FOUNTAIN_R, 0, TAU); ctx.fill();
      ctx.fillStyle = '#44403c'; ctx.beginPath(); ctx.arc(f.x, f.y, 52, 0, TAU); ctx.fill(); ctx.strokeStyle = '#1c1917'; ctx.lineWidth = 4; ctx.stroke();
      ctx.fillStyle = '#0e7490'; ctx.beginPath(); ctx.arc(f.x, f.y, 38, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(165,243,252,0.6)'; ell(ctx, f.x - 10, f.y - 10, 14, 7, -0.4); ctx.fill();
    }
    // decor
    for (const [x, y, c, s] of dec.mush) {
      if (!inT(x, y, 40)) continue;
      const g = ctx.createRadialGradient(x, y, 0, x, y, s * 6);
      g.addColorStop(0, c + '55'); g.addColorStop(1, c + '00'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s * 6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e7e5e4'; ctx.fillRect(x - 1, y, 2, s * 1.2);
      ell(ctx, x, y, s * 1.3, s * 0.8); fs(ctx, c);
      ell(ctx, x + s * 2.2, y + 3, s * 0.8, s * 0.5); fs(ctx, c);
    }
    for (const [x, y, s] of dec.stones) { if (!inT(x, y, 30)) continue; ell(ctx, x, y, s, s * 0.7); fs(ctx, '#3f4a44', '#1c2420', 2); ell(ctx, x - s * 0.3, y - s * 0.25, s * 0.35, s * 0.2); fs(ctx, '#57635c'); }
    for (const [x, y, s] of dec.stumps) { if (!inT(x, y, 30)) continue; ell(ctx, x, y, s, s * 0.75); fs(ctx, '#4a3424', '#1c1410', 2); ell(ctx, x, y, s * 0.6, s * 0.42); fs(ctx, null, '#7a5a3c', 1.5); }
    for (const [x, y] of dec.pumpkins) { if (!inT(x, y, 30)) continue; ell(ctx, x, y, 12, 9); fs(ctx, '#c2410c', '#431407', 2); ell(ctx, x, y, 5, 9); fs(ctx, null, '#431407', 1.5); ctx.fillStyle = '#365314'; ctx.fillRect(x - 1.5, y - 13, 3, 5); }
    for (const [x, y] of dec.lanterns) {
      if (!inT(x, y, 80)) continue;
      const g = ctx.createRadialGradient(x, y - 26, 0, x, y - 26, 70); g.addColorStop(0, 'rgba(253,224,71,0.35)'); g.addColorStop(1, 'rgba(253,224,71,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y - 26, 70, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#292524'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 34); ctx.stroke();
      rr(ctx, x - 6, y - 34, 12, 14, 3); fs(ctx, '#fde047', '#292524', 2);
    }
    for (const [x, y, a] of dec.fences) {
      if (!inT(x, y, 60)) continue;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-36, 4, 76, 6);
      ctx.fillStyle = '#6b4f2e'; ctx.strokeStyle = '#1c1410'; ctx.lineWidth = 2;
      for (const px of [-34, 0, 34]) { rr(ctx, px - 4, -16, 8, 22, 2); ctx.fill(); ctx.stroke(); }
      rr(ctx, -38, -12, 76, 5, 2); ctx.fill(); ctx.stroke(); rr(ctx, -38, -3, 76, 5, 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    for (const [x, y] of dec.hay) {
      if (!inT(x, y, 60)) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; rr(ctx, x - 26 + 6, y - 16 + 8, 52, 32, 8); ctx.fill();
      rr(ctx, x - 26, y - 16, 52, 32, 8); fs(ctx, '#a1782a', '#3f2e0c', 2.5);
      ctx.strokeStyle = '#6b4f16'; ctx.lineWidth = 1.5; ctx.beginPath(); for (let i = -18; i < 26; i += 10) { ctx.moveTo(x + i, y - 14); ctx.lineTo(x + i - 4, y + 14); } ctx.stroke();
    }
    for (const [x, y] of dec.scare) {
      if (!inT(x, y, 60)) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ell(ctx, x + 6, y + 6, 22, 8); ctx.fill();
      ctx.strokeStyle = '#3f2e1c'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x, y + 4); ctx.lineTo(x, y - 46); ctx.moveTo(x - 22, y - 32); ctx.lineTo(x + 22, y - 32); ctx.stroke();
      rr(ctx, x - 10, y - 38, 20, 22, 4); fs(ctx, '#7c2d12', '#1c1410', 2);
      ell(ctx, x, y - 50, 9, 9); fs(ctx, '#d6b36a', '#1c1410', 2);
      ctx.beginPath(); ctx.moveTo(x - 16, y - 54); ctx.lineTo(x + 16, y - 54); ctx.lineTo(x + 6, y - 66); ctx.lineTo(x - 6, y - 66); ctx.closePath(); fs(ctx, '#3f2e1c', '#1c1410', 1.5);
      ell(ctx, x - 3, y - 51, 1.5, 1.5); fs(ctx, '#f97316'); ell(ctx, x + 3, y - 51, 1.5, 1.5); fs(ctx, '#f97316');
    }
    // camp clearings
    for (const c of D.CAMPS) {
      if (!inT(c.x, c.y, 160)) continue;
      ctx.fillStyle = 'rgba(70,55,40,0.45)'; ell(ctx, c.x, c.y, D.CAMP_TYPES[c.type].reward ? 120 : 85, D.CAMP_TYPES[c.type].reward ? 90 : 62); ctx.fill();
    }
    // trees (walls) last so they sit on top of the ground decor
    const sorted = dec.trees.slice().sort((a, b) => a[1] - b[1]);
    for (const [x, y, Rr, v] of sorted) if (inT(x, y, Rr + 20)) tree(ctx, x, y, Rr, v);
    ctx.restore();
  }

  window.Art = { drawChamp, POSES, HOVER, spawn, updateDraw, clearParts, castFx, trail, boom, hit, puff, proj, zone, buildDecor, paintTile, ell, fs, rr };
})();
