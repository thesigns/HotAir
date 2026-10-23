import { BALLOON, GROUND, LADDER, LANDING, PIBAL, POWER, PROPANE, TREES } from '../config.js';
import { Balloon } from './balloon.js';
import { dampAngle } from './utils.js';

// One flight (GDD §6): the launch, the pibal, the flight with the wind, the landing and its rating.
// Pure logic, no Three.js. The terrain gives height(x, z), surfaceAt(x, z) and near(x, z, r).
// Phases: launch (tied to the car) → air ⇄ ground (a touchdown; lifting off again is a hop) → done | crashed.
// Events go to onEvent(type, data): liftoff, touchdown, hop, reserve, empty, done, crash.
const W = {};
const _near = { trees: [], houses: [] };
const _wires = [];
// where a landing is rough at best: in the trees, among vines, olive trees or rocks (GDD §6.4, §8)
const ROUGH_SURFACES = new Set(['forest', 'vines', 'olives', 'rock']);

// The balloon's radius at a height above the basket floor: the basket, the ropes, the envelope.
function radiusAt(h) {
  if (h < 0) return -1;
  if (h < BALLOON.basket + 0.1) return BALLOON.basket * 0.6;
  const e = h - BALLOON.mouth;
  if (e < 0) return 1.2;
  const pr = BALLOON.profile;
  for (let i = 1; i < pr.length; i++) {
    if (e <= pr[i][1]) return pr[i - 1][0] + (pr[i][0] - pr[i - 1][0]) * (e - pr[i - 1][1]) / (pr[i][1] - pr[i - 1][1]);
  }
  return -1;
}

// Does a balloon with its basket at (x, y, z) touch a power line's wires?
export function touchesWires(terrain, x, y, z) {
  for (const w of terrain.wires(x, z, _wires)) {
    const r = radiusAt(w.h - y);
    if (r < 0) continue;
    const sp = w.spread ?? POWER.spread;
    const d = Math.min(Math.abs(w.cross), Math.abs(w.cross - sp), Math.abs(w.cross + sp));
    if (d < r) return true;
  }
  return false;
}

export function rate(sink, { forest = false, tipped = false } = {}) {
  if (sink > LANDING.crash) return 'CRASH';
  if (forest || tipped || sink > LANDING.good) return 'ROUGH';
  return sink <= LANDING.exceptional ? 'EXCEPTIONAL' : 'GOOD';
}

export class Flight {
  constructor(terrain, wind, propane, onEvent = () => {}) {
    this.terrain = terrain;
    this.wind = wind;
    this.onEvent = onEvent;
    this.fleet = null;           // the other balloons (js/core/fleet.js), when there are any
    this.threat = null;          // one of them on a collision course
    this.learnFleet = (agl, w) => this.learnWind(agl, w);
    this.balloon = new Balloon();
    this.propane = propane;
    this.reset();
  }

  reset() {
    const { x, z } = this.terrain.launch;
    this.x0 = x;
    this.z0 = z;
    this.balloon.reset(x, this.terrain.height(x, z), z, this.propane);
    this.phase = 'launch';
    this.t = 0;
    this.groundTime = 0;
    this.sink = 0;               // the hardest touchdown since the balloon was last clearly airborne
    this.touchdown = null;       // { x, z, sink, surface, tipped }
    this.result = null;          // { rating, distance, score, reason }
    this.reserveSaid = false;
    this.emptySaid = false;
    this.inTrees = false;
    this.lastGround = null;
    this.powerAhead = null;      // seconds until the present track and sink rate lead into a power line
    this.wireCheck = 0;
    this.ladder = Array.from({ length: Math.ceil(LADDER.top / LADDER.bin) + 1 }, () => null);
    this.ref = null;             // the "away from the launch" direction for the wind ladder (heading, rad)
    // the pilot balloon, released a few meters off the basket
    this.pibal = { x: x + 6, y: 1, z: z + 4, alive: true, trail: [], next: 0 };
  }

  get agl() { return this.balloon.y - this.terrain.height(this.balloon.x, this.balloon.z); }
  get distance() {
    const p = this.touchdown ?? this.balloon;
    return Math.hypot(p.x - this.x0, p.z - this.z0);
  }
  get over() { return this.phase === 'done' || this.phase === 'crashed'; }
  get reserve() { return this.balloon.propane < this.balloon.full * PROPANE.reserve; }

