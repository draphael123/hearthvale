// Pure game state + rules for Hearthvale. No rendering here.
import { key, neighbor, opposite, DIRS } from './hex.js';
import { rotate, makeTile, buildStack, startingTile, makeLandmarkTile, TERRAIN, LANDMARKS } from './tiles.js';

const REWARD_TILES = 3;        // tiles added to the stack when a quest completes
const QUEST_CHANCE = 0.35;     // chance a freshly placed tile spawns a quest
const START_SKIPS = 3;         // how many tiles you may defer per run
const MAX_COMBO_MULT = 4;      // streak multiplier cap

export function newGame(palette, stackSize = 50, startEdges = null) {
  const board = new Map();
  const start = startEdges ? { edges: startEdges.slice() } : startingTile();
  start.q = 0; start.r = 0;
  start.townSize = 1; start.townCenter = true;
  board.set(key(0, 0), start);

  const stack = buildStack(stackSize, palette);
  // Guarantee an early Wonder so the opening has a landmark moment.
  if (!stack.slice(0, 8).some(t => t.landmark)) {
    stack[3 + Math.floor(Math.random() * 4)] = makeLandmarkTile(palette);
  }
  const current = stack.shift() || null;
  // A starter decree gives the player an immediate goal from tile one.
  const quests = [];
  const sd = dominantTerrain(start);
  if (sd.count >= 2) quests.push({ q: 0, r: 0, terrain: sd.terrain, target: 3, done: false });

  return {
    palette,
    board,
    stack,
    current,
    held: null,          // hold-slot tile (Tetris-style stash)
    heldUsed: false,     // already swapped this turn?
    endless: false,      // Zen mode: stack refills, never game-over (set by main)
    journeyIdx: 0,       // Journey mode: index of the active objective
    weatherOn: true,     // weather fronts active (main syncs to the Weather setting)
    weather: { type: null, left: 0, until: 6 },
    torches: 2,          // controlled burns: deliberately ignite your own land
    rotation: 0,
    score: 0,
    placed: 0,
    quests,              // { q, r, terrain, target, done }
    gameOver: false,
    lastPlace: null,     // { q, r, matches, perfect, points, combo, mult, ... } for fx
    // combo / streak
    combo: 0,            // consecutive placements with >=1 match
    bestCombo: 0,
    // resources & run stats (also feed the end-of-run summary)
    skips: START_SKIPS,
    perfects: 0,
    decreesDone: 0,
    landmarksPlaced: 0,
    regionsBloomed: 0,   // decrees completed while the region was fully closed
    townMilestone: 0,    // highest town tier reached (for festival triggers)
    festivals: [],       // queued firework celebrations
    firstDecreeDone: false,
    firstLandmarkDone: false,
    prosperousTowns: {}, // region-keys of towns that reached full prosperity
    portTowns: {},       // region-keys of towns that reached the coast
    corrupted: {},       // keys of blighted tiles
    blightStarted: false,
    blighthearts: [],    // keys of active Blightheart source tiles
    lastHeartAt: 0,      // placement count when the last heart rose
    cleansedTotal: 0,
    heartsPurged: 0,
    mode: 'warden',      // 'calm' (no blight) | 'warden' (full system); set by main
  };
}

// Multiplier for the current streak (1× at combo 0-1, then climbing, capped).
export function comboMult(g) {
  return Math.min(MAX_COMBO_MULT, 1 + Math.max(0, g.combo - 1) * 0.5);
}

// Defer the current tile to the bottom of the stack (costs a skip).
export function skipTile(g) {
  if (g.gameOver || !g.current || g.skips <= 0 || g.stack.length === 0) return false;
  g.skips--;
  g.stack.push(g.current);
  g.current = g.stack.shift();
  g.rotation = 0;
  return true;
}

// Upcoming tiles for the queue preview (does not include the current tile).
export function upcoming(g, n = 3) {
  return g.stack.slice(0, n);
}

// Stash the current tile in the hold slot (or swap with what's held). Once per
// turn — a light strategic choice available from the very first placement.
export function hold(g) {
  if (g.gameOver || !g.current || g.heldUsed) return false;
  if (g.held) {
    const tmp = g.held; g.held = g.current; g.current = tmp;
  } else {
    if (g.stack.length === 0) return false;   // nothing to draw in its place
    g.held = g.current; g.current = g.stack.shift();
  }
  g.rotation = 0; g.heldUsed = true;
  return true;
}

export function currentEdges(g) {
  return g.current ? rotate(g.current.edges, g.rotation) : null;
}

// ---- save / resume (JSON-friendly snapshot of a run) ----
export function serialize(g) {
  return {
    palette: g.palette, score: g.score, placed: g.placed, rotation: g.rotation,
    combo: g.combo, bestCombo: g.bestCombo, skips: g.skips, perfects: g.perfects,
    decreesDone: g.decreesDone, landmarksPlaced: g.landmarksPlaced, regionsBloomed: g.regionsBloomed,
    townMilestone: g.townMilestone, firstDecreeDone: g.firstDecreeDone, firstLandmarkDone: g.firstLandmarkDone,
    estuaryCount: g.estuaryCount || 0, gameOver: g.gameOver,
    prosperousTowns: g.prosperousTowns || {}, portTowns: g.portTowns || {},
    corrupted: g.corrupted || {}, blightStarted: !!g.blightStarted, corruptionOn: g.corruptionOn,
    blighthearts: g.blighthearts || [], lastHeartAt: g.lastHeartAt || 0,
    cleansedTotal: g.cleansedTotal || 0, heartsPurged: g.heartsPurged || 0, mode: g.mode,
    held: g.held || null, heldUsed: !!g.heldUsed, endless: !!g.endless, journeyIdx: g.journeyIdx || 0,
    weatherOn: g.weatherOn !== false, weather: g.weather || null, stats: g.stats || {}, torches: g.torches || 0, gentleStart: !!g.gentleStart,
    visitor: g.visitor || null, visitorCooldown: g.visitorCooldown || 0, lastVisitorId: g.lastVisitorId || null,
    current: g.current, stack: g.stack, quests: g.quests,
    board: [...g.board.values()],
  };
}

export function deserialize(d) {
  const board = new Map();
  for (const t of d.board) board.set(key(t.q, t.r), t);
  return {
    palette: d.palette, board, stack: d.stack || [], current: d.current || null, rotation: d.rotation || 0,
    score: d.score || 0, placed: d.placed || 0, quests: d.quests || [], gameOver: !!d.gameOver, lastPlace: null,
    combo: d.combo || 0, bestCombo: d.bestCombo || 0, skips: d.skips ?? START_SKIPS, perfects: d.perfects || 0,
    decreesDone: d.decreesDone || 0, landmarksPlaced: d.landmarksPlaced || 0, regionsBloomed: d.regionsBloomed || 0,
    townMilestone: d.townMilestone || 0, festivals: [], blooms: [],
    firstDecreeDone: !!d.firstDecreeDone, firstLandmarkDone: !!d.firstLandmarkDone, estuaryCount: d.estuaryCount || 0,
    prosperousTowns: d.prosperousTowns || {}, portTowns: d.portTowns || {},
    corrupted: d.corrupted || {}, blightStarted: !!d.blightStarted, corruptionOn: d.corruptionOn,
    blighthearts: d.blighthearts || [], lastHeartAt: d.lastHeartAt || 0,
    cleansedTotal: d.cleansedTotal || 0, heartsPurged: d.heartsPurged || 0, mode: d.mode || 'warden',
    held: d.held || null, heldUsed: !!d.heldUsed, endless: !!d.endless, journeyIdx: d.journeyIdx || 0,
    weatherOn: d.weatherOn !== false, weather: d.weather || { type: null, left: 0, until: 6 }, stats: d.stats || {},
    torches: d.torches || 0, gentleStart: !!d.gentleStart,
    visitor: d.visitor || null, visitorCooldown: d.visitorCooldown || 0, lastVisitorId: d.lastVisitorId || null,
  };
}

