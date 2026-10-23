import { WIND } from '../config.js';
import { DEG, mulberry32, range, smoothstep, wrapAngle } from './utils.js';

const TAU = Math.PI * 2;

// The wind field (GDD §6.2): direction and speed at a few heights above the ground, from the seed, smoothly
// interpolated between them. Winds veer (turn clockwise) with height, and every node wanders slowly during
// the flight, so the best height has to be found again. Directions are meteorological: where the wind comes
// from, clockwise from north (−Z); +X is east.
export class Wind {
  constructor(seed) {
    const rnd = mulberry32(seed ^ 0x5eed);
    // the Dutch prevailing winds come from the south-west and west
    let dir = rnd() < 0.65 ? range(rnd, [195, 295]) : rnd() * 360;
    this.nodes = WIND.heights.map((h, i) => {
      if (i > 0) dir += range(rnd, WIND.veer[i - 1]);
      return {
        h,
        dir: dir * DEG,
        kmh: range(rnd, WIND.speed[i]),
        dirAmp: WIND.driftDir * DEG * (0.4 + 0.6 * rnd()) * (rnd() < 0.5 ? -1 : 1),
        speedAmp: WIND.driftSpeed * (0.3 + 0.7 * rnd()),
        period: range(rnd, WIND.driftPeriod),
        phase: rnd() * TAU,
        phase2: rnd() * TAU,
      };
    });
  }

  // Direction (from, rad) and speed (m/s) of one node at time t.
  node(n, t) {
    const a = TAU * t / n.period;
    return [n.dir + n.dirAmp * Math.sin(a + n.phase), n.kmh / 3.6 * (1 + n.speedAmp * Math.sin(a * 0.83 + n.phase2))];
  }

  // The wind at a height above the ground at time t: out.x, out.z (the air's velocity, m/s), out.dir (from, rad),
  // out.speed (m/s).
  at(agl, t, out) {
    const ns = this.nodes;
    let i = 0;
    while (i < ns.length - 2 && agl > ns[i + 1].h) i++;
    const [d0, s0] = this.node(ns[i], t);
    const [d1, s1] = this.node(ns[i + 1], t);
    const f = smoothstep(Math.min(1, Math.max(0, (agl - ns[i].h) / (ns[i + 1].h - ns[i].h))));
    const dir = d0 + wrapAngle(d1 - d0) * f;
    const speed = s0 + (s1 - s0) * f;
    out.dir = dir;
    out.speed = speed;
    // blowing towards dir + 180°
    out.x = -Math.sin(dir) * speed;
    out.z = Math.cos(dir) * speed;
    return out;
  }
}
