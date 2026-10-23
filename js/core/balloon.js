import { ATMOS, BALLOON, GROUND, PROPANE } from '../config.js';
import { clamp, damp } from './utils.js';

// The air at a height above sea level (GDD §5): it cools and thins with height.
export const airTemp = (h) => ATMOS.T0 - ATMOS.lapse * h;
export const pressure = (h) => Math.exp(-h / ATMOS.scaleHeight);
const density = (h, T) => ATMOS.rho0 * pressure(h) * ATMOS.T0 / T;

// The flight model (GDD §5): the burner heats the envelope, the envelope cools towards the air, the vent
// spills hot air out. Buoyancy against weight and drag moves a heavy, slow body up and down; horizontally the
// balloon is carried by the wind at its height. No Three.js – testable in Node (tools/feel.mjs).
// y is the basket floor (altitude above sea level).
export class Balloon {
  constructor(cfg = BALLOON) {
    this.cfg = cfg;
    this.reset(0, 0, 0, PROPANE.cylinder * 2);
  }

  reset(x, y, z, propane) {
    this.x = x; this.y = y; this.z = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.propane = propane;     // seconds of burning left
    this.full = propane;
    this.deflate = 0;           // 0 = inflated … 1 = flat on the ground
    this.burning = false;
    this.vapour = false;        // BURN held with the propane gone
    this.venting = false;
    this.onGround = true;
    this.impact = null;         // sink rate of the last touchdown, until the flight logic takes it [m/s]
    this.T = this.equilibrium(y) - this.cfg.startBelow;
    this.net = 0;               // net upward force [N] (debug)
  }

  get mass() { return this.cfg.dryMass + this.cfg.propaneMass * this.propane / PROPANE.cylinder; }
  get volume() { return this.cfg.volume * (1 - this.deflate); }

  // The envelope temperature at which the balloon floats at height h.
  equilibrium(h) {
    const Ta = airTemp(h);
    return 1 / (1 / Ta - this.mass / (this.cfg.volume * ATMOS.rho0 * pressure(h) * ATMOS.T0));
  }

  // One fixed step. wx, wz: the wind at the balloon's height [m/s]; ground: the ground height under the basket;
  // tethered: still tied to the car at the launch; groundRate: how fast the ground under the basket rises [m/s].
  step(dt, burn, vent, wx, wz, ground, tethered = false, groundRate = 0) {
    const c = this.cfg, g = ATMOS.g;
    const Ta = airTemp(this.y);
    this.burning = burn && this.propane > 0 && this.deflate === 0;
    this.vapour = burn && !this.burning && this.deflate === 0;
    this.venting = vent && this.deflate === 0;

    // heat
    let dT = -c.cool * (this.T - Ta);
    if (this.venting) dT -= c.vent * (this.T - Ta);
    if (this.burning || this.vapour) {
      dT += c.burner * (this.burning ? 1 : c.vapour) * clamp((c.tMax - this.T) / c.tMaxSoft, 0, 1);
      if (this.burning) this.propane = Math.max(0, this.propane - dt);
    }
    this.T = Math.max(Ta, this.T + dT * dt);

    // buoyancy, weight and drag; the envelope's air and the air around it move with the balloon
    const V = this.volume;
    const rhoA = density(this.y, Ta), rhoI = density(this.y, this.T);
    const M = this.mass;
    const F = g * (V * (rhoA - rhoI) - M) - Math.sign(this.vy) * c.dragK * this.vy * this.vy;
    this.net = F;
    const mEff = M + V * rhoI + c.addedMass * V * rhoA;
    this.vy += (F / mEff) * dt;
    this.y += this.vy * dt;

    if (this.y <= ground) {
      this.y = ground;
      // the closing speed: sinking, or carried against rising ground
      if (!this.onGround) this.impact = Math.max(0, Math.max(0, groundRate) - this.vy);
      if (this.vy < 0) this.vy = 0;
      this.onGround = true;
    } else if (this.y > ground + 0.05) {
      this.onGround = false;
    }

    // horizontal: with the wind in the air; dragged along by the envelope on the ground
    if (this.onGround) {
      const k = tethered ? 0 : GROUND.drag * (1 - this.deflate);
      this.vx = damp(this.vx, wx * k, GROUND.dragRate, dt);
      this.vz = damp(this.vz, wz * k, GROUND.dragRate, dt);
    } else {
      this.vx = damp(this.vx, wx, c.follow, dt);
      this.vz = damp(this.vz, wz, c.follow, dt);
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
  }
}
