// Achievements — checked after each placement and at run end. Unlocked set is
// stored on the save object (save.achievements) and persisted by the caller.

function maxTown(g) { let m = 0; for (const t of g.board.values()) m = Math.max(m, t.townSize || 0); return m; }

export const ACHIEVEMENTS = [
  { id: 'first_decree', name: 'By Decree', desc: 'Fulfil your first decree', check: (g) => g.decreesDone >= 1 },
  { id: 'estuary', name: 'River Meets Sea', desc: 'Form an estuary (coast + river)', check: (g) => (g.estuaryCount || 0) >= 1 },
  { id: 'combo', name: 'On a Roll', desc: 'Reach a 5-placement combo', check: (g) => g.bestCombo >= 5 },
  { id: 'town', name: 'Township', desc: 'Grow a town of 7+ tiles', check: (g) => maxTown(g) >= 7 },
  { id: 'festival', name: 'Festival Day', desc: 'Throw a town festival', check: (g) => (g.townMilestone || 0) >= 2 },
  { id: 'prosperous', name: 'Prosperity', desc: 'Make a town prosperous (food, water, wood)', check: (g) => Object.keys(g.prosperousTowns || {}).length >= 1 },
  { id: 'port', name: 'Harbourmaster', desc: 'Found a port town on the coast', check: (g) => Object.keys(g.portTowns || {}).length >= 1 },
  { id: 'perfect10', name: 'Flawless', desc: '10 perfect placements in a run', check: (g) => g.perfects >= 10 },
  { id: 'landmarks5', name: 'Wonders of the Vale', desc: 'Build 5 landmarks in a run', check: (g) => g.landmarksPlaced >= 5 },
  { id: 'decrees8', name: 'Lawgiver', desc: 'Fulfil 8 decrees in a run', check: (g) => g.decreesDone >= 8 },
  { id: 'bloom', name: 'In Full Bloom', desc: 'Fully close a region', check: (g) => g.regionsBloomed >= 1 },
  { id: 'score2k', name: 'Prosperous', desc: 'Score 2,000 in one vale', check: (g) => g.score >= 2000 },
  { id: 'fill', name: 'A Vale Complete', desc: 'Place every tile in a run', check: (g) => g.gameOver },
  { id: 'allbiomes', name: 'Realm Unbound', desc: 'Unlock every biome', check: (g, s) => (s.best || 0) >= 10000 },
  { id: 'cleanse', name: 'Light in the Dark', desc: 'Cleanse the blight', check: (g) => (g.cleansedTotal || 0) >= 1 },
  { id: 'purge', name: 'Heartbreaker', desc: 'Purge a Blightheart with a Wardtower', check: (g) => (g.heartsPurged || 0) >= 1 },
  { id: 'warden', name: 'Warden of the Vale', desc: 'Finish a run after the blight began', check: (g) => g.gameOver && g.blightStarted },
];

// Returns the achievements newly unlocked by this check (mutates save).
export function checkAchievements(g, save) {
  save.achievements = save.achievements || {};
  const newly = [];
  for (const a of ACHIEVEMENTS) {
    if (!save.achievements[a.id] && a.check(g, save)) { save.achievements[a.id] = 1; newly.push(a); }
  }
  return newly;
}

export function achievementCount(save) {
  return { unlocked: save.achievements ? Object.keys(save.achievements).length : 0, total: ACHIEVEMENTS.length };
}
