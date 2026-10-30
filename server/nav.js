'use strict';
// Grid navigation (A*), line-of-sight and wall collision.
const D = require('../shared/data.js');

const CELL = 40;
const INFLATE = 30;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

class Nav {
  constructor() {
    this.cols = Math.ceil(D.W / CELL);
    this.rows = Math.ceil(D.H / CELL);
    const n = this.cols * this.rows;
    this.grid = new Uint8Array(n);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = c * CELL + CELL / 2, y = r * CELL + CELL / 2;
        if (this.pointBlocked(x, y, INFLATE)) this.grid[r * this.cols + c] = 1;
      }
    }
    // A* buffers
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gen = 1;
  }

  pointBlocked(x, y, pad) {
    if (x < pad || y < pad || x > D.W - pad || y > D.H - pad) return true;
    for (const w of D.WALLS) {
      if (x > w.x - pad && x < w.x + w.w + pad && y > w.y - pad && y < w.y + w.h + pad) return true;
    }
    for (const t of D.TOWERS) {
      const rr = t.r + pad;
      if ((x - t.x) * (x - t.x) + (y - t.y) * (y - t.y) < rr * rr) return true;
    }
    return false;
  }

  cellOf(x, y) {
    const c = clamp(Math.floor(x / CELL), 0, this.cols - 1);
    const r = clamp(Math.floor(y / CELL), 0, this.rows - 1);
    return r * this.cols + c;
  }
  blocked(x, y) { return this.grid[this.cellOf(x, y)] === 1; }

  los(ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    const steps = Math.ceil(len / 15);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.blocked(ax + dx * t, ay + dy * t)) return false;
    }
    return true;
  }

  nearestFree(x, y) {
    if (!this.blocked(x, y)) return { x, y };
    const c0 = clamp(Math.floor(x / CELL), 0, this.cols - 1);
    const r0 = clamp(Math.floor(y / CELL), 0, this.rows - 1);
    for (let rad = 1; rad < 40; rad++) {
      let best = null, bd = Infinity;
      for (let r = r0 - rad; r <= r0 + rad; r++) {
        for (let c = c0 - rad; c <= c0 + rad; c++) {
          if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) continue;
          if (Math.abs(r - r0) !== rad && Math.abs(c - c0) !== rad) continue;
          if (this.grid[r * this.cols + c]) continue;
          const cx = c * CELL + CELL / 2, cy = r * CELL + CELL / 2;
          const d = (cx - x) ** 2 + (cy - y) ** 2;
          if (d < bd) { bd = d; best = { x: cx, y: cy }; }
        }
      }
      if (best) return best;
    }
    return { x, y };
  }

  // Returns a list of waypoints (excluding the start).
  findPath(sx, sy, tx, ty) {
    const goal = this.nearestFree(tx, ty);
    tx = goal.x; ty = goal.y;
    let start = { x: sx, y: sy };
    if (this.blocked(sx, sy)) start = this.nearestFree(sx, sy);
    if (this.los(start.x, start.y, tx, ty)) return [{ x: tx, y: ty }];

    const cols = this.cols, grid = this.grid;
    const gen = ++this.gen;
    const s = this.cellOf(start.x, start.y), t = this.cellOf(tx, ty);
    const tc = t % cols, tr = (t / cols) | 0;
    const h = (i) => {
      const dc = Math.abs((i % cols) - tc), dr = Math.abs(((i / cols) | 0) - tr);
      return (dc + dr + (Math.SQRT2 - 2) * Math.min(dc, dr));
    };
    const heap = [];
    const push = (i) => {
      heap.push(i);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (this.f[heap[p]] <= this.f[heap[k]]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]]; k = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last; let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1; let m = k;
          if (l < heap.length && this.f[heap[l]] < this.f[heap[m]]) m = l;
          if (r < heap.length && this.f[heap[r]] < this.f[heap[m]]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
        }
      }
      return top;
    };
    this.stamp[s] = gen; this.g[s] = 0; this.f[s] = h(s); this.parent[s] = -1;
    push(s);
    let found = false, iter = 0;
    while (heap.length && iter++ < 12000) {
      const cur = pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === t) { found = true; break; }
      const cc = cur % cols, cr = (cur / cols) | 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = cc + dc, nr = cr + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= this.rows) continue;
          const ni = nr * cols + nc;
          if (grid[ni]) continue;
          if (dr && dc && (grid[cr * cols + nc] || grid[nr * cols + cc])) continue; // no corner cutting
          if (this.closed[ni] === gen) continue;
          const ng = this.g[cur] + (dr && dc ? Math.SQRT2 : 1);
          if (this.stamp[ni] !== gen || ng < this.g[ni]) {
            this.stamp[ni] = gen; this.g[ni] = ng; this.f[ni] = ng + h(ni); this.parent[ni] = cur;
            push(ni);
          }
        }
      }
    }
    if (!found) return [{ x: tx, y: ty }];
    const cells = [];
    for (let i = t; i !== -1 && i !== s; i = this.parent[i]) {
      cells.push({ x: (i % cols) * CELL + CELL / 2, y: ((i / cols) | 0) * CELL + CELL / 2 });
    }
    cells.reverse();
    cells[cells.length - 1] = { x: tx, y: ty };
    // string pulling
    const out = [];
    let cx = start.x, cy = start.y, i = 0;
    while (i < cells.length) {
      let j = cells.length - 1;
      while (j > i && !this.los(cx, cy, cells[j].x, cells[j].y)) j--;
      out.push(cells[j]);
      cx = cells[j].x; cy = cells[j].y; i = j + 1;
    }
    return out;
  }

  // Push a circle unit out of walls / towers / map edges. Returns true if moved.
  pushOut(u) {
    const ox = u.x, oy = u.y, r = u.r;
    for (const w of D.WALLS) {
      if (u.x < w.x - r || u.x > w.x + w.w + r || u.y < w.y - r || u.y > w.y + w.h + r) continue;
      const cx = clamp(u.x, w.x, w.x + w.w), cy = clamp(u.y, w.y, w.y + w.h);
      const dx = u.x - cx, dy = u.y - cy, d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        u.x = cx + (dx / d) * r; u.y = cy + (dy / d) * r;
      } else {
        const l = u.x - w.x, rt = w.x + w.w - u.x, t = u.y - w.y, b = w.y + w.h - u.y;
        const m = Math.min(l, rt, t, b);
        if (m === l) u.x = w.x - r; else if (m === rt) u.x = w.x + w.w + r;
        else if (m === t) u.y = w.y - r; else u.y = w.y + w.h + r;
      }
    }
    for (const t of D.TOWERS) {
      const rr = t.r + r, dx = u.x - t.x, dy = u.y - t.y, d2 = dx * dx + dy * dy;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1;
        u.x = t.x + (dx / d) * rr; u.y = t.y + (dy / d) * rr;
      }
    }
    u.x = clamp(u.x, r, D.W - r);
    u.y = clamp(u.y, r, D.H - r);
    return Math.abs(u.x - ox) > 0.5 || Math.abs(u.y - oy) > 0.5;
  }
}

module.exports = { Nav, CELL };
