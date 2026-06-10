// Terrain types + procedural tile generation.
// A tile is { edges: [t0..t5] } where each edge is a terrain id.
// Edges are arranged in contiguous runs so tiles look like real terrain
// (a forest takes up a wedge, a river crosses, etc.) rather than confetti.

export const TERRAIN = {
  forest:   { id: 'forest',   name: 'Forest',   c1: '#3f7d3a', c2: '#2c5a2a' },
  field:    { id: 'field',    name: 'Field',    c1: '#cdb24a', c2: '#a98f33' },
  water:    { id: 'water',    name: 'River',    c1: '#3d86c2', c2: '#2c6396' },
  village:  { id: 'village',  name: 'Village',  c1: '#c2683d', c2: '#8f4a2a' },
  mountain: { id: 'mountain', name: 'Mountain', c1: '#8a8f99', c2: '#5e636d' },
  fae:      { id: 'fae',      name: 'Fae Ring', c1: '#9d5bd0', c2: '#6f3aa0' },
  coast:    { id: 'coast',    name: 'Coast',    c1: '#2f8fb0', c2: '#1f6e90' },
  moor:     { id: 'moor',     name: 'Moor',     c1: '#9a6f9e', c2: '#6e5070' },
  marsh:    { id: 'marsh',    name: 'Marsh',    c1: '#5f7a52', c2: '#42583a' },
  orchard:  { id: 'orchard',  name: 'Orchard',  c1: '#6fae5a', c2: '#52823f' },
  ruins:    { id: 'ruins',    name: 'Ruins',    c1: '#8a9080', c2: '#5e6356' },
};

export const TERRAIN_ORDER = ['forest', 'field', 'water', 'village', 'mountain', 'fae', 'coast', 'moor', 'marsh', 'orchard', 'ruins'];

// Biomes gate which terrains appear. Base run uses the first three; more
// unlock as the player crosses score thresholds (see meta.js).
export const BASE_TERRAINS = ['forest', 'field', 'water', 'village'];

// Landmark tiles: rare special tiles with a central structure and a preferred
// terrain. Placing one pays a flat bonus + synergy for each preferred edge.
export const LANDMARKS = {
  castle:     { name: 'Castle',     prefers: 'village' },
  windmill:   { name: 'Windmill',   prefers: 'field' },
  lighthouse: { name: 'Lighthouse', prefers: 'water' },
  shrine:     { name: 'Fae Shrine', prefers: 'fae' },
  watchtower: { name: 'Watchtower', prefers: 'mountain' },
  harbor:     { name: 'Harbor',     prefers: 'coast' },
  henge:      { name: 'Stone Henge', prefers: 'moor' },
  witchhut:   { name: "Witch's Hut", prefers: 'marsh' },
  press:      { name: 'Cider Press', prefers: 'orchard' },
  monolith:   { name: 'Monolith',   prefers: 'ruins' },
  // Fortress against the blight. Never generated randomly — only offered into
  // the queue by the game when Blighthearts threaten the vale (Warden mode).
  wardtower:  { name: 'Wardtower',   prefers: 'mountain', noRandom: true },
};
const LANDMARK_CHANCE = 0.08;

// Rotate a tile's edges clockwise by `n` steps (returns a new edges array).
export function rotate(edges, n) {
  const len = edges.length;
  const out = new Array(len);
  for (let i = 0; i < len; i++) out[(i + n) % len] = edges[i];
  return out;
}

// Deterministic-ish RNG hook so the rest of the game can stay seedable later.
let rng = Math.random;
export function setRng(fn) { rng = fn; }
const rand = () => rng();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// Generate a tile from the given terrain palette. We lay down 1-3 contiguous
// runs around the 6 edges. ~25% of tiles are a single-terrain "pure" tile,
// which are the satisfying ones for closing off regions.
export function makeTile(palette) {
  const r = rand();
  let runs;
  if (r < 0.22) runs = 1;
  else if (r < 0.7) runs = 2;
  else runs = 3;

  // Choose distinct terrains for each run.
  const chosen = [];
  const pool = palette.slice();
  for (let i = 0; i < runs && pool.length; i++) {
    const idx = Math.floor(rand() * pool.length);
    chosen.push(pool.splice(idx, 1)[0]);
  }
  while (chosen.length < runs) chosen.push(pick(palette));

  // Random run lengths summing to 6.
  const lengths = splitInto(6, runs);
  const edges = new Array(6);
  let e = Math.floor(rand() * 6); // random starting edge for rotation variety
  for (let i = 0; i < runs; i++) {
    for (let j = 0; j < lengths[i]; j++) {
      edges[e % 6] = chosen[i];
      e++;
    }
  }

  const tile = { edges };

  // Occasionally promote to a landmark whose preferred terrain is in-palette.
  if (rand() < LANDMARK_CHANCE) {
    const options = Object.keys(LANDMARKS).filter(l => !LANDMARKS[l].noRandom && palette.includes(LANDMARKS[l].prefers));
    if (options.length) {
      const lm = options[Math.floor(rand() * options.length)];
      tile.landmark = lm;
      // Bias most edges toward the preferred terrain so it reads as a hub.
      const pref = LANDMARKS[lm].prefers;
      const keep = 2 + Math.floor(rand() * 2); // leave 2-3 edges as-is for variety
      for (let i = 0; i < 6 - keep; i++) edges[Math.floor(rand() * 6)] = pref;
    }
  }
  return tile;
}

// Always produce a landmark tile (any randomly-eligible Wonder for the palette).
// Used to guarantee an early landmark so the opening has a "wonder" moment.
export function makeLandmarkTile(palette) {
  const t = makeTile(palette);
  const options = Object.keys(LANDMARKS).filter(l => !LANDMARKS[l].noRandom && palette.includes(LANDMARKS[l].prefers));
  if (!options.length) return t;
  const lm = options[Math.floor(rand() * options.length)];
  t.landmark = lm;
  const pref = LANDMARKS[lm].prefers;
  const keep = 2 + Math.floor(rand() * 2);
  for (let i = 0; i < 6 - keep; i++) t.edges[Math.floor(rand() * 6)] = pref;
  return t;
}

// Split `total` into `parts` positive integers (roughly even, randomized).
function splitInto(total, parts) {
  const out = new Array(parts).fill(1);
  let remaining = total - parts;
  while (remaining > 0) {
    out[Math.floor(rand() * parts)]++;
    remaining--;
  }
  return out;
}

// Build the starting draw stack for a run.
export function buildStack(size, palette) {
  const stack = [];
  for (let i = 0; i < size; i++) stack.push(makeTile(palette));
  return stack;
}

// The fixed starting tile placed at the origin — a friendly mixed hamlet so
// every terrain has something to attach to early.
export function startingTile() {
  return { edges: ['field', 'village', 'field', 'forest', 'forest', 'water'] };
}

// Draftable opening scenes — the player picks one to begin, for instant agency
// and a more characterful opening board. All use base terrains.
export const START_OPTIONS = [
  { id: 'riverbend',  name: 'Riverbend',  desc: 'A river winds through', edges: ['water', 'field', 'forest', 'water', 'field', 'forest'] },
  { id: 'woodland',   name: 'Woodland',   desc: 'Deep woods & a glade',  edges: ['forest', 'forest', 'field', 'forest', 'forest', 'village'] },
  { id: 'crossroads', name: 'Crossroads', desc: 'Where roads meet',      edges: ['village', 'field', 'village', 'forest', 'village', 'field'] },
];
