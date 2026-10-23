import { POLDER } from '../config.js';
import { hash, mulberry32, range, weighted } from '../core/utils.js';

// The Dutch polder (GDD §8.1), endless and procedural: square blocks between long straight border lines
// (roads, canals, wide ditches), each block cut into long field strips by narrow ditches, with farms,
// rows of trees along the roads, a solitary tree in a pasture now and then, and the odd small wood.
// Pure data, no Three.js: the landing check and the collisions use it in Node too; js/world/polderView.js
// draws it. All rectangles are axis-aligned. Flat: the fields are at y = 0, the water just below.

export const WATER_Y = -0.15;

const FIELDS = [
  ['pasture', 0.42], ['grain', 0.12], ['crop', 0.12], ['tulips', 0.12], ['ploughed', 0.1], ['maize', 0.08],
];
const TULIPS = ['#d8443a', '#f2cf3d', '#e77fb0', '#ef8a2f', '#f1eee4', '#8c5fb3', '#d8443a', '#f2cf3d'];

export class Polder {
  constructor(seed) {
    this.seed = seed;
    this.blocks = new Map();
    this.lines = new Map();
  }

  // A border line: vertical lines (x = i·block) are axis 0, horizontal ones (z = j·block) axis 1.
  line(axis, n) {
    const key = axis * 1e7 + n;
    let t = this.lines.get(key);
    if (!t) {
      const r = mulberry32(hash(this.seed, 7 + axis, n))();
      const { road, canal } = POLDER.edgeOdds;
      t = r < road ? 'road' : r < road + canal ? 'canal' : 'ditch';
      // the launch field's block has roads around it, for the crew
      if (n === 0 || n === 1) t = 'road';
      this.lines.set(key, t);
    }
    return t;
  }

  halfWidth(axis, n) { return POLDER.edge[this.line(axis, n)]; }

  block(i, j) {
    const key = `${i},${j}`;
    let b = this.blocks.get(key);
    if (!b) {
      b = this.makeBlock(i, j);
      this.blocks.set(key, b);
      if (this.blocks.size > 600) this.blocks.delete(this.blocks.keys().next().value);
    }
    return b;
  }

