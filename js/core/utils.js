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
