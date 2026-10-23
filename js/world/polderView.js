import * as THREE from 'three';
import { POLDER } from '../config.js';
import { hash, mulberry32 } from '../core/utils.js';
import { WATER_Y } from './polder.js';

// Draws the polder (js/world/polder.js) in chunks of POLDER.chunk × POLDER.chunk blocks around the balloon:
// one merged, vertex-coloured, flat-shaded mesh per chunk (one draw call). Built one chunk per frame,
// dropped when far away.

const COLORS = {
  pasture: ['#79a948', '#86b453', '#6f9f43', '#8cb85a'],
  grain: ['#d8c46c', '#cdb35a', '#e0cd7c'],
  crop: ['#5f8f3a', '#4f7f32', '#6a9a40'],
  maize: ['#8fae3c', '#9cb848'],
  ploughed: ['#8a6a4a', '#7b5c3f', '#94735a'],
  forest: ['#4c6a33'],
  road: '#77786f',
  water: '#6f9cb2',
  bank: '#5f5a3e',
  yard: '#a39a84',
  trunk: '#5a4632',
  crowns: ['#4d7a34', '#5a8a3a', '#3f6b2e', '#628f3f'],
  pine: ['#33572d', '#3d6334'],
};
// field types drawn as rows (alternating shades along the strip)
const ROWS = { grain: 3.2, crop: 2.4, maize: 2.8, ploughed: 2.2 };

const _c = new THREE.Color();
const _d = new THREE.Color();

// Unit shapes for the trees, as flat triangle lists.
function template(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const a = Float32Array.from(g.attributes.position.array);
  geo.dispose();
  if (g !== geo) g.dispose();
  return a;
}
const ROUND = template(new THREE.IcosahedronGeometry(1, 0));
const CONE = template(new THREE.ConeGeometry(1, 1, 6, 1, true).translate(0, 0.5, 0));
const TRUNK = template(new THREE.CylinderGeometry(0.18, 0.26, 1, 5, 1, true).translate(0, 0.5, 0));

class Builder {
  constructor() { this.p = []; this.c = []; }

  tri(ax, ay, az, bx, by, bz, cx, cy, cz, col) {
    this.p.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let i = 0; i < 3; i++) this.c.push(col.r, col.g, col.b);
  }

  // A horizontal rectangle facing up.
  flat(x0, z0, x1, z1, y, col) {
    if (x1 - x0 < 0.01 || z1 - z0 < 0.01) return;
    this.tri(x0, y, z0, x0, y, z1, x1, y, z1, col);
    this.tri(x0, y, z0, x1, y, z1, x1, y, z0, col);
  }

  // A vertical wall from (x0, z0) to (x1, z1), between y0 and y1.
  wall(x0, z0, x1, z1, y0, y1, col) {
    this.tri(x0, y0, z0, x1, y0, z1, x1, y1, z1, col);
    this.tri(x0, y0, z0, x1, y1, z1, x0, y1, z0, col);
  }

  shape(tpl, x, y, z, sx, sy, sz, col, jitter = 0, rnd = null) {
    for (let i = 0; i < tpl.length; i += 9) {
      if (jitter) _d.copy(col).multiplyScalar(1 - jitter + rnd() * jitter * 2);
      const cc = jitter ? _d : col;
      this.tri(
        x + tpl[i] * sx, y + tpl[i + 1] * sy, z + tpl[i + 2] * sz,
        x + tpl[i + 3] * sx, y + tpl[i + 4] * sy, z + tpl[i + 5] * sz,
        x + tpl[i + 6] * sx, y + tpl[i + 7] * sy, z + tpl[i + 8] * sz, cc,
      );
    }
  }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }
}

const shadeOf = (list, s) => _c.set(list[Math.floor(s * list.length) % list.length]);

export class PolderView {
  constructor(polder, parent) {
    this.polder = polder;
    this.group = new THREE.Group();
    parent.add(this.group);
    // double-sided: walls, roofs and banks are lit right whichever way their triangles wind
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.chunks = new Map();
  }

  get size() { return POLDER.block * POLDER.chunk; }

