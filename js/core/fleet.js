import { BALLOON, FLEET, PROPANE } from '../config.js';
import { Balloon } from './balloon.js';
import { clamp, mulberry32, range } from './utils.js';

// The other balloons (GDD §6.3). They follow the same winds with the same physics, flown by simple pilots
// who pick a height, hold it for a while, change it now and then, and finally land. Some launch from fields
// around the player's, others are already in the air. Like real pilots they keep clear of a balloon close
// above or below them: the upper one doesn't sink onto it, the lower one doesn't climb into it – so a
// collision is the player's own doing, crossing another balloon's height. No Three.js.
const W = {};
const AI_PROPANE = PROPANE.cylinder * 2;

// A balloon as an ellipsoid from the basket to the crown: two of them touch when this is below 1.
const RX = BALLOON.radius * 2, RY = (BALLOON.mouth + BALLOON.height) + 1;
const MID = (BALLOON.mouth + BALLOON.height) / 2;
export const gap = (dx, dy, dz) => Math.sqrt((dx * dx + dz * dz) / (RX * RX) + (dy * dy) / (RY * RY));

export class Fleet {
  constructor(terrain, wind, seed, x0, z0) {
    this.terrain = terrain;
    this.wind = wind;
    const rnd = this.rnd = mulberry32(seed ^ 0xba11);
    this.list = [];
    const n = FLEET.ground + FLEET.air;
    for (let i = 0; i < n; i++) {
      const onGround = i < FLEET.ground;
      const a = rnd() * Math.PI * 2;
      const r = onGround ? range(rnd, FLEET.groundRange) : range(rnd, FLEET.airRange);
      let x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
      // launch fields are dry land
      for (let k = 0; onGround && k < 12 && this.terrain.surfaceAt(x, z) === 'water'; k++) x += 3;
      const b = new Balloon();
      const agl = onGround ? 0 : range(rnd, FLEET.heights);
      b.reset(x, terrain.height(x, z) + agl, z, AI_PROPANE);
      b.T = b.equilibrium(b.y) - (onGround ? BALLOON.startBelow : 0);
      b.onGround = onGround;
      this.list.push({
        b,
        pattern: i,
        launchAt: onGround ? range(rnd, FLEET.launchAt) : 0,
        landAt: range(rnd, FLEET.flightTime),
        target: range(rnd, FLEET.heights),
        until: range(rnd, FLEET.hold),
        burning: false,
        phase: onGround ? 'waiting' : 'air',    // waiting | air | landing | landed
        rnd: mulberry32(seed + i * 7919),
      });
    }
  }

  // One step for every balloon; `player` (a Balloon) is who the courtesy rules keep clear of.
  // learn(agl, wind): what a balloon close to the player shows about the wind at its height.
  update(dt, t, player, learn) {
    for (const a of this.list) {
      const b = a.b;
      const ground = this.terrain.height(b.x, b.z);
      const agl = b.y - ground;
      this.wind.at(Math.max(0, agl), t, W);
      this.terrain.channel?.(b.x, b.z, b.y, W);
      let burn = false, vent = false;
      if (a.phase === 'waiting' && t >= a.launchAt) a.phase = 'air';
      if (a.phase === 'air' && t >= a.landAt) a.phase = 'landing';
      if (a.phase === 'air' || a.phase === 'landing') {
        if (a.phase === 'air' && t > a.until) {
          a.target = range(a.rnd, FLEET.heights);
          a.until = t + range(a.rnd, FLEET.hold);
        }
        let v = a.phase === 'landing'
          ? (agl > 40 ? -1.4 : agl > 8 ? -0.7 : -0.3)
          : clamp((a.target - agl) * 0.03, -1.3, 1.6);
        // courtesy: don't sink onto a balloon below, don't climb into one above
        const dx = player.x - b.x, dz = player.z - b.z, dy = player.y - b.y;
        if (dx * dx + dz * dz < FLEET.keepClear * FLEET.keepClear) {
          if (dy < 0 && dy > -60) v = Math.max(v, 0.6);
          if (dy > 0 && dy < 60) v = Math.min(v, -0.2);
        }
        const want = b.equilibrium(b.y) + clamp(4 * (v - b.vy), -6, 6);
        if (!a.burning && b.T < want - 2) a.burning = true;
        if (a.burning && b.T > want + 2) a.burning = false;
        burn = a.burning;
        if (a.phase === 'landing' && b.onGround && agl < 0.5) a.phase = 'landed';
      }
      if (a.phase === 'landed') {
        b.deflate = Math.min(1, b.deflate + dt / 5);
        vent = true;
      }
      b.propane = AI_PROPANE;   // the other pilots never run out
      b.step(dt, burn, vent, W.x, W.z, ground, a.phase === 'waiting');
      const dx = player.x - b.x, dz = player.z - b.z, d2 = dx * dx + dz * dz;
      if (learn && a.phase === 'air' && agl > 5 && d2 < FLEET.reveals * FLEET.reveals) learn(agl, W);
      if (a.phase !== 'waiting' && d2 > FLEET.recycle * FLEET.recycle) this.recycle(a, t, player);
    }
  }

