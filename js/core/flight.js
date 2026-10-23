import { BALLOON, GROUND, LADDER, LANDING, PIBAL, PROPANE, TREES } from '../config.js';
import { Balloon } from './balloon.js';
import { dampAngle } from './utils.js';

// One flight (GDD §6): the launch, the pibal, the flight with the wind, the landing and its rating.
// Pure logic, no Three.js. The terrain gives height(x, z), surfaceAt(x, z) and near(x, z, r).
// Phases: launch (tied to the car) → air ⇄ ground (a touchdown; lifting off again is a hop) → done | crashed.
// Events go to onEvent(type, data): liftoff, touchdown, hop, reserve, empty, done, crash.
const W = {};
const _near = { trees: [], houses: [] };

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
    const agl = b.y - ground;
    this.wind.at(Math.max(0, agl), this.t, W);

    // on the ground after a touchdown, the vent line deflates the balloon
    if (this.phase === 'ground' && vent) b.deflate = Math.min(1, b.deflate + dt / GROUND.deflate);
    b.step(dt, burn, vent, W.x, W.z, ground, this.phase === 'launch');
    this.learn(agl, W);
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
      if (b.y < roofAt(h, b.x, b.z)) { this.crash('house'); return; }
    }
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
        this.onEvent('touchdown', { sink: this.sink, rating: rate(this.sink, { forest: surface === 'forest', tipped }) });
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
    const rating = rate(td.sink, { forest: td.surface === 'forest', tipped: td.tipped });
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

  // The wind ladder (GDD §9) learns the wind at every height the balloon or the pibal passes.
  learn(agl, w) {
    if (this.phase === 'launch' || agl < 0 || agl > LADDER.top) return;
    this.ladder[Math.round(agl / LADDER.bin)] = { dir: w.dir, speed: w.speed, t: this.t };
  }

  updatePibal(dt) {
    const p = this.pibal;
    if (!p.alive) return;
    p.y += PIBAL.climb * dt;
    const agl = p.y - this.terrain.height(p.x, p.z);
    const w = this.wind.at(agl, this.t, {});
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

// The roof height over a point of a house (a gable roof, its ridge along ridgeAxis).
export function roofAt(h, x, z) {
  if (x < h.x0 || x > h.x1 || z < h.z0 || z > h.z1) return -Infinity;
  const across = h.ridgeAxis === 'z' ? Math.abs(x - (h.x0 + h.x1) / 2) / ((h.x1 - h.x0) / 2) : Math.abs(z - (h.z0 + h.z1) / 2) / ((h.z1 - h.z0) / 2);
  return h.wall + (h.ridge - h.wall) * (1 - across);
}

function slope(terrain, x, z) {
  const d = 2;
  return Math.hypot(terrain.height(x + d, z) - terrain.height(x - d, z), terrain.height(x, z + d) - terrain.height(x, z - d)) / (2 * d);
}
