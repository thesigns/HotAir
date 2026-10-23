import * as THREE from 'three';
import { COAST, DETAIL, POLDER, POWER } from '../config.js';
import { hash, mulberry32 } from '../core/utils.js';
import { SEA_Y, WATER_Y } from './polder.js';
import { Builder, ROUND, _c, _d, drawCow, drawTree, shadeOf } from './kit.js';
import { modelGeometry } from '../models/library.js';
import { DIMS } from '../models/dims.js';

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
  wire: '#2d2f33',
  marker: '#ff7a1a',
  sea: '#5d8aa3',
  sand: '#ecdcae',
  wetSand: '#cdbf95',
  dune: ['#e2d2a0', '#c9c58a', '#a9ad6a', '#93a05c'],
  village: '#7fa452',
  glassWall: '#c9dde3',
  glassRoof: '#e4eff2',
};
// field types drawn as rows (alternating shades along the strip)
const ROWS = { grain: 3.2, crop: 2.4, maize: 2.8, ploughed: 2.2 };

// The windmill's body and sails (shared by every mill), from the Blender models once they are loaded.
const MILL = {
  get body() { return this._body ??= modelGeometry('nl_windmill'); },
  get sails() { return this._sails ??= modelGeometry('nl_mill_sails'); },
};

export class PolderView {
  constructor(polder, parent) {
    this.polder = polder;
    this.group = new THREE.Group();
    parent.add(this.group);
    // double-sided: walls, roofs and banks are lit right whichever way their triangles wind
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.chunks = new Map();   // key -> a group: the merged mesh, and the windmill sails
  }

