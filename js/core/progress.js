// Records and settings (GDD §6.5, §13.5): the best score per country × propane preset, with the distance and
// the rating it came from, the last preset chosen and the settings, in localStorage. Storage can be unavailable
// (private mode, blocked site data): everything still works, nothing is kept.

const KEY = 'hotair.progress.v2';   // v2: bigger cylinders, the long flight has four – the old records don't compare
const OLD = 'hotair.progress.v1';

export const DEFAULT_SETTINGS = {
  sound: true,
  haptics: true,
  toggleBurn: false,    // tap to start and tap to stop the burner, instead of holding (GDD §4.3)
  leftHanded: false,    // BURN under the left thumb, VENT under the right
};

export function loadProgress() {
  let p = null;
  try {
    p = JSON.parse(localStorage.getItem(KEY));
    // from v1 keep the settings and the choices, not the records
    if (!p) {
      const old = JSON.parse(localStorage.getItem(OLD));
      if (old) p = { records: {}, settings: old.settings, preset: old.preset, country: old.country };
    }
  } catch { /* storage unavailable or corrupt */ }
  if (!p || typeof p.records !== 'object') p = { records: {} };
  p.settings = { ...DEFAULT_SETTINGS, ...p.settings };
  p.preset ??= 'standard';
  p.country ??= 'netherlands';
  return p;
}

export function saveProgress(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

export const recordKey = (country, preset) => `${country}.${preset}`;

// Record a finished flight; returns true for a new record.
export function recordFlight(p, key, { score, distance, rating }, seed) {
  const old = p.records[key];
  if (score <= 0 || (old && old.score >= score)) return false;
  p.records[key] = { score, distance: Math.round(distance), rating, seed };
  saveProgress(p);
  return true;
}