  // A new balloon at another height, placed so that the wind brings it past the player in a while.
  recycle(a, t, p) {
    const rnd = this.rnd, b = a.b;
    const pAgl = p.y - this.terrain.height(p.x, p.z);
    // usually a little above or below the player – the layers next door are where the traffic matters
    let h = rnd() < FLEET.nearby ? pAgl + (rnd() < 0.5 ? 1 : -1) * range(rnd, FLEET.nearbyGap) : range(rnd, FLEET.heights);
    if (h < FLEET.heights[0]) h = pAgl + range(rnd, FLEET.nearbyGap);
    h = clamp(h, FLEET.heights[0], FLEET.heights[1]);
    this.wind.at(h, t, W);
    const T = range(rnd, FLEET.cross);
    const side = (rnd() - 0.5) * 2 * FLEET.crossOffset;
    let rx = W.x - p.vx, rz = W.z - p.vz;
    const rel = Math.hypot(rx, rz);
    if (rel < 0.3) { rx = 1; rz = 0; } else { rx /= rel; rz /= rel; }
    const dist = Math.min(FLEET.recycle * 0.95, Math.max(FLEET.spawn, rel * T));
    const x = p.x - rx * dist - rz * side, z = p.z - rz * dist + rx * side;
    b.reset(x, this.terrain.height(x, z) + h, z, AI_PROPANE);
    b.T = b.equilibrium(b.y);
    b.onGround = false;
    b.vx = W.x; b.vz = W.z;
    a.phase = 'air';
    a.target = h;
    a.until = t + range(rnd, FLEET.hold);
    a.landAt = t + range(rnd, FLEET.flightTime);
    a.burning = false;
  }

  // The first balloon the player touches, or null.
  hit(p) {
    for (const a of this.list) {
      const b = a.b;
      if (a.phase === 'landed' && b.deflate > 0.5) continue;
      if (gap(b.x - p.x, b.y - p.y, b.z - p.z) < FLEET.touch) return a;
    }
    return null;
  }

  // The most urgent balloon on a collision course within FLEET.warn seconds, from the relative motion now:
  // { a, time, where: 'above' | 'below' | 'level' } or null.
  threat(p) {
    let best = null;
    for (const a of this.list) {
      const b = a.b;
      if (a.phase === 'waiting' || a.phase === 'landed') continue;
      const rx = b.x - p.x, ry = b.y - p.y, rz = b.z - p.z;
      const vx = b.vx - p.vx, vy = b.vy - p.vy, vz = b.vz - p.vz;
      // in the ellipsoid metric: the time of contact, or of the closest approach for a near miss
      const sx = 1 / (RX * RX), sy = 1 / (RY * RY);
      const vv = (vx * vx + vz * vz) * sx + vy * vy * sy;
      const rv = (rx * vx + rz * vz) * sx + ry * vy * sy;
      const rr = (rx * rx + rz * rz) * sx + ry * ry * sy;
      const closest = vv > 1e-9 ? clamp(-rv / vv, 0, FLEET.warn) : 0;
      const d = gap(rx + vx * closest, ry + vy * closest, rz + vz * closest);
      const disc = rv * rv - vv * (rr - 1);
      const contact = vv > 1e-9 && disc >= 0 ? (-rv - Math.sqrt(disc)) / vv : Infinity;
      const time = contact >= 0 && contact <= closest ? contact : closest;
      if (d < FLEET.warnGap && (!best || time < best.time)) {
        best = { a, time, where: ry > MID ? 'above' : ry < -MID ? 'below' : 'level' };
      }
    }
    return best;
  }
}
