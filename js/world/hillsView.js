import * as THREE from 'three';
import { HILLS } from '../config.js';
import { hash, mulberry32 } from '../core/utils.js';
import { BOX, Builder, ROUND, _c, drawCow, drawHouse, drawTree } from './kit.js';

// Draws a hilly country (js/world/hills.js) in chunks of HILLS.chunk × HILLS.chunk blocks around the balloon:
// the ground as a height grid coloured by the land cover, and the things on it, merged into one flat-shaded
// mesh per chunk. Built one chunk per frame, dropped when far away. Same interface as PolderView.

const RIBBONS = { gravel: '#e8dfc8', road: '#7c7c76', river: '#6d9cb4', lake: '#6d9cb4' };
const VINE = '#4f6e2c';
const CABLE = '#2d2f33';
const STATION = '#8a8f96';
const GONDOLA = '#d6362c';

const colors = new Map();
const parsed = (hex) => {
  let c = colors.get(hex);
  if (!c) { c = new THREE.Color(hex); colors.set(hex, c); }
  return c;
};

export class HillsView {
  constructor(terrain, parent) {
    this.terrain = terrain;
    this.group = new THREE.Group();
    parent.add(this.group);
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.chunks = new Map();
    this.job = null;           // the chunk being built, a little every frame: { key, step (a generator) }
  }

  get size() { return HILLS.block * HILLS.chunk; }

