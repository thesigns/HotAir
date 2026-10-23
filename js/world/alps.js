import { ALPS } from '../config.js';
import { clamp, hash, makeFbm, makeNoise, mulberry32, range, smoothstep } from '../core/utils.js';
import { Hills, faceTowards } from './hills.js';

// Switzerland (GDD §8.3): long valleys running east–west, each with a river, a road, meadows, chalets and
// villages on its narrow flat floor, and the odd lake; pine woods on the lower slopes, alpine meadows above,
// rock and snow on the ridges between the valleys, with lower passes here and there. The ground starts
// high, so the air is thinner (GDD §5). Low down the wind flows along the valley (channel()); above the
// ridges it blows its own way. Cable cars climb from the valley floors – their wires are a danger like
// power lines.

const COLORS = {
  meadow: ['#7fae4e', '#86b555', '#78a649'], alp: ['#9cbf5e', '#a6c768', '#93b856'], forest: ['#3e5f34', '#45663a'],
  rock: ['#8d8a84', '#7f7c77', '#99958e'], snow: ['#f2f4f6', '#e6ebf0'], water: ['#5e8fb0'], road: ['#7c7c76'],
  village: ['#8fae5e'],
};

export class Alps extends Hills {
  constructor(seed) {
    super(seed);
    this.ridgeNoise = makeNoise(hash(seed, 41));
    this.rough = makeFbm(hash(seed, 42), 3);
    this.woods = makeFbm(hash(seed, 43), 2);
    this.phases = new Map();
  }

  // Per valley: phases of its meanders and width, from the seed.
  valley(k) {
    let v = this.phases.get(k);
    if (!v) {
      const r = mulberry32(hash(this.seed, 51, k));
      v = { a: r() * 6.28, b: r() * 6.28, c: r() * 6.28, f: r() * 6.28 };
      this.phases.set(k, v);
    }
    return v;
  }

  centre(k, x) {
    const v = this.valley(k);
    return k * ALPS.spacing + ALPS.meander * Math.sin(x / 430 + v.a) + ALPS.meander * 0.4 * Math.sin(x / 170 + v.b);
  }

  // The valley's direction at x (a unit vector along it, eastwards).
  tangent(k, x) {
    const v = this.valley(k);
    const dz = (ALPS.meander / 430) * Math.cos(x / 430 + v.a) + (ALPS.meander * 0.4 / 170) * Math.cos(x / 170 + v.b);
    const l = Math.hypot(1, dz);
    return [1 / l, dz / l];
  }

  halfWidth(k, x) { return ALPS.floorWidth + 35 * Math.sin(x / 520 + this.valley(k).c); }
  floor(k, x) { return ALPS.floor + 12 * Math.sin(x / 900 + this.valley(k).f); }

  // The ridge between valley r and r + 1, above the floor: high peaks, lower passes.
  ridge(r, x) {
    const n = this.ridgeNoise(x / 650, r * 7.3);
    return ALPS.ridge[0] + (ALPS.ridge[1] - ALPS.ridge[0]) * smoothstep(n);
  }

  // A lake on this stretch of the valley floor: { x0, x1, level } or null.
  lake(k, x) {
    const S = ALPS.lakeEvery, s = Math.floor(x / S);
    const r = mulberry32(hash(this.seed, 61, k, s));
    if (r() > ALPS.lakeOdds || (k === 0 && Math.abs(s) <= 1)) return null;
    const x0 = s * S + range(r, [200, 500]), x1 = x0 + range(r, [500, 900]);
    return x >= x0 - 300 && x <= x1 + 300 ? { x0, x1, level: this.floor(k, (x0 + x1) / 2) - 1.5 } : null;
  }

  // Where (x, z) is: the nearest valley k, the distance d from its centre line (signed), the floor half-width.
  where(x, z) {
    const k0 = Math.round(z / ALPS.spacing);
    let best = null;
    for (let k = k0 - 1; k <= k0 + 1; k++) {
      const d = z - this.centre(k, x);
      if (!best || Math.abs(d) < Math.abs(best.d)) best = { k, d };
    }
    best.w = this.halfWidth(best.k, x);
    return best;
  }

