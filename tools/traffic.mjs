// The other balloons around scripted flights: how often they pass close, warnings, collisions.
// Run: node tools/traffic.mjs [flights]
import { Flight } from '../js/core/flight.js';
import { Fleet } from '../js/core/fleet.js';
import { makeWorld } from '../js/world/world.js';
import { PROPANE, SIM } from '../js/config.js';

const dt = 1 / SIM.hz;
const N = Number(process.argv[2] ?? 30);
let crashes = 0, warned = 0, close = 0;
for (let seed = 1; seed <= N; seed++) {
  const { terrain: p, wind: w } = makeWorld(process.argv[3] ?? 'netherlands', seed);
  const f = new Flight(p, w, PROPANE.cylinder * 2);
  f.fleet = new Fleet(p, w, seed, f.x0, f.z0);
  const b = f.balloon, st = { burning: false };
  let warnedHere = false, closeHere = 0, wasClose = new Set();
  while (!f.over && f.t < 420) {
    // a pilot who changes height every 40 s, blind to the other balloons
    const H = 50 + ((Math.floor(f.t / 40) * 137) % 320);
    const v = Math.max(-1.5, Math.min(2, (H - f.agl) * 0.04));
    const want = b.equilibrium(b.y) + Math.max(-6, Math.min(6, 4 * (v - b.vy)));
    if (!st.burning && b.T < want - 2) st.burning = true;
    if (st.burning && b.T > want + 2) st.burning = false;
    f.update(dt, st.burning && b.propane > 0, false);
    if (f.threat) warnedHere = true;
    for (const a of f.fleet.list) {
      const d = Math.hypot(a.b.x - b.x, a.b.z - b.z);
      if (d < 120 && !wasClose.has(a)) { wasClose.add(a); closeHere++; }
      if (d > 300) wasClose.delete(a);
    }
  }
  if (f.result?.how === 'balloon') crashes++;
  if (warnedHere) warned++;
  close += closeHere;
}
console.log(`${N} flights: ${(close / N).toFixed(1)} balloons pass within 120 m per flight, warnings in ${warned}, collisions in ${crashes}`);