// Axial hex distance between two cells.
export function hexDist(q1, r1, q2, r2) {
  return (Math.abs(q1 - q2) + Math.abs(q1 + r1 - q2 - r2) + Math.abs(r1 - r2)) / 2;
}

export function rotateCW(g) {
  if (g.current) g.rotation = (g.rotation + 1) % 6;
}

// All empty cells adjacent to at least one placed tile.
export function openSlots(g) {
  const slots = new Map(); // key -> {q,r}
  for (const t of g.board.values()) {
    for (let i = 0; i < 6; i++) {
      const n = neighbor(t.q, t.r, i);
      const k = key(n.q, n.r);
      if (!g.board.has(k)) slots.set(k, n);
    }
  }
  return slots;
}

// Soft "terrain wheel": neighbouring terrains that blend naturally also count
// as a match (a coast meets a river, a moor meets the fields, ruins reclaim the
// forest…). Fae stays exclusively magical. Symmetric via compatible().
const COMPAT = {
  coast: ['water'],
  water: ['coast', 'marsh'],
  marsh: ['water', 'forest'],
  forest: ['marsh', 'ruins'],
  ruins: ['forest', 'mountain'],
  mountain: ['ruins', 'moor'],
  moor: ['mountain', 'field'],
  field: ['moor', 'orchard'],
  orchard: ['field', 'village'],
  village: ['orchard'],
};

export function compatible(a, b) {
  if (a === b) return true;
  return (COMPAT[a] && COMPAT[a].includes(b)) || (COMPAT[b] && COMPAT[b].includes(a)) || false;
}

// A coast meeting a river is an "estuary" — a small bonus + flourish.
function isEstuary(a, b) {
  return (a === 'coast' && b === 'water') || (a === 'water' && b === 'coast');
}

// ---- mechanical seasons (advance every 13 tiles) ----
// Each season favours one terrain (its matched edges earn +5 each); winter
// freezes rivers (water matches score nothing that season).
export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];
export const SEASON_FAVOR = ['forest', 'field', 'orchard', 'village'];
export function seasonAt(placed) { return Math.floor((placed || 0) / 13) % 4; }

// ---- weather fronts (telegraphed; last a few placements; tweak scoring) ----
// A front rolls in, runs for a handful of tiles, then clears for a gap before
// the next. Seasons bias which front appears. Mostly upside (cozy).
export const WEATHER = {
  sun: { name: 'Harvest Sun', note: 'fields & orchards +50%', icon: 'sun' },
  rain: { name: 'Downpour', note: 'rivers & coast +50%', icon: 'rain' },
  frost: { name: 'Cold Snap', note: 'rivers frozen — hold water', icon: 'snow' },
};
const WEATHER_DUR = [4, 6];     // placements a front lasts
const WEATHER_GAP = [5, 9];     // calm placements between fronts
function rint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function rollFront(season) {
  const r = Math.random();
  if (season === 1) return r < 0.55 ? 'sun' : (r < 0.82 ? 'rain' : 'frost');   // summer
  if (season === 3) return r < 0.55 ? 'frost' : (r < 0.82 ? 'rain' : 'sun');   // winter
  if (season === 2) return r < 0.48 ? 'sun' : (r < 0.85 ? 'rain' : 'frost');   // autumn harvest
  return r < 0.42 ? 'rain' : (r < 0.76 ? 'sun' : 'frost');                     // spring
}
// Advance the weather clock by one placement (mutates g.weather).
function advanceWeather(g) {
  if (!g.weatherOn) { g.weather = { type: null, left: 0, until: 0 }; return; }
  const w = g.weather || (g.weather = { type: null, left: 0, until: rint(WEATHER_GAP[0], WEATHER_GAP[1]) });
  if (w.type) {
    w.left--;
    if (w.left <= 0) { w.type = null; w.until = rint(WEATHER_GAP[0], WEATHER_GAP[1]); }
  } else {
    w.until--;
    if (w.until <= 0) { w.type = rollFront(seasonAt(g.placed)); w.left = rint(WEATHER_DUR[0], WEATHER_DUR[1]); }
  }
}
// Current active front for the HUD, or null.
export function weatherInfo(g) {
  const w = g && g.weather;
  if (!w || !w.type) return null;
  return Object.assign({ type: w.type, left: w.left }, WEATHER[w.type]);
}

// ---- living valley: irrigation (rivers water the farms beside them) ----
// A farm tile (field/orchard edges) touching river water is irrigated, and the
// valley yields a little "growth" score on its own each placement — the board
// becomes a living system you cultivate, not just a mosaic you score once.
function refreshIrrigation(g) {
  let n = 0;
  for (const t of g.board.values()) {
    if (t.corrupt || t.flooded || t.overgrown || t.burning || t.harvested || !t.edges.some(e => e === 'field' || e === 'orchard')) { t.irrigated = false; continue; }
    let wet = t.edges.includes('water');
    for (let i = 0; i < 6 && !wet; i++) {
      const n = neighbor(t.q, t.r, i);
      const nb = g.board.get(key(n.q, n.r));
      if (nb && nb.edges.includes('water')) wet = true;
    }
    t.irrigated = wet;
    if (wet) n++;
  }
  return n;
}

// ---- wild forces: wildfire (first force of the shared spread family) ----
// Drought (a Harvest Sun front) can ignite dry growth; fire spreads through
// forest/field/orchard each placement, is blocked by water/coast/marsh/
// mountain firebreaks, and is doused by rain/frost or a placed water tile.
// Burnt-out tiles leave fertile ash: build beside it for a bonus, and it
// regrows. Warden runs face it much more often.
function flammable(t) {
  if (t.corrupt || t.burning || t.ash || t.flooded) return false;
  if (t.overgrown) return true;                      // dry brambles are tinder
  let dry = 0; for (const e of t.edges) if (e === 'forest' || e === 'field' || e === 'orchard') dry++;
  return dry >= 2;
}
function firebreak(t) {
  if (t.flooded) return true;                        // floodwater stops fire cold
  let mtn = 0;
  for (const e of t.edges) { if (e === 'water' || e === 'coast' || e === 'marsh') return true; if (e === 'mountain') mtn++; }
  return mtn >= 2;
}
function advanceFire(g) {
  const out = { ignited: 0, spread: 0, burnedOut: 0, doused: 0, started: false };
  const wt = g.weather && g.weather.type;
  const burning = [...g.board.values()].filter(t => t.burning);
  // Rain or a cold snap snuffs every flame (no ash — the land is spared).
  if (burning.length && (wt === 'rain' || wt === 'frost')) {
    for (const t of burning) t.burning = 0;
    out.doused = burning.length;
    return out;
  }
  for (const t of burning) {
    t.burning--;
    if (t.burning <= 0) { t.burning = 0; t.ash = true; t.overgrown = false; out.burnedOut++; }   // fire clears brambles
  }
  for (const t of burning) {
    if (Math.random() > (g.mode === 'warden' ? 0.5 : 0.35)) continue;
    const opts = [];
    for (let i = 0; i < 6; i++) {
      const n = neighbor(t.q, t.r, i);
      const nb = g.board.get(key(n.q, n.r));
      if (nb && flammable(nb) && !firebreak(nb)) opts.push(nb);
    }
    if (opts.length) { opts[(Math.random() * opts.length) | 0].burning = 2; out.spread++; }
  }
  // Fresh ignition only during a drought, and only if nothing burns yet.
  // (A player's very first vale gets a long grace period.)
  if (!burning.length && wt === 'sun' && g.placed > (g.gentleStart ? 24 : 8)) {
    const chance = g.mode === 'warden' ? 0.22 : 0.05;
    if (Math.random() < chance) {
      const cands = [...g.board.values()].filter(t => flammable(t) && !firebreak(t));
      if (cands.length) { cands[(Math.random() * cands.length) | 0].burning = 2; out.ignited = 1; out.started = true; }
    }
  }
  return out;
}