  makeBlock(i, j) {
    const B = POLDER.block;
    const rnd = mulberry32(hash(this.seed, i, j));
    const launch = i === 0 && j === 0;
    // the inside of the block, between the border lines
    const x0 = i * B + this.halfWidth(0, i), x1 = (i + 1) * B - this.halfWidth(0, i + 1);
    const z0 = j * B + this.halfWidth(1, j), z1 = (j + 1) * B - this.halfWidth(1, j + 1);
    const b = { i, j, x0, x1, z0, z1, forest: false, strips: [], yard: null, trees: [], houses: [] };
    b.forest = !launch && rnd() < POLDER.forest;
    // strips are separated along the across axis: 0 = across x (ditches run north–south), 1 = across z
    b.across = rnd() < 0.5 ? 0 : 1;
    const [a0, a1] = b.across === 0 ? [x0, x1] : [z0, z1];
    const [l0, l1] = b.across === 0 ? [z0, z1] : [x0, x1];

    if (b.forest) {
      // a small wood on a jittered grid
      for (let u = x0 + 4; u < x1 - 3; u += 7.5) {
        for (let v = z0 + 4; v < z1 - 3; v += 7.5) {
          if (rnd() < 0.12) continue;
          this.tree(b, u + (rnd() - 0.5) * 5, v + (rnd() - 0.5) * 5, rnd, rnd() < 0.3 ? 'pine' : 'round');
        }
      }
      return b;
    }

    // field strips
    let a = a0;
    while (a < a1 - 1) {
      let w = range(rnd, POLDER.strip);
      if (a1 - (a + w) < 18) w = a1 - a;
      const type = launch ? 'pasture' : weighted(rnd, FIELDS);
      const s = { a0: a, a1: a + w, type, shade: rnd() };
      if (type === 'tulips') {
        // bands of colour along the strip
        const n = 2 + Math.floor(rnd() * 3);
        s.bands = Array.from({ length: n }, () => TULIPS[Math.floor(rnd() * TULIPS.length)]);
      }
      b.strips.push(s);
      a += w;
    }
    for (const s of b.strips) {
      // the ditches between strips (not along the block border)
      s.f0 = s.a0 + (s.a0 > a0 + 0.5 ? POLDER.ditch : 0);
      s.f1 = s.a1 - (s.a1 < a1 - 0.5 ? POLDER.ditch : 0);
    }

    // the launch: the middle of the strip at the centre of the block
    if (launch) {
      const mid = (a0 + a1) / 2;
      const s = b.strips.find((st) => st.a0 <= mid && st.a1 > mid);
      const c = (s.f0 + s.f1) / 2, l = (l0 + l1) / 2;
      b.launch = b.across === 0 ? { x: c, z: l } : { x: l, z: c };
      s.launch = true;
    }

    // a farm: a yard at the end of one strip, next to a road if there is one
    if (!launch && rnd() < POLDER.farm) {
      const ends = [[0, this.line(1 - b.across, b.across === 0 ? j : i)], [1, this.line(1 - b.across, b.across === 0 ? j + 1 : i + 1)]];
      const end = ends.find(([, t]) => t === 'road')?.[0] ?? (rnd() < 0.5 ? 0 : 1);
      const s = b.strips[Math.floor(rnd() * b.strips.length)];
      const depth = 42;
      const y0 = end === 0 ? l0 : l1 - depth, y1 = end === 0 ? l0 + depth : l1;
      s.yard = end === 0 ? [l0, l0 + depth] : [l1 - depth, l1];
      b.yard = this.rect(b.across, s.f0, s.f1, y0, y1);
      this.farm(b, s, end, l0, l1, rnd);
    }

    // rows of trees along the roads, inside the block
    const sides = [
      [0, i, x0 + 2.5, 'v'], [0, i + 1, x1 - 2.5, 'v'], [1, j, z0 + 2.5, 'h'], [1, j + 1, z1 - 2.5, 'h'],
    ];
    for (const [axis, n, at, dir] of sides) {
      if (this.line(axis, n) !== 'road' || rnd() >= POLDER.treeRow) continue;
      if (launch && n === 0) continue;
      const kind = rnd() < 0.55 ? 'poplar' : 'round';
      const gap = kind === 'poplar' ? range(rnd, [7, 9]) : range(rnd, [9, 13]);
      const [from, to] = dir === 'v' ? [z0, z1] : [x0, x1];
      for (let u = from + gap / 2; u < to; u += gap) {
        if (rnd() < 0.08) continue;
        const [x, z] = dir === 'v' ? [at, u] : [u, at];
        if (b.yard && inRect(b.yard, x, z, 2)) continue;
        this.tree(b, x, z, rnd, kind);
      }
    }

    // a solitary tree in a pasture
    for (const s of b.strips) {
      if (s.type !== 'pasture' || s.launch || rnd() > 0.18) continue;
      const c = s.f0 + 4 + rnd() * (s.f1 - s.f0 - 8), l = l0 + 10 + rnd() * (l1 - l0 - 20);
      const [x, z] = b.across === 0 ? [c, l] : [l, c];
      if (!(b.yard && inRect(b.yard, x, z, 6))) this.tree(b, x, z, rnd, 'round');
    }
    return b;
  }

  rect(across, a0, a1, l0, l1) {
    return across === 0 ? { x0: a0, x1: a1, z0: l0, z1: l1 } : { x0: l0, x1: l1, z0: a0, z1: a1 };
  }

  tree(b, x, z, rnd, kind) {
    const t = { x, z, kind, shade: rnd() };
    if (kind === 'poplar') { t.r = range(rnd, [1.4, 2]); t.top = range(rnd, [14, 19]); t.base = 2; }
    else if (kind === 'pine') { t.r = range(rnd, [2, 2.8]); t.top = range(rnd, [11, 16]); t.base = 3; }
    else { t.r = range(rnd, [2.6, 4.2]); t.top = range(rnd, [8, 13]); t.base = 2.2; }
    b.trees.push(t);
  }

