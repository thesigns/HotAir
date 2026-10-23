import { HILLS } from '../config.js';
import { hash, mulberry32, range } from '../core/utils.js';
import { footprint, place } from '../models/place.js';

// The base of the hilly countries (Tuscany, the Alps): a height field and land cover from noise, with the
// things on it – trees, houses, cows, roads and rivers, cable-car wires – kept in square blocks that are
// made on demand from the seed. Pure data, no Three.js; js/world/hillsView.js draws it. A country subclass
// gives height(x, z), cover(x, z) (what grows or stands there) and color(x, z), and fills its blocks.
// The interface is the polder's: height, surfaceAt, near, wires, sounds, launch, coast (none).

// Land covers where a landing is rough at best (GDD §6.4, §8.2).
export const ROUGH_COVER = new Set(['forest', 'vines', 'olives', 'rock']);

export class Hills {
  constructor(seed) {
    this.seed = seed;
    this.coast = null;
    this.blocks = new Map();
  }

  coastS() { return -Infinity; }
  landRange(axis, from, to) { return [from, to]; }

  get B() { return HILLS.block; }

  // A block as it is so far (maybe not filled yet).
  raw(i, j) {
    const key = `${i},${j}`;
    let b = this.blocks.get(key);
    if (!b) {
      const B = this.B;
      b = {
        i, j, x0: i * B, x1: (i + 1) * B, z0: j * B, z1: (j + 1) * B, filled: false,
        trees: [], houses: [], props: [], cows: [], ribbons: [], rows: [], cables: [], church: null, farm: null,
      };
      this.blocks.set(key, b);
    }
    return b;
  }

  // The block that holds whatever stands at (x, z).
  at(x, z) { return this.raw(Math.floor(x / this.B), Math.floor(z / this.B)); }

  // A complete block. A block's things may stand in its neighbours (a cypress drive, a town), so each thing
  // is kept by the block it stands in, and a block is complete once it and its neighbours have been filled.
  block(i, j) {
    for (let a = i - 1; a <= i + 1; a++) {
      for (let c = j - 1; c <= j + 1; c++) this.ensure(a, c);
    }
    return this.raw(i, j);
  }

  // Fill one block if it isn't yet; true if that was work (the view spreads it over frames).
  ensure(i, j) {
    const b = this.raw(i, j);
    if (b.filled) return false;
    b.filled = true;
    this.fill(b, mulberry32(hash(this.seed, i, j, 3)));
    return true;
  }

  // the country fills a block with its things
  fill() {}

  surfaceAt(x, z) { return this.cover(x, z); }

  slope(x, z) {
    const d = 3;
    return Math.hypot(this.height(x + d, z) - this.height(x - d, z), this.height(x, z + d) - this.height(x, z - d)) / (2 * d);
  }

  tree(b, x, z, rnd, kind) {
    const y = this.height(x, z);
    const t = { x, z, y, kind, shade: rnd() };
    if (kind === 'cypress') { t.r = range(rnd, [1.1, 1.6]); t.top = range(rnd, [12, 17]); t.base = 1.2; }
    else if (kind === 'olive') { t.r = range(rnd, [1.6, 2.3]); t.top = range(rnd, [4.5, 6.5]); t.base = 1.3; }
    else if (kind === 'pine') { t.r = range(rnd, [2, 3]); t.top = range(rnd, [12, 20]); t.base = 2.5; }
    else { t.r = range(rnd, [2.6, 4]); t.top = range(rnd, [8, 12]); t.base = 2.2; }
    t.top += y;
    t.base += y;
    this.at(x, z).trees.push(t);
    return t;
  }

  // A building (a Blender model) standing on the ground at (x, z), its front turned by yaw: its base at the
  // highest point under it (the model's plinth reaches down the slope), kept by the block it stands in.
  building(name, x, z, yaw, kind = undefined) {
    const r = footprint(name, x, z, yaw);
    let y = -Infinity;
    for (const [px, pz] of [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1], [x, z]]) y = Math.max(y, this.height(px, pz));
    place(this.at(x, z), name, x, z, yaw, y, kind);
    return r;
  }

  // An extra thing to draw, no collisions (a hay bale): kept by the block it lies in.
  prop(name, x, z, yaw) {
    this.at(x, z).props.push({ m: name, x, y: this.height(x, z), z, yaw });
  }

  // Trees and houses within r of (x, z).
  near(x, z, r, out = { trees: [], houses: [] }) {
    out.trees.length = 0;
    out.houses.length = 0;
    // a house or a crown may reach a little over its block's edge
    const B = this.B, m = r + 12;
    for (let i = Math.floor((x - m) / B); i <= Math.floor((x + m) / B); i++) {
      for (let j = Math.floor((z - m) / B); j <= Math.floor((z + m) / B); j++) {
        const b = this.block(i, j);
        for (const t of b.trees) if (Math.abs(t.x - x) < r + t.r && Math.abs(t.z - z) < r + t.r) out.trees.push(t);
        for (const h of b.houses) if (x > h.x0 - r && x < h.x1 + r && z > h.z0 - r && z < h.z1 + r) out.houses.push(h);
      }
    }
    return out;
  }

  // Cable-car and other wires near (x, z): { cross, h, spread } like the polder's power lines.
  wires(x, z, out = []) {
    out.length = 0;
    const B = this.B;
    for (let i = Math.floor((x - 60) / B); i <= Math.floor((x + 60) / B); i++) {
      for (let j = Math.floor((z - 60) / B); j <= Math.floor((z + 60) / B); j++) {
        for (const c of this.block(i, j).cables) {
          // the cable as a sagging line between its two ends, seen from above as a segment
          const dx = c.x1 - c.x0, dz = c.z1 - c.z0, len = Math.hypot(dx, dz);
          const u = ((x - c.x0) * dx + (z - c.z0) * dz) / (len * len);
          if (u < 0 || u > 1) continue;
          const cross = ((x - c.x0) * dz - (z - c.z0) * dx) / len;
          if (Math.abs(cross) > 40) continue;
          out.push({ cross, h: c.y0 + (c.y1 - c.y0) * u - c.sag * 4 * u * (1 - u), spread: c.spread });
        }
      }
    }
    return out;
  }

  // For the soundscape: the distance to the nearest cow, farm and church within r, or Infinity.
  sounds(x, z, r, out = {}) {
    out.cow = out.farm = out.church = Infinity;
    out.sea = Infinity;
    const B = this.B;
    for (let i = Math.floor((x - r) / B); i <= Math.floor((x + r) / B); i++) {
      for (let j = Math.floor((z - r) / B); j <= Math.floor((z + r) / B); j++) {
        const b = this.block(i, j);
        for (const c of b.cows) out.cow = Math.min(out.cow, Math.hypot(c.x - x, c.z - z));
        if (b.farm) out.farm = Math.min(out.farm, Math.hypot(b.farm.x - x, b.farm.z - z));
        if (b.church) out.church = Math.min(out.church, Math.hypot(b.church.x - x, b.church.z - z));
      }
    }
    return out;
  }
}

// The yaw that turns a model's front (+z) towards (dx, dz), to the nearest quarter turn.
export const faceTowards = (dx, dz) => (Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2) : (dz > 0 ? 0 : Math.PI));