// ---- wild force: flood (rain swells the rivers into low land) ----
// During a Downpour, water creeps from rivers into low-lying neighbours;
// mountains and high ground are natural levees. When the rain passes the
// flood recedes, leaving fertile floodplain — build beside it for rich silt.
const ELEV_G = { mountain: 0.95, ruins: 0.5, fae: 0.42, forest: 0.34, orchard: 0.3, village: 0.24, moor: 0.16, field: 0.12, marsh: -0.16, coast: -0.2, water: -0.3 };
function tileElev(t) { let s = 0; for (const e of t.edges) s += (ELEV_G[e] || 0); return s / 6; }
function advanceFlood(g) {
  const out = { flooded: 0, receded: 0 };
  const raining = g.weather && g.weather.type === 'rain';
  if (!raining) {
    for (const t of g.board.values()) if (t.flooded) { t.flooded = false; t.floodplain = true; out.receded++; }
    return out;
  }
  if (g.gentleStart && g.placed < 24) return out;     // first-vale grace
  const sources = [...g.board.values()].filter(t => t.flooded || t.edges.includes('water'));
  for (const s of sources) {
    if (Math.random() > 0.22) continue;
    const opts = [];
    for (let i = 0; i < 6; i++) {
      const n = neighbor(s.q, s.r, i);
      const nb = g.board.get(key(n.q, n.r));
      if (nb && !nb.flooded && !nb.corrupt && !nb.burning && !nb.edges.includes('water') && tileElev(nb) <= 0.12) opts.push(nb);
    }
    if (opts.length) { opts[(Math.random() * opts.length) | 0].flooded = true; out.flooded++; }
    if (out.flooded >= 2) break;   // cap per placement — sim showed water-heavy
  }                                // palettes (Journey) drowning 20+ tiles a run
  return out;
}

// ---- wild force: overgrowth (the unmanaged wild creeps into tame land) ----
// A big wild forest or fae wood (region ≥ 5) sends brambles into adjacent
// farms and villages every so often. Build beside an overgrown tile to prune
// it (+ bonus). Overgrown brush is tinder — fire clears it too.
function advanceOvergrowth(g) {
  const out = { grew: 0 };
  if ((g.placed % 3) !== 0 || (g.gentleStart && g.placed < 24)) return out;
  if (Math.random() >= (g.mode === 'warden' ? 0.22 : 0.12)) return out;
  const cands = [];
  for (const t of g.board.values()) {
    let wild = 0; for (const e of t.edges) if (e === 'forest' || e === 'fae') wild++;
    if (wild < 3 || t.corrupt || t.burning) continue;
    const region = regionTiles(g, t, t.edges.includes('forest') ? 'forest' : 'fae');
    if (region.size < 5) continue;
    for (let i = 0; i < 6; i++) {
      const n = neighbor(t.q, t.r, i);
      const nb = g.board.get(key(n.q, n.r));
      if (nb && !nb.overgrown && !nb.corrupt && !nb.burning && !nb.flooded &&
          nb.edges.some(e => e === 'field' || e === 'orchard' || e === 'village')) cands.push(nb);
    }
  }
  if (cands.length) { cands[(Math.random() * cands.length) | 0].overgrown = true; out.grew = 1; }
  return out;
}

// Controlled burn: spend a torch to deliberately ignite one of your tiles —
// clears brambles, and the burn leaves fertile ash to build beside. The fire
// is real: it can spread, so pick a spot with firebreaks around it.
export function igniteTile(g, q, r) {
  if ((g.torches || 0) <= 0 || g.gameOver) return false;
  const t = g.board.get(key(q, r));
  if (!t || !flammable(t) || firebreak(t)) return false;
  t.burning = 2;
  g.torches--;
  const st = g.stats || (g.stats = {});
  st.torched = (st.torched || 0) + 1;
  return true;
}

// ---- cultivation: nature co-builds the vale ----
// Every so often the wild spreads ON ITS OWN: a young wood / marsh / meadow
// takes root in an open slot beside an existing wild region. The player is no
// longer the only builder — they're a steward negotiating with a garden.
const WILD_SOURCES = ['forest', 'marsh', 'fae', 'moor'];
function sproutWild(g) {
  if (g.gentleStart && g.placed < 24) return null;
  if (g.placed < 10 || Math.random() > 0.16) return null;
  // candidate slots: open, adjacent to a tile with ≥3 wild edges
  const cands = [];
  for (const t of g.board.values()) {
    let best = null, bestN = 0;
    for (const w of WILD_SOURCES) { let n = 0; for (const e of t.edges) if (e === w) n++; if (n > bestN) { bestN = n; best = w; } }
    if (bestN < 3) continue;
    for (let i = 0; i < 6; i++) {
      const n = neighbor(t.q, t.r, i);
      if (!g.board.has(key(n.q, n.r))) cands.push({ q: n.q, r: n.r, terr: best });
    }
  }
  if (!cands.length) return null;
  const c = cands[(Math.random() * cands.length) | 0];
  // young wild tile: mostly the spreading terrain, a little mixed scrub
  const edges = [];
  for (let i = 0; i < 6; i++) edges.push(Math.random() < 0.7 ? c.terr : (Math.random() < 0.5 ? 'field' : c.terr));
  g.board.set(key(c.q, c.r), { q: c.q, r: c.r, edges, wild: true });
  const st = g.stats || (g.stats = {});
  st.sprouted = (st.sprouted || 0) + 1;
  return c;
}

// Harvest: a ripe forest / field / orchard region (≥ 4 connected tiles) can be
// reaped — points + bonus tiles — and its land enters a regrow rest before it
// can be harvested again. Regions have LIFECYCLES; the board is a crop.
const HARVESTABLE = ['forest', 'field', 'orchard'];
export function harvestRegion(g, q, r) {
  if (g.gameOver) return null;
  const t = g.board.get(key(q, r));
  if (!t || t.harvested || t.burning || t.corrupt || t.flooded || t.overgrown) return null;
  let terr = null, bestN = 0;
  for (const h of HARVESTABLE) { let n = 0; for (const e of t.edges) if (e === h) n++; if (n > bestN) { bestN = n; terr = h; } }
  if (!terr || bestN < 2) return null;
  const region = [...regionTiles(g, t, terr)].map(k2 => g.board.get(k2)).filter(x => x && !x.harvested);
  if (region.length < 4) return null;
  for (const rt of region) { rt.harvested = true; rt.regrow = 12; }
  const points = Math.min(80, region.length * 8);
  const bonusTiles = Math.floor(region.length / 3);
  for (let i = 0; i < bonusTiles; i++) g.stack.push(makeTile(g.palette));
  g.score += points;
  const st = g.stats || (g.stats = {});
  st.harvests = (st.harvests || 0) + 1;
  return { size: region.length, points, tiles: bonusTiles, terr };
}