  height(x, z) {
    const { k, d, w } = this.where(x, z);
    const ad = Math.abs(d);
    let f = this.floor(k, x);
    const lk = this.lake(k, x);
    if (lk && x > lk.x0 && x < lk.x1 && ad < w) f = lk.level - 2;
    if (ad <= w) return f;
    // up the wall to the ridge on that side
    const u = clamp((ad - w) / (ALPS.spacing / 2 - w), 0, 1);
    const R = this.ridge(d > 0 ? k : k - 1, x);
    const rock = (this.rough(x / 90, z / 90) - 0.5) * 40 * u;
    return f + R * smoothstep(u) ** 1.1 + rock;
  }

  // slope: when known (a drawn triangle's), instead of measuring it here
  cover(x, z, slope = null) {
    const { k, d, w } = this.where(x, z);
    const ad = Math.abs(d);
    const lk = this.lake(k, x);
    if (lk && x > lk.x0 && x < lk.x1 && ad < w) return 'water';
    if (ad < ALPS.river) return 'water';
    if (Math.abs(d - ALPS.road) < 3) return 'road';
    if (ad <= w) return 'meadow';
    const h = this.height(x, z), rel = h - this.floor(k, x), R = this.ridge(d > 0 ? k : k - 1, x);
    if (h > ALPS.snow + (this.rough(x / 60, z / 60) - 0.5) * 30) return 'snow';
    if (rel > R * 0.8 + (this.rough(x / 40, z / 40) - 0.5) * 60 || (slope ?? this.slope(x, z)) > 1.05) return 'rock';
    if (rel < R * 0.62 && this.woods(x / 180, z / 180) > 0.38) return 'forest';
    return 'alp';
  }

  surfaceAt(x, z) {
    const c = this.cover(x, z);
    return c === 'meadow' || c === 'alp' ? 'pasture' : c;
  }

  color(x, z, slope = null) {
    const list = COLORS[this.cover(x, z, slope)];
    return list[(hash(Math.floor(x / 23), Math.floor(z / 23)) >>> 7) % list.length];
  }

  get launch() {
    return { x: 0, z: this.centre(0, 0) - ALPS.launchSide };
  }

  // Low down, the wind follows the valley; over the ridges it blows its own way (GDD §8.3).
  channel(x, z, y, W) {
    const { k, d } = this.where(x, z);
    const R = this.ridge(d > 0 ? k : k - 1, x);
    const rel = (y - this.floor(k, x)) / (R * 0.85);
    const f = (1 - smoothstep(clamp(rel, 0, 1))) * 0.9;
    if (f <= 0.01) return W;
    const [tx, tz] = this.tangent(k, x);
    let along = W.x * tx + W.z * tz;
    if (Math.abs(along) < W.speed * 0.45) along = (along < 0 ? -1 : 1) * W.speed * 0.45;
    W.x += (tx * along - W.x) * f;
    W.z += (tz * along - W.z) * f;
    W.speed = Math.hypot(W.x, W.z);
    W.dir = Math.atan2(-W.x, W.z);
    return W;
  }

