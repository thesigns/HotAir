import * as THREE from 'three';
import { COAST, POLDER, POWER } from '../config.js';
import { hash, mulberry32 } from '../core/utils.js';
import { SEA_Y, WATER_Y } from './polder.js';

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
  pylon: '#9a9ea3',
  wire: '#2d2f33',
  marker: '#ff7a1a',
  sea: '#5d8aa3',
  sand: '#ecdcae',
  wetSand: '#cdbf95',
  dune: ['#e2d2a0', '#c9c58a', '#a9ad6a', '#93a05c'],
  village: '#7fa452',
  glassWall: '#c9dde3',
  glassRoof: '#e4eff2',
  mill: '#5c5446',
  millCap: '#3b3833',
  sail: '#efe8d6',
  cows: [['#1d1d1d', '#f4f2ec'], ['#f4f2ec', '#1d1d1d'], ['#7a4a2a', '#f4f2ec']],
  spire: '#2f4f4a',
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
const TOWER = template(new THREE.CylinderGeometry(0.55, 1, 1, 8, 1, true).translate(0, 0.5, 0));
const BOX = template(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
const PYRAMID = template(new THREE.ConeGeometry(1, 1, 4, 1, true).rotateY(Math.PI / 4).translate(0, 0.5, 0));

// A windmill's sails: four blades on a hub, turning about the local Z axis (shared by every mill).
const SAILS = (() => {
  const pos = [];
  for (let k = 0; k < 4; k++) {
    const g = new THREE.BoxGeometry(1.7, 11, 0.15).translate(0.5, 6.3, 0).rotateZ((k * Math.PI) / 2).toNonIndexed();
    pos.push(...g.attributes.position.array);
  }
  pos.push(...new THREE.BoxGeometry(0.8, 0.8, 0.8).toNonIndexed().attributes.position.array);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
})();
const SAIL_MAT = new THREE.MeshLambertMaterial({ color: COLORS.sail, side: THREE.DoubleSide });

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
    this.chunks = new Map();   // key -> a group: the merged mesh, and the windmill sails
  }

  // The sails turn with the surface wind and face into it (GDD §10: reading the wind in the world).
  animate(dt, wind) {
    const yaw = Math.PI - wind.dir;
    const spin = Math.min(2.2, 0.25 + wind.speed * 0.35) * dt;
    for (const chunk of this.chunks.values()) {
      for (const m of chunk.userData.mills) {
        m.rotation.y = yaw;
        m.children[0].rotation.z += spin;
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
        if (all && d < near) this.build(ci, cj);
        else if (d < bestD) { bestD = d; best = [ci, cj]; }
      }
    }
    if (best) this.build(...best);
    for (const [key, chunk] of this.chunks) {
      const { ci, cj } = chunk.userData;
      if (Math.hypot((ci + 0.5) * S - x, (cj + 0.5) * S - z) > R + S) {
        this.group.remove(chunk);
        chunk.userData.mesh.geometry.dispose();
        this.chunks.delete(key);
      }
    }
  }

  build(ci, cj) {
    const bld = new Builder();
    this.mills = [];
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
    // the windmills' sails, on their own (they turn)
    for (const m of this.mills) {
      const head = new THREE.Group();
      head.position.set(m.x, 16.2, m.z);
      const sails = new THREE.Mesh(SAILS, SAIL_MAT);
      sails.position.z = 3.4;
      sails.rotation.z = m.phase;
      head.add(sails);
      chunk.add(head);
    }
    chunk.userData = { ci, cj, mesh, mills: chunk.children.slice(1) };
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

  // Pylons from `from` to `to` along a power line at `c` across, and the wires to the next pylon,
  // with orange marker balls (GDD §7: dangers are visible early).
  powerLine(bld, axis, c, phase, from, to) {
    const S = POWER.spacing, top = POWER.top;
    // world point from (across, height, along)
    const P = (a, y, l) => (axis === 0 ? [a, y, l] : [l, y, a]);
    const quad = (p0, p1, p2, p3, col) => { bld.tri(...p0, ...p1, ...p2, col); bld.tri(...p0, ...p2, ...p3, col); };
    const steel = _c.set(COLORS.pylon).clone(), wire = _d.set(COLORS.wire).clone(), orange = new THREE.Color(COLORS.marker);
    for (let l = phase + Math.ceil((from - phase) / S) * S; l < to; l += S) {
      // a tapering four-sided tower and its cross-arm
      const H = top + 3, b0 = 2.4, b1 = 0.6;
      for (const [sa, sl, ta, tl] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
        quad(P(c + sa * b0, 0, l + sl * b0), P(c + ta * b0, 0, l + tl * b0), P(c + ta * b1, H, l + tl * b1), P(c + sa * b1, H, l + sl * b1), steel);
      }
      const sp = POWER.spread + 0.8;
      quad(P(c - sp, top + 0.6, l), P(c + sp, top + 0.6, l), P(c + sp, top - 0.2, l), P(c - sp, top - 0.2, l), steel);
      // the wires: thin vertical ribbons along a sagging curve
      const segs = 10;
      for (const k of [-1, 0, 1]) {
        const a = c + k * POWER.spread;
        for (let s = 0; s < segs; s++) {
          const u0 = s / segs, u1 = (s + 1) / segs;
          const y0 = top - POWER.sag * 4 * u0 * (1 - u0), y1 = top - POWER.sag * 4 * u1 * (1 - u1);
          quad(P(a, y0, l + u0 * S), P(a, y1, l + u1 * S), P(a, y1 - 0.14, l + u1 * S), P(a, y0 - 0.14, l + u0 * S), wire);
        }
      }
      // marker balls on the middle wire
      for (const u of [0.25, 0.5, 0.75]) {
        const [x, y, z] = P(c, top - POWER.sag * 4 * u * (1 - u) - 0.3, l + u * S);
        bld.shape(ROUND, x, y, z, 0.7, 0.7, 0.7, orange);
      }
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
    for (const h of b.houses) {
      if (h.kind === 'glass') this.greenhouse(bld, h);
      else if (h.kind !== 'pylon' && h.kind !== 'mill') this.house(bld, h);   // pylons: drawn with their line
    }
    for (const m of b.mills) this.mill(bld, m);
    for (const t of b.trees) this.tree(bld, t, rnd);
    for (const c of b.cows) this.cow(bld, c);
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

  // A Dutch windmill: a tapering eight-sided tower and its cap; the sails turn on their own (build()).
  mill(bld, m) {
    bld.shape(TOWER, m.x, 0, m.z, 3.6, 15.2, 3.6, _c.set(COLORS.mill));
    bld.shape(ROUND, m.x, 16.2, m.z, 2.6, 2, 2.6, _c.set(COLORS.millCap));
    this.mills.push(m);
  }

  // A cow: a body, a patch and a head - black-and-white or brown.
  cow(bld, c) {
    const [coat, patch] = COLORS.cows[c.coat];
    const sx = c.turn ? 2.2 : 0.8, sz = c.turn ? 0.8 : 2.2;
    bld.shape(BOX, c.x, 0.55, c.z, sx, 0.75, sz, _c.set(coat));
    bld.shape(BOX, c.x + (c.turn ? 0.3 : 0), 1.05, c.z + (c.turn ? 0 : 0.3), c.turn ? 0.8 : 0.7, 0.3, c.turn ? 0.7 : 0.8, _c.set(patch));
    const hx = c.turn ? c.x + 1.25 : c.x, hz = c.turn ? c.z : c.z + 1.25;
    bld.shape(BOX, hx, 0.85, hz, 0.45, 0.45, 0.45, _c.set(coat));
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
    if (h.kind === 'tower') {
      // a church tower with a spire
      bld.shape(BOX, (x0 + x1) / 2, 0, (z0 + z1) / 2, x1 - x0, wall, z1 - z0, _c.set(h.wallColor));
      bld.shape(PYRAMID, (x0 + x1) / 2, wall, (z0 + z1) / 2, (x1 - x0) * 0.72, h.spire - wall, (z1 - z0) * 0.72, _c.set(COLORS.spire));
      return;
    }
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
    for (const chunk of this.chunks.values()) chunk.userData.mesh.geometry.dispose();
    this.chunks.clear();
    this.group.parent?.remove(this.group);
    this.material.dispose();
  }
}