// ---- named visitors: wandering folk with small wishes for the vale ----
// One traveller at a time appears on the board, strolls tile to tile, and asks
// for something the vale can give. Fulfil the wish while they're here for a
// generous reward; if not, they simply wave farewell (cozy — no penalty).
const VISITORS = [
  { id: 'maren', name: 'Maren the Miller', wish: 'Water the farms — six fields drinking from the rivers', check: (g, b, irr) => irr >= 6, reward: 120 },
  { id: 'sylfa', name: 'Sylfa the Fae Trader', wish: 'Grow me a deep wood — a forest of six', check: (g) => maxTerrainRegion(g, 'forest') >= 6, reward: 120 },
  { id: 'bram', name: 'Old Bram the Reeve', wish: 'Raise a proud town of five', check: (g) => maxTownSize(g) >= 5, reward: 140 },
  { id: 'tilda', name: 'Tilda the Harvester', wish: 'Reap a ripe region while I watch', check: (g, b) => ((g.stats || {}).harvests || 0) > (b.harvests || 0), reward: 100 },
  { id: 'rook', name: 'Rook the Charcoal-Burner', wish: 'Light a controlled burn for my kilns', check: (g, b) => ((g.stats || {}).torched || 0) > (b.torched || 0), reward: 100 },
  { id: 'hilda', name: 'Hilda the Matron', wish: 'Shelter thirty hearthfolk in your vale', check: (g) => !!(g.needs && g.needs.pop >= 30), reward: 140 },
  { id: 'piet', name: 'Piet the Woodward', wish: 'Lay in wood for winter — three woods to spare', check: (g) => !!(g.needs && g.needs.wood >= g.needs.woodNeed + 3), reward: 110 },
];
function advanceVisitor(g, irrigated) {
  const out = { arrived: null, helped: null, gone: null };
  g.visitorCooldown = Math.max(0, (g.visitorCooldown || 0) - 1);
  if (g.visitor) {
    const v = g.visitor;
    const def = VISITORS.find(d => d.id === v.id);
    // stroll to a neighbouring tile now and then
    if (Math.random() < 0.3) {
      const opts = [];
      for (let i = 0; i < 6; i++) { const n = neighbor(v.q, v.r, i); if (g.board.has(key(n.q, n.r))) opts.push(n); }
      if (opts.length) { const n = opts[(Math.random() * opts.length) | 0]; v.q = n.q; v.r = n.r; }
    }
    if (def && def.check(g, v.base || {}, irrigated)) {
      out.helped = { name: v.name, reward: def.reward };
      const st = g.stats || (g.stats = {});
      st.visitors = (st.visitors || 0) + 1;
      g.visitor = null; g.visitorCooldown = 14;
      return out;
    }
    v.left--;
    if (v.left <= 0) { out.gone = { name: v.name }; g.visitor = null; g.visitorCooldown = 14; }
    return out;
  }
  if (g.placed > 14 && g.visitorCooldown <= 0 && Math.random() < 0.1 && !(g.gentleStart && g.placed < 24)) {
    const base = { harvests: (g.stats || {}).harvests || 0, torched: (g.stats || {}).torched || 0 };
    const pool = VISITORS.filter(d => d.id !== g.lastVisitorId && !d.check(g, base, irrigated));
    if (pool.length) {
      const def = pool[(Math.random() * pool.length) | 0];
      const tiles = [...g.board.values()];
      const t0 = tiles[(Math.random() * tiles.length) | 0];
      g.visitor = { id: def.id, name: def.name, wish: def.wish, q: t0.q, r: t0.r, left: 12, base };
      g.lastVisitorId = def.id;
      out.arrived = { name: def.name, wish: def.wish };
    }
  }
  return out;
}

// ---- hearthfolk: population & needs (the people of the vale) ----
// Settlements hold folk; folk need food (farmland), water (rivers & coast)
// and wood (healthy forests). Meeting every need lets the vale THRIVE —
// steady income, towns celebrate and prosper. A shortfall never destroys
// anything: growth simply waits until the land provides again.
const TIER_POP = [2, 5, 8, 12];
export function computeNeeds(g) {
  let pop = 0, food = 0, water = 0, wood = 0;
  for (const t of g.board.values()) {
    if (t.corrupt || t.burning || t.flooded) continue;
    if (t.townSize) pop += TIER_POP[townTier(t.townSize)] || 2;
    let f = 0, w = 0, wd = 0;
    for (const e of t.edges) {
      if (e === 'field' || e === 'orchard') f++;
      else if (e === 'water' || e === 'coast') w++;
      else if (e === 'forest') wd++;
    }
    if (f >= 2 && !t.harvested && !t.overgrown) food += t.irrigated ? 2 : 1;   // watered farms feed double
    if (w >= 2) water += 1;
    if (wd >= 2 && !t.harvested) wood += 1;
  }
  // Winter hearths burn extra wood — lay in your forests before the snow.
  const winter = seasonAt(g.placed) === 3;
  const foodNeed = Math.ceil(pop / 8), waterNeed = Math.ceil(pop / 12), woodNeed = Math.ceil(pop / (winter ? 7 : 12));
  const met = pop < 6 || (food >= foodNeed && water >= waterNeed && wood >= woodNeed);
  return { pop, food, water, wood, foodNeed, waterNeed, woodNeed, met, winter };
}

// Per-edge scoring for a set of matched edge indices under a season + weather.
function scoreMatches(matchedEdges, edges, season, weather) {
  let base = 0, seasonBonus = 0, frozen = 0, weatherBonus = 0;
  const favor = SEASON_FAVOR[season];
  const wt = weather && weather.type;
  for (const i of matchedEdges) {
    const e = edges[i];
    // Winter OR a Cold Snap freezes rivers — water matches score nothing.
    if ((season === 3 || wt === 'frost') && e === 'water') { frozen++; continue; }
    base += 10;
    if (e === favor) seasonBonus += 5;                            // seasonal bounty
    // Weather fronts nearly double their favoured terrain (base is 10/edge) —
    // tuned up from +5 after simulation showed +5 was invisible vs combos.
    if (wt === 'sun' && (e === 'field' || e === 'orchard')) weatherBonus += 8;
    else if (wt === 'rain' && (e === 'water' || e === 'coast' || e === 'marsh')) weatherBonus += 8;
  }
  return { base, seasonBonus, frozen, weatherBonus };
}

// Score a hypothetical placement of `edges` at (q,r): matched edges + perfect.
export function evaluate(g, q, r, edges) {
  let matches = 0;
  let neighbors = 0;
  for (let i = 0; i < 6; i++) {
    const n = neighbor(q, r, i);
    const nb = g.board.get(key(n.q, n.r));
    if (!nb) continue;
    neighbors++;
    if (compatible(edges[i], nb.edges[opposite(i)])) matches++;
  }
  const perfect = neighbors > 0 && matches === neighbors;
  return { matches, neighbors, perfect };
}

// Projected score breakdown for placing `edges` at (q,r) — for the ghost
// preview, so the player can SEE how scoring works. Does not mutate.
export function previewScore(g, q, r, edges) {
  const ev = evaluate(g, q, r, edges);
  let estuaries = 0;
  for (let i = 0; i < 6; i++) {
    const n = neighbor(q, r, i);
    const nb = g.board.get(key(n.q, n.r));
    if (nb && isEstuary(edges[i], nb.edges[opposite(i)])) estuaries++;
  }
  const matchedEdges = [];
  for (let i = 0; i < 6; i++) {
    const n = neighbor(q, r, i);
    const nb = g.board.get(key(n.q, n.r));
    if (nb && compatible(edges[i], nb.edges[opposite(i)])) matchedEdges.push(i);
  }
  const season = seasonAt(g.placed);
  const sm = scoreMatches(matchedEdges, edges, season, g.weather);
  const projCombo = ev.matches > 0 ? (g.combo || 0) + 1 : 0;
  const mult = Math.min(MAX_COMBO_MULT, 1 + Math.max(0, projCombo - 1) * 0.5);
  const base = sm.base + sm.seasonBonus + (sm.weatherBonus || 0) + (ev.perfect ? 30 : 0);
  const scaled = Math.round(base * mult);
  const lm = g.current && g.current.landmark;
  let landmarkBonus = 0;
  if (lm) { const pref = LANDMARKS[lm] && LANDMARKS[lm].prefers; let syn = 0; for (const e of edges) if (e === pref) syn++; landmarkBonus = 50 + syn * 15; }
  const estuaryBonus = estuaries * 15;
  return {
    matches: ev.matches, perfect: ev.perfect, mult, baseMatch: sm.base,
    estuaries, estuaryBonus, landmark: lm, landmarkBonus,
    season, seasonFavor: SEASON_FAVOR[season], seasonBonus: sm.seasonBonus, frozen: sm.frozen,
    weatherBonus: sm.weatherBonus || 0,
    weatherName: (g.weather && g.weather.type && WEATHER[g.weather.type]) ? WEATHER[g.weather.type].name : null,
    total: scaled + landmarkBonus + estuaryBonus,
  };
}

