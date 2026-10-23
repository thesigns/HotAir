import { COUNTRIES, WIND } from '../config.js';
import { Wind } from '../core/wind.js';
import { Polder, coastFor } from './polder.js';
import { Tuscany } from './tuscany.js';
import { Alps } from './alps.js';

// A new world for a country and a seed: its winds and its terrain (no Three.js – the tools use it in Node).
export function makeWorld(country, seed) {
  const cfg = COUNTRIES[country] ?? COUNTRIES.netherlands;
  const wind = new Wind(seed, { ...WIND, ...cfg.wind });
  let terrain;
  if (cfg.terrain === 'polder') {
    const w = wind.at(150, 0, {});
    terrain = new Polder(seed, { coast: coastFor(seed, w.dir + Math.PI) });
  } else {
    terrain = cfg.terrain === 'alps' ? new Alps(seed) : new Tuscany(seed);
  }
  return { cfg, wind, terrain };
}