  // The sails turn with the surface wind and face into it (GDD §10: reading the wind in the world).
  animate(dt, wind) {
    const yaw = Math.PI - wind.dir;
    const spin = Math.min(2.2, 0.25 + wind.speed * 0.35) * dt;
    for (const chunk of this.chunks.values()) {
      for (const m of chunk.userData.mills) {
        m.rotation.y = yaw;
        m.userData.sails.rotation.z += spin;
      }
    }
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
        if (all && d < near) this.build(ci, cj, d > DETAIL.near);
        else if (d < bestD) { bestD = d; best = [ci, cj]; }
      }
    }
    if (best) this.build(...best, bestD > DETAIL.near);
    let up = null, upD = Infinity;
    for (const [key, chunk] of this.chunks) {
      const { ci, cj } = chunk.userData;
      const d = Math.hypot((ci + 0.5) * S - x, (cj + 0.5) * S - z);
      if (d > R + S) this.drop(key);
      else if (chunk.userData.far && d < DETAIL.upgrade && d < upD) { upD = d; up = [ci, cj]; }
    }
    // a far chunk coming near is built again in full
    if (up && !best) this.build(...up, false);
  }

  drop(key) {
    const chunk = this.chunks.get(key);
    this.group.remove(chunk);
    chunk.userData.mesh.geometry.dispose();
    this.chunks.delete(key);
  }

  build(ci, cj, far = false) {
    const bld = new Builder();
    this.mills = [];
    this.far = far;
    const n = POLDER.chunk, B = POLDER.block, p = this.polder;
    const x0 = ci * n * B, z0 = cj * n * B, x1 = x0 + n * B, z1 = z0 + n * B;
    for (let i = ci * n; i < ci * n + n; i++) {
      for (let j = cj * n; j < cj * n + n; j++) this.block(bld, p.block(i, j));
    }
    // the border lines inside this chunk (each line is drawn by the chunk where it starts)
    for (let k = ci * n; k < ci * n + n; k++) this.line(bld, 0, k, k * B, ...p.landRange(0, z0, z1));
    for (let k = cj * n; k < cj * n + n; k++) this.line(bld, 1, k, k * B, ...p.landRange(1, x0, x1));
    const mesh = new THREE.Mesh(bld.build(), this.material);
    mesh.matrixAutoUpdate = false;
    const chunk = new THREE.Group();
    chunk.add(mesh);
    // the windmills on their own: they turn into the wind, their sails turn with it
    const mills = [];
    for (const m of this.mills) {
      const mill = new THREE.Mesh(MILL.body, this.material);
      mill.position.set(m.x, 0, m.z);
      const sails = new THREE.Mesh(MILL.sails, this.material);
      sails.position.set(...DIMS.nl_windmill.hub);
      sails.rotation.z = m.phase;
      mill.add(sails);
      mill.userData.sails = sails;
      chunk.add(mill);
      mills.push(mill);
    }
    chunk.userData = { ci, cj, mesh, mills, far };
    if (this.chunks.has(`${ci},${cj}`)) this.drop(`${ci},${cj}`);
    this.group.add(chunk);
    this.chunks.set(`${ci},${cj}`, chunk);
  }

  // A road, canal or wide ditch along a border line at `at`, from `from` to `to`.
  line(bld, axis, n, at, from, to) {
    const type = this.polder.line(axis, n), hw = POLDER.edge[type];
    if (type === 'sea' || to <= from) return;
    const rect = (a0, a1, l0, l1, y, col) => (axis === 0 ? bld.flat(a0, l0, a1, l1, y, col) : bld.flat(l0, a0, l1, a1, y, col));
    if (type === 'road') {
      rect(at - hw, at + hw, from, to, 0.04, _c.set(COLORS.road));
      const p = this.polder.power(axis, n);
      if (p) this.powerLine(bld, axis, at + p.off, p.phase, from, to);
      return;
    }
    rect(at - hw, at + hw, from, to, WATER_Y, _c.set(COLORS.water));
    this.banks(bld, axis, at - hw, at + hw, from, to);
  }

  // Pylons from `from` to `to` along a power line at `c` across, and the conductors to the next pylon,
  // with orange marker balls on the top one (GDD §7: dangers are visible early).
  powerLine(bld, axis, c, phase, from, to) {
    const S = POWER.spacing, conductors = DIMS.pylon.conductors;
    // world point from (across, height, along)
    const P = (a, y, l) => (axis === 0 ? [a, y, l] : [l, y, a]);
    const quad = (p0, p1, p2, p3, col) => { bld.tri(...p0, ...p1, ...p2, col); bld.tri(...p0, ...p2, ...p3, col); };
    const wire = _d.set(COLORS.wire).clone(), orange = new THREE.Color(COLORS.marker);
    const sag = (u) => POWER.sag * 4 * u * (1 - u);
    for (let l = phase + Math.ceil((from - phase) / S) * S; l < to; l += S) {
      bld.model('pylon', ...P(c, 0, l), axis === 0 ? 0 : Math.PI / 2);
      // the conductors: thin vertical ribbons along a sagging curve
      const segs = 10;
      for (const [off, h] of conductors) {
        const a = c + off;
        for (let s = 0; s < segs; s++) {
          const u0 = s / segs, u1 = (s + 1) / segs, y0 = h - sag(u0), y1 = h - sag(u1);
          quad(P(a, y0, l + u0 * S), P(a, y1, l + u1 * S), P(a, y1 - 0.12, l + u1 * S), P(a, y0 - 0.12, l + u0 * S), wire);
        }
      }
      const [, top] = conductors[conductors.length - 1];
      for (const u of [0.25, 0.5, 0.75]) bld.shape(ROUND, ...P(c, top - sag(u) - 0.35, l + u * S), 0.65, 0.65, 0.65, orange);
    }
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
    if (b.kind === 'sea' || b.kind === 'dunes') this.coast(bld, b);
    if (b.kind === 'forest') {
      bld.flat(b.x0, b.z0, b.x1, b.z1, 0, _c.set(COLORS.forest[0]));
    } else if (b.kind === 'village') {
      bld.flat(b.x0, b.z0, b.x1, b.z1, 0, _c.set(COLORS.village));
    } else if (b.kind === 'glass') {
      bld.flat(b.x0, b.z0, b.x1, b.z1, 0, _c.set(COLORS.yard));
    } else if (b.kind === 'fields') {
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
    // the buildings (the Blender models; b.houses are only their collision boxes), greenhouses built here
    for (const p of b.props) bld.model(p.m, p.x, p.y, p.z, p.yaw);
    for (const h of b.houses) if (h.kind === 'glass') this.greenhouse(bld, h);
    this.mills.push(...b.mills);
    for (const t of b.trees) drawTree(bld, t, this.far);
    if (!this.far) for (const c of b.cows) drawCow(bld, c);
  }

  // The coast in a block: the dunes (a height grid), the beach, the sea - across the whole block square,
  // since the lines across the coast stop behind the dunes.
  coast(bld, b) {
    const p = this.polder, c = p.coast, B = POLDER.block;
    const ax = c.axis, k = ax === 0 ? b.i : b.j;
    const [l0, l1] = ax === 0 ? [b.j * B, (b.j + 1) * B] : [b.i * B, (b.i + 1) * B];
    // the world coordinate across the coast for a coast distance s, and the block's own s range
    const at = (s) => c.n * B + c.sign * s;
    const sA = c.sign * (k * B - c.n * B), sB = c.sign * ((k + 1) * B - c.n * B);
    const s0 = Math.min(sA, sB), s1 = Math.max(sA, sB);
    const rect = (sa, sb, y, col) => {
      const u0 = Math.min(at(sa), at(sb)), u1 = Math.max(at(sa), at(sb));
      if (ax === 0) bld.flat(u0, l0, u1, l1, y, col);
      else bld.flat(l0, u0, l1, u1, y, col);
    };
    if (b.kind === 'sea') {
      const beach = Math.min(s1, COAST.beach);
      if (beach > s0) {
        rect(s0, Math.max(s0, beach - 12), 0.02, _c.set(COLORS.sand));
        rect(Math.max(s0, beach - 12), beach, 0.01, _c.set(COLORS.wetSand));
      }
      if (s1 > COAST.beach) rect(Math.max(s0, COAST.beach), s1, SEA_Y, _c.set(COLORS.sea));
      return;
    }
    // the landward part of the dune block: grass behind the dunes
    const land = Math.min(s1, -COAST.dunes);
    if (land > s0) {
      const u0 = Math.min(at(s0 + POLDER.edge.road), at(land)), u1 = Math.max(at(s0 + POLDER.edge.road), at(land));
      if (ax === 0) bld.flat(u0, b.z0, u1, b.z1, 0, _c.set(COLORS.pasture[2]));
      else bld.flat(b.x0, u0, b.x1, u1, 0, _c.set(COLORS.pasture[2]));
    }
    // the dunes: a grid following the height, sand on the crests, marram in the hollows
    const cell = 6;
    const ns = Math.ceil(COAST.dunes / cell), nl = Math.ceil((l1 - l0) / cell);
    const P = (s, l) => {
      const u = at(s);
      const x = ax === 0 ? u : l, z = ax === 0 ? l : u;
      return [x, p.height(x, z), z];
    };
    for (let a = 0; a < ns; a++) {
      const sa = -COAST.dunes + a * cell, sb = Math.min(0, sa + cell);
      for (let q = 0; q < nl; q++) {
        const la = l0 + q * cell, lb = Math.min(l1, la + cell);
        const p00 = P(sa, la), p10 = P(sb, la), p11 = P(sb, lb), p01 = P(sa, lb);
        const h = (p00[1] + p10[1] + p11[1] + p01[1]) / 4;
        const tone = Math.min(3, Math.floor((h / COAST.duneHeight) * 3 + ((a * 7 + q * 13) % 5) * 0.12));
        _c.set(COLORS.dune[3 - tone]);
        bld.tri(...p00, ...p01, ...p11, _c);
        bld.tri(...p00, ...p11, ...p10, _c);
      }
    }
  }

  // A greenhouse: glass walls and a sawtooth roof of many small ridges along it.
  greenhouse(bld, h) {
    const { x0, x1, z0, z1, wall, ridge } = h;
    const col = _c.set(COLORS.glassWall).clone(), roof = _d.set(COLORS.glassRoof).clone();
    bld.wall(x0, z1, x0, z0, 0, wall, col);
    bld.wall(x1, z0, x1, z1, 0, wall, col);
    bld.wall(x0, z0, x1, z0, 0, wall, col);
    bld.wall(x1, z1, x0, z1, 0, wall, col);
    const along = h.ridgeAxis === 'z';
    const a0 = along ? x0 : z0, a1 = along ? x1 : z1, m0 = along ? z0 : x0, m1 = along ? z1 : x1;
    const span = 3.2, n = Math.max(1, Math.round((a1 - a0) / span)), w = (a1 - a0) / n;
    const P = (a, y, m) => (along ? [a, y, m] : [m, y, a]);
    for (let i = 0; i < n; i++) {
      const a = a0 + i * w, mid = a + w / 2;
      bld.tri(...P(a, wall, m0), ...P(mid, ridge, m0), ...P(mid, ridge, m1), roof);
      bld.tri(...P(a, wall, m0), ...P(mid, ridge, m1), ...P(a, wall, m1), roof);
      bld.tri(...P(mid, ridge, m0), ...P(a + w, wall, m0), ...P(a + w, wall, m1), col);
      bld.tri(...P(mid, ridge, m0), ...P(a + w, wall, m1), ...P(mid, ridge, m1), col);
    }
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



  dispose() {
    for (const chunk of this.chunks.values()) chunk.userData.mesh.geometry.dispose();
    this.chunks.clear();
    this.group.parent?.remove(this.group);
    this.material.dispose();
  }
}