// Place the current tile at (q,r). Returns the scoring result, or null if
// the move was illegal (slot not open / no current tile).
export function place(g, q, r) {
  if (g.gameOver || !g.current) return null;
  const k = key(q, r);
  if (g.board.has(k)) return null;
  const slots = openSlots(g);
  if (!slots.has(k)) return null;

  const edges = currentEdges(g);
  const evalRes = evaluate(g, q, r, edges);
  const matchedEdges = [];
  let estuaries = 0;
  for (let i = 0; i < 6; i++) {
    const n = neighbor(q, r, i);
    const nb = g.board.get(key(n.q, n.r));
    if (!nb) continue;
    const nbEdge = nb.edges[opposite(i)];
    if (compatible(edges[i], nbEdge)) matchedEdges.push(i);
    if (isEstuary(edges[i], nbEdge)) estuaries++;
  }
  const landmark = g.current.landmark || null;
  const season = seasonAt(g.placed);   // current (pre-increment) season

  const tile = { edges, q, r };
  if (landmark) tile.landmark = landmark;
  g.board.set(k, tile);
  g.placed++;

  // Combo: a placement that matches at least one edge extends the streak.
  if (evalRes.matches > 0) g.combo++;
  else g.combo = 0;
  g.bestCombo = Math.max(g.bestCombo, g.combo);
  const mult = comboMult(g);

  // Seasonal + weather per-edge scoring (favoured-terrain bonus; frozen rivers).
  const sm = scoreMatches(matchedEdges, edges, season, g.weather);
  let base = sm.base + sm.seasonBonus + (sm.weatherBonus || 0);
  if (evalRes.perfect) { base += 30; g.perfects++; }
  let points = Math.round(base * mult);

  // Landmark bonus (flat + synergy with its preferred terrain on the board).
  let landmarkBonus = 0;
  let firstLandmark = false;
  if (landmark) {
    g.landmarksPlaced++;
    if (!g.firstLandmarkDone) { g.firstLandmarkDone = true; firstLandmark = true; }
    const pref = LANDMARKS[landmark]?.prefers;
    let synergy = 0;
    for (let i = 0; i < 6; i++) if (edges[i] === pref) synergy++;
    landmarkBonus = 50 + synergy * 15;
    points += landmarkBonus;
  }

  // Estuary bonus: each coast↔river seam pays a little extra.
  const estuaryBonus = estuaries * 15;
  points += estuaryBonus;
  if (estuaries) g.estuaryCount = (g.estuaryCount || 0) + estuaries;

  // Maybe seed a quest on this tile (only if it has a clear dominant terrain).
  maybeSeedQuest(g, tile);

  // Advance / complete any quests that this placement may have grown.
  const completed = checkQuests(g);
  const firstDecree = completed.length > 0 && !g.firstDecreeDone;
  if (firstDecree) g.firstDecreeDone = true;
  for (const qd of completed) {
    g.decreesDone++;
    const seed = g.board.get(key(qd.q, qd.r));
    const region = seed ? regionTiles(g, seed, qd.terrain) : new Set();
    // The whole region springs to life (drives the drawLife animations).
    for (const tk of region) g.board.get(tk).bloom = qd.terrain;
    // Queue an outward "bloom wave" from the seed for the renderer to animate.
    g.blooms = g.blooms || [];
    g.blooms.push({
      terrain: qd.terrain,
      tiles: [...region].map(rk => { const tt = g.board.get(rk); return { q: tt.q, r: tt.r, d: hexDist(qd.q, qd.r, tt.q, tt.r) }; }),
    });
    const closed = seed ? regionClosed(g, seed, qd.terrain) : false;
    qd.bloomed = closed;
    if (closed) g.regionsBloomed++;
    points += qd.target * 15 * (closed ? 2 : 1);   // closed regions pay double
    for (let i = 0; i < REWARD_TILES; i++) g.stack.push(makeTile(g.palette));
  }

  // Recompute town growth so building density reflects the new layout.
  updateTowns(g);
  updateLabels(g);

  // Hearthfolk: population & needs. Gates celebrations/prosperity and pays a
  // steady "thrive" income while every need is met.
  const needs = computeNeeds(g);
  g.needs = needs;
  {
    const st0 = g.stats || (g.stats = {});
    if (needs.pop > (st0.peakPop || 0)) st0.peakPop = needs.pop;
  }
  const thrive = needs.met && needs.pop >= 6 ? Math.min(8, Math.ceil(needs.pop / 6)) : 0;
  points += thrive;

  // Festival when any town reaches a new tier milestone (hamlet → village → town).
  let festival = null;
  let maxTier = 0, festTile = null;
  for (const tt of g.board.values()) {
    if (tt.townCenter) { const tier = townTier(tt.townSize); if (tier > maxTier) { maxTier = tier; festTile = tt; } }
  }
  // Celebrate the meaningful milestones only: village (tier 2) and town (tier 3)
  // — and only when the folk's needs are met (otherwise the milestone waits).
  if (maxTier >= 2 && maxTier > (g.townMilestone || 0) && festTile && needs.met) {
    g.townMilestone = maxTier;
    g.festivals = g.festivals || [];
    g.festivals.push({ q: festTile.q, r: festTile.r, tier: maxTier });
    festival = { q: festTile.q, r: festTile.r, tier: maxTier };
  } else if (maxTier > (g.townMilestone || 0) && (maxTier < 2 || needs.met)) {
    g.townMilestone = maxTier;   // record tier-1 without a festival
  }

  // Town needs & trade: prosperity (★) and ports only bloom while the vale's
  // folk are provided for — a shortfall pauses them, never punishes.
  const prosp = needs.met ? updateProsperity(g) : { bonus: 0, prospered: 0, ported: 0 };
  points += prosp.bonus;

  // The Blight & the Wardens (Warden mode): this tile cleanses adjacent rot,
  // Wardtower auras grind down hearts, then the blight creeps one more tile.
  let cleansed = 0, blight = { started: false, newCount: 0, spawned: 0 }, purge = { purged: 0 }, wardOffered = 0;
  const wardPlaced = tile.landmark === 'wardtower';
  if (g.corruptionOn !== false) {
    cleansed = cleanseCorruption(g, tile);
    blight = spreadCorruption(g, k);
    purge = purgeHearts(g);
    wardOffered = maybeOfferWardtower(g);
    points += cleansed * 10 - blight.newCount * 14 + purge.purged * 60;   // corruption stings (sim: warden out-scored calm)
    if (cleansed) g.cleansedTotal = (g.cleansedTotal || 0) + cleansed;
    if (purge.purged) g.heartsPurged = (g.heartsPurged || 0) + purge.purged;
  }

  // Journey: complete the active objective for points + tiles, then advance.
  let journeyDone = null;
  if (g.mode === 'journey' && (g.journeyIdx || 0) < JOURNEY.length) {
    const obj = JOURNEY[g.journeyIdx || 0];
    if (obj.check(g)) {
      g.journeyIdx = (g.journeyIdx || 0) + 1;
      points += obj.reward;
      journeyDone = { text: obj.text, reward: obj.reward, all: g.journeyIdx >= JOURNEY.length };
      for (let i = 0; i < REWARD_TILES + 1; i++) g.stack.push(makeTile(g.palette));
    }
  }

  // Weather: advance the front clock; flag a newly-arrived front for the HUD.
  const wPrev = g.weather && g.weather.type;
  advanceWeather(g);
  const wNow = g.weather && g.weather.type;
  const weatherStarted = (wNow && wNow !== wPrev) ? wNow : null;

  // Wildfire: this placement can douse flames (water/coast edges) and reclaim
  // fertile ash beside it; then the fire itself advances.
  const fire = { ignited: 0, spread: 0, burnedOut: 0, doused: 0, started: false };
  let ashBonus = 0, siltBonus = 0, pruned = 0, blessing = 0;
  {
    const wetPlaced = edges.some(e => e === 'water' || e === 'coast');
    for (let i = 0; i < 6; i++) {
      const n = neighbor(q, r, i);
      const nb = g.board.get(key(n.q, n.r));
      if (!nb) continue;
      if (wetPlaced && nb.burning) { nb.burning = 0; fire.doused++; }
      if (nb.ash) { nb.ash = false; ashBonus += 12; }           // new growth on burnt land
      if (nb.floodplain) { nb.floodplain = false; siltBonus += 15; }  // rich silt claimed
      if (nb.overgrown) { nb.overgrown = false; pruned++; }     // brambles pruned back
      if (nb.heirloom) blessing = 12;                           // ancestral blessing
    }
    // Counterplay pays well (sim showed small rewards vanish vs combos).
    points += fire.doused * 25 + ashBonus + siltBonus + pruned * 15 + blessing;
    const adv = advanceFire(g);
    fire.ignited = adv.ignited; fire.spread += adv.spread; fire.burnedOut = adv.burnedOut;
    fire.doused += adv.doused; fire.started = adv.started;
    points -= (fire.ignited + fire.spread) * 10;                // burning land hurts
  }

  // Flood swells during a Downpour and recedes after; the wild creeps into
  // tame land beside big unmanaged woods.
  const flood = advanceFlood(g);
  points -= flood.flooded * 6;
  const over = advanceOvergrowth(g);
  points -= over.grew * 8;

  // Nature co-builds: the wild may sprout a young tile of its own, and
  // harvested land regrows a little with every placement.
  const sprouted = sproutWild(g);
  for (const t of g.board.values()) if (t.harvested && --t.regrow <= 0) { t.harvested = false; t.regrow = 0; }

  // Living valley: rivers water adjacent farms — the land yields a little
  // growth on its own each placement (the fields sleep while frozen).
  const irrigated = refreshIrrigation(g);
  const frozenWorld = season === 3 || wNow === 'frost';
  const growth = frozenWorld ? 0 : Math.min(10, Math.floor(irrigated / 2));
  points += growth;

  // Visitors: a wandering traveller may arrive, stroll, and reward a wish.
  const vis = advanceVisitor(g, irrigated);
  if (vis.helped) points += vis.helped.reward;

  g.score = Math.max(0, g.score + points);
  g.lastPlace = {
    q, r, matches: evalRes.matches, perfect: evalRes.perfect,
    points, combo: g.combo, mult, landmark, landmarkBonus, completed, matchedEdges, festival,
    firstDecree, firstLandmark, estuaries, estuaryBonus,
    season, seasonBonus: sm.seasonBonus, frozen: sm.frozen,
    prospered: prosp.prospered, ported: prosp.ported,
    corruptionStarted: blight.started, corruptedNew: blight.newCount, cleansed,
    corruptedTotal: Object.keys(g.corrupted || {}).length,
    heartRose: (blight.spawned || 0) > 0, heartsPurged: purge.purged,
    wardPlaced, wardOffered, blighthearts: (g.blighthearts || []).length,
    journeyDone, journeyIdx: g.journeyIdx || 0,
    weatherBonus: sm.weatherBonus || 0, weatherStarted,
    fireStarted: fire.started, fireSpread: fire.spread, fireDoused: fire.doused,
    fireBurnedOut: fire.burnedOut, ashBonus, irrigated, growth,
    flooded: flood.flooded, receded: flood.receded, overgrew: over.grew, pruned, siltBonus,
    sprouted, visitorArrived: vis.arrived, visitorHelped: vis.helped, visitorGone: vis.gone, blessing,
    thrive, pop: needs.pop, needsMet: needs.met,
  };

  // Run chronicle: cumulative totals for the game-over "story of your vale".
  const st = g.stats || (g.stats = {});
  st.growth = (st.growth || 0) + growth;
  st.perfects = (st.perfects || 0) + (evalRes.perfect ? 1 : 0);
  st.decrees = (st.decrees || 0) + completed.length;
  st.fires = (st.fires || 0) + (fire.started ? 1 : 0);
  st.doused = (st.doused || 0) + fire.doused;
  st.burned = (st.burned || 0) + fire.burnedOut;
  st.floods = (st.floods || 0) + flood.flooded;
  st.silt = (st.silt || 0) + siltBonus;
  st.pruned = (st.pruned || 0) + pruned;

  // Zen / endless mode: keep the stack topped up so the run never ends.
  if (g.endless && g.stack.length < 8) { for (let i = 0; i < 24; i++) g.stack.push(makeTile(g.palette)); }

  // Draw the next tile. A fresh turn re-enables the hold slot. If the stack is
  // empty but a tile is held, play that one out before ending the run.
  g.current = g.stack.shift() || null;
  g.heldUsed = false;
  if (!g.current && g.held) { g.current = g.held; g.held = null; }
  g.rotation = 0;
  if (!g.current) g.gameOver = true;

  return g.lastPlace;
}

