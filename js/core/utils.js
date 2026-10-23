export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// Frame-rate independent smoothing.
export const damp = (current, target, rate, dt) => lerp(current, target, 1 - Math.exp(-rate * dt));
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const dampAngle = (current, target, rate, dt) => current + wrapAngle(target - current) * (1 - Math.exp(-rate * dt));
export const DEG = Math.PI / 180;

// Deterministic RNG (the world must always be the same for a given seed).
export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// An integer hash of a few integers: the seed for one block, one border line…
export function hash(...n) {
  let h = 0x9e3779b9;
  for (const v of n) {
    h = Math.imul(h ^ (v | 0), 0x85ebca6b);
    h = (h ^ (h >>> 13)) | 0;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

export const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];
export const range = (rnd, [a, b]) => a + (b - a) * rnd();

// Pick from [[item, weight], …].
export function weighted(rnd, list) {
  let total = 0;
  for (const [, w] of list) total += w;
  let r = rnd() * total;
  for (const [item, w] of list) {
    r -= w;
    if (r <= 0) return item;
  }
  return list[list.length - 1][0];
}

// 1 840 – thousands separated by a thin space.
export const formatMeters = (m) => String(Math.round(m)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// Smooth value noise in 2D from a seed: n(x, y) in 0…1, one feature per unit.
export function makeNoise(seed) {
  const at = (i, j) => hash(seed, i, j) / 4294967296;
  return (x, y) => {
    const i = Math.floor(x), j = Math.floor(y);
    const fx = smoothstep(x - i), fy = smoothstep(y - j);
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
  };
}

// Fractal noise: a few octaves of makeNoise, 0…1.
export function makeFbm(seed, octaves = 4) {
  const n = makeNoise(seed);
  return (x, y) => {
    let v = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      v += n(x * f + o * 17.3, y * f - o * 9.1) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return v / norm;
  };
}
