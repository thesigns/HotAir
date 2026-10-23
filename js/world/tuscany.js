import { TUSCANY } from '../config.js';
import { clamp, hash, makeFbm, mulberry32, range, smoothstep, weighted } from '../core/utils.js';
import { Hills, faceTowards } from './hills.js';
import { footprint as footprintOf } from '../models/place.js';

const overlaps = (a, b, m) => a.x0 - m < b.x1 && a.x1 + m > b.x0 && a.z0 - m < b.z1 && a.z1 + m > b.z0;

// Tuscany (GDD §8.2): rolling hills, a patchwork of irregular fields (grain, sunflowers, ploughed earth,
// dry pasture), vineyards and olive groves on the slopes, oak woods where it is steep, stone farmhouses at
// the end of white gravel drives lined with cypresses, and towns on the hilltops with a tower. The flat
// ground is on the hilltops and the valley floors; vineyards and olive groves are no place to land.

const FIELDS = [
  ['grain', 0.24], ['sunflowers', 0.12], ['ploughed', 0.15], ['pasture', 0.18], ['vines', 0.13], ['olives', 0.1], ['forest', 0.08],
];
const COLORS = {
  grain: ['#d9bf6a', '#e2c97a', '#cfb25a'],
  sunflowers: ['#e8c22a', '#f0cd3a'],
  ploughed: ['#a07a55', '#93704c', '#ab8660'],
  pasture: ['#a3a65a', '#94a052', '#b0ad66'],
  vines: ['#6f8a3c', '#7a9444'],
  olives: ['#a9a678', '#b2ae80'],
  forest: ['#58703a', '#4f6834'],
  village: ['#b8a888'],
};
const TOWN_HOUSES = ['it_house_a', 'it_house_b', 'it_house_c'];

export class Tuscany extends Hills {
  constructor(seed) {
    super(seed);
    this.big = makeFbm(hash(seed, 11), 3);
    this.small = makeFbm(hash(seed, 12), 3);
    this.towns = new Map();
    this.types = new Map();      // field type per site (it needs the slope: worth keeping)
    this.base = this.rawHeight(0, 0);
  }

  rawHeight(x, z) {
    const a = this.big(x / TUSCANY.hillScale, z / TUSCANY.hillScale);
    const b = this.small(x / 210, z / 210);
    return Math.max(0, (a - 0.25) * 1.55) ** 1.3 * TUSCANY.hillHeight + b * 14;
  }

  // A hilltop town in a macro cell, or null: its centre at the highest point found there.
  town(I, J) {
    const key = I * 65536 + J;
    if (this.towns.has(key)) return this.towns.get(key);
    const S = TUSCANY.townCell, rnd = mulberry32(hash(this.seed, 21, I, J));
    let t = null;
    if (rnd() < TUSCANY.townOdds && !(I === 0 && J === 0)) {
      let best = -1, bx = 0, bz = 0;
      for (let a = 1; a < 8; a++) {
        for (let c = 1; c < 8; c++) {
          const x = (I + a / 8) * S, z = (J + c / 8) * S, h = this.rawHeight(x, z);
          if (h > best) { best = h; bx = x; bz = z; }
        }
      }
      if (best > TUSCANY.townAbove) t = { x: bx, z: bz, y: best, r: TUSCANY.townRadius };
    }
    this.towns.set(key, t);
    return t;
  }

  // The towns whose plateau reaches (x, z).
  townAt(x, z) {
    const S = TUSCANY.townCell, I = Math.floor(x / S), J = Math.floor(z / S);
    for (let a = I - 1; a <= I + 1; a++) {
      for (let c = J - 1; c <= J + 1; c++) {
        const t = this.town(a, c);
        if (t && Math.hypot(x - t.x, z - t.z) < t.r * 1.8) return t;
      }
    }
    return null;
  }

  height(x, z) {
    let h = this.rawHeight(x, z);
    // the launch field and the town plateaus are flat
    const dl = Math.hypot(x, z);
    if (dl < 140) h += (this.base - h) * (1 - smoothstep(clamp((dl - 50) / 90, 0, 1)));
    const t = this.townAt(x, z);
    if (t) {
      const d = Math.hypot(x - t.x, z - t.z);
      h += (t.y - h) * (1 - smoothstep(clamp((d - t.r) / (t.r * 0.8), 0, 1)));
    }
    return h;
  }

  // The field at (x, z): the nearest of the jittered sites on a grid (irregular, Voronoi-like fields).
  site(x, z) {
    const C = TUSCANY.field;
    const ci = Math.floor(x / C), cj = Math.floor(z / C);
    let best = null, bestD = Infinity;
    for (let a = ci - 1; a <= ci + 1; a++) {
      for (let c = cj - 1; c <= cj + 1; c++) {
        const h = hash(this.seed, 31, a, c);
        const sx = (a + 0.15 + (h & 1023) / 1023 * 0.7) * C, sz = (c + 0.15 + ((h >>> 10) & 1023) / 1023 * 0.7) * C;
        const d = (x - sx) ** 2 + (z - sz) ** 2;
        if (d < bestD) { bestD = d; best = [a, c, sx, sz, h]; }
      }
    }
    return best;
  }

  fieldType(a, c, sx, sz, h) {
    const key = a * 65536 + c;
    let t = this.types.get(key);
    if (t) return t;
    const rnd = mulberry32(h);
    if (Math.hypot(sx, sz) < 160) t = 'pasture';
    else if (this.slope(sx, sz) > 0.3 && rnd() < 0.7) t = 'forest';
    else t = weighted(rnd, FIELDS);
    this.types.set(key, t);
    return t;
  }