function dominantTerrain(tile) {
  const counts = {};
  let best = null;
  let bestN = 0;
  for (const e of tile.edges) {
    counts[e] = (counts[e] || 0) + 1;
    if (counts[e] > bestN) { bestN = counts[e]; best = e; }
  }
  return { terrain: best, count: bestN };
}

function maybeSeedQuest(g, tile) {
  // Cap active decrees so the early flood doesn't become clutter.
  const active = g.quests.filter(q => !q.done).length;
  if (active >= 4) return;
  // Early game: decrees appear often and with small, quick targets so the
  // opening is a steady stream of goals & payoffs rather than quiet matching.
  const early = g.placed < 10;
  if (Math.random() > (early ? 0.72 : QUEST_CHANCE)) return;
  const { terrain, count } = dominantTerrain(tile);
  if (count < 2) return; // need a real feature to grow
  // Don't double up quests on the same terrain right next door.
  const region = regionTiles(g, tile, terrain);
  const grow = early ? 1 + Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 3);
  const target = region.size + grow;
  g.quests.push({ q: tile.q, r: tile.r, terrain, target, done: false });
}

// Connected component of tiles linked by matched `terrain` borders, starting
// from `seed`. Returns a Set of tile-keys.
export function regionTiles(g, seed, terrain) {
  const seen = new Set();
  const stack = [seed];
  seen.add(key(seed.q, seed.r));
  while (stack.length) {
    const t = stack.pop();
    for (let i = 0; i < 6; i++) {
      if (t.edges[i] !== terrain) continue;
      const n = neighbor(t.q, t.r, i);
      const nb = g.board.get(key(n.q, n.r));
      if (!nb) continue;
      if (nb.edges[opposite(i)] !== terrain) continue;
      const nk = key(n.q, n.r);
      if (seen.has(nk)) continue;
      seen.add(nk);
      stack.push(nb);
    }
  }
  return seen;
}

// Is a region fully closed — no `terrain` edge facing an empty cell?
export function regionClosed(g, seed, terrain) {
  const region = regionTiles(g, seed, terrain);
  for (const tk of region) {
    const t = g.board.get(tk);
    for (let i = 0; i < 6; i++) {
      if (t.edges[i] !== terrain) continue;
      const n = neighbor(t.q, t.r, i);
      if (!g.board.has(key(n.q, n.r))) return false;
    }
  }
  return true;
}

function checkQuests(g) {
  const completed = [];
  for (const qd of g.quests) {
    if (qd.done) continue;
    const seed = g.board.get(key(qd.q, qd.r));
    if (!seed) { qd.done = true; continue; }
    const size = regionTiles(g, seed, qd.terrain).size;
    qd.size = size;
    if (size >= qd.target) {
      qd.done = true;
      completed.push(qd);
    }
  }
  return completed;
}

// Tag every village tile with the size of its connected village region and
// mark one "center" tile per town (the busiest junction) for its landmark
// building. This drives building density as the town grows. Cheap: runs once
// per placement, board is small.
export function updateTowns(g) {
  const seen = new Set();
  for (const tile of g.board.values()) {
    if (!tile.edges.includes('village')) { tile.townSize = 0; tile.townCenter = false; continue; }
    const tk0 = key(tile.q, tile.r);
    if (seen.has(tk0)) continue;
    const region = regionTiles(g, tile, 'village');
    let center = null, bestEdges = -1;
    for (const tk of region) {
      seen.add(tk);
      const tt = g.board.get(tk);
      const ve = tt.edges.filter(e => e === 'village').length;
      if (ve > bestEdges) { bestEdges = ve; center = tk; }
    }
    for (const tk of region) {
      const tt = g.board.get(tk);
      tt.townSize = region.size;
      tt.townCenter = false;
    }
    if (center) g.board.get(center).townCenter = true;
  }
}