  // Build the chunks near (x, z) – all of those within `near` at once when `all`, otherwise the nearest
  // missing one a few milliseconds per frame – and drop the far ones.
  update(x, z, all = false, near = HILLS.viewRadius) {
    const S = this.size, R = HILLS.viewRadius;
    const t0 = performance.now();
    while (all || performance.now() - t0 < HILLS.budget) {
      if (!this.job) {
        let best = null, bestD = Infinity;
        for (let ci = Math.floor((x - R) / S); ci <= Math.floor((x + R) / S); ci++) {
          for (let cj = Math.floor((z - R) / S); cj <= Math.floor((z + R) / S); cj++) {
            const d = Math.hypot((ci + 0.5) * S - x, (cj + 0.5) * S - z);
            if (d > R || this.chunks.has(`${ci},${cj}`)) continue;
            if (d < bestD && (!all || d < near)) { bestD = d; best = [ci, cj]; }
          }
        }
        if (!best) break;
        this.job = this.build(...best);
      }
      if (this.job.next().done) this.job = null;
    }
    for (const [key, mesh] of this.chunks) {
      const { ci, cj } = mesh.userData;
      if (Math.hypot((ci + 0.5) * S - x, (cj + 0.5) * S - z) > R + S) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        this.chunks.delete(key);
      }
    }
  }

  animate() {}

  // A generator: one step at a time (a block filled, a few rows of the ground, a block's things), so a chunk
  // is built over several frames.
  *build(ci, cj) {
    const t = this.terrain, bld = new Builder();
    const n = HILLS.chunk, B = HILLS.block, G = HILLS.cell;
    for (let i = ci * n - 1; i <= ci * n + n; i++) {
      for (let j = cj * n - 1; j <= cj * n + n; j++) if (t.ensure(i, j)) yield;
    }
    const x0 = ci * n * B, z0 = cj * n * B, cells = Math.round((n * B) / G);
    // the ground: a height grid, each square coloured by what covers its middle
    const hs = new Float32Array((cells + 1) * (cells + 1));
    for (let a = 0; a <= cells; a++) {
      for (let c = 0; c <= cells; c++) hs[a * (cells + 1) + c] = t.height(x0 + a * G, z0 + c * G);
      if (a % 10 === 9) yield;
    }
    for (let a = 0; a < cells; a++) {
      for (let c = 0; c < cells; c++) {
        const xa = x0 + a * G, za = z0 + c * G, xb = xa + G, zb = za + G;
        const h00 = hs[a * (cells + 1) + c], h10 = hs[(a + 1) * (cells + 1) + c];
        const h01 = hs[a * (cells + 1) + c + 1], h11 = hs[(a + 1) * (cells + 1) + c + 1];
        // each triangle by what covers it and how steep it is
        const s1 = Math.hypot(h11 - h01, h01 - h00) / G, s2 = Math.hypot(h10 - h00, h11 - h10) / G;
        bld.tri(xa, h00, za, xa, h01, zb, xb, h11, zb, parsed(t.color(xa + G / 3, za + (2 * G) / 3, s1)));
        bld.tri(xa, h00, za, xb, h11, zb, xb, h10, za, parsed(t.color(xa + (2 * G) / 3, za + G / 3, s2)));
      }
      if (a % 8 === 7) yield;
    }
    // the things on it
    for (let i = ci * n; i < ci * n + n; i++) {
      for (let j = cj * n; j < cj * n + n; j++) {
        this.block(bld, t.block(i, j));
        yield;
      }
    }
    const mesh = new THREE.Mesh(bld.build(), this.material);
    mesh.matrixAutoUpdate = false;
    mesh.userData = { ci, cj };
    this.group.add(mesh);
    this.chunks.set(`${ci},${cj}`, mesh);
  }

  block(bld, b) {
    const rnd = mulberry32(hash(this.terrain.seed, b.i, b.j, 98));
    for (const r of b.ribbons) this.ribbon(bld, r);
    for (const v of b.rows) this.vines(bld, v);
    for (const h of b.houses) drawHouse(bld, h);
    for (const tr of b.trees) drawTree(bld, tr, rnd);
    for (const c of b.cows) drawCow(bld, c);
    for (const c of b.cables) if (c.owner === b) this.cable(bld, c);
  }

  // A row of vines: a low hedge following the ground, its top and its sunny side.
  vines(bld, v) {
    const t = this.terrain, col = parsed(VINE), w = 0.5, H = 1.1;
    for (let x = v.x0; x < v.x1 - 0.1; x += 8) {
      const xb = Math.min(v.x1, x + 8), ya = t.height(x, v.z), yb = t.height(xb, v.z);
      bld.tri(x, ya + H, v.z - w, xb, yb + H, v.z - w, xb, yb + H, v.z + w, col);
      bld.tri(x, ya + H, v.z - w, xb, yb + H, v.z + w, x, ya + H, v.z + w, col);
      bld.tri(x, ya, v.z + w, xb, yb, v.z + w, xb, yb + H, v.z + w, col);
      bld.tri(x, ya, v.z + w, xb, yb + H, v.z + w, x, ya + H, v.z + w, col);
    }
  }

  // A road, a drive or a river laid on the ground, in short pieces that follow its height.
  ribbon(bld, r) {
    const t = this.terrain, dx = r.x1 - r.x0, dz = r.z1 - r.z0, len = Math.hypot(dx, dz);
    const nx = -dz / len * r.w / 2, nz = dx / len * r.w / 2, lift = r.kind === 'river' ? 0.12 : 0.25;
    const steps = Math.max(1, Math.ceil(len / 8)), col = parsed(RIBBONS[r.kind]);
    let px = r.x0, pz = r.z0, py = t.height(px, pz) + lift;
    for (let s = 1; s <= steps; s++) {
      const x = r.x0 + (dx * s) / steps, z = r.z0 + (dz * s) / steps, y = t.height(x, z) + lift;
      bld.tri(px - nx, py, pz - nz, x - nx, y, z - nz, x + nx, y, z + nz, col);
      bld.tri(px - nx, py, pz - nz, x + nx, y, z + nz, px + nx, py, pz + nz, col);
      px = x; pz = z; py = y;
    }
  }

  // A cable car: the stations, two cables (thin ribbons) and a pair of gondolas.
  cable(bld, c) {
    const dx = c.x1 - c.x0, dz = c.z1 - c.z0, len = Math.hypot(dx, dz);
    const sx = -dz / len, sz = dx / len;
    for (const [x, g, z, y] of [[c.x0, c.g0, c.z0, c.y0], [c.x1, c.g1, c.z1, c.y1]]) bld.shape(BOX, x, g, z, 8, y - g + 2, 8, parsed(STATION));
    const segs = 16, wire = parsed(CABLE);
    for (const side of [-c.spread, c.spread]) {
      for (let s = 0; s < segs; s++) {
        const u0 = s / segs, u1 = (s + 1) / segs;
        const p = (u) => [c.x0 + dx * u + sx * side, c.y0 + (c.y1 - c.y0) * u - c.sag * 4 * u * (1 - u), c.z0 + dz * u + sz * side];
        const [ax, ay, az] = p(u0), [bx, by, bz] = p(u1);
        bld.tri(ax, ay, az, bx, by, bz, bx, by - 0.2, bz, wire);
        bld.tri(ax, ay, az, bx, by - 0.2, bz, ax, ay - 0.2, az, wire);
      }
    }
    for (const [u, side] of [[0.35, -c.spread], [0.65, c.spread]]) {
      const x = c.x0 + dx * u + sx * side, z = c.z0 + dz * u + sz * side;
      const y = c.y0 + (c.y1 - c.y0) * u - c.sag * 4 * u * (1 - u);
      bld.shape(BOX, x, y - 4.2, z, 2.4, 2.6, 2.4, parsed(GONDOLA));
      bld.shape(ROUND, x, y - 0.4, z, 0.3, 0.3, 0.3, _c.set(CABLE));
    }
  }

  dispose() {
    this.job = null;
    for (const mesh of this.chunks.values()) mesh.geometry.dispose();
    this.chunks.clear();
    this.group.parent?.remove(this.group);
    this.material.dispose();
  }
}