  fill(b, rnd) {
    const { x0, z0, x1, z1 } = b;
    // pine woods
    for (let x = x0 + 4.5; x < x1; x += 9) {
      for (let z = z0 + 4.5; z < z1; z += 9) {
        const jx = x + (rnd() - 0.5) * 5, jz = z + (rnd() - 0.5) * 5;
        if (this.cover(jx, jz) === 'forest' && rnd() < 0.85) this.tree(b, jx, jz, rnd, 'pine').low = true;
      }
    }
    // the valleys crossing this block: the river and the road, villages, cable cars
    const k0 = Math.floor((z0 - ALPS.spacing) / ALPS.spacing), k1 = Math.ceil((z1 + ALPS.spacing) / ALPS.spacing);
    for (let k = k0; k <= k1; k++) {
      const zc = this.centre(k, (x0 + x1) / 2);
      if (zc < z0 - 200 || zc > z1 + 200) continue;
      this.valleyThings(b, k, rnd);
    }
    // chalets and cows on the meadows
    for (let n = 0; n < 6; n++) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
      const c = this.cover(x, z);
      if ((c !== 'meadow' && c !== 'alp') || this.slope(x, z) > 0.28) continue;
      if (rnd() < 0.45) this.chalet(b, x, z, rnd);
      else this.herd(b, x, z, rnd);
    }
  }

  valleyThings(b, k, rnd) {
    const { x0, x1 } = b;
    // the river and the road in short straight pieces along the meanders (unless there is a lake)
    for (let x = x0; x < x1; x += 20) {
      const xa = x, xb = Math.min(x1, x + 20);
      const za = this.centre(k, xa), zb = this.centre(k, xb);
      const lk = this.lake(k, (xa + xb) / 2), inLake = lk && xa > lk.x0 && xb < lk.x1;
      if (!inLake) b.ribbons.push({ x0: xa, z0: za, x1: xb, z1: zb, w: ALPS.river * 2, kind: 'river' });
      b.ribbons.push({ x0: xa, z0: za + ALPS.road, x1: xb, z1: zb + ALPS.road, w: 6, kind: 'road' });
    }
    // a village on the floor every so often
    const S = ALPS.villageEvery, s = Math.floor(((x0 + x1) / 2) / S);
    const vr = mulberry32(hash(this.seed, 71, k, s));
    const vx = s * S + range(vr, [300, S - 300]);
    if (vx >= x0 && vx < x1 && !(k === 0 && Math.abs(vx) < 350)) this.village(b, k, vx, vr);
    // a cable car up one side
    const C = ALPS.cableEvery, cs = Math.floor(((x0 + x1) / 2) / C);
    const cr = mulberry32(hash(this.seed, 81, k, cs));
    const cx = cs * C + range(cr, [200, C - 200]);
    if (cx >= x0 && cx < x1) this.cableCar(b, k, cx, cr);
  }

  village(b, k, x, rnd) {
    const zc = this.centre(k, x), w = this.halfWidth(k, x);
    const side = rnd() < 0.5 ? -1 : 1, z = zc + side * (w * 0.55 + ALPS.river);
    this.building('ch_church', x, z, faceTowards(0, -side), 'tower');
    b.church = { x, z };
    for (let n = 0; n < 16; n++) {
      const hx = x + (rnd() - 0.5) * 220, hz = z + (rnd() - 0.5) * w * 1.1;
      const c = this.cover(hx, hz);
      if (c === 'water' || c === 'road' || Math.hypot(hx - x, hz - z) < 26) continue;
      this.chalet(b, hx, hz, rnd);
    }
  }

  // A chalet (or a hay barn), its front to the valley's middle.
  chalet(b, x, z, rnd) {
    const { k } = this.where(x, z);
    const yaw = faceTowards(0, this.centre(k, x) - z);
    this.building(rnd() < 0.7 ? 'ch_chalet' : 'ch_barn', x, z, yaw);
    b.farm = { x, z };
  }

  herd(b, x, z, rnd) {
    const n = 3 + Math.floor(rnd() * 6);
    for (let i = 0; i < n; i++) {
      const cx = x + (rnd() - 0.5) * 40, cz = z + (rnd() - 0.5) * 40;
      const c = this.cover(cx, cz);
      if (c === 'meadow' || c === 'alp') this.at(cx, cz).cows.push({ x: cx, z: cz, y: this.height(cx, cz), turn: rnd() < 0.5, coat: 2 - Math.floor(rnd() * 1.5) });
    }
  }

  // A cable car from the valley floor up the slope on one side.
  cableCar(b, k, x, rnd) {
    const zc = this.centre(k, x), w = this.halfWidth(k, x), side = rnd() < 0.5 ? -1 : 1;
    const zA = zc + side * (w - 10), zB = zc + side * (w + ALPS.cableLength);
    const gA = this.height(x, zA), gB = this.height(x, zB);
    let yA = gA + 14, yB = gB + 14;
    // keep the cable clear of the slope under it
    for (let u = 0.1; u < 1; u += 0.1) {
      const g = this.height(x, zA + (zB - zA) * u), y = yA + (yB - yA) * u - ALPS.cableSag * 4 * u * (1 - u);
      if (y < g + 10) { yA += g + 10 - y; yB += g + 10 - y; }
    }
    const c = { x0: x, z0: zA, x1: x, z1: zB, y0: yA, y1: yB, g0: gA, g1: gB, sag: ALPS.cableSag, spread: 3.5, owner: b };
    // the stations at both ends, open towards the cable
    this.building('ch_station', x, zA, faceTowards(0, zA - zB));
    this.building('ch_station', x, zB, faceTowards(0, zB - zA));
    // every block it crosses knows it (for the collisions); the owner draws it
    const seen = new Set();
    for (let u = 0; u <= 1; u += 0.05) {
      const blk = this.at(x, zA + (zB - zA) * u);
      if (!seen.has(blk)) { seen.add(blk); blk.cables.push(c); }
    }
  }
}