// Compute each town's prosperity (needs met) + port status, and award a one-
// time bonus the first time a town becomes prosperous / a port. Stable region
// key (min coord) keeps the "first time" honest as the town grows.
function updateProsperity(g) {
  g.prosperousTowns = g.prosperousTowns || {};
  g.portTowns = g.portTowns || {};
  let bonus = 0, prospered = false, ported = false;
  const seen = new Set();
  for (const tt of g.board.values()) {
    if (!tt.townCenter) continue;
    const region = regionTiles(g, tt, 'village');
    const terr = new Set();
    let minId = Infinity, minKey = null;
    for (const rk of region) {
      const r2 = g.board.get(rk);
      for (const e of r2.edges) terr.add(e);
      const id = r2.q * 100000 + r2.r;
      if (id < minId) { minId = id; minKey = rk; }
    }
    const food = terr.has('field') || terr.has('orchard');
    const water = terr.has('water') || terr.has('coast') || terr.has('marsh');
    const wood = terr.has('forest');
    const met = (food ? 1 : 0) + (water ? 1 : 0) + (wood ? 1 : 0);
    tt.prosperity = met;
    tt.port = terr.has('coast');
    if (met >= 3 && tt.townSize >= 3 && !g.prosperousTowns[minKey]) { g.prosperousTowns[minKey] = 1; bonus += 30; prospered = true; }
    if (tt.port && tt.townSize >= 2 && !g.portTowns[minKey]) { g.portTowns[minKey] = 1; bonus += 20; ported = true; }
  }
  return { bonus, prospered, ported };
}

// ---- the Blight & the Wardens (late-game "Warden" mode) ----
const BLIGHT_START = 30;                          // tiles placed before it seeds
const BLIGHT_BARRIER = new Set(['water', 'mountain', 'coast']); // halt its spread
const WARD_RADIUS = 2;        // hexes a Wardtower protects
const PURGE_TURNS = 3;        // turns a Blightheart must sit in a ward aura to die
const MAX_HEARTS = 3;         // most Blighthearts alive at once
const HEART_INTERVAL = 16;    // placements between new hearts rising

// All Wardtower fortress tiles currently on the board.
function wardtowerTiles(g) {
  const out = [];
  for (const t of g.board.values()) if (t.landmark === 'wardtower') out.push(t);
  return out;
}
// Is (q,r) inside any Wardtower's protective aura?
export function isWarded(g, q, r) {
  for (const w of wardtowerTiles(g)) if (hexDist(q, r, w.q, w.r) <= WARD_RADIUS) return true;
  return false;
}
function makeWardtowerTile(palette) {
  const t = makeTile(palette);
  t.landmark = 'wardtower';
  return t;
}

function pickBlightSeed(g) {
  // a frontier-ish tile, away from the origin, not a town centre or warded
  let best = null, bestD = -1;
  for (const t of g.board.values()) {
    if (t.townCenter || (t.q === 0 && t.r === 0) || t.corrupt) continue;
    const open = t.edges.some(e => !BLIGHT_BARRIER.has(e));
    if (!open || isWarded(g, t.q, t.r)) continue;
    const d = Math.abs(t.q) + Math.abs(t.r) + Math.random();   // jittered distance
    if (d > bestD) { bestD = d; best = t; }
  }
  return best;
}

// Raise a new Blightheart (a source tile that spreads corruption).
function spawnHeart(g) {
  const seed = pickBlightSeed(g);
  if (!seed) return false;
  seed.corrupt = true; seed.blightheart = true; seed.purge = 0;
  g.corrupted[key(seed.q, seed.r)] = 1;
  g.blighthearts = g.blighthearts || [];
  g.blighthearts.push(key(seed.q, seed.r));
  g.lastHeartAt = g.placed;
  return true;
}

// The new tile cleanses adjacent (non-heart) corruption if it carries fae or is
// a shrine. Hearts themselves can only be destroyed by a Wardtower aura.
function cleanseCorruption(g, tile) {
  const shrine = tile.landmark === 'shrine';
  if (!shrine && !tile.edges.includes('fae')) return 0;
  let cleansed = 0;
  for (let i = 0; i < 6; i++) {
    const n = neighbor(tile.q, tile.r, i);
    const nb = g.board.get(key(n.q, n.r));
    if (nb && nb.corrupt && !nb.blightheart && (shrine || tile.edges[i] === 'fae')) {
      nb.corrupt = false; delete g.corrupted[key(n.q, n.r)]; cleansed++;
    }
  }
  return cleansed;
}

// Spread corruption from the hearts' frontier — one tile per placement, blocked
// by water/mountain/coast and by Wardtower auras. New hearts rise over time.
// Returns { started, newCount, spawned }.
function spreadCorruption(g, skipKey) {
  g.corrupted = g.corrupted || {};
  g.blighthearts = g.blighthearts || [];
  if (!g.blightStarted) {
    if (g.placed < BLIGHT_START) return { started: false, newCount: 0, spawned: 0 };
    g.blightStarted = true;
    const ok = spawnHeart(g);
    return { started: ok, newCount: ok ? 1 : 0, spawned: ok ? 1 : 0 };
  }
  // Escalation: occasionally another heart rises elsewhere.
  let spawned = 0;
  if (g.blighthearts.length > 0 && g.blighthearts.length < MAX_HEARTS &&
      g.placed - (g.lastHeartAt || BLIGHT_START) >= HEART_INTERVAL) {
    if (spawnHeart(g)) spawned = 1;
  }
  // Creep to one new frontier tile (never into a barrier or a warded tile).
  const candidates = [];
  for (const ck in g.corrupted) {
    const ct = g.board.get(ck); if (!ct) continue;
    for (let i = 0; i < 6; i++) {
      if (BLIGHT_BARRIER.has(ct.edges[i])) continue;
      const n = neighbor(ct.q, ct.r, i);
      const nk = key(n.q, n.r);
      if (nk === skipKey) continue;
      const nb = g.board.get(nk);
      if (!nb || nb.corrupt || BLIGHT_BARRIER.has(nb.edges[opposite(i)])) continue;
      if (isWarded(g, nb.q, nb.r)) continue;
      candidates.push(nb);
    }
  }
  let newCount = 0;
  if (candidates.length) {
    const victim = candidates[Math.floor(Math.random() * candidates.length)];
    victim.corrupt = true; g.corrupted[key(victim.q, victim.r)] = 1; newCount = 1;
  }
  return { started: false, newCount, spawned };
}

// Wardtower auras grind down hearts they cover; a heart held for PURGE_TURNS dies
// and its whole connected blight cluster recedes. Returns { purged }.
function purgeHearts(g) {
  g.blighthearts = g.blighthearts || [];
  let purged = 0;
  const remaining = [];
  for (const hk of g.blighthearts) {
    const ht = g.board.get(hk);
    if (!ht || !ht.corrupt) continue;           // already cleansed away
    if (isWarded(g, ht.q, ht.r)) {
      ht.purge = (ht.purge || 0) + 1;
      if (ht.purge >= PURGE_TURNS) { purgeCluster(g, ht); purged++; continue; }
    } else {
      ht.purge = 0;                              // lost protection — progress resets
    }
    remaining.push(hk);
  }
  g.blighthearts = remaining;
  return { purged };
}

// Flood-fill cleanse of the corrupted cluster connected to a destroyed heart.
function purgeCluster(g, heart) {
  const stack = [key(heart.q, heart.r)]; const seen = new Set();
  while (stack.length) {
    const ck = stack.pop(); if (seen.has(ck)) continue; seen.add(ck);
    const ct = g.board.get(ck); if (!ct || !ct.corrupt) continue;
    ct.corrupt = false; ct.blightheart = false; ct.purge = 0; delete g.corrupted[ck];
    for (let i = 0; i < 6; i++) { const n = neighbor(ct.q, ct.r, i); stack.push(key(n.q, n.r)); }
  }
}