  // Build the nearest missing chunk (or all of them within `near`, when `all`), drop the far ones.
  update(x, z, all = false, near = POLDER.viewRadius) {
    const S = this.size, R = POLDER.viewRadius;
    const ci0 = Math.floor((x - R) / S), ci1 = Math.floor((x + R) / S);
    const cj0 = Math.floor((z - R) / S), cj1 = Math.floor((z + R) / S);
    let best = null, bestD = Infinity;
    for (let ci = ci0; ci <= ci1; ci++) {
      for (let cj = cj0; cj <= cj1; cj++) {
        const d = Math.hypot((ci + 0.5) * S - x, (cj + 0.5) * S - z);
        if (d > R || this.chunks.has(`${ci},${cj}`)) continue;
        if (all && d < near) this.build(ci, cj);
        else if (d < bestD) { bestD = d; best = [ci, cj]; }
      }
    }
    if (best) this.build(...best);
    for (const [key, mesh] of this.chunks) {
      const { ci, cj } = mesh.userData;
      if (Math.hypot((ci + 0.5) * S - x, (cj + 0.5) * S - z) > R + S) {
        this.group.remove(mesh);
        mesh.geometry.dispose();
        this.chunks.delete(key);
      }
    }
  }

  build(ci, cj) {
    const bld = new Builder();
    const n = POLDER.chunk, B = POLDER.block, p = this.polder;
    const x0 = ci * n * B, z0 = cj * n * B, x1 = x0 + n * B, z1 = z0 + n * B;
    for (let i = ci * n; i < ci * n + n; i++) {
      for (let j = cj * n; j < cj * n + n; j++) this.block(bld, p.block(i, j));
    }
    // the border lines inside this chunk (each line is drawn by the chunk where it starts)
    for (let k = ci * n; k < ci * n + n; k++) this.line(bld, 0, k, k * B, z0, z1);
    for (let k = cj * n; k < cj * n + n; k++) this.line(bld, 1, k, k * B, x0, x1);
    const mesh = new THREE.Mesh(bld.build(), this.material);
    mesh.userData = { ci, cj };
    mesh.matrixAutoUpdate = false;
    this.group.add(mesh);
    this.chunks.set(`${ci},${cj}`, mesh);
  }

  // A road, canal or wide ditch along a border line at `at`, from `from` to `to`.
  line(bld, axis, n, at, from, to) {
    const type = this.polder.line(axis, n), hw = POLDER.edge[type];
    const rect = (a0, a1, l0, l1, y, col) => (axis === 0 ? bld.flat(a0, l0, a1, l1, y, col) : bld.flat(l0, a0, l1, a1, y, col));
    if (type === 'road') {
      rect(at - hw, at + hw, from, to, 0.04, _c.set(COLORS.road));
      return;
    }
    rect(at - hw, at + hw, from, to, WATER_Y, _c.set(COLORS.water));
    this.banks(bld, axis, at - hw, at + hw, from, to);
  }

  // The low banks on both sides of a strip of water between a0 and a1 (across), from l0 to l1 (along).
  banks(bld, axis, a0, a1, l0, l1) {
    _c.set(COLORS.bank);
    if (axis === 0) {
      bld.wall(a0, l1, a0, l0, WATER_Y, 0, _c);
      bld.wall(a1, l0, a1, l1, WATER_Y, 0, _c);
    } else {
      bld.wall(l0, a0, l1, a0, WATER_Y, 0, _c);
      bld.wall(l1, a1, l0, a1, WATER_Y, 0, _c);
    }
  }

  block(bld, b) {
    const rnd = mulberry32(hash(this.polder.seed, b.i, b.j, 99));
    if (b.forest) {
      bld.flat(b.x0, b.z0, b.x1, b.z1, 0, _c.set(COLORS.forest[0]));
    } else {
      const ax = b.across;
      const [l0, l1] = ax === 0 ? [b.z0, b.z1] : [b.x0, b.x1];
      // across a0…a1, along l0…l1, in world terms
      const rect = (a0, a1, m0, m1, y, col) => (ax === 0 ? bld.flat(a0, m0, a1, m1, y, col) : bld.flat(m0, a0, m1, a1, y, col));
      for (let k = 0; k < b.strips.length; k++) {
        const s = b.strips[k];
        // the field, without the farmyard
        const parts = s.yard ? (s.yard[0] <= l0 + 0.1 ? [[s.yard[1], l1]] : [[l0, s.yard[0]]]) : [[l0, l1]];
        for (const [m0, m1] of parts) this.field(rect, s, m0, m1);
        if (s.yard) rect(s.f0, s.f1, s.yard[0], s.yard[1], 0, _c.set(COLORS.yard));
        // the ditch to the next strip
        if (s.f1 < s.a1) {
          const next = b.strips[k + 1];
          const a0 = s.f1, a1 = next ? next.f0 : s.a1;
          rect(a0, a1, l0, l1, WATER_Y, _c.set(COLORS.water));
          this.banks(bld, ax, a0, a1, l0, l1);
        }
      }
    }
    for (const h of b.houses) this.house(bld, h);
    for (const t of b.trees) this.tree(bld, t, rnd);
  }

