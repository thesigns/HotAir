// Measures the flight model against the GDD §5.1 target-feel table with scripted pilots.
// Run: node tools/feel.mjs
import { Balloon } from '../js/core/balloon.js';
import { PROPANE, SIM } from '../js/config.js';

const dt = 1 / SIM.hz;
const f1 = (v) => v.toFixed(1);

// A balloon floating level at height h.
function level(h) {
  const b = new Balloon();
  b.reset(0, h, 0, PROPANE.cylinder * 2);
  b.T = b.equilibrium(h);
  b.onGround = false;
  return b;
}

function run(b, seconds, pilot) {
  for (let t = 0; t < seconds; t += dt) {
    const [burn, vent] = pilot(t, b);
    b.step(dt, burn, vent, 0, 0, -1000);
  }
}

// lag: the climb starts when the balloon rises at 0.15 m/s
{
  const b = level(150);
  let start = null;
  run(b, 12, (t) => {
    if (start === null && b.vy > 0.15) start = t;
    return [true, false];
  });
  console.log(`Burner lag (climb > 0.15 m/s)   ${f1(start)} s          target ~3 s`);
}

// a 10 s burn from level flight
{
  const b = level(150);
  let at10 = 0, max = 0, tMax = 0, y0 = b.y;
  run(b, 90, (t) => {
    if (Math.abs(t - 10) < dt / 2) at10 = b.vy;
    if (b.vy > max) { max = b.vy; tMax = t; }
    return [t < 10, false];
  });
  console.log(`10 s burn: climb at 10 s        ${f1(at10)} m/s, max ${f1(max)} at ${f1(tMax)} s, +${Math.round(b.y - y0)} m after 90 s   target ~2 m/s, levels off`);
}

// burning continuously
{
  const b = level(100);
  let max = 0;
  run(b, 60, () => { max = Math.max(max, b.vy); return [true, false]; });
  console.log(`Continuous burn                 max ${f1(max)} m/s, at ${Math.round(b.y)} m after 60 s   target up to ~4 m/s`);
}

// no burning from level flight
{
  const b = level(250);
  let at20 = 0;
  run(b, 20, () => [false, false]);
  at20 = b.vy;
  console.log(`No burn: sink after 20 s        ${f1(-at20)} m/s          target ~1 m/s`);
}

// vent held 3 s
{
  const b = level(250);
  let min = 0;
  run(b, 25, (t) => { min = Math.min(min, b.vy); return [false, t < 3]; });
  console.log(`VENT held 3 s: sink             max ${f1(-min)} m/s within 25 s   target ~3 m/s`);
}

// holding a height: a careful pilot who reads the envelope temperature, blasting with hysteresis like a human (a few kelvins)
function holdPilot(b, h, state) {
  const want = b.equilibrium(h) + Math.max(-4, Math.min(4, 0.12 * (h - b.y) - 2.5 * b.vy));
  if (!state.burning && b.T < want - 3.5) { state.burning = true; state.blasts++; }
  if (state.burning && b.T > want + 3.5) state.burning = false;
  return state.burning;
}
function hold(h, seconds) {
  const b = level(h);
  const st = { burning: false, blasts: 0 };
  let used = b.propane, lo = h, hi = h;
  run(b, seconds, (t) => {
    if (t > 30) { lo = Math.min(lo, b.y); hi = Math.max(hi, b.y); }
    return [holdPilot(b, h, st), false];
  });
  used -= b.propane;
  return { every: seconds / st.blasts, blast: used / st.blasts, perMin: used / seconds * 60, lo, hi };
}
for (const h of [30, 150, 300, 450]) {
  const r = hold(h, 300);
  console.log(`Hold ${String(h).padStart(3)} m: a ${f1(r.blast)} s blast every ${f1(r.every)} s, ${f1(r.perMin)} s of propane / min, band ${Math.round(r.lo)}–${Math.round(r.hi)} m   target 2–3 s every ~15 s`);
}

// flight length per preset: climb to 150 m and hold until the propane is gone
for (const [key, p] of Object.entries(PROPANE.presets)) {
  const b = new Balloon();
  b.reset(0, 0, 0, PROPANE.cylinder * p.cylinders);
  const st = { burning: false, blasts: 0 };
  let t = 0;
  while (b.propane > 0 && t < 3600) {
    b.step(dt, holdPilot(b, 150, st), false, 0, 0, 0);
    t += dt;
  }
  console.log(`Preset ${p.name.padEnd(8)} (${p.cylinders} cyl): ${f1(t / 60)} min of flight at 150 m   target ${{ short: '2–3', standard: '~5', long: '~8' }[key]} min`);
}

// the propane gone at 150 m: holding BURN (the last vapour) all the way down
{
  const b = level(150);
  b.propane = 0;
  b.onGround = false;
  for (let t = 0; t < 600 && b.impact === null; t += dt) b.step(dt, true, false, 0, 0, 0);
  console.log(`Empty, BURN held: touchdown at  ${f1(b.impact)} m/s          target 1–3 m/s (ROUGH, not a crash)`);
  const c = level(150);
  c.propane = 0;
  for (let t = 0; t < 600 && c.impact === null; t += dt) c.step(dt, false, false, 0, 0, 0);
  console.log(`Empty, nothing held: touchdown  ${f1(c.impact)} m/s          (a crash)`);
}
