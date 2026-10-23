import { COAST, POLDER, POWER } from '../config.js';
import { hash, mulberry32, range, weighted } from '../core/utils.js';
import { dims, footprint, place } from '../models/place.js';

// The Dutch polder (GDD §8.1), endless and procedural: square blocks between long straight border lines
// (roads, canals, wide ditches), each block cut into long field strips by narrow ditches, with farms,
// windmills, cows, rows of trees along the roads, a solitary tree in a pasture now and then, the odd small
// wood, villages with a church, clusters of greenhouses – and, in most worlds, the North Sea coast: a belt
// of dunes, a wide beach and the sea. Pure data, no Three.js: the landing check and the collisions use it in
// Node too; js/world/polderView.js draws it. All rectangles are axis-aligned. Flat but for the dunes: the
// fields are at y = 0, the water just below.

export const WATER_Y = -0.15;
export const SEA_Y = -0.3;

const FIELDS = [
  ['pasture', 0.42], ['grain', 0.12], ['crop', 0.12], ['tulips', 0.12], ['ploughed', 0.1], ['maize', 0.08],
];
const TULIPS = ['#d8443a', '#f2cf3d', '#e77fb0', '#ef8a2f', '#f1eee4', '#8c5fb3', '#d8443a', '#f2cf3d'];
const HOUSES = ['nl_house_a', 'nl_house_b', 'nl_house_c'];
// the way a building's front faces: towards −x, +x, −z, +z (its yaw)
const FACING = { '-x': -Math.PI / 2, '+x': Math.PI / 2, '-z': Math.PI, '+z': 0 };

// Where the coast is, for a world whose wind at the start blows towards `heading` (rad): usually somewhere
// downwind – then the sea is the end of the land – sometimes behind the launch, sometimes nowhere near.
// Returns { axis, sign, n } (the coast line is at n · block along axis; the sea is on the `sign` side) or null.
export function coastFor(seed, heading) {
  const rnd = mulberry32(hash(seed, 77));
  if (rnd() < COAST.inland) return null;
  const downwind = rnd() < COAST.downwind;
  const h = downwind ? heading : heading + Math.PI;
  const sx = Math.sin(h), sz = -Math.cos(h);
  const axis = Math.abs(sx) > Math.abs(sz) ? 0 : 1;
  const sign = Math.sign(axis === 0 ? sx : sz) || 1;
  const k = Math.floor(range(rnd, downwind ? COAST.downwindBlocks : COAST.upwindBlocks));
  return { axis, sign, n: sign > 0 ? k + 1 : -k };
}

export class Polder {
  constructor(seed, { coast = null } = {}) {
    this.seed = seed;
    this.coast = coast;
    this.blocks = new Map();
    this.lines = new Map();
    this.powers = new Map();
    this.dunePhase = mulberry32(hash(seed, 55))() * 100;
  }