  field(rect, s, m0, m1) {
    if (s.bands) {
      const w = (s.f1 - s.f0) / s.bands.length;
      s.bands.forEach((col, i) => rect(s.f0 + i * w, s.f0 + (i + 1) * w, m0, m1, 0, _c.set(col)));
      return;
    }
    const base = shadeOf(COLORS[s.type] ?? COLORS.pasture, s.shade).clone();
    const row = ROWS[s.type];
    if (!row) { rect(s.f0, s.f1, m0, m1, 0, base); return; }
    // rows along the strip, alternating a lighter and a darker shade
    const n = Math.max(1, Math.round((s.f1 - s.f0) / row)), w = (s.f1 - s.f0) / n;
    for (let i = 0; i < n; i++) rect(s.f0 + i * w, s.f0 + (i + 1) * w, m0, m1, 0, _d.copy(base).multiplyScalar(i % 2 ? 0.92 : 1.04));
  }

  house(bld, h) {
    const { x0, x1, z0, z1, wall, ridge } = h;
    const col = _c.set(h.wallColor);
    bld.wall(x0, z1, x0, z0, 0, wall, col);
    bld.wall(x1, z0, x1, z1, 0, wall, col);
    bld.wall(x0, z0, x1, z0, 0, wall, col);
    bld.wall(x1, z1, x0, z1, 0, wall, col);
    const roof = _d.set(h.roof);
    const o = 0.5;   // eaves
    if (h.ridgeAxis === 'z') {
      const xm = (x0 + x1) / 2;
      // gable ends
      bld.tri(x0, wall, z0, x1, wall, z0, xm, ridge, z0, col);
      bld.tri(x1, wall, z1, x0, wall, z1, xm, ridge, z1, col);
      // roof planes
      bld.tri(x0 - o, wall - 0.3, z0 - o, xm, ridge, z0 - o, xm, ridge, z1 + o, roof);
      bld.tri(x0 - o, wall - 0.3, z0 - o, xm, ridge, z1 + o, x0 - o, wall - 0.3, z1 + o, roof);
      bld.tri(x1 + o, wall - 0.3, z1 + o, xm, ridge, z1 + o, xm, ridge, z0 - o, roof);
      bld.tri(x1 + o, wall - 0.3, z1 + o, xm, ridge, z0 - o, x1 + o, wall - 0.3, z0 - o, roof);
    } else {
      const zm = (z0 + z1) / 2;
      bld.tri(x0, wall, z1, x0, wall, z0, x0, ridge, zm, col);
      bld.tri(x1, wall, z0, x1, wall, z1, x1, ridge, zm, col);
      bld.tri(x1 + o, wall - 0.3, z0 - o, x0 - o, wall - 0.3, z0 - o, x0 - o, ridge, zm, roof);
      bld.tri(x1 + o, wall - 0.3, z0 - o, x0 - o, ridge, zm, x1 + o, ridge, zm, roof);
      bld.tri(x0 - o, wall - 0.3, z1 + o, x1 + o, wall - 0.3, z1 + o, x1 + o, ridge, zm, roof);
      bld.tri(x0 - o, wall - 0.3, z1 + o, x1 + o, ridge, zm, x0 - o, ridge, zm, roof);
    }
  }

  tree(bld, t, rnd) {
    const crownH = t.top - t.base;
    bld.shape(TRUNK, t.x, 0, t.z, 1, t.base + crownH * 0.3, 1, _c.set(COLORS.trunk));
    if (t.kind === 'pine') {
      bld.shape(CONE, t.x, t.base, t.z, t.r, crownH, t.r, shadeOf(COLORS.pine, t.shade), 0.06, rnd);
    } else {
      const sy = crownH / 2;
      bld.shape(ROUND, t.x, t.base + sy, t.z, t.r, sy, t.r, shadeOf(COLORS.crowns, t.shade), 0.08, rnd);
    }
  }

  dispose() {
    for (const mesh of this.chunks.values()) mesh.geometry.dispose();
    this.chunks.clear();
    this.group.parent?.remove(this.group);
    this.material.dispose();
  }
}
