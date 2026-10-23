// Records (GDD §6.5, §13.5): the best score per country × propane preset, with the distance and the rating
// it came from, in localStorage. Storage can be unavailable (private mode, blocked site data): everything
// still works, nothing is kept.

const KEY = 'hotair.progress.v1';

export function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY));
    if (p && typeof p.records === 'object') return p;
  } catch { /* storage unavailable or corrupt */ }
  return { records: {} };
}

function save(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

export const recordKey = (country, preset) => `${country}.${preset}`;

// Record a finished flight; returns true for a new record.
export function recordFlight(p, key, { score, distance, rating }, seed) {
  const old = p.records[key];
  if (score <= 0 || (old && old.score >= score)) return false;
  p.records[key] = { score, distance: Math.round(distance), rating, seed };
  save(p);
  return true;
}