  update(dt, burn, vent) {
    if (this.over) return;
    const b = this.balloon, terrain = this.terrain;
    this.t += dt;
    const ground = terrain.height(b.x, b.z);
    // the ground rising under a balloon carried against a hillside counts in a touchdown
    const groundRate = this.lastGround === null ? 0 : (ground - this.lastGround) / dt;
    this.lastGround = ground;
    const agl = b.y - ground;
    this.wind.at(Math.max(0, agl), this.t, W);
    terrain.channel?.(b.x, b.z, b.y, W);

    // on the ground after a touchdown, the vent line deflates the balloon
    if (this.phase === 'ground' && vent) b.deflate = Math.min(1, b.deflate + dt / GROUND.deflate);
    b.step(dt, burn, vent, W.x, W.z, ground, this.phase === 'launch', groundRate);
    this.learn(agl, W);
    if (this.fleet) {
      this.fleet.update(dt, this.t, b, this.learnFleet);
      this.threat = this.phase === 'air' ? this.fleet.threat(b) : null;
      if (this.phase !== 'launch' && this.fleet.hit(b)) { this.crash('balloon'); return; }
    }
    this.updatePibal(dt);
    this.updateRef(dt);

    // propane
    if (!this.reserveSaid && this.reserve) { this.reserveSaid = true; this.onEvent('reserve'); }
    if (!this.emptySaid && b.propane <= 0) { this.emptySaid = true; this.onEvent('empty'); }

    if (this.phase === 'launch') {
      if (!b.onGround && agl > 0.5) { this.phase = 'air'; this.onEvent('liftoff'); }
      return;
    }

    // houses: the basket against the walls and the roof
    terrain.near(b.x, b.z, BALLOON.basket, _near);
    for (const h of _near.houses) {
      if (b.y < roofAt(h, b.x, b.z)) { this.crash(h.kind === 'pylon' ? 'power' : h.kind === 'glass' ? 'glass' : 'house'); return; }
    }
    // power lines: the wires against the whole balloon; a warning when the track leads into them
    if (terrain.wires && this.phase === 'air') {
      if (touchesWires(terrain, b.x, b.y, b.z)) { this.crash('power'); return; }
      this.wireCheck -= dt;
      if (this.wireCheck <= 0) { this.wireCheck = 0.25; this.powerAhead = this.predictWires(); }
    } else this.powerAhead = null;
    // trees: scraping through a crown; sinking deep into it is a landing in the trees
    this.inTrees = false;
    for (const tr of _near.trees) {
      if (Math.hypot(tr.x - b.x, tr.z - b.z) > tr.r + BALLOON.basket * 0.4 || b.y > tr.top || b.y < tr.base) continue;
      if (b.vy < -LANDING.crash) { this.crash('trees'); return; }
      this.inTrees = true;
      const k = 1 - Math.exp(-TREES.scrape * dt);
      b.vx -= b.vx * k;
      b.vz -= b.vz * k;
      if (b.vy < 0) b.vy -= b.vy * (1 - Math.exp(-TREES.hold * dt));
      if (b.y < tr.top - TREES.stuck) {
        this.touchdown = { x: b.x, z: b.z, sink: Math.max(this.sink, -b.vy), surface: 'forest', tipped: false };
        this.finish('trees');
        return;
      }
    }

    if (b.impact !== null) {
      const sink = b.impact;
      b.impact = null;
      const surface = terrain.surfaceAt(b.x, b.z);
      if (surface === 'water') { this.crash('water'); return; }
      if (sink > LANDING.crash) { this.crash('hard', sink); return; }
      this.sink = Math.max(this.sink, sink);
      if (this.phase === 'air') {
        this.phase = 'ground';
        this.groundTime = 0;
        const tipped = slope(terrain, b.x, b.z) > GROUND.maxSlope;
        this.touchdown = { x: b.x, z: b.z, sink: this.sink, surface, tipped };
        this.onEvent('touchdown', { sink: this.sink, rating: rate(this.sink, { forest: ROUGH_SURFACES.has(surface), tipped }) });
      }
    }

    if (this.phase === 'air') {
      if (agl > GROUND.hop) this.sink = 0;
      return;
    }

    // on the ground: a hop if the balloon lifts off again, otherwise the drag until it stops
    if (!b.onGround && agl > GROUND.hop) {
      this.phase = 'air';
      this.touchdown = null;
      this.onEvent('hop');
      return;
    }
    this.groundTime += dt;
    if (b.onGround) {
      // dragged into a ditch or against a tree
      if (terrain.surfaceAt(b.x, b.z) === 'water') { this.crash('water'); return; }
      if (this.inTrees) { this.touchdown.surface = 'forest'; this.finish('hedge'); return; }
    }
    const speed = Math.hypot(b.vx, b.vz);
    // deflated and still – or the crew catches the basket after a while
    if ((b.deflate >= 1 && speed < GROUND.stopSpeed) || this.groundTime > GROUND.crew) this.finish();
  }