  cover(x, z) {
    const t = this.townAt(x, z);
    if (t && Math.hypot(x - t.x, z - t.z) < t.r) return 'village';
    const [a, c, sx, sz, h] = this.site(x, z);
    return this.fieldType(a, c, sx, sz, h);
  }

  color(x, z) {
    const t = this.townAt(x, z);
    if (t && Math.hypot(x - t.x, z - t.z) < t.r) return COLORS.village[0];
    const [a, c, sx, sz, h] = this.site(x, z);
    const list = COLORS[this.fieldType(a, c, sx, sz, h)];
    return list[(h >>> 20) % list.length];
  }

  get launch() { return { x: 0, z: 0 }; }

  fill(b, rnd) {
    const { x0, z0, x1, z1 } = b;
    // woods and olive groves: trees on a jittered grid where they grow
    for (let x = x0 + 5; x < x1; x += 10) {
      for (let z = z0 + 5; z < z1; z += 10) {
        const jx = x + (rnd() - 0.5) * 5, jz = z + (rnd() - 0.5) * 5;
        const cv = this.cover(jx, jz);
        if (cv === 'forest' && rnd() < 0.9) this.tree(b, jx, jz, rnd, 'round').low = true;
        else if (cv === 'olives' && rnd() < 0.9) this.tree(b, jx, jz, rnd, 'olive').low = true;
      }
    }
    // vineyards: rows of vines along x, as runs from one end of the vineyard to the other
    const step = 8;
    for (let z = z0 + 2; z < z1; z += 4) {
      let run = null;
      for (let x = x0; x <= x1; x += step) {
        const vine = x < x1 && this.cover(x + step / 2, z) === 'vines';
        if (vine && !run) run = { x0: x, z };
        if (!vine && run) { run.x1 = x; b.rows.push(run); run = null; }
      }
    }
    // round bales of hay in a cut grain field
    for (let k = 0; k < 3; k++) {
      const x = x0 + 20 + rnd() * (x1 - x0 - 40), z = z0 + 20 + rnd() * (z1 - z0 - 40);
      if (this.cover(x, z) !== 'grain' || rnd() < 0.5) continue;
      for (let n = 0; n < 4 + Math.floor(rnd() * 6); n++) {
        const bx = x + (rnd() - 0.5) * 40, bz = z + (rnd() - 0.5) * 40;
        if (this.cover(bx, bz) === 'grain') this.prop('hay_bale', bx, bz, rnd() * Math.PI);
      }
    }
    // a hilltop town: stone houses round the square, a tower
    const t = this.townAt((x0 + x1) / 2, (z0 + z1) / 2);
    if (t && t.x >= x0 && t.x < x1 && t.z >= z0 && t.z < z1) this.townHouses(b, t, rnd);
    // a farmhouse at the end of a drive lined with cypresses
    if (rnd() < TUSCANY.farm) {
      for (let k = 0; k < 6; k++) {
        const x = x0 + 30 + rnd() * (x1 - x0 - 60), z = z0 + 30 + rnd() * (z1 - z0 - 60);
        const cv = this.cover(x, z);
        if (this.slope(x, z) > 0.14 || cv === 'village' || Math.hypot(x, z) < 120) continue;
        this.farmhouse(b, x, z, rnd);
        break;
      }
    }
  }

  farmhouse(b, x, z, rnd) {
    this.building('it_farmhouse', x, z, Math.floor(rnd() * 4) * Math.PI / 2);
    b.farm = { x, z };
    // the drive: straight away from the house, white gravel, cypresses both sides
    const ang = rnd() * Math.PI * 2, len = range(rnd, [90, 180]);
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const sx = x + dx * 12, sz = z + dz * 12;
    b.ribbons.push({ x0: sx, z0: sz, x1: sx + dx * len, z1: sz + dz * len, w: 4, kind: 'gravel' });
    for (let s = 6; s < len; s += 9) {
      for (const side of [-1, 1]) {
        const tx = sx + dx * s - dz * side * 4.2, tz = sz + dz * s + dx * side * 4.2;
        if (this.cover(tx, tz) !== 'village') this.tree(b, tx, tz, rnd, 'cypress');
      }
    }
  }

  townHouses(b, t, rnd) {
    // the tower at the top
    this.building('it_tower', t.x, t.z, 0, 'tower');
    b.church = { x: t.x, z: t.z };
    // rings of houses round the square, their fronts to the square
    const taken = [];
    for (const [ring, n] of [[22, 8], [38, 13], [54, 18]]) {
      for (let k = 0; k < n; k++) {
        if (rnd() < 0.12) continue;
        const a = (k / n) * Math.PI * 2 + rnd() * 0.2, r = ring + (rnd() - 0.5) * 5;
        const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
        const name = TOWN_HOUSES[Math.floor(rnd() * TOWN_HOUSES.length)];
        const yaw = faceTowards(-Math.cos(a), -Math.sin(a));
        const fp = footprintOf(name, x, z, yaw);
        if (taken.some((o) => overlaps(o, fp, 1.5)) || Math.hypot(x - t.x, z - t.z) < 9) continue;
        taken.push(this.building(name, x, z, yaw));
      }
    }
    // cypresses round the town
    for (let k = 0; k < 14; k++) {
      const a = rnd() * Math.PI * 2, r = t.r + 6 + rnd() * 20;
      this.tree(b, t.x + Math.cos(a) * r, t.z + Math.sin(a) * r, rnd, 'cypress');
    }
  }
}