  // Signed distance from the coast line: > 0 out to sea, < 0 inland (−Infinity without a coast).
  coastS(x, z) {
    const c = this.coast;
    if (!c) return -Infinity;
    return c.sign * ((c.axis === 0 ? x : z) - c.n * POLDER.block);
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
      const c = this.coast;
      if (c && axis === c.axis) {
        const s = c.sign * (n - c.n);
        if (s === -1) t = 'road';          // the coast road behind the dunes
        if (s >= 0) t = 'sea';             // the shore and the lines out at sea: nothing
      }
      this.lines.set(key, t);
    }
    return t;
  }

  halfWidth(axis, n) { return POLDER.edge[this.line(axis, n)]; }

  // Where a line across the coast ends: the along-range [from, to] clipped to the land behind the dunes.
  landRange(axis, from, to) {
    const c = this.coast;
    if (!c || axis === c.axis) return [from, to];
    const end = c.n * POLDER.block - c.sign * COAST.dunes;
    return c.sign > 0 ? [from, Math.min(to, end)] : [Math.max(from, end), to];
  }

  // A power line along a road, or null: { off (from the line, signed), phase (of the pylons along it) }.
  power(axis, n) {
    const key = axis * 1e7 + n;
    if (this.powers.has(key)) return this.powers.get(key);
    let p = null;
    const c = this.coast;
    const coastRoad = c && axis === c.axis && c.sign * (n - c.n) === -1;
    if (this.line(axis, n) === 'road' && n !== 0 && n !== 1 && !coastRoad) {
      const rnd = mulberry32(hash(this.seed, 31 + axis, n));
      if (rnd() < POWER.odds) {
        p = { off: (rnd() < 0.5 ? -1 : 1) * (this.halfWidth(axis, n) + POWER.offset), phase: rnd() * POWER.spacing };
      }
    }
    this.powers.set(key, p);
    return p;
  }

  // The power lines near (x, z): the signed distance across each line and the wire height there.
  wires(x, z, out = []) {
    out.length = 0;
    if (this.coastS(x, z) > -COAST.dunes) return out;
    const B = POLDER.block, S = POWER.spacing;
    for (let axis = 0; axis < 2; axis++) {
      const c = axis === 0 ? x : z, along = axis === 0 ? z : x;
      for (let n = Math.floor((c - 40) / B); n <= Math.floor((c + 40) / B) + 1; n++) {
        const p = this.power(axis, n);
        if (!p) continue;
        const cross = c - (n * B + p.off);
        if (Math.abs(cross) > 40) continue;
        const u = ((((along - p.phase) % S) + S) % S) / S, sag = POWER.sag * 4 * u * (1 - u);
        // each conductor where it hangs from the pylon's arms, sagging between the pylons
        for (const [off, h] of dims('pylon').conductors) out.push({ cross: cross - off, h: h - sag, spread: 0 });
      }
    }
    return out;
  }

  block(i, j) {
    const key = `${i},${j}`;
    let b = this.blocks.get(key);
    if (!b) {
      b = this.makeBlock(i, j);
      if (b.kind !== 'sea' && b.kind !== 'dunes') this.pylons(b);
      this.blocks.set(key, b);
      if (this.blocks.size > 600) this.blocks.delete(this.blocks.keys().next().value);
    }
    return b;
  }

  // What a block is: sea | dunes | village | glass | forest | fields.
  kindOf(i, j, rnd) {
    const c = this.coast;
    if (c) {
      const k = c.sign * ((c.axis === 0 ? i : j) - c.n);
      if (k >= 0) return 'sea';
      if (k === -1) return 'dunes';
    }
    if (i === 0 && j === 0) return 'fields';
    const near = Math.abs(i) <= 1 && Math.abs(j) <= 1;
    // a village in some 5 × 5 cells of blocks, a cluster of greenhouses in some 4 × 4 cells
    const V = 5, vr = mulberry32(hash(this.seed, 501, Math.floor(i / V), Math.floor(j / V)));
    if (vr() < POLDER.village && !near) {
      const vi = Math.floor(i / V) * V + Math.floor(vr() * V), vj = Math.floor(j / V) * V + Math.floor(vr() * V);
      if (i === vi && j === vj) return 'village';
    }
    const G = 4, gr = mulberry32(hash(this.seed, 601, Math.floor(i / G), Math.floor(j / G)));
    if (gr() < POLDER.glass && !near) {
      const gi = Math.floor(i / G) * G + Math.floor(gr() * (G - 1)), gj = Math.floor(j / G) * G + Math.floor(gr() * (G - 1));
      const w = 1 + Math.floor(gr() * 2), h = 1 + Math.floor(gr() * 2);
      if (i >= gi && i < gi + w && j >= gj && j < gj + h) return 'glass';
    }
    return rnd() < POLDER.forest ? 'forest' : 'fields';
  }

  makeBlock(i, j) {
    const B = POLDER.block;
    const rnd = mulberry32(hash(this.seed, i, j));
    const launch = i === 0 && j === 0;
    // the inside of the block, between the border lines
    const x0 = i * B + this.halfWidth(0, i), x1 = (i + 1) * B - this.halfWidth(0, i + 1);
    const z0 = j * B + this.halfWidth(1, j), z1 = (j + 1) * B - this.halfWidth(1, j + 1);
    const b = {
      i, j, x0, x1, z0, z1, kind: this.kindOf(i, j, rnd), strips: [], yard: null, trees: [], houses: [], props: [], mills: [], cows: [], church: null,
    };
    // strips are separated along the across axis: 0 = across x (ditches run north–south), 1 = across z
    b.across = rnd() < 0.5 ? 0 : 1;
    const [a0, a1] = b.across === 0 ? [x0, x1] : [z0, z1];
    const [l0, l1] = b.across === 0 ? [z0, z1] : [x0, x1];

    switch (b.kind) {
      case 'sea': return b;
      case 'dunes': this.dunes(b, rnd); return b;
      case 'village': this.village(b, rnd); return b;
      case 'glass': this.glass(b, a0, a1, l0, l1, rnd); return b;
      case 'forest':
        // a small wood on a jittered grid
        for (let u = x0 + 4; u < x1 - 3; u += 7.5) {
          for (let v = z0 + 4; v < z1 - 3; v += 7.5) {
            if (rnd() < 0.12) continue;
            this.tree(b, u + (rnd() - 0.5) * 5, v + (rnd() - 0.5) * 5, rnd, rnd() < 0.3 ? 'pine' : 'round');
          }
        }
        return b;
      default:
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

    // a windmill by a ditch, in the middle of a strip
    if (!launch && rnd() < POLDER.mill) {
      const s = b.strips[Math.floor(rnd() * b.strips.length)];
      if (!s.yard && s.f1 - s.f0 > 14) {
        const c = s.f0 + 6, l = l0 + 30 + rnd() * (l1 - l0 - 60);
        const [x, z] = b.across === 0 ? [c, l] : [l, c];
        b.mills.push({ x, z, phase: rnd() * 6 });
        for (const p of dims('nl_windmill').parts) {
          b.houses.push({ x0: x + p.x0, x1: x + p.x1, z0: z + p.z0, z1: z + p.z1, wall: p.wall, ridge: p.ridge, kind: 'mill', ridgeAxis: 'z' });
        }
        s.mill = true;
      }
    }

    // rows of trees along the roads, inside the block
    this.roadTrees(b, rnd, launch);

    // cows in some pastures; a solitary tree in others
    for (const s of b.strips) {
      if (s.type !== 'pasture' || s.launch) continue;
      if (rnd() < POLDER.cows) {
        const n = 3 + Math.floor(rnd() * 8);
        const lc = l0 + 20 + rnd() * (l1 - l0 - 40);
        for (let k = 0; k < n; k++) {
          const c = s.f0 + 3 + rnd() * (s.f1 - s.f0 - 6), l = lc + (rnd() - 0.5) * 50;
          if (l < l0 + 4 || l > l1 - 4) continue;
          const [x, z] = b.across === 0 ? [c, l] : [l, c];
          if (!(b.yard && inRect(b.yard, x, z, 3))) b.cows.push({ x, z, turn: rnd() < 0.5, coat: Math.floor(rnd() * 3) });
        }
      } else if (rnd() < 0.2) {
        const c = s.f0 + 4 + rnd() * (s.f1 - s.f0 - 8), l = l0 + 10 + rnd() * (l1 - l0 - 20);
        const [x, z] = b.across === 0 ? [c, l] : [l, c];
        if (!(b.yard && inRect(b.yard, x, z, 6)) && !s.mill) this.tree(b, x, z, rnd, 'round');
      }
    }
    return b;
  }

  roadTrees(b, rnd, launch = false) {
    const { i, j, x0, x1, z0, z1 } = b;
    const sides = [[0, i, x0 + 2.5, 'v'], [0, i + 1, x1 - 2.5, 'v'], [1, j, z0 + 2.5, 'h'], [1, j + 1, z1 - 2.5, 'h']];
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
        if (b.houses.some((h) => inRect(h, x, z, 3))) continue;
        this.tree(b, x, z, rnd, kind);
      }
    }
  }

  rect(across, a0, a1, l0, l1) {
    return across === 0 ? { x0: a0, x1: a1, z0: l0, z1: l1 } : { x0: l0, x1: l1, z0: a0, z1: a1 };
  }

  tree(b, x, z, rnd, kind) {
    const t = { x, z, kind, shade: rnd() };
    if (kind === 'poplar') { t.r = range(rnd, [1.4, 2]); t.top = range(rnd, [14, 19]); t.base = 2; }
    else if (kind === 'pine') { t.r = range(rnd, [2, 2.8]); t.top = range(rnd, [11, 16]); t.base = 3; }
    else { t.r = range(rnd, [2.6, 4.2]); t.top = range(rnd, [8, 13]); t.base = 2.2; }
    t.y = this.height(x, z);
    t.top += t.y;
    t.base += t.y;
    b.trees.push(t);
  }

  // A farmhouse near the road end of the yard (its front to the road), a barn behind it, trees around.
  farm(b, s, end, l0, l1, rnd) {
    const w = s.f1 - s.f0;
    const near = end === 0 ? l0 : l1, dirL = end === 0 ? 1 : -1;
    // the front faces the road end of the strip
    const yaw = b.across === 0 ? FACING[end === 0 ? '-z' : '+z'] : FACING[end === 0 ? '-x' : '+x'];
    const ha = s.f0 + 8 + rnd() * Math.max(0, w - 16);
    const at = (a, l) => (b.across === 0 ? [a, l] : [l, a]);
    place(b, 'nl_farmhouse', ...at(ha, near + dirL * 10), yaw);
    place(b, 'nl_barn', ...at((s.f0 + s.f1) / 2, near + dirL * 29), yaw);
    b.farm = { x: (b.yard.x0 + b.yard.x1) / 2, z: (b.yard.z0 + b.yard.z1) / 2 };
    // trees along the far side of the yard
    const far = near + dirL * 40.5;
    for (let a = s.f0 + 3; a < s.f1 - 2; a += range(rnd, [6, 9])) this.tree(b, ...at(a, far), rnd, 'round');
  }

  // A village: brick houses in rows along the block's sides facing the roads, gardens, trees, a church in the middle.
  village(b, rnd) {
    const { x0, x1, z0, z1 } = b;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    place(b, 'nl_church', cx, cz, 0);
    b.church = { x: cx, z: cz + 12 };
    // rows of houses facing the four sides, two deep
    for (const [axis, side] of [[0, -1], [0, 1], [1, -1], [1, 1]]) {
      const yaw = FACING[(side < 0 ? '-' : '+') + (axis === 0 ? 'x' : 'z')];
      const edge = axis === 0 ? (side < 0 ? x0 : x1) : (side < 0 ? z0 : z1);
      for (const depth of [10, 32]) {
        const [from, to] = axis === 0 ? [z0 + 10, z1 - 10] : [x0 + 10, x1 - 10];
        for (let u = from + rnd() * 4; u < to; u += range(rnd, [11, 15])) {
          if (rnd() < 0.12) continue;
          const name = HOUSES[Math.floor(rnd() * HOUSES.length)];
          const c = edge - side * depth;
          const [x, z] = axis === 0 ? [c, u] : [u, c];
          const r = footprint(name, x, z, yaw);
          if (b.houses.some((h) => overlap(h, r, 2.5))) continue;
          place(b, name, x, z, yaw);
        }
      }
    }
    // trees in the gardens and round the church
    for (let k = 0; k < 30; k++) {
      const x = x0 + 6 + rnd() * (x1 - x0 - 12), z = z0 + 6 + rnd() * (z1 - z0 - 12);
      if (!b.houses.some((h) => inRect(h, x, z, 4))) this.tree(b, x, z, rnd, 'round');
    }
    this.roadTrees(b, rnd);
  }

  // Greenhouses (the Westland): long glass halls across the block with paths between them.
  glass(b, a0, a1, l0, l1, rnd) {
    let a = a0 + 6;
    while (a < a1 - 20) {
      const w = Math.min(a1 - 6 - a, range(rnd, [40, 75]));
      if (w < 20) break;
      const r = this.rect(b.across, a, a + w, l0 + 8, l1 - 8);
      b.houses.push({ ...r, wall: 5, ridge: 6.2, kind: 'glass', ridgeAxis: b.across === 0 ? 'z' : 'x' });
      a += w + range(rnd, [8, 14]);
    }
    b.farm = { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 };
  }

  // The dune belt behind the beach: marram grass, sand, a few pines on the landward side.
  dunes(b, rnd) {
    for (let k = 0; k < 40; k++) {
      const x = b.x0 + rnd() * (b.x1 - b.x0), z = b.z0 + rnd() * (b.z1 - b.z0);
      const s = this.coastS(x, z);
      if (s < -COAST.dunes * 0.45 && s > -COAST.dunes) this.tree(b, x, z, rnd, 'pine');
    }
  }

  // Pylons of the power lines along the block's borders, on its side of them (woods included).
  pylons(b) {
    const B = POLDER.block, { i, j, x0, x1, z0, z1 } = b;
    for (const [axis, n, side] of [[0, i, 1], [0, i + 1, -1], [1, j, 1], [1, j + 1, -1]]) {
      const p = this.power(axis, n);
      if (!p || Math.sign(p.off) !== side) continue;
      const c = n * B + p.off;
      const [from, to] = axis === 0 ? [z0, z1] : [x0, x1];
      for (let u = p.phase + Math.ceil((from - p.phase) / POWER.spacing) * POWER.spacing; u < to; u += POWER.spacing) {
        const [x, z] = axis === 0 ? [c, u] : [u, c];
        for (const p of dims('pylon').parts) {
          b.houses.push({ x0: x + p.x0, x1: x + p.x1, z0: z + p.z0, z1: z + p.z1, wall: p.wall, ridge: p.ridge, kind: 'pylon', ridgeAxis: 'z' });
        }
        b.trees = b.trees.filter((t) => Math.abs(t.x - x) > 6 || Math.abs(t.z - z) > 6);
        b.cows = b.cows.filter((t) => Math.abs(t.x - x) > 4 || Math.abs(t.z - z) > 4);
      }
    }
  }

  // What is on the ground here: 'road' | 'water' | 'forest' | 'yard' | 'village' | 'glass' | 'dunes' | 'beach'
  // | a field type.
  surfaceAt(x, z) {
    const cs = this.coastS(x, z);
    if (cs > COAST.beach) return 'water';
    if (cs > 0) return 'beach';
    if (cs > -COAST.dunes) return 'dunes';
    const B = POLDER.block;
    const i = Math.floor(x / B), j = Math.floor(z / B);
    // the border lines on either side
    const bx = x - i * B, bz = z - j * B;
    const lx = bx < B / 2 ? i : i + 1, dx = bx < B / 2 ? bx : B - bx;
    const lz = bz < B / 2 ? j : j + 1, dz = bz < B / 2 ? bz : B - bz;
    if (dx < this.halfWidth(0, lx)) return this.line(0, lx) === 'road' ? 'road' : 'water';
    if (dz < this.halfWidth(1, lz)) return this.line(1, lz) === 'road' ? 'road' : 'water';
    const b = this.block(i, j);
    if (b.kind === 'forest' || b.kind === 'village' || b.kind === 'dunes') return b.kind === 'dunes' ? 'pasture' : b.kind;
    if (b.kind === 'glass') return 'yard';
    if (b.yard && inRect(b.yard, x, z)) return 'yard';
    const a = b.across === 0 ? x : z;
    for (const s of b.strips) {
      if (a >= s.a0 && a < s.a1) return a < s.f0 || a >= s.f1 ? 'water' : s.type;
    }
    return 'pasture';
  }

  // The ground height: flat polder, rolling dunes along the coast.
  height(x, z) {
    const s = this.coastS(x, z);
    if (s <= -COAST.dunes || s > 0) return 0;
    const c = this.coast, along = (c.axis === 0 ? z : x) + this.dunePhase;
    const u = (s + COAST.dunes) / COAST.dunes;           // 0 inland … 1 at the beach
    const bump = Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.7;
    const n = 0.55 + 0.25 * Math.sin(along / 37 + s / 23) + 0.2 * Math.sin(along / 13 - s / 9);
    return Math.max(0, COAST.duneHeight * bump * n);
  }

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

  // For the soundscape: the distance to the nearest cow, farm and church within r, or Infinity.
  sounds(x, z, r, out = {}) {
    out.cow = out.farm = out.church = Infinity;
    const B = POLDER.block;
    for (let i = Math.floor((x - r) / B); i <= Math.floor((x + r) / B); i++) {
      for (let j = Math.floor((z - r) / B); j <= Math.floor((z + r) / B); j++) {
        const b = this.block(i, j);
        for (const c of b.cows) out.cow = Math.min(out.cow, Math.hypot(c.x - x, c.z - z));
        if (b.farm) out.farm = Math.min(out.farm, Math.hypot(b.farm.x - x, b.farm.z - z));
        if (b.church) out.church = Math.min(out.church, Math.hypot(b.church.x - x, b.church.z - z));
      }
    }
    out.sea = Math.max(0, COAST.beach - this.coastS(x, z));
    return out;
  }

  get launch() { return this.block(0, 0).launch; }
}

export const inRect = (r, x, z, m = 0) => x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;
const overlap = (a, b, m) => a.x0 - m < b.x1 && a.x1 + m > b.x0 && a.z0 - m < b.z1 && a.z1 + m > b.z0;