  finish(how = 'landed') {
    const td = this.touchdown;
    const rating = rate(td.sink, { forest: ROUGH_SURFACES.has(td.surface), tipped: td.tipped });
    const distance = Math.hypot(td.x - this.x0, td.z - this.z0);
    this.result = { rating, distance, score: Math.round(distance * LANDING.mult[rating]), how, sink: td.sink };
    this.phase = rating === 'CRASH' ? 'crashed' : 'done';
    this.onEvent('done', this.result);
  }

  crash(reason, sink = 0) {
    const b = this.balloon;
    this.touchdown = { x: b.x, z: b.z, sink, surface: reason, tipped: false };
    const distance = Math.hypot(b.x - this.x0, b.z - this.z0);
    this.result = { rating: 'CRASH', distance, score: 0, how: reason, sink };
    this.phase = 'crashed';
    b.vx = b.vy = b.vz = 0;
    this.onEvent('crash', this.result);
  }

  // Straight on with the present velocity: when would the balloon touch a power line? (GDD §7)
  predictWires() {
    const b = this.balloon;
    for (let t = 0.5; t <= POWER.warn; t += 0.5) {
      const x = b.x + b.vx * t, z = b.z + b.vz * t;
      const y = Math.max(this.terrain.height(x, z), b.y + b.vy * t);
      if (touchesWires(this.terrain, x, y, z)) return t;
    }
    return null;
  }

  // The wind ladder (GDD §9) learns the wind at every height the balloon or the pibal passes.
  learn(agl, w) {
    if (this.phase === 'launch') return;
    this.learnWind(agl, w);
  }

  learnWind(agl, w) {
    if (agl < 0 || agl > LADDER.top) return;
    this.ladder[Math.round(agl / LADDER.bin)] = { dir: w.dir, speed: w.speed, t: this.t };
  }

  updatePibal(dt) {
    const p = this.pibal;
    if (!p.alive) return;
    p.y += PIBAL.climb * dt;
    const agl = p.y - this.terrain.height(p.x, p.z);
    const w = this.wind.at(agl, this.t, {});
    this.terrain.channel?.(p.x, p.z, p.y, w);
    p.x += w.x * dt;
    p.z += w.z * dt;
    if (agl <= LADDER.top) {
      const i = Math.round(agl / LADDER.bin);
      if (!this.ladder[i] || this.ladder[i].t < this.t - 5) this.ladder[i] = { dir: w.dir, speed: w.speed, t: this.t };
    }
    if (this.t >= p.next) {
      p.trail.push({ x: p.x, y: p.y, z: p.z, t: this.t });
      p.next = this.t + PIBAL.sample;
    }
    if (agl > PIBAL.top) p.alive = false;
  }

  // "Away from the launch": the way the balloon has gone so far, or the pibal's drift before that.
  updateRef(dt) {
    const b = this.balloon, p = this.pibal;
    let dx = b.x - this.x0, dz = b.z - this.z0;
    if (dx * dx + dz * dz < 40 * 40) { dx = p.x - this.x0; dz = p.z - this.z0; }
    if (dx * dx + dz * dz < 1) return;
    const h = Math.atan2(dx, -dz);
    this.ref = this.ref === null ? h : dampAngle(this.ref, h, 0.5, dt);
  }
}

// The roof height over a point of a house (a gable roof, its ridge along ridgeAxis; standing on the ground at h.y).
export function roofAt(h, x, z) {
  if (x < h.x0 || x > h.x1 || z < h.z0 || z > h.z1) return -Infinity;
  const across = h.ridgeAxis === 'z' ? Math.abs(x - (h.x0 + h.x1) / 2) / ((h.x1 - h.x0) / 2) : Math.abs(z - (h.z0 + h.z1) / 2) / ((h.z1 - h.z0) / 2);
  return (h.y ?? 0) + h.wall + (h.ridge - h.wall) * (1 - across);
}

function slope(terrain, x, z) {
  const d = 2;
  return Math.hypot(terrain.height(x + d, z) - terrain.height(x - d, z), terrain.height(x, z + d) - terrain.height(x, z - d)) / (2 * d);
}