  // A farmhouse near the road end of the yard, a barn behind it, trees around.
  farm(b, s, end, l0, l1, rnd) {
    const w = s.f1 - s.f0;
    const near = end === 0 ? l0 : l1, dirL = end === 0 ? 1 : -1;
    const house = { w: Math.min(10, w - 6), d: 9, wall: 3.6, ridge: 8.5, wallColor: rnd() < 0.5 ? '#9b4a33' : '#a85a3c', roof: rnd() < 0.5 ? '#3d3d42' : '#b5552f' };
    const barn = { w: Math.min(20, w - 4), d: 13, wall: 4.8, ridge: 10.5, wallColor: rnd() < 0.5 ? '#5b4636' : '#4a5a4a', roof: '#4a4a4e' };
    const ha = s.f0 + 3 + house.w / 2 + rnd() * Math.max(0, w - house.w - 6);
    const hl = near + dirL * (5 + house.d / 2);
    const bl = near + dirL * (5 + house.d + 5 + barn.d / 2);
    for (const [h, ac, lc] of [[house, ha, hl], [barn, (s.f0 + s.f1) / 2, bl]]) {
      // the ridge runs along the strip
      const r = this.rect(b.across, ac - h.w / 2, ac + h.w / 2, lc - h.d / 2, lc + h.d / 2);
      b.houses.push({ ...r, ...h, ridgeAxis: b.across === 0 ? 'z' : 'x' });
    }
    // trees along the far side of the yard
    const far = near + dirL * 40;
    for (let a = s.f0 + 3; a < s.f1 - 2; a += range(rnd, [6, 9])) {
      const [x, z] = b.across === 0 ? [a, far] : [far, a];
      this.tree(b, x, z, rnd, 'round');
    }
  }

  // What is on the ground here: 'road' | 'water' | 'forest' | 'yard' | a field type.
  surfaceAt(x, z) {
    const B = POLDER.block;
    const i = Math.floor(x / B), j = Math.floor(z / B);
    // the border lines on either side
    const bx = x - i * B, bz = z - j * B;
    const lx = bx < B / 2 ? i : i + 1, dx = bx < B / 2 ? bx : B - bx;
    const lz = bz < B / 2 ? j : j + 1, dz = bz < B / 2 ? bz : B - bz;
    if (dx < this.halfWidth(0, lx)) return this.line(0, lx) === 'road' ? 'road' : 'water';
    if (dz < this.halfWidth(1, lz)) return this.line(1, lz) === 'road' ? 'road' : 'water';
    const b = this.block(i, j);
    if (b.forest) return 'forest';
    if (b.yard && inRect(b.yard, x, z)) return 'yard';
    const a = b.across === 0 ? x : z;
    for (const s of b.strips) {
      if (a >= s.a0 && a < s.a1) return a < s.f0 || a >= s.f1 ? 'water' : s.type;
    }
    return 'pasture';
  }

  height() { return 0; }

  // Trees and houses within r of (x, z).
  near(x, z, r, out = { trees: [], houses: [] }) {
    out.trees.length = 0;
    out.houses.length = 0;
    const B = POLDER.block;
    for (let i = Math.floor((x - r) / B); i <= Math.floor((x + r) / B); i++) {
      for (let j = Math.floor((z - r) / B); j <= Math.floor((z + r) / B); j++) {
        const b = this.block(i, j);
        for (const t of b.trees) if (Math.abs(t.x - x) < r + t.r && Math.abs(t.z - z) < r + t.r) out.trees.push(t);
        for (const h of b.houses) if (x > h.x0 - r && x < h.x1 + r && z > h.z0 - r && z < h.z1 + r) out.houses.push(h);
      }
    }
    return out;
  }

  get launch() { return this.block(0, 0).launch; }
}

export const inRect = (r, x, z, m = 0) => x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;