// When the vale is under threat, slip Wardtower tiles into the upcoming queue —
// more readily the worse it gets, fewer once towers already stand.
function maybeOfferWardtower(g) {
  if (!g.blighthearts || g.blighthearts.length === 0) return 0;
  const haveSoon = (g.current && g.current.landmark === 'wardtower') ||
    g.stack.slice(0, 4).some(t => t.landmark === 'wardtower');
  if (haveSoon) return 0;
  const threat = g.blighthearts.length;
  const built = wardtowerTiles(g).length;
  const chance = Math.min(0.6, 0.2 + 0.16 * threat - 0.12 * built);
  if (Math.random() < chance) {
    const t = makeWardtowerTile(g.palette);
    const pos = Math.min(1 + Math.floor(Math.random() * 2), g.stack.length);
    g.stack.splice(pos, 0, t);
    return 1;
  }
  return 0;
}

// ---- Journey objectives (directed map goals, completed in sequence) ----
function maxTerrainRegion(g, terr) {
  let max = 0; const seen = new Set();
  for (const t of g.board.values()) {
    if (!t.edges.includes(terr)) continue;
    const kk = key(t.q, t.r); if (seen.has(kk)) continue;
    const region = regionTiles(g, t, terr);
    for (const rk of region) seen.add(rk);
    if (region.size > max) max = region.size;
  }
  return max;
}
function maxTownSize(g) { let m = 0; for (const t of g.board.values()) m = Math.max(m, t.townSize || 0); return m; }
// A connected river that touches both a mountain and the coast = mountains→sea.
function riverMtnToSea(g) {
  const seen = new Set();
  for (const t of g.board.values()) {
    if (!t.edges.includes('water')) continue;
    const kk = key(t.q, t.r); if (seen.has(kk)) continue;
    const region = regionTiles(g, t, 'water');
    for (const rk of region) seen.add(rk);
    let hasMtn = false, hasSea = false;
    for (const rk of region) {
      const rt = g.board.get(rk); if (!rt) continue;
      if (rt.edges.includes('coast')) hasSea = true;
      for (let i = 0; i < 6; i++) {
        const n = neighbor(rt.q, rt.r, i); const nb = g.board.get(key(n.q, n.r));
        if (!nb) continue;
        if (nb.edges.includes('mountain')) hasMtn = true;
        if (nb.edges.includes('coast')) hasSea = true;
      }
    }
    if (hasMtn && hasSea) return true;
  }
  return false;
}
export const JOURNEY = [
  { text: 'Grow a forest of 4 connected tiles', check: g => maxTerrainRegion(g, 'forest') >= 4, reward: 40 },
  { text: 'Raise a town of 4 tiles', check: g => maxTownSize(g) >= 4, reward: 50 },
  { text: 'Wind a river through 5 connected tiles', check: g => maxTerrainRegion(g, 'water') >= 5, reward: 60 },
  { text: 'Build 2 landmarks', check: g => (g.landmarksPlaced || 0) >= 2, reward: 70 },
  { text: 'Make a town prosper (food, water & wood near it)', check: g => Object.keys(g.prosperousTowns || {}).length >= 1, reward: 90 },
  { text: 'Carry a river from the mountains to the sea', check: g => riverMtnToSea(g), reward: 130 },
  { text: 'Grow the vale to 60 tiles', check: g => (g.placed || 0) >= 60, reward: 110 },
];
export function journeyCurrent(g) { return (g.mode === 'journey' && (g.journeyIdx || 0) < JOURNEY.length) ? JOURNEY[g.journeyIdx || 0] : null; }
export const JOURNEY_PALETTE = ['forest', 'field', 'water', 'village', 'mountain', 'coast', 'fae'];

// Building-density tier from a tile's town size (0 cottage … 3 town).
export function townTier(townSize) {
  if (!townSize || townSize <= 1) return 0;
  if (townSize <= 3) return 1;
  if (townSize <= 6) return 2;
  return 3;
}

// ---- procedural place names ----
const NAME_PREFIX = ['Old', 'Green', 'Misty', 'Silver', 'Raven', 'Bram', 'Thorn',
  'Wynn', 'Ash', 'Elder', 'Fern', 'Stone', 'Dun', 'Mar', 'Wic', 'Bel', 'Cor',
  'Hart', 'Oak', 'Wren', 'Black', 'White', 'Gold', 'Mire'];
const NAME_SUFFIX = {
  forest: ['Forest', 'Wood', 'Wilds', 'Thicket'],
  field: ['Fields', 'Meadow', 'Downs', 'Heath'],
  water: ['River', 'Brook', 'Lake', 'Mere'],
  village: ['ton', 'bury', 'ham', 'stead', 'brook', 'field'],
  mountain: ['Peaks', 'Tor', 'Crags', 'Fells'],
  fae: ['Hollow', 'Ring', 'Glimmer', 'Reach'],
  coast: ['Coast', 'Bay', 'Shoals', 'Strand'],
  moor: ['Moor', 'Heath', 'Wold', 'Reach'],
  marsh: ['Marsh', 'Mire', 'Fen', 'Bog'],
  orchard: ['Orchard', 'Grove', 'Vineyard', 'Garth'],
  ruins: ['Ruins', 'Barrows', 'Hallow', 'Stones'],
};
const NAME_MIN = { forest: 4, field: 4, water: 4, mountain: 3, fae: 3, coast: 3, moor: 4, marsh: 3, orchard: 3, ruins: 2 };
const NATURE_TERRAINS = ['water', 'forest', 'field', 'mountain', 'fae', 'coast', 'moor', 'marsh', 'orchard', 'ruins'];

function nameFor(terrain, seed) {
  seed = seed >>> 0;
  const pre = NAME_PREFIX[seed % NAME_PREFIX.length];
  const suf = NAME_SUFFIX[terrain][(seed >>> 5) % NAME_SUFFIX[terrain].length];
  return terrain === 'village' ? pre + suf : pre + ' ' + suf;
}

// Assign hand-lettered place names to large regions (and towns). Stored on the
// region's centroid tile as { label, labelKind } for the renderer.
export function updateLabels(g) {
  for (const t of g.board.values()) { t.label = null; }
  // towns (use the village-region data from updateTowns)
  for (const t of g.board.values()) {
    if (t.townCenter && (t.townSize || 0) >= 3) {
      t.label = nameFor('village', regionSeedAt(g, t, 'village'));
      t.labelKind = 'village';
    }
  }
  // natural features
  const seenByTerr = {};
  for (const terr of NATURE_TERRAINS) seenByTerr[terr] = new Set();
  for (const t of g.board.values()) {
    for (const terr of NATURE_TERRAINS) {
      if (!t.edges.includes(terr)) continue;
      const tk = key(t.q, t.r);
      if (seenByTerr[terr].has(tk)) continue;
      const region = regionTiles(g, t, terr);
      let minId = Infinity, cq = 0, cr = 0;
      for (const rk of region) { seenByTerr[terr].add(rk); const tt = g.board.get(rk); cq += tt.q; cr += tt.r; const id = tt.q * 10000 + tt.r; if (id < minId) minId = id; }
      if (region.size < (NAME_MIN[terr] || 4)) continue;
      // centroid tile of the region
      cq /= region.size; cr /= region.size;
      let best = null, bestD = Infinity;
      for (const rk of region) { const tt = g.board.get(rk); const d = (tt.q - cq) ** 2 + (tt.r - cr) ** 2; if (d < bestD && !tt.label) { bestD = d; best = tt; } }
      if (best) { best.label = nameFor(terr, (minId >>> 0)); best.labelKind = terr; }
    }
  }
}

function regionSeedAt(g, seed, terrain) {
  let minId = Infinity;
  for (const rk of regionTiles(g, seed, terrain)) { const tt = g.board.get(rk); const id = tt.q * 10000 + tt.r; if (id < minId) minId = id; }
  return (minId >>> 0);
}

// Live progress for HUD: refresh region sizes on active quests.
export function refreshQuestProgress(g) {
  for (const qd of g.quests) {
    if (qd.done) continue;
    const seed = g.board.get(key(qd.q, qd.r));
    qd.size = seed ? regionTiles(g, seed, qd.terrain).size : 0;
  }
}
