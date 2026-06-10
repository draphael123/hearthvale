// Persistent meta-progression: best score, lifetime tiles, and the biome
// unlock tree. Stored in localStorage so it survives between runs.

const SAVE_KEY = 'hearthvale.save.v1';

// Unlock thresholds (best single-run score required). Reaching a tier folds
// that terrain into the draw palette for future runs.
export const UNLOCKS = [
  { terrain: 'mountain', score: 800,   name: 'Mountain' },
  { terrain: 'fae',      score: 2000,  name: 'Fae Ring' },
  { terrain: 'coast',    score: 3200,  name: 'Coast' },
  { terrain: 'moor',     score: 4600,  name: 'Moor' },
  { terrain: 'marsh',    score: 6200,  name: 'Marsh' },
  { terrain: 'orchard',  score: 8000,  name: 'Orchard' },
  { terrain: 'ruins',    score: 10000, name: 'Ruins' },
];

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return { best: 0, lifetimeTiles: 0, runs: 0 };
}

// Record a finished run. `opts` = { daily, ymd } (ymd = YYYYMMDD number).
export function saveRun(save, score, tiles, opts = {}) {
  save.best = Math.max(save.best || 0, score);
  save.lifetimeTiles = (save.lifetimeTiles || 0) + tiles;
  save.runs = (save.runs || 0) + 1;
  // recent history (most-recent first, capped)
  save.history = save.history || [];
  save.history.unshift({ score, tiles, daily: !!opts.daily, ymd: opts.ymd || 0 });
  save.history = save.history.slice(0, 30);
  // per-day best for daily runs
  if (opts.daily && opts.ymd) {
    save.dailyBest = save.dailyBest || {};
    save.dailyBest[opts.ymd] = Math.max(save.dailyBest[opts.ymd] || 0, score);
  }
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
  return save;
}

// Write the save object to localStorage (used for mid-run unlocks).
export function persist(save) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
}

export function todayYmd() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

// Best score recorded for today's daily board (0 if none yet).
export function dailyBestToday(save) {
  return (save.dailyBest && save.dailyBest[todayYmd()]) || 0;
}

// The most recent runs, newest first.
export function recentRuns(save, n = 5) {
  return (save.history || []).slice(0, n);
}

// Which terrains are available for a run, given the player's best score.
export function paletteFor(save) {
  const base = ['forest', 'field', 'water', 'village'];
  const extra = UNLOCKS.filter(u => (save.best || 0) >= u.score).map(u => u.terrain);
  return base.concat(extra);
}

// Themed valleys — fixed palettes for a different feel, ignoring unlocks.
export const THEMES = [
  { id: 'isles',     name: 'Isles',     desc: 'sea, shore & marsh',     accent: '#2f8fb0', palette: ['water', 'coast', 'marsh', 'village', 'field', 'forest'] },
  { id: 'wildwood',  name: 'Wildwood',  desc: 'deep enchanted woods',   accent: '#6f3aa0', palette: ['forest', 'fae', 'orchard', 'field', 'water', 'ruins'] },
  { id: 'highlands', name: 'Highlands', desc: 'crags, moor & heather',  accent: '#8a8f99', palette: ['mountain', 'moor', 'forest', 'field', 'water', 'village'] },
];

// The next locked tier (for the HUD "next unlock" nudge), or null if maxed.
export function nextUnlock(save) {
  for (const u of UNLOCKS) {
    if ((save.best || 0) < u.score) return u;
  }
  return null;
}
