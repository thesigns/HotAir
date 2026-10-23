// Whole flights with a scripted pilot over many seeds: distances, landing ratings, crashes.
// Run: node tools/fly.mjs [flights] [height]
import { Flight } from '../js/core/flight.js';
import { Wind } from '../js/core/wind.js';
import { Polder, coastFor } from '../js/world/polder.js';
import { PROPANE, SIM } from '../js/config.js';

const dt = 1 / SIM.hz;
const N = Number(process.argv[2] ?? 40);
const H = Number(process.argv[3] ?? 150);

// A pilot that flies a vertical speed by reading the envelope temperature (with some hysteresis).
function pilot(b, vWant, st) {
  const want = b.equilibrium(b.y) + Math.max(-6, Math.min(6, 4 * (vWant - b.vy)));
  if (!st.burning && b.T < want - 2) st.burning = true;
  if (st.burning && b.T > want + 2) st.burning = false;
  return st.burning;
}

const tally = {};
let sumDist = 0, sumScore = 0, sumTime = 0;
for (let seed = 1; seed <= N; seed++) {
  const wind = new Wind(seed), w = wind.at(150, 0, {});
  const polder = new Polder(seed, { coast: coastFor(seed, w.dir + Math.PI) });
  const flight = new Flight(polder, wind, PROPANE.cylinder * PROPANE.presets.standard.cylinders);
  const b = flight.balloon;
  const st = { burning: false };
  let landing = false;
  while (!flight.over && flight.t < 1200) {
    const agl = flight.agl;
    if (flight.reserve || b.propane <= 0) landing = true;
    let v;
    if (!landing) v = Math.max(-1.5, Math.min(2.5, (H - agl) * 0.04));
    else if (agl > 40) v = -1.5;
    else if (agl > 8) v = -0.8;
    else v = -0.3;
    const onGround = flight.phase === 'ground';
    flight.update(dt, !onGround && pilot(b, v, st), onGround);
  }
  const r = flight.result ?? { rating: 'TIMEOUT', distance: flight.distance, score: 0, how: '' };
  const key = r.rating === 'CRASH' ? `CRASH (${r.how})` : r.rating;
  tally[key] = (tally[key] ?? 0) + 1;
  sumDist += r.distance;
  sumScore += r.score;
  sumTime += flight.t;
}
console.log(`${N} flights at ~${H} m: average ${Math.round(sumDist / N)} m, score ${Math.round(sumScore / N)}, ${(sumTime / N / 60).toFixed(1)} min`);
console.log(tally);
