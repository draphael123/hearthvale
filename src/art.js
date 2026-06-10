// Painterly tile art for Hearthvale. Each tile is drawn as natural ground
// (grass / wheat / rock / dusk) with scattered props (trees, houses, peaks,
// mushrooms), and "path" terrains — rivers and roads — are drawn as ribbons
// flowing from edge midpoints through the tile center, so matched edges on
// neighboring tiles join into continuous rivers and roads.
//
// Edge i is centered at angle 60*i degrees: 0:E 1:SE 2:SW 3:W 4:NW 5:NE.

const DEG = Math.PI / 180;
const APO = Math.sqrt(3) / 2; // apothem / size (center -> edge midpoint)

// Ground + accent palette. Grass-family grounds are kept close in hue so the
// seams between forest / village / riverbank read as one soft meadow.
const ART = {
  forest:   { g1: '#5b8a44', g2: '#3f6e30', path: null },
  field:    { g1: '#d9c25a', g2: '#bda23f', path: null },
  water:    { g1: '#6f9a52', g2: '#557e3f', path: 'river' },   // grassy bank, river ribbon on top
  village:  { g1: '#6f9a52', g2: '#557e3f', path: 'road' },    // grass, dirt road + houses
  mountain: { g1: '#9a917f', g2: '#6d6453', path: null },
  fae:      { g1: '#5e4486', g2: '#3d2a5c', path: null },
  coast:    { g1: '#3d9ec6', g2: '#27749b', path: null },      // open sea
  moor:     { g1: '#7c7064', g2: '#5b5247', path: null },      // heathland
  marsh:    { g1: '#5e6e44', g2: '#43502f', path: null },      // murky wetland
  orchard:  { g1: '#6fa64f', g2: '#54863a', path: null },      // tended grass
  ruins:    { g1: '#7f8470', g2: '#5b6050', path: null },      // mossy stone
};

// ---- seeded RNG (mulberry32) so props are stable per tile, not shimmering ----
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashCoord(q, r) {
  return (Math.imul(q, 73856093) ^ Math.imul(r, 19349663) ^ 0x9e3779b9) >>> 0;
}
const rr = (rng, a, b) => a + (b - a) * rng();

function corner(cx, cy, size, k) {
  const a = (60 * k - 30) * DEG;
  return [cx + size * Math.cos(a), cy + size * Math.sin(a)];
}
function edgeMid(cx, cy, size, i) {
  const a = 60 * i * DEG;
  return [cx + size * APO * Math.cos(a), cy + size * APO * Math.sin(a)];
}

function hexPath(ctx, cx, cy, size) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const [x, y] = corner(cx, cy, size, k);
    k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// Convenience: full static tile (base + a still frame of foliage). Used for
// the ghost preview and the HUD "next tile" thumbnail.
export function drawTile(ctx, cx, cy, size, edges, seed, landmark = null, t = 0, town = null) {
  drawTileBase(ctx, cx, cy, size, edges, seed, landmark, town);
  drawStructures(ctx, cx, cy, size, edges, seed, landmark, town);
  drawFoliage(ctx, cx, cy, size, edges, seed, t);
}

// Tall structures — village buildings + the central landmark — drawn LIVE (not
// baked into the cached ground bitmap) so the renderer can stand them upright
// off the foreshortened ground. Deliberately NOT clipped to the hex, so steeples
// and roofs may rise above the tile's top edge.
export function drawStructures(ctx, cx, cy, size, edges, seed, landmark = null, town = null) {
  const rng = makeRng(((seed >>> 0) ^ 0x9e3779b9) >>> 0);
  if (edges.includes('village')) drawVillage(ctx, cx, cy, size, edges, rng, town);
  if (landmark) drawLandmark(ctx, cx, cy, size, landmark, rng);
}

// CACHED layer: ground, texture, ribbons, static props, landmark, soft edge.
// Everything here is frame-independent so it can be rendered once per tile.
// `town` = { tier, center } drives village building density (re-cached when
// the tier changes as the settlement grows).
export function drawTileBase(ctx, cx, cy, size, edges, seed, landmark = null, town = null) {
  const rng = makeRng(seed >>> 0);

  ctx.save();
  hexPath(ctx, cx, cy, size);
  ctx.clip();

  // 1) Ground wedges.
  for (let i = 0; i < 6; i++) {
    const [ax, ay] = corner(cx, cy, size, i);
    const [bx, by] = corner(cx, cy, size, (i + 1) % 6);
    const t = ART[edges[i]] || ART.field;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const g = ctx.createLinearGradient(cx, cy, mx, my);
    g.addColorStop(0, t.g1);
    g.addColorStop(1, t.g2);
    ctx.beginPath();
    ctx.moveTo(cx, cy); ctx.lineTo(ax, ay); ctx.lineTo(bx, by); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
  }

  // 2) Soften the internal seams between DIFFERENT terrains so the tile reads
  // as one painted patch rather than six hard wedges.
  for (let i = 0; i < 6; i++) {
    if (edges[i] === edges[(i + 1) % 6]) continue;
    const [ax, ay] = corner(cx, cy, size, (i + 1) % 6);
    const g = ctx.createLinearGradient(cx, cy, ax, ay);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.10)');
    ctx.strokeStyle = g;
    ctx.lineWidth = size * 0.06;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ax, ay); ctx.stroke();
  }

  // 3) Subtle ground speckle for texture.
  ctx.globalAlpha = 0.1;
  for (let s = 0; s < 14; s++) {
    const ang = rng() * Math.PI * 2, rad = rng() * size * 0.9;
    const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
    ctx.fillStyle = rng() < 0.5 ? '#000' : '#fff';
    ctx.beginPath(); ctx.arc(x, y, size * 0.05, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 4) Path ribbons (rivers, then roads).
  drawRibbons(ctx, cx, cy, size, edges, 'river');
  drawRibbons(ctx, cx, cy, size, edges, 'road');

  // 4b) Boundary structures where terrains interact (bridges, docks, mills).
  drawBoundaries(ctx, cx, cy, size, edges, rng, town);

  // 5) Static props per wedge (peaks, mushrooms, reeds — village handled below).
  for (let i = 0; i < 6; i++) staticProps(ctx, cx, cy, size, edges[i], 60 * i, rng);

  // NB: village buildings + central landmark are NOT baked here — they're drawn
  // LIVE & un-foreshortened (see drawStructures) so they stand up off the tilted
  // ground instead of lying flat on it.

  ctx.restore();

  // Soft outer edge — faint and earthy so adjacent tiles blend into one vale.
  hexPath(ctx, cx, cy, size);
  ctx.lineWidth = Math.max(1, size * 0.02);
  ctx.strokeStyle = 'rgba(22,34,18,0.22)';
  ctx.stroke();
}

// LIVE layer: trees and wheat that sway with the clock. Stable positions
// (own seeded rng), redrawn each frame on top of the cached base.
export function drawFoliage(ctx, cx, cy, size, edges, seed, t = 0, season = 1) {
  const rng = makeRng(((seed >>> 0) ^ 0x9e3779b9) >>> 0);
  // A traveling wind gust sweeps across the vale — foliage leans harder as the
  // gust front passes its position, and gusts swell and die down over time.
  const wind = 1 + 1.15 * Math.sin(t / 700 - cx * 0.018) * Math.max(0, Math.sin(t / 4600));
  ctx.save();
  hexPath(ctx, cx, cy, size);
  ctx.clip();
  for (let i = 0; i < 6; i++) foliageProps(ctx, cx, cy, size, edges[i], 60 * i, rng, t, season, wind);
  ctx.restore();
}

const spotFn = (cx, cy, size, a0, rng) => (rmin, rmax, spread) => {
  const ang = (a0 + rr(rng, -spread, spread)) * DEG;
  const rad = rr(rng, rmin, rmax) * size;
  return [cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad];
};

// Frame-independent props.
function staticProps(ctx, cx, cy, size, terr, a0, rng) {
  const spot = spotFn(cx, cy, size, a0, rng);
  switch (terr) {
    case 'field':
      if (rng() < 0.5) { const [x, y] = spot(0.55, 0.85, 22); fence(ctx, x, y, size, a0); }
      break;
    case 'mountain': {
      const [x, y] = spot(0.4, 0.82, 22); peak(ctx, x, y, size * rr(rng, 0.28, 0.4), rng); break;
    }
    case 'fae': {
      const [gx, gy] = spot(0.3, 0.7, 20);
      const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, size * 0.42);
      glow.addColorStop(0, 'rgba(190,140,255,0.55)');
      glow.addColorStop(1, 'rgba(190,140,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(gx, gy, size * 0.42, 0, Math.PI * 2); ctx.fill();
      if (rng() < 0.8) { const [x, y] = spot(0.45, 0.8, 22); mushroom(ctx, x, y, size * 0.13); }
      break;
    }
    case 'water':
      if (rng() < 0.4) { const [x, y] = spot(0.55, 0.85, 26); reed(ctx, x, y, size * 0.16); }
      break;
    case 'coast': {
      // foam crescents along the outer edge + a stray rock
      ctx.strokeStyle = 'rgba(235,245,255,0.55)'; ctx.lineWidth = size * 0.03; ctx.lineCap = 'round';
      for (let i = 0; i < 2; i++) {
        const [x, y] = spot(0.55, 0.9, 26);
        ctx.beginPath(); ctx.arc(x, y, size * 0.12, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
      }
      if (rng() < 0.3) { const [x, y] = spot(0.4, 0.7, 22); ctx.fillStyle = '#6d6453'; ctx.beginPath(); ctx.ellipse(x, y, size * 0.07, size * 0.05, 0, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'moor': {
      const n = 2 + (rng() < 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) { const [x, y] = spot(0.4, 0.85, 24); heather(ctx, x, y, size, rng); }
      if (rng() < 0.3) { const [x, y] = spot(0.4, 0.75, 20); standingStone(ctx, x, y, size); }
      break;
    }
    case 'marsh': {
      if (rng() < 0.8) { const [x, y] = spot(0.45, 0.85, 26); reed(ctx, x, y, size * 0.18); }
      const n = 1 + (rng() < 0.5 ? 1 : 0);
      for (let k = 0; k < n; k++) { const [x, y] = spot(0.3, 0.7, 24); lilyPad(ctx, x, y, size); }
      break;
    }
    case 'ruins': {
      const n = 1 + (rng() < 0.6 ? 1 : 0);
      for (let k = 0; k < n; k++) { const [x, y] = spot(0.35, 0.8, 24); brokenColumn(ctx, x, y, size, rng); }
      // moss/ivy specks
      ctx.fillStyle = 'rgba(90,130,60,0.5)';
      for (let k = 0; k < 4; k++) { const [x, y] = spot(0.3, 0.85, 28); ctx.beginPath(); ctx.arc(x, y, size * 0.04, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
  }
}

function heather(ctx, x, y, size, rng) {
  const s = size * 0.1;
  ctx.fillStyle = rng() < 0.5 ? '#a86fb0' : '#8d5fa0';
  for (let i = 0; i < 5; i++) {
    const a = i * 1.3;
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * s, y + Math.sin(a) * s * 0.7, s * 0.4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = '#4f5a3a'; ctx.lineWidth = Math.max(1, size * 0.02);
  ctx.beginPath(); ctx.moveTo(x, y + s); ctx.lineTo(x, y - s * 0.3); ctx.stroke();
}

function standingStone(ctx, x, y, size) {
  const s = size * 0.2;
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(x, y + s * 0.5, s * 0.55, s * 0.16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8a8578';
  ctx.beginPath(); ctx.moveTo(x - s * 0.3, y + s * 0.5); ctx.lineTo(x - s * 0.22, y - s * 0.7); ctx.lineTo(x + s * 0.22, y - s * 0.7); ctx.lineTo(x + s * 0.3, y + s * 0.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#9c978a'; ctx.fillRect(x - s * 0.18, y - s * 0.7, s * 0.16, s);
}

function lilyPad(ctx, x, y, size) {
  const s = size * 0.13;
  ctx.fillStyle = '#4f7a3f';
  ctx.beginPath(); ctx.arc(x, y, s, 0.5, Math.PI * 2 + 0.1); ctx.lineTo(x, y); ctx.closePath(); ctx.fill();
  if (Math.abs((x + y) % 3) < 1) { ctx.fillStyle = '#e8d2e0'; ctx.beginPath(); ctx.arc(x - s * 0.2, y - s * 0.2, s * 0.3, 0, Math.PI * 2); ctx.fill(); }
}

function brokenColumn(ctx, x, y, size, rng) {
  const s = size * 0.22, h = s * (0.7 + rng() * 0.7);
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(x, y + s * 0.4, s * 0.5, s * 0.15, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#cdc7b4'; ctx.fillRect(x - s * 0.22, y - h, s * 0.44, h + s * 0.4);
  ctx.fillStyle = '#b3ad9a'; ctx.fillRect(x - s * 0.22, y - h, s * 0.1, h + s * 0.4); // shaded flute
  // broken jagged top
  ctx.fillStyle = ART.ruins.g2;
  ctx.beginPath(); ctx.moveTo(x - s * 0.22, y - h); ctx.lineTo(x - s * 0.05, y - h + s * 0.12); ctx.lineTo(x + s * 0.1, y - h - s * 0.05); ctx.lineTo(x + s * 0.22, y - h + s * 0.1); ctx.lineTo(x + s * 0.22, y - h); ctx.closePath(); ctx.fill();
  // ivy
  ctx.strokeStyle = '#5a8a3a'; ctx.lineWidth = Math.max(1, size * 0.018);
  ctx.beginPath(); ctx.moveTo(x + s * 0.1, y + s * 0.3); ctx.quadraticCurveTo(x - s * 0.1, y - h * 0.3, x + s * 0.05, y - h * 0.7); ctx.stroke();
}

// Swaying props.
function foliageProps(ctx, cx, cy, size, terr, a0, rng, t, season = 1, wind = 1) {
  const spot = spotFn(cx, cy, size, a0, rng);
  if (terr === 'forest') {
    const n = 2 + (rng() < 0.5 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const [x, y] = spot(0.42, 0.86, 24);
      const r = size * rr(rng, 0.16, 0.22);
      const sway = Math.sin(t / 680 + x * 0.05) * r * 0.28 * wind;
      tree(ctx, x, y, r, rng, sway, season);
    }
  } else if (terr === 'field') {
    // wheat is golden in summer/autumn, sparse green sprouts in spring, bare in winter
    if (season !== 3) { const [x, y] = spot(0.5, 0.7, 12); wheat(ctx, x, y, size, a0, t, season, wind); }
  } else if (terr === 'orchard') {
    // a neat little row of fruit trees (seasonal foliage)
    const ang = a0 * DEG, ux = Math.cos(ang), uy = Math.sin(ang), px = -uy, py = ux;
    const bx = cx + ux * size * 0.55, by = cy + uy * size * 0.55;
    for (let k = -1; k <= 1; k++) {
      const x = bx + px * k * size * 0.26, y = by + py * k * size * 0.26;
      const r = size * 0.13;
      const sway = Math.sin(t / 720 + x * 0.06) * r * 0.22 * wind;
      fruitTree(ctx, x, y, r, sway, season);
    }
  }
}

// A small, tidy orchard tree — blossoms in spring, fruit in summer/autumn.
function fruitTree(ctx, x, y, r, sway, season) {
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.8, r * 0.5, r * 0.18, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#6e4a2c'; ctx.fillRect(x - r * 0.1, y, r * 0.2, r * 0.6);
  if (season === 3) {
    ctx.strokeStyle = '#6e4a2c'; ctx.lineWidth = r * 0.12; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sway, y - r * 0.5); ctx.moveTo(x, y); ctx.lineTo(x + sway - r * 0.3, y - r * 0.4); ctx.stroke();
    return;
  }
  ctx.fillStyle = 'rgba(245,240,224,0.5)';   // paper cut-out rim
  ctx.beginPath(); ctx.arc(x + sway, y - r * 0.4, r * 0.7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3f7a35';
  ctx.beginPath(); ctx.arc(x + sway, y - r * 0.4, r * 0.62, 0, Math.PI * 2); ctx.fill();
  const dot = season === 0 ? '#f7c6dd' : (season === 2 ? '#d24b3e' : '#e8a93e'); // blossom / apples / fruit
  ctx.fillStyle = dot;
  for (let i = 0; i < 4; i++) { const a = i * 1.7; ctx.beginPath(); ctx.arc(x + sway + Math.cos(a) * r * 0.4, y - r * 0.4 + Math.sin(a) * r * 0.4, r * 0.12, 0, Math.PI * 2); ctx.fill(); }
}

// Draw a river ('river') or road ('road') connecting all matching edges
// through the tile center. Two collinear edges become one smooth through-line.
function drawRibbons(ctx, cx, cy, size, edges, kind) {
  const ids = [];
  for (let i = 0; i < 6; i++) {
    const p = (ART[edges[i]] || {}).path;
    if (p === kind) ids.push(i);
  }
  if (ids.length === 0) return;

  const isRiver = kind === 'river';
  const width = size * (isRiver ? 0.34 : 0.26);
  const mids = ids.map(i => edgeMid(cx, cy, size, i));

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const stroke = (w, color) => {
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    ctx.beginPath();
    if (mids.length === 2) {
      ctx.moveTo(mids[0][0], mids[0][1]);
      ctx.quadraticCurveTo(cx, cy, mids[1][0], mids[1][1]);
    } else {
      for (const m of mids) { ctx.moveTo(cx, cy); ctx.lineTo(m[0], m[1]); }
      // little hub so 1 or 3+ branches look intentional
      ctx.moveTo(cx + w * 0.01, cy);
    }
    ctx.stroke();
    if (mids.length !== 2 && mids.length >= 1) {
      ctx.beginPath(); ctx.arc(cx, cy, w * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
    }
  };

  if (isRiver) {
    stroke(width + size * 0.06, '#2c5f86');   // dark water edge
    stroke(width, '#3f86c2');                 // water body
    stroke(width * 0.45, '#7cb6e0');          // bright center glint
  } else {
    stroke(width + size * 0.05, '#5b4326');   // road shoulder
    stroke(width, '#b08a55');                 // dirt road
    stroke(width * 0.4, '#cda770');           // worn center
  }
  ctx.restore();
}

// ---- individual props (drawn around a local anchor) ----
// `sway` shifts the canopy horizontally for idle wind motion (trunk stays put).
// season: 0 spring (blossom), 1 summer (green), 2 autumn (amber), 3 winter (bare+snow).
// ---- moving sun: prop shadows sweep + stretch with the time of day ----
// SUN.dx/dy = shadow direction (screen), len = length factor, alpha = darkness.
let SUN = { dx: 0.34, dy: 0.94, len: 0.8, alpha: 1 };
export function setSun(dx, dy, len, alpha) {
  const m = Math.hypot(dx, dy) || 1;
  SUN = { dx: dx / m, dy: dy / m, len, alpha };
}
// A soft ground shadow cast in the sun's direction, stretched as the sun lowers.
function propShadow(ctx, x, baseY, radius, baseAlpha) {
  const L = radius * SUN.len;
  const ang = Math.atan2(SUN.dy, SUN.dx);
  ctx.save();
  ctx.translate(x + SUN.dx * L * 0.7, baseY + SUN.dy * L * 0.4);
  ctx.rotate(ang);
  ctx.fillStyle = `rgba(0,0,0,${baseAlpha * SUN.alpha})`;
  ctx.beginPath(); ctx.ellipse(0, 0, radius * (0.55 + SUN.len * 0.7), radius * 0.24, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function tree(ctx, x, y, r, rng, sway = 0, season = 1) {
  // directional cast shadow that sweeps + stretches with the sun
  propShadow(ctx, x, y + r * 0.78, r * 0.6, 0.2);
  // trunk
  ctx.fillStyle = '#5a3d22';
  ctx.fillRect(x - r * 0.12, y, r * 0.24, r * 0.7);

  if (season === 3) {
    // winter: bare branches + snow
    ctx.strokeStyle = '#5a3d22'; ctx.lineWidth = r * 0.12; ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath(); ctx.moveTo(x, y - r * 0.1);
      ctx.lineTo(x + sway * 0.5 + i * r * 0.45, y - r * 0.7); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(240,245,250,0.9)';
    ctx.beginPath(); ctx.ellipse(x + sway * 0.4, y - r * 0.6, r * 0.5, r * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    return;
  }

  // Paper cut-out rim: a pale edge just behind the canopy silhouette so the
  // tree reads as a standing piece of cardstock (pop-up diorama).
  ctx.fillStyle = 'rgba(245,240,224,0.5)';
  for (let i = 0; i < 5; i++) {
    const ang = i / 5 * Math.PI * 2;
    const ox = Math.cos(ang) * r * 0.46 + sway * 0.5, oy = Math.sin(ang) * r * 0.32 - r * 0.32;
    ctx.beginPath(); ctx.arc(x + ox, y + oy, r * 0.58, 0, Math.PI * 2); ctx.fill();
  }
  // Fuller, layered crown: a darker base ring, a green mid mass, then highlights.
  const baseCol = season === 2 ? '#9a5a1c' : '#275824';
  const midCol = season === 2 ? '#c17a2a' : '#3a7a33';
  const hiCol = season === 2 ? '#e2aa55' : '#6fb04a';
  for (let i = 0; i < 5; i++) {
    const ang = i / 5 * Math.PI * 2;
    const ox = Math.cos(ang) * r * 0.46 + sway * 0.5, oy = Math.sin(ang) * r * 0.32 - r * 0.32;
    ctx.fillStyle = baseCol;
    ctx.beginPath(); ctx.arc(x + ox, y + oy, r * 0.5, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 3; i++) {
    const ox = (i - 1) * r * 0.42 + sway, oy = -r * 0.42 - (i === 1 ? r * 0.22 : 0);
    ctx.fillStyle = midCol;
    ctx.beginPath(); ctx.arc(x + ox, y + oy, r * 0.52, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = hiCol;
  ctx.beginPath(); ctx.arc(x - r * 0.16 + sway, y - r * 0.64, r * 0.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = season === 2 ? 'rgba(248,214,150,0.55)' : 'rgba(175,222,135,0.55)';
  ctx.beginPath(); ctx.arc(x + r * 0.24 + sway, y - r * 0.5, r * 0.15, 0, Math.PI * 2); ctx.fill();
  if (season === 0) {
    // spring blossoms — pink dots
    ctx.fillStyle = 'rgba(247,198,221,0.95)';
    for (let i = 0; i < 5; i++) {
      const ang = i * 1.7, rr2 = r * 0.5;
      ctx.beginPath(); ctx.arc(x + sway + Math.cos(ang) * rr2, y - r * 0.4 + Math.sin(ang) * rr2 * 0.7, r * 0.1, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// A little tuft of wheat stalks whose tips bend with the wind.
function wheat(ctx, x, y, size, a0, t, season = 1, wind = 1) {
  ctx.strokeStyle = season === 0 ? '#7fae58' : '#b89a3c';
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.lineCap = 'round';
  const h = size * 0.3;
  for (let i = -2; i <= 2; i++) {
    const bx = x + i * size * 0.07;
    const bend = Math.sin(t / 520 + i * 0.7 + x * 0.04) * size * 0.06 * wind;
    ctx.beginPath();
    ctx.moveTo(bx, y + h * 0.4);
    ctx.quadraticCurveTo(bx + bend * 0.5, y - h * 0.1, bx + bend, y - h * 0.6);
    ctx.stroke();
    // grain head (golden in summer, deeper amber in autumn; none in spring)
    if (season !== 0) {
      ctx.fillStyle = season === 2 ? '#caa23f' : '#d8c25a';
      ctx.beginPath(); ctx.arc(bx + bend, y - h * 0.6, size * 0.035, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// Building palettes — varied so a growing town reads as many distinct homes.
const WALLS = ['#e6d6b8', '#dcc6a0', '#ece2cc', '#cdbf9e', '#d9c4a4', '#e3d2b0'];
const ROOFS = ['#b14f33', '#9c4429', '#7c5a3c', '#6f8190', '#a8732f', '#8a6550'];
// Multiply a #rrggbb colour by f (clamped) — for lit/shaded faces of a 3D box.
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

// A 3D cottage: front wall + a shaded right side face + a two-slope roof, lit
// from the upper-left so it reads as a solid box casting a directional shadow.
function house(ctx, x, y, s, rng) {
  const ww = s, wh = s * 0.8;
  const dx = s * 0.26, dy = -s * 0.2;            // depth vector: back is up-right
  const wall = WALLS[(rng() * WALLS.length) | 0];
  const roof = ROOFS[(rng() * ROOFS.length) | 0];
  const eave = y - wh * 0.1, base = y + wh * 0.9;
  const apexX = x, apexY = y - wh * 0.72;
  propShadow(ctx, x, base - s * 0.02, ww * 0.62, 0.22);
  // paper cut-out rim behind the cottage silhouette
  {
    const m = s * 0.09;
    ctx.fillStyle = 'rgba(245,240,224,0.5)';
    ctx.fillRect(x - ww / 2 - m, eave - m, ww + dx + 2 * m, wh + 2 * m);
    ctx.beginPath(); ctx.moveTo(x - ww * 0.62 - m, eave); ctx.lineTo(apexX, apexY - m * 1.4); ctx.lineTo(x + ww * 0.62 + dx + m, eave + dy); ctx.closePath(); ctx.fill();
  }
  // right side wall (depth)
  ctx.fillStyle = shade(wall, 0.7);
  ctx.beginPath();
  ctx.moveTo(x + ww / 2, eave); ctx.lineTo(x + ww / 2 + dx, eave + dy);
  ctx.lineTo(x + ww / 2 + dx, base + dy); ctx.lineTo(x + ww / 2, base);
  ctx.closePath(); ctx.fill();
  // front wall (lit)
  ctx.fillStyle = wall; ctx.fillRect(x - ww / 2, eave, ww, wh);
  // door + a small window
  ctx.fillStyle = '#5a3d22'; ctx.fillRect(x - ww * 0.12, y + wh * 0.32, ww * 0.24, wh * 0.58);
  ctx.fillStyle = 'rgba(120,92,52,0.85)'; ctx.fillRect(x + ww * 0.18, eave + wh * 0.16, ww * 0.18, wh * 0.2);
  // right roof slope (shaded)
  ctx.fillStyle = shade(roof, 0.72);
  ctx.beginPath();
  ctx.moveTo(x + ww * 0.62, eave); ctx.lineTo(apexX, apexY);
  ctx.lineTo(apexX + dx, apexY + dy); ctx.lineTo(x + ww * 0.62 + dx, eave + dy);
  ctx.closePath(); ctx.fill();
  // front gable roof (lit)
  ctx.fillStyle = roof;
  ctx.beginPath(); ctx.moveTo(x - ww * 0.62, eave); ctx.lineTo(apexX, apexY); ctx.lineTo(x + ww * 0.62, eave); ctx.closePath(); ctx.fill();
  // ridge highlight
  ctx.strokeStyle = shade(roof, 1.2); ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath(); ctx.moveTo(apexX, apexY); ctx.lineTo(apexX + dx, apexY + dy); ctx.stroke();
}

// A taller two-storey townhouse for denser settlements — same 3D treatment.
function townhouse(ctx, x, y, s, rng) {
  const w = s * 0.82, h = s * 1.05;
  const dx = s * 0.24, dy = -s * 0.18;
  const wall = WALLS[(rng() * WALLS.length) | 0];
  const roof = ROOFS[(rng() * ROOFS.length) | 0];
  const top = y - h * 0.42, base = y + h * 0.6;
  const apexX0 = x, apexY0 = top - h * 0.32;
  propShadow(ctx, x, base, w * 0.56, 0.22);
  // paper cut-out rim behind the townhouse silhouette
  {
    const m = s * 0.09;
    ctx.fillStyle = 'rgba(245,240,224,0.5)';
    ctx.fillRect(x - w / 2 - m, top - m, w + dx + 2 * m, h * 1.02 + 2 * m);
    ctx.beginPath(); ctx.moveTo(x - w * 0.6 - m, top); ctx.lineTo(apexX0, apexY0 - m * 1.4); ctx.lineTo(x + w * 0.6 + dx + m, top + dy); ctx.closePath(); ctx.fill();
  }
  // side face
  ctx.fillStyle = shade(wall, 0.68);
  ctx.beginPath();
  ctx.moveTo(x + w / 2, top); ctx.lineTo(x + w / 2 + dx, top + dy);
  ctx.lineTo(x + w / 2 + dx, base + dy); ctx.lineTo(x + w / 2, base);
  ctx.closePath(); ctx.fill();
  // front
  ctx.fillStyle = wall; ctx.fillRect(x - w / 2, top, w, h * 1.02);
  ctx.fillStyle = 'rgba(106,84,54,0.9)';
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++)
    ctx.fillRect(x - w * 0.3 + c * w * 0.38, y - h * 0.3 + r * h * 0.42, w * 0.22, h * 0.24);
  // right roof slope + front gable
  const apexX = x, apexY = top - h * 0.32;
  ctx.fillStyle = shade(roof, 0.72);
  ctx.beginPath(); ctx.moveTo(x + w * 0.6, top); ctx.lineTo(apexX, apexY); ctx.lineTo(apexX + dx, apexY + dy); ctx.lineTo(x + w * 0.6 + dx, top + dy); ctx.closePath(); ctx.fill();
  ctx.fillStyle = roof;
  ctx.beginPath(); ctx.moveTo(x - w * 0.6, top); ctx.lineTo(apexX, apexY); ctx.lineTo(x + w * 0.6, top); ctx.closePath(); ctx.fill();
}

// Town church with a steeple — the centerpiece of a grown settlement.
function church(ctx, x, y, s, rng) {
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(x, y + s * 0.5, s * 0.6, s * 0.16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8dcc0'; ctx.fillRect(x - s * 0.28, y - s * 0.1, s * 0.56, s * 0.5);
  ctx.fillStyle = '#7a5a3a';
  ctx.beginPath(); ctx.moveTo(x - s * 0.34, y - s * 0.1); ctx.lineTo(x, y - s * 0.34); ctx.lineTo(x + s * 0.34, y - s * 0.1); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ddd0b4'; ctx.fillRect(x - s * 0.1, y - s * 0.5, s * 0.2, s * 0.6);
  ctx.fillStyle = '#5b3f2a';
  ctx.beginPath(); ctx.moveTo(x - s * 0.1, y - s * 0.5); ctx.lineTo(x, y - s * 0.82); ctx.lineTo(x + s * 0.1, y - s * 0.5); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#caa84a'; ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath(); ctx.moveTo(x, y - s * 0.82); ctx.lineTo(x, y - s * 0.95); ctx.moveTo(x - s * 0.05, y - s * 0.9); ctx.lineTo(x + s * 0.05, y - s * 0.9); ctx.stroke();
}

// A stone well / town square centerpiece for mid-size settlements.
function well(ctx, x, y, s) {
  const w = s * 0.36;
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath(); ctx.ellipse(x, y + w * 0.4, w * 0.7, w * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#9a8d78'; ctx.beginPath(); ctx.ellipse(x, y, w * 0.5, w * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#5a3d22'; ctx.lineWidth = Math.max(1, s * 0.03);
  ctx.beginPath(); ctx.moveTo(x - w * 0.4, y); ctx.lineTo(x - w * 0.4, y - w * 0.7); ctx.moveTo(x + w * 0.4, y); ctx.lineTo(x + w * 0.4, y - w * 0.7); ctx.stroke();
  ctx.fillStyle = '#8a5a34';
  ctx.beginPath(); ctx.moveTo(x - w * 0.6, y - w * 0.6); ctx.lineTo(x, y - w * 0.95); ctx.lineTo(x + w * 0.6, y - w * 0.6); ctx.closePath(); ctx.fill();
}

// A market stall with a striped awning — brings market-day colour to a town.
function marketStall(ctx, x, y, s, rng) {
  const w = s * 0.5, h = s * 0.34;
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.ellipse(x + s * 0.05, y + h * 0.72, w * 0.7, s * 0.11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#6e4a2c'; ctx.lineWidth = Math.max(1, s * 0.04); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - w * 0.5, y + h * 0.6); ctx.lineTo(x - w * 0.5, y - h * 0.2); ctx.moveTo(x + w * 0.5, y + h * 0.6); ctx.lineTo(x + w * 0.5, y - h * 0.2); ctx.stroke();
  ctx.fillStyle = '#8a5a34'; ctx.fillRect(x - w * 0.5, y + h * 0.2, w, h * 0.42);
  const c1 = ['#c0392b', '#2e6da4', '#2e8b57'][(rng() * 3) | 0], c2 = '#f0e9d8';
  const aw = w * 1.18, ax = x - aw / 2, ay = y - h * 0.5;
  for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? c1 : c2; ctx.fillRect(ax + i * aw / 5, ay, aw / 5 + 0.5, h * 0.34); }
  ctx.fillStyle = c1;
  for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(ax + (i + 0.5) * aw / 5, ay + h * 0.34, aw / 10, 0, Math.PI); ctx.fill(); }
  for (let i = 0; i < 3; i++) { ctx.fillStyle = ['#d98a3a', '#7cae3a', '#c0392b'][i]; ctx.beginPath(); ctx.arc(x - w * 0.28 + i * w * 0.28, y + h * 0.28, s * 0.04, 0, Math.PI * 2); ctx.fill(); }
}

// A small fenced vegetable garden — domestic detail around a settled town.
function gardenPlot(ctx, x, y, s) {
  const w = s * 0.5, h = s * 0.3;
  ctx.fillStyle = '#6a4a2a'; ctx.fillRect(x - w / 2, y - h / 2, w, h);
  for (let r = 0; r < 3; r++) { ctx.strokeStyle = r % 2 ? '#5b8c3a' : '#74b04a'; ctx.lineWidth = Math.max(1, s * 0.03); ctx.beginPath(); ctx.moveTo(x - w * 0.4, y - h * 0.3 + r * h * 0.3); ctx.lineTo(x + w * 0.4, y - h * 0.3 + r * h * 0.3); ctx.stroke(); }
  ctx.strokeStyle = '#8a6a44'; ctx.lineWidth = Math.max(1, s * 0.02); ctx.strokeRect(x - w / 2, y - h / 2, w, h);
}

// A tall pennant banner — flies over a proud, walled town.
function banner(ctx, x, y, s, rng) {
  ctx.strokeStyle = '#5a4630'; ctx.lineWidth = Math.max(1, s * 0.03); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - s * 0.52); ctx.stroke();
  ctx.fillStyle = ['#b23b3b', '#2e6da4', '#caa84a', '#3b8b5a'][(rng() * 4) | 0];
  ctx.beginPath(); ctx.moveTo(x, y - s * 0.52); ctx.lineTo(x + s * 0.24, y - s * 0.44); ctx.lineTo(x, y - s * 0.36); ctx.closePath(); ctx.fill();
}

// A simple post-and-rail fence in a field.
function fence(ctx, x, y, size, a0) {
  const dir = (a0 + 90) * DEG, dx = Math.cos(dir), dy = Math.sin(dir);
  const L = size * 0.32;
  ctx.strokeStyle = '#6e5836'; ctx.lineWidth = Math.max(1, size * 0.024); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - dx * L / 2, y - dy * L / 2); ctx.lineTo(x + dx * L / 2, y + dy * L / 2); ctx.stroke();
  for (let i = -2; i <= 2; i++) {
    const px = x + dx * i * L * 0.24, py = y + dy * i * L * 0.24;
    ctx.beginPath(); ctx.moveTo(px, py - size * 0.05); ctx.lineTo(px, py + size * 0.05); ctx.stroke();
  }
}

// Structures where terrains interact: a bridge where a road crosses a river,
// else a dock / watermill where a village meets water.
function drawBoundaries(ctx, cx, cy, size, edges, rng, town) {
  const water = [], road = [];
  for (let i = 0; i < 6; i++) { if (edges[i] === 'water') water.push(i); if (edges[i] === 'village') road.push(i); }
  if (water.length === 0 || road.length === 0) return;
  const mid = (i) => { const a = 60 * i * DEG; return [cx + size * APO * Math.cos(a), cy + size * APO * Math.sin(a)]; };

  if (water.length >= 2 && road.length >= 1) {
    const a = road.length >= 2 ? mid(road[0]) : [cx, cy];
    const b = road.length >= 2 ? mid(road[1]) : mid(road[0]);
    bridge(ctx, cx, cy, size, a, b);
  } else {
    const wm = mid(water[0]);
    if (town && town.center) watermill(ctx, cx, cy, size, wm, rng);
    else dock(ctx, cx, cy, size, wm);
  }
}

function bridge(ctx, cx, cy, size, a, b) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
  const L = size * 0.74, W = size * 0.28;
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(-L / 2, -W / 2 + size * 0.03, L, W);
  ctx.fillStyle = '#7a5230'; ctx.fillRect(-L / 2, -W / 2, L, W);
  ctx.fillStyle = '#5a3d22';
  for (let i = -2; i <= 2; i++) ctx.fillRect(i * L * 0.17 - L * 0.015, -W / 2, L * 0.03, W);
  ctx.strokeStyle = '#5a3d22'; ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.beginPath(); ctx.moveTo(-L / 2, -W / 2); ctx.lineTo(L / 2, -W / 2); ctx.moveTo(-L / 2, W / 2); ctx.lineTo(L / 2, W / 2); ctx.stroke();
  ctx.restore();
}

function dock(ctx, cx, cy, size, wm) {
  const dx = wm[0] - cx, dy = wm[1] - cy, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, px = -uy, py = ux;
  ctx.strokeStyle = '#6e4a2c'; ctx.lineCap = 'round';
  ctx.lineWidth = size * 0.06;
  ctx.beginPath(); ctx.moveTo(cx + ux * size * 0.18, cy + uy * size * 0.18); ctx.lineTo(cx + ux * size * 0.82, cy + uy * size * 0.82); ctx.stroke();
  ctx.lineWidth = size * 0.022;
  for (let tt = 0.3; tt <= 0.82; tt += 0.16) {
    const mx = cx + ux * size * tt, my = cy + uy * size * tt;
    ctx.beginPath(); ctx.moveTo(mx - px * size * 0.08, my - py * size * 0.08); ctx.lineTo(mx + px * size * 0.08, my + py * size * 0.08); ctx.stroke();
  }
}

// Where a tile's watermill wheel sits, or null. Shared by the cached rim and
// the live spinning spokes so they line up exactly.
export function millWheel(cx, cy, size, edges, tile) {
  const water = [], road = [];
  for (let i = 0; i < 6; i++) { if (edges[i] === 'water') water.push(i); if (edges[i] === 'village') road.push(i); }
  // mill only when exactly one water edge + a road + this is a town center
  // (matches the watermill branch in drawBoundaries; 2+ water = a bridge).
  if (water.length !== 1 || road.length === 0 || !(tile && tile.townCenter)) return null;
  const a = 60 * water[0] * DEG;
  const wm = [cx + size * APO * Math.cos(a), cy + size * APO * Math.sin(a)];
  const dx = wm[0] - cx, dy = wm[1] - cy, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  return { wx: cx + ux * size * 0.32, wy: cy + uy * size * 0.32, r: size * 0.14 };
}

function watermill(ctx, cx, cy, size, wm, rng) {
  const dx = wm[0] - cx, dy = wm[1] - cy, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  house(ctx, cx - ux * size * 0.1, cy - uy * size * 0.1, size * 0.22, rng);
  const wx = cx + ux * size * 0.32, wy = cy + uy * size * 0.32;
  // rim + hub only — spokes are drawn live (spinning) in drawLife.
  ctx.save(); ctx.strokeStyle = '#4a3320'; ctx.lineWidth = size * 0.03;
  ctx.beginPath(); ctx.arc(wx, wy, size * 0.14, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#4a3320'; ctx.beginPath(); ctx.arc(wx, wy, size * 0.03, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Lay out a village's buildings along its roads, packing tighter and taller as
// the connected town grows. The "center" tile of a big town gets a church.
function drawTownWall(ctx, cx, cy, size, edges) {
  for (let i = 0; i < 6; i++) {
    if (edges[i] === 'village') continue;            // interior border -> open (natural gate)
    const [ax, ay] = corner(cx, cy, size, i);
    const [bx, by] = corner(cx, cy, size, (i + 1) % 6);
    const ins = 0.15;
    const a2x = ax + (cx - ax) * ins, a2y = ay + (cy - ay) * ins;
    const b2x = bx + (cx - bx) * ins, b2y = by + (cy - by) * ins;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#857d70'; ctx.lineWidth = size * 0.09;
    ctx.beginPath(); ctx.moveTo(a2x, a2y); ctx.lineTo(b2x, b2y); ctx.stroke();
    ctx.strokeStyle = '#a39a8b'; ctx.lineWidth = size * 0.028;
    ctx.beginPath(); ctx.moveTo(a2x, a2y); ctx.lineTo(b2x, b2y); ctx.stroke();
    ctx.fillStyle = '#9a9286';
    for (let s = 0.18; s <= 0.82; s += 0.32) {
      const mx = a2x + (b2x - a2x) * s, my = a2y + (b2y - a2y) * s;
      ctx.fillRect(mx - size * 0.024, my - size * 0.055, size * 0.048, size * 0.05);
    }
  }
}

function drawVillage(ctx, cx, cy, size, edges, rng, town) {
  const tier = town ? town.tier : 0;
  const center = town ? town.center : false;
  if (tier >= 3) drawTownWall(ctx, cx, cy, size, edges);
  const APO = Math.sqrt(3) / 2;
  const vis = [];
  for (let i = 0; i < 6; i++) if (edges[i] === 'village') vis.push(i);
  const mids = vis.map(i => { const a = 60 * i * DEG; return [cx + size * APO * Math.cos(a), cy + size * APO * Math.sin(a)]; });

  const perArm = tier >= 3 ? 2 : 1;
  const spots = [];
  for (const m of mids) {
    const dx = m[0] - cx, dy = m[1] - cy, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, px = -uy, py = ux;
    for (let j = 0; j < perArm; j++) {
      const tt = 0.42 + j * 0.3 + rr(rng, -0.04, 0.04);
      const off = (0.17 + rr(rng, 0, 0.07)) * size * (rng() < 0.5 ? 1 : -1);
      spots.push([cx + ux * len * tt + px * off, cy + uy * len * tt + py * off]);
    }
  }
  if (spots.length === 0) spots.push([cx + rr(rng, -0.15, 0.15) * size, cy + rr(rng, -0.12, 0.12) * size]);
  if (tier >= 2) spots.push([cx + rr(rng, -0.2, 0.2) * size, cy + rr(rng, -0.2, 0.2) * size]);
  if (tier >= 3) spots.push([cx + rr(rng, -0.28, 0.28) * size, cy + rr(rng, -0.28, 0.28) * size]);

  // A vegetable garden dresses the edge of a settled town (ground level, first).
  if (tier >= 1 && rng() < 0.7) gardenPlot(ctx, cx + rr(rng, -0.3, 0.3) * size, cy + rr(rng, 0.14, 0.34) * size, size * 0.5);

  spots.sort((a, b) => a[1] - b[1]); // painter's order
  const maxN = [1, 2, 4, 6][tier];
  const n = Math.min(spots.length, maxN);
  for (let k = 0; k < n; k++) {
    const [x, y] = spots[k];
    const pick = rng();
    if (tier >= 2 && pick < 0.22) marketStall(ctx, x, y, size * 0.58, rng);
    else if (tier >= 2 && pick < 0.55) townhouse(ctx, x, y, size * rr(rng, 0.2, 0.26), rng);
    else house(ctx, x, y, size * rr(rng, 0.15, 0.2), rng);
  }
  if (center) {
    if (tier >= 3) church(ctx, cx, cy - size * 0.04, size, rng);
    else if (tier >= 1) well(ctx, cx, cy, size);
  }
  // Pennant banners fly over a proud, walled town.
  if (tier >= 3) { banner(ctx, cx - size * 0.42, cy + size * 0.12, size * 0.55, rng); banner(ctx, cx + size * 0.4, cy + size * 0.05, size * 0.55, rng); }
}

// LIVE: warm window/lantern light over a settlement at dusk & night. `night`
// is 0 (day) … 1 (deep night). Twinkle positions are stable per tile.
// Fireflies drifting over meadows, woods & marsh — drawn AFTER the night wash
// (like town lights) so they actually glow against the dark.
export function drawNightFireflies(ctx, cx, cy, size, tile, t, night) {
  if (night < 0.35 || tile.corrupt) return;
  const e = tile.edges;
  if (!e.some(x => x === 'field' || x === 'forest' || x === 'marsh' || x === 'orchard' || x === 'moor')) return;
  if ((hashCoord(tile.q + 5, tile.r - 1) % 3) === 0) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const nf = 2 + (hashCoord(tile.q, tile.r) % 2);
  const amp = Math.min(1, (night - 0.35) / 0.5);
  for (let k = 0; k < nf; k++) {
    const x = cx + Math.sin(t / 1100 + k * 2.3 + cx) * size * 0.48 + (k - nf / 2) * size * 0.18;
    const y = cy + Math.cos(t / 900 + k * 1.9) * size * 0.4;
    const tw = (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t / 260 + k * 3))) * amp;
    const r = size * 0.06;
    const gl = ctx.createRadialGradient(x, y, 0, x, y, r);
    gl.addColorStop(0, `rgba(200,255,140,${0.95 * tw})`); gl.addColorStop(1, 'rgba(200,255,140,0)');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export function drawTownLights(ctx, cx, cy, size, tile, t, night) {
  if (night <= 0.04 || !tile.edges.includes('village')) return;
  const sz = tile.townSize || 1;
  const tier = sz <= 1 ? 0 : sz <= 3 ? 1 : sz <= 6 ? 2 : 3;
  const rng = makeRng((hashCoord(tile.q, tile.r) ^ 0x1357) >>> 0);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const R = size * (0.5 + tier * 0.12);
  const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  gr.addColorStop(0, `rgba(255,190,90,${0.18 * night * (0.6 + tier * 0.18)})`);
  gr.addColorStop(1, 'rgba(255,190,90,0)');
  ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
  const n = [1, 2, 4, 7][tier];
  for (let k = 0; k < n; k++) {
    const ang = rr(rng, 0, Math.PI * 2), rad = rr(rng, 0.2, 0.78) * size;
    // each window lights up at its own dusk threshold — they turn on one by one
    const thr = 0.05 + (k / Math.max(1, n)) * 0.42 + rr(rng, -0.03, 0.03);
    const on = Math.max(0, Math.min(1, (night - thr) / 0.1));
    if (on <= 0) continue;
    const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad;
    const fl = 0.62 + 0.38 * Math.sin(t / 110 + k * 3.1) * Math.sin(t / 287 + k * 1.7);
    ctx.fillStyle = `rgba(255,206,110,${Math.max(0.2, fl) * night * on})`;
    ctx.fillRect(x - size * 0.022, y - size * 0.022, size * 0.045, size * 0.045);
  }
  ctx.restore();
}

function peak(ctx, x, y, s, rng) {
  // shadow side
  ctx.fillStyle = '#5f5749';
  ctx.beginPath();
  ctx.moveTo(x - s * 0.6, y + s * 0.5);
  ctx.lineTo(x, y - s * 0.55);
  ctx.lineTo(x + s * 0.6, y + s * 0.5);
  ctx.closePath(); ctx.fill();
  // lit side
  ctx.fillStyle = '#8d8576';
  ctx.beginPath();
  ctx.moveTo(x, y - s * 0.55);
  ctx.lineTo(x + s * 0.6, y + s * 0.5);
  ctx.lineTo(x + s * 0.08, y + s * 0.5);
  ctx.closePath(); ctx.fill();
  // snow cap
  ctx.fillStyle = '#f2f2ef';
  ctx.beginPath();
  ctx.moveTo(x, y - s * 0.55);
  ctx.lineTo(x + s * 0.2, y - s * 0.18);
  ctx.lineTo(x - s * 0.18, y - s * 0.18);
  ctx.closePath(); ctx.fill();
}

function mushroom(ctx, x, y, s) {
  ctx.fillStyle = '#efe6d2';
  ctx.fillRect(x - s * 0.18, y - s * 0.2, s * 0.36, s * 0.7);
  ctx.fillStyle = '#c4413f';
  ctx.beginPath(); ctx.ellipse(x, y - s * 0.2, s * 0.6, s * 0.42, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath(); ctx.arc(x - s * 0.2, y - s * 0.3, s * 0.08, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + s * 0.18, y - s * 0.22, s * 0.07, 0, Math.PI * 2); ctx.fill();
}

// A little deer — head lowers to graze on a slow cycle.
function deer(ctx, x, y, size, t) {
  const s = size * 0.16;
  const graze = Math.sin(t / 1500 + x) > 0.2;
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.beginPath(); ctx.ellipse(x, y + s * 0.95, s * 0.9, s * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#6e472a'; ctx.lineWidth = s * 0.16; ctx.lineCap = 'round';
  for (const lx of [-s * 0.6, -s * 0.2, s * 0.2, s * 0.6]) { ctx.beginPath(); ctx.moveTo(x + lx, y + s * 0.3); ctx.lineTo(x + lx, y + s * 0.95); ctx.stroke(); }
  ctx.fillStyle = '#8a5a36';
  ctx.beginPath(); ctx.ellipse(x, y, s * 0.9, s * 0.5, 0, 0, Math.PI * 2); ctx.fill();
  const hx = x + s * 0.95, hy = graze ? y + s * 0.35 : y - s * 0.6;
  ctx.strokeStyle = '#8a5a36'; ctx.lineWidth = s * 0.28;
  ctx.beginPath(); ctx.moveTo(x + s * 0.7, y - s * 0.2); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.fillStyle = '#8a5a36'; ctx.beginPath(); ctx.ellipse(hx, hy, s * 0.26, s * 0.18, 0, 0, Math.PI * 2); ctx.fill();
  // antlers (only when head is up)
  if (!graze) {
    ctx.strokeStyle = '#caa06a'; ctx.lineWidth = s * 0.09;
    ctx.beginPath();
    ctx.moveTo(hx, hy - s * 0.15); ctx.lineTo(hx + s * 0.08, hy - s * 0.55);
    ctx.moveTo(hx + s * 0.04, hy - s * 0.38); ctx.lineTo(hx + s * 0.26, hy - s * 0.5);
    ctx.moveTo(hx - s * 0.04, hy - s * 0.38); ctx.lineTo(hx - s * 0.16, hy - s * 0.52);
    ctx.stroke();
  }
}

function reed(ctx, x, y, s) {
  ctx.strokeStyle = '#3f6e30';
  ctx.lineWidth = Math.max(1, s * 0.12);
  ctx.lineCap = 'round';
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * s * 0.25, y + s * 0.4);
    ctx.lineTo(x + i * s * 0.25 + s * 0.1, y - s * 0.5);
    ctx.stroke();
  }
}

// ---- landmark structures (drawn at the tile center) ----
function drawLandmark(ctx, cx, cy, size, landmark, rng) {
  const s = size * 0.5;
  propShadow(ctx, cx, cy + s * 0.5, s * 0.66, 0.22);   // sun-cast platform shadow
  ctx.save();
  ctx.translate(cx, cy);
  switch (landmark) {
    case 'castle': {
      ctx.fillStyle = '#9a9690';
      for (const tx of [-s * 0.55, s * 0.55]) { ctx.fillRect(tx - s * 0.16, -s * 0.55, s * 0.32, s); battlement(ctx, tx, -s * 0.55, s * 0.32); }
      ctx.fillRect(-s * 0.45, -s * 0.32, s * 0.9, s * 0.82);
      battlement(ctx, 0, -s * 0.32, s * 0.9);
      ctx.fillStyle = '#5a3d22'; ctx.fillRect(-s * 0.12, s * 0.12, s * 0.24, s * 0.38); // gate
      ctx.strokeStyle = '#7a2f2f'; ctx.lineWidth = s * 0.06; ctx.beginPath(); ctx.moveTo(0, -s * 0.55); ctx.lineTo(0, -s * 0.85); ctx.stroke();
      ctx.fillStyle = '#c23b3b'; ctx.beginPath(); ctx.moveTo(0, -s * 0.85); ctx.lineTo(s * 0.3, -s * 0.78); ctx.lineTo(0, -s * 0.68); ctx.fill();
      break;
    }
    case 'windmill': {
      ctx.fillStyle = '#cdbfa3'; ctx.beginPath(); ctx.moveTo(-s * 0.34, s * 0.5); ctx.lineTo(-s * 0.22, -s * 0.4); ctx.lineTo(s * 0.22, -s * 0.4); ctx.lineTo(s * 0.34, s * 0.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#6e4a2c'; ctx.beginPath(); ctx.moveTo(-s * 0.28, -s * 0.4); ctx.lineTo(0, -s * 0.62); ctx.lineTo(s * 0.28, -s * 0.4); ctx.fill();
      ctx.strokeStyle = '#efe6d2'; ctx.lineWidth = s * 0.07; const a = 0.6;
      for (let i = 0; i < 4; i++) { const ang = a + i * Math.PI / 2; ctx.beginPath(); ctx.moveTo(0, -s * 0.42); ctx.lineTo(Math.cos(ang) * s * 0.6, -s * 0.42 + Math.sin(ang) * s * 0.6); ctx.stroke(); }
      break;
    }
    case 'lighthouse': {
      for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#d24b3e' : '#f0eadb'; const y0 = -s * 0.5 + i * s * 0.2, w0 = s * 0.16 + i * s * 0.05; ctx.beginPath(); ctx.moveTo(-w0, y0 + s * 0.2); ctx.lineTo(w0, y0 + s * 0.2); ctx.lineTo(w0 * 0.82, y0); ctx.lineTo(-w0 * 0.82, y0); ctx.closePath(); ctx.fill(); }
      ctx.fillStyle = '#3a3a3a'; ctx.fillRect(-s * 0.18, -s * 0.62, s * 0.36, s * 0.16);
      const glow = ctx.createRadialGradient(0, -s * 0.54, 0, 0, -s * 0.54, s * 0.5); glow.addColorStop(0, 'rgba(255,235,150,0.85)'); glow.addColorStop(1, 'rgba(255,235,150,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, -s * 0.54, s * 0.5, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'shrine': {
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.8); glow.addColorStop(0, 'rgba(190,140,255,0.6)'); glow.addColorStop(1, 'rgba(190,140,255,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(0, 0, s * 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6f4fa0';
      for (let i = 0; i < 5; i++) { const ang = -Math.PI / 2 + (i - 2) * 0.5; ctx.beginPath(); ctx.ellipse(Math.cos(ang) * s * 0.5, Math.sin(ang) * s * 0.5 + s * 0.1, s * 0.12, s * 0.2, 0, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'watchtower': {
      ctx.fillStyle = '#8d8576'; ctx.beginPath(); ctx.moveTo(-s * 0.22, s * 0.5); ctx.lineTo(-s * 0.14, -s * 0.5); ctx.lineTo(s * 0.14, -s * 0.5); ctx.lineTo(s * 0.22, s * 0.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#6d6453'; ctx.fillRect(-s * 0.26, -s * 0.62, s * 0.52, s * 0.16); battlement(ctx, 0, -s * 0.62, s * 0.52);
      ctx.fillStyle = '#2a2a2a'; ctx.fillRect(-s * 0.06, -s * 0.32, s * 0.12, s * 0.2);
      break;
    }
    case 'wardtower': {
      // a sturdy warded keep: stone base + crenellations + a glowing ward gem
      ctx.fillStyle = '#9aa0ab'; ctx.fillRect(-s * 0.5, -s * 0.18, s, s * 0.7);            // base
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(-s * 0.5, -s * 0.18, s, s * 0.12);   // shade band
      ctx.fillStyle = '#aab0bb'; battlement(ctx, 0, -s * 0.18, s);                          // base crenellations
      ctx.fillStyle = '#b6bcc7'; ctx.fillRect(-s * 0.2, -s * 0.6, s * 0.4, s * 0.46);       // central tower
      ctx.fillStyle = '#cdd3dd'; battlement(ctx, 0, -s * 0.6, s * 0.4);                      // tower crenellations
      ctx.fillStyle = '#3a3f48'; ctx.fillRect(-s * 0.07, -s * 0.12, s * 0.14, s * 0.22);     // gate
      const wg = ctx.createRadialGradient(0, -s * 0.7, 0, 0, -s * 0.7, s * 0.42);            // ward gem glow
      wg.addColorStop(0, 'rgba(150,220,255,0.95)'); wg.addColorStop(1, 'rgba(150,220,255,0)');
      ctx.fillStyle = wg; ctx.beginPath(); ctx.arc(0, -s * 0.7, s * 0.42, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#dff2ff'; ctx.beginPath(); ctx.arc(0, -s * 0.7, s * 0.11, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'harbor': {
      // pier + a docked sailboat + crates
      ctx.fillStyle = '#6e4a2c'; ctx.fillRect(-s * 0.5, s * 0.06, s, s * 0.14);
      for (let i = -2; i <= 2; i++) { ctx.fillStyle = '#5a3d22'; ctx.fillRect(i * s * 0.2 - s * 0.02, s * 0.06, s * 0.05, s * 0.32); }
      ctx.fillStyle = '#5a3d22'; ctx.beginPath(); ctx.ellipse(s * 0.18, -s * 0.06, s * 0.26, s * 0.1, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#3a2a18'; ctx.lineWidth = s * 0.04; ctx.beginPath(); ctx.moveTo(s * 0.18, -s * 0.12); ctx.lineTo(s * 0.18, -s * 0.7); ctx.stroke();
      ctx.fillStyle = '#f0eadb'; ctx.beginPath(); ctx.moveTo(s * 0.18, -s * 0.16); ctx.lineTo(s * 0.18, -s * 0.66); ctx.lineTo(s * 0.5, -s * 0.26); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8a5a34'; ctx.fillRect(-s * 0.46, -s * 0.16, s * 0.18, s * 0.18); ctx.fillRect(-s * 0.3, -s * 0.1, s * 0.14, s * 0.14);
      break;
    }
    case 'henge': {
      // ring of standing stones with a lintel
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * 0.62;
        const x = Math.cos(a) * s * 0.55, y = Math.sin(a) * s * 0.4 + s * 0.12;
        ctx.fillStyle = i % 2 ? '#9c978a' : '#8a8578';
        ctx.fillRect(x - s * 0.09, y - s * 0.5, s * 0.18, s * 0.62);
      }
      ctx.fillStyle = '#9c978a'; ctx.fillRect(-s * 0.34, -s * 0.5, s * 0.68, s * 0.14); // lintel
      break;
    }
    case 'witchhut': {
      // hut on stilts with a glowing window
      ctx.strokeStyle = '#4a3320'; ctx.lineWidth = s * 0.05;
      ctx.beginPath(); ctx.moveTo(-s * 0.3, s * 0.5); ctx.lineTo(-s * 0.24, s * 0.02); ctx.moveTo(s * 0.3, s * 0.5); ctx.lineTo(s * 0.24, s * 0.02); ctx.stroke();
      ctx.fillStyle = '#5e4a32'; ctx.fillRect(-s * 0.34, -s * 0.22, s * 0.68, s * 0.34);
      ctx.fillStyle = '#3a2c1c'; ctx.beginPath(); ctx.moveTo(-s * 0.42, -s * 0.22); ctx.lineTo(0, -s * 0.6); ctx.lineTo(s * 0.42, -s * 0.22); ctx.closePath(); ctx.fill();
      const gl = ctx.createRadialGradient(0, -s * 0.05, 0, 0, -s * 0.05, s * 0.3); gl.addColorStop(0, 'rgba(150,255,180,0.8)'); gl.addColorStop(1, 'rgba(150,255,180,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, -s * 0.05, s * 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#aef0c0'; ctx.fillRect(-s * 0.1, -s * 0.14, s * 0.2, s * 0.18);
      break;
    }
    case 'press': {
      // a cider press + stacked barrels
      ctx.fillStyle = '#6e4a2c'; ctx.fillRect(-s * 0.4, -s * 0.35, s * 0.1, s * 0.75); ctx.fillRect(s * 0.3, -s * 0.35, s * 0.1, s * 0.75);
      ctx.fillStyle = '#8a5a34'; ctx.fillRect(-s * 0.44, -s * 0.42, s * 0.88, s * 0.12);
      ctx.fillStyle = '#9a6a3a'; ctx.fillRect(-s * 0.28, -s * 0.05, s * 0.56, s * 0.4); // vat
      ctx.strokeStyle = '#5a3d22'; ctx.lineWidth = s * 0.03; ctx.beginPath(); ctx.moveTo(-s * 0.28, s * 0.1); ctx.lineTo(s * 0.28, s * 0.1); ctx.stroke();
      ctx.fillStyle = '#b5772f'; ctx.beginPath(); ctx.ellipse(s * 0.42, s * 0.34, s * 0.14, s * 0.18, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'monolith': {
      // tall carved obelisk with a faint rune glow
      const gl = ctx.createRadialGradient(0, -s * 0.2, 0, 0, -s * 0.2, s * 0.6); gl.addColorStop(0, 'rgba(150,120,210,0.4)'); gl.addColorStop(1, 'rgba(150,120,210,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(0, -s * 0.2, s * 0.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3e3a44'; ctx.beginPath(); ctx.moveTo(-s * 0.16, s * 0.5); ctx.lineTo(-s * 0.1, -s * 0.75); ctx.lineTo(0, -s * 0.92); ctx.lineTo(s * 0.1, -s * 0.75); ctx.lineTo(s * 0.16, s * 0.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#56506a'; ctx.fillRect(-s * 0.04, -s * 0.6, s * 0.08, s * 0.04); ctx.fillRect(-s * 0.04, -s * 0.4, s * 0.08, s * 0.04); ctx.fillRect(-s * 0.04, -s * 0.2, s * 0.08, s * 0.04);
      break;
    }
  }
  ctx.restore();
}

function battlement(ctx, x, topY, w) {
  const n = 4, cw = w / (n * 2 - 1);
  for (let i = 0; i < n; i++) ctx.fillRect(x - w / 2 + i * cw * 2, topY - cw, cw, cw);
}

// ---- living-region animation overlay (per-frame, driven by t) ----
// Villages always breathe smoke; rivers carry a boat; "bloomed" regions (a
// completed decree) sprout fireflies in forests and birds over fields.
// A tiny villager: a coloured tunic + head, with a little walking lean.
function villager(ctx, x, y, s, col, t, ph) {
  const h = s * 0.13;
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  ctx.beginPath(); ctx.ellipse(x, y + s * 0.008, s * 0.03, s * 0.012, 0, 0, Math.PI * 2); ctx.fill();
  const lean = Math.sin(t / 150 + ph * 9) * s * 0.006;
  ctx.strokeStyle = col; ctx.lineWidth = s * 0.032; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + lean, y - h * 0.62); ctx.stroke();
  ctx.fillStyle = '#e8c9a0';
  ctx.beginPath(); ctx.arc(x + lean, y - h * 0.74, s * 0.026, 0, Math.PI * 2); ctx.fill();
}

// A little duck paddling, leaving a soft V-wake.
function duck(ctx, x, y, s) {
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = s * 0.012; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x - s * 0.07, y - s * 0.035); ctx.lineTo(x, y); ctx.lineTo(x - s * 0.07, y + s * 0.035); ctx.stroke();
  ctx.fillStyle = '#4a3a2a';
  ctx.beginPath(); ctx.ellipse(x, y, s * 0.036, s * 0.022, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2f5a32';
  ctx.beginPath(); ctx.arc(x + s * 0.032, y - s * 0.012, s * 0.016, 0, Math.PI * 2); ctx.fill();
}

export function drawLife(ctx, cx, cy, size, tile, t, night = 0, season = 1) {
  const edges = tile.edges;
  const APO = Math.sqrt(3) / 2;
  const mid = (i) => { const a = 60 * i * DEG; return [cx + size * APO * Math.cos(a), cy + size * APO * Math.sin(a)]; };

  // chimney smoke from the first village wedge — thickens at dawn/dusk (cooking
  // fires), thins at midday.
  const vi = edges.indexOf('village');
  if (vi >= 0) {
    const cook = 0.55 + Math.max(0, 1 - Math.abs(night - 0.5) * 2.2);   // peaks at dawn/dusk
    const a = 60 * vi * DEG;
    const hx = cx + Math.cos(a) * size * 0.5, hy = cy + Math.sin(a) * size * 0.5 - size * 0.18;
    for (let k = 0; k < 3; k++) {
      const p = ((t / 1500) + k * 0.34) % 1;
      const x = hx + Math.sin(p * 6 + k) * size * 0.06;
      const y = hy - p * size * 0.6;
      ctx.fillStyle = `rgba(220,220,215,${0.32 * (1 - p) * cook})`;
      ctx.beginPath(); ctx.arc(x, y, size * (0.05 + p * 0.07) * (0.7 + cook * 0.4), 0, Math.PI * 2); ctx.fill();
    }
  }

  // villagers strolling the roads of a settled tile — they head inside at night
  if (tile.townSize && !tile.corrupt) {
    const roads = [];
    for (let i = 0; i < 6; i++) if (edges[i] === 'village') roads.push(i);
    if (roads.length) {
      const sf = (hashCoord(tile.q, tile.r) % 97) / 97;
      const base = Math.min(3, Math.ceil(tile.townSize / 2));
      const n = night > 0.62 ? 0 : Math.max(1, Math.round(base * (0.5 + 0.5 * (1 - night))));
      const m0 = mid(roads[0]), m1 = roads.length >= 2 ? mid(roads[1]) : [cx, cy];
      const cols = ['#7a3b3b', '#3b5a7a', '#6a5a2a', '#4a6a4a', '#7a5638'];
      for (let v = 0; v < n; v++) {
        const ph = ((t / (5400 + v * 760)) + v * 0.41 + sf) % 1, u = 1 - ph;
        const x = u * u * m0[0] + 2 * u * ph * cx + ph * ph * m1[0];
        const y = u * u * m0[1] + 2 * u * ph * cy + ph * ph * m1[1];
        villager(ctx, x, y, size, cols[(v + (sf * 5 | 0)) % cols.length], t, v);
      }
    }
  }

  // a boat sailing the river (tiles with a through-river or a finished river)
  const wi = [];
  for (let i = 0; i < 6; i++) if (edges[i] === 'water') wi.push(i);
  if (wi.length >= 2 || tile.bloom === 'water') {
    const m0 = mid(wi[0] ?? 0), m1 = mid(wi[1] ?? ((wi[0] + 3) % 6));
    const p = (t / 4200) % 1, u = 1 - p;
    const x = u * u * m0[0] + 2 * u * p * cx + p * p * m1[0];
    const y = u * u * m0[1] + 2 * u * p * cy + p * p * m1[1];
    ctx.fillStyle = '#5a3d22';
    ctx.beginPath(); ctx.ellipse(x, y, size * 0.1, size * 0.045, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f0eadb';
    ctx.beginPath(); ctx.moveTo(x, y - size * 0.02); ctx.lineTo(x, y - size * 0.17); ctx.lineTo(x + size * 0.09, y - size * 0.05); ctx.closePath(); ctx.fill();
  }

  // ducks paddling on river tiles (about half of them, stable per-tile)
  if (wi.length >= 1 && !tile.corrupt && (hashCoord(tile.q - 2, tile.r + 4) % 2) === 0) {
    const nd = wi.length >= 3 ? 2 : 1;
    for (let d = 0; d < nd; d++) {
      const a = 60 * wi[d % wi.length] * DEG;
      const bx = cx + Math.cos(a) * size * 0.3, by = cy + Math.sin(a) * size * 0.3;
      duck(ctx, bx + Math.sin(t / 2600 + d * 2 + cx) * size * 0.14, by + Math.cos(t / 3100 + d * 3) * size * 0.07, size);
    }
  }

  // bloomed forest -> fireflies
  if (tile.bloom === 'forest') {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 4; k++) {
      const x = cx + Math.sin(t / 900 + k * 1.7) * size * 0.5 + (k - 1.5) * size * 0.12;
      const y = cy + Math.cos(t / 760 + k * 2.1) * size * 0.4;
      const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t / 300 + k));
      const r = size * 0.06;
      const gl = ctx.createRadialGradient(x, y, 0, x, y, r); gl.addColorStop(0, `rgba(200,255,150,${0.8 * tw})`); gl.addColorStop(1, 'rgba(200,255,150,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // bloomed field -> a couple of birds drifting over
  if (tile.bloom === 'field') {
    ctx.strokeStyle = 'rgba(40,40,40,0.6)'; ctx.lineWidth = Math.max(1, size * 0.03); ctx.lineCap = 'round';
    for (let k = 0; k < 2; k++) {
      const bx = cx - size * 0.5 + ((t / 2600 + k * 0.5) % 1) * size;
      const by = cy - size * 0.35 + Math.sin(t / 500 + k) * size * 0.05;
      const w = size * 0.09;
      ctx.beginPath(); ctx.moveTo(bx - w, by); ctx.quadraticCurveTo(bx - w * 0.4, by - w * 0.5, bx, by);
      ctx.quadraticCurveTo(bx + w * 0.4, by - w * 0.5, bx + w, by); ctx.stroke();
    }
  }

  // a traveler (villager or cart) walking the road
  const ri = [];
  for (let i = 0; i < 6; i++) if (edges[i] === 'village') ri.push(i);
  if (ri.length >= 1) {
    const r0 = mid(ri[0]), r1 = ri.length >= 2 ? mid(ri[1]) : [cx, cy];
    const seed = hashCoord(tile.q, tile.r);
    const speed = 5200 + (seed % 1800);
    const p = ((t + (seed % speed)) / speed) % 1, u = 1 - p;
    const x = u * u * r0[0] + 2 * u * p * cx + p * p * r1[0];
    const y = u * u * r0[1] + 2 * u * p * cy + p * p * r1[1];
    const cart = (seed % 3) === 0;
    if (cart) {
      ctx.fillStyle = '#6e4a2c'; ctx.fillRect(x - size * 0.06, y - size * 0.06, size * 0.12, size * 0.07);
      ctx.fillStyle = '#3a2a18';
      ctx.beginPath(); ctx.arc(x - size * 0.04, y + size * 0.02, size * 0.025, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + size * 0.04, y + size * 0.02, size * 0.025, 0, Math.PI * 2); ctx.fill();
    } else {
      const bob = Math.abs(Math.sin(t / 140)) * size * 0.02;
      ctx.fillStyle = '#8a5a3a'; // body
      ctx.fillRect(x - size * 0.018, y - size * 0.06 - bob, size * 0.036, size * 0.08);
      ctx.fillStyle = '#e8c9a0'; // head
      ctx.beginPath(); ctx.arc(x, y - size * 0.075 - bob, size * 0.022, 0, Math.PI * 2); ctx.fill();
    }
  }

  // turning watermill wheel
  const mw = millWheel(cx, cy, size, edges, tile);
  if (mw) {
    ctx.save();
    const spin = t / 600;
    ctx.strokeStyle = '#5a4226'; ctx.lineWidth = size * 0.03; ctx.lineCap = 'round';
    for (let k = 0; k < 6; k++) {
      const a = spin + k * Math.PI / 3;
      const px = mw.wx + Math.cos(a) * mw.r, py = mw.wy + Math.sin(a) * mw.r;
      ctx.beginPath(); ctx.moveTo(mw.wx, mw.wy); ctx.lineTo(px, py); ctx.stroke();
      ctx.fillStyle = '#6e4a2c'; ctx.fillRect(px - size * 0.028, py - size * 0.028, size * 0.056, size * 0.056);
    }
    ctx.restore();
  }

  // rotating lighthouse beam at night
  if (tile.landmark === 'lighthouse' && night > 0.25) {
    const lx = cx, ly = cy - size * 0.27;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.translate(lx, ly); ctx.rotate((t / 1500) % (Math.PI * 2));
    const grd = ctx.createLinearGradient(0, 0, size * 1.7, 0);
    grd.addColorStop(0, `rgba(255,240,170,${0.34 * night})`);
    grd.addColorStop(1, 'rgba(255,240,170,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(size * 1.7, -size * 0.2); ctx.lineTo(size * 1.7, size * 0.2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = `rgba(255,245,200,${0.7 * night})`;
    ctx.beginPath(); ctx.arc(0, 0, size * 0.08, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // sheep grazing on some fields (stable per-tile via seed)
  const fi = edges.indexOf('field');
  if (fi >= 0 && (hashCoord(tile.q + 7, tile.r - 3) % 3) === 0) {
    const a = 60 * fi * DEG;
    const fx = cx + Math.cos(a) * size * 0.45, fy = cy + Math.sin(a) * size * 0.45;
    for (let k = 0; k < 2; k++) {
      const sx = fx + (k - 0.5) * size * 0.22 + Math.sin(t / 2600 + k * 4 + fx) * size * 0.05;
      const sy = fy + (k % 2) * size * 0.1;
      ctx.fillStyle = '#efeae0';
      ctx.beginPath(); ctx.ellipse(sx, sy, size * 0.055, size * 0.04, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3a3330';
      ctx.beginPath(); ctx.arc(sx + size * 0.05, sy - size * 0.01, size * 0.022, 0, Math.PI * 2); ctx.fill();
    }
  }

  // a deer grazing in some forests (stable per-tile via seed)
  const foi = edges.indexOf('forest');
  if (foi >= 0 && (hashCoord(tile.q * 3 + 1, tile.r * 5 - 2) % 4) === 0) {
    const a = 60 * foi * DEG;
    const dx = cx + Math.cos(a) * size * 0.4 + Math.sin(t / 3200 + cx) * size * 0.1;
    const dy = cy + Math.sin(a) * size * 0.4;
    deer(ctx, dx, dy, size, t);
  }

  // coast surf — a soft foam line that breathes along the outer sea edges
  const c4 = edges.indexOf('coast');
  if (c4 >= 0) {
    ctx.save();
    ctx.strokeStyle = `rgba(240,250,255,${0.3 + 0.2 * Math.sin(t / 700)})`;
    ctx.lineWidth = size * 0.04; ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      if (edges[i] !== 'coast') continue;
      const a = 60 * i * DEG;
      const mx = cx + Math.cos(a) * size * 0.72, my = cy + Math.sin(a) * size * 0.72;
      const off = Math.sin(t / 600 + i) * size * 0.03;
      ctx.beginPath(); ctx.arc(mx, my + off, size * 0.16, a - 1, a + 1); ctx.stroke();
    }
    ctx.restore();
  }

  // marsh will-o'-the-wisps drifting at night
  const mq = edges.indexOf('marsh');
  if (mq >= 0 && night > 0.3) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 2; k++) {
      const x = cx + Math.sin(t / 1300 + k * 2.6) * size * 0.45;
      const y = cy + Math.cos(t / 1000 + k * 3.1) * size * 0.35;
      const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t / 420 + k));
      const r = size * 0.09;
      const gl = ctx.createRadialGradient(x, y, 0, x, y, r);
      gl.addColorStop(0, `rgba(140,255,200,${0.7 * tw * night})`);
      gl.addColorStop(1, 'rgba(140,255,200,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // ---- night reflection: a rippling moon glint on the water ----
  if (night > 0.25 && wi.length >= 1) {
    const m = mid(wi[0]);
    const rx = (m[0] + cx) / 2, ry = (m[1] + cy) / 2;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (let s = 0; s < 3; s++) {
      const yy = ry + (s - 1) * size * 0.08 + Math.sin(t / 500 + s) * size * 0.015;
      ctx.fillStyle = `rgba(230,235,255,${(0.16 - s * 0.04) * night})`;
      ctx.beginPath(); ctx.ellipse(rx, yy, size * 0.12, size * 0.018, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // ---- winter: frozen rivers + snow lying on the land ----
  if (season === 3) {
    if (wi.length >= 1) {
      const m0 = mid(wi[0]), m1 = wi.length >= 2 ? mid(wi[1]) : [cx, cy];
      ctx.save();
      ctx.lineCap = 'round'; ctx.globalAlpha = 0.55; ctx.strokeStyle = '#d2e4ef';
      ctx.lineWidth = size * 0.3;
      ctx.beginPath(); ctx.moveTo(m0[0], m0[1]); ctx.quadraticCurveTo(cx, cy, m1[0], m1[1]); ctx.stroke();
      ctx.globalAlpha = 0.4; ctx.strokeStyle = '#9fc0d6'; ctx.lineWidth = size * 0.02;
      ctx.beginPath(); ctx.moveTo(m0[0], m0[1]); ctx.quadraticCurveTo(cx + size * 0.1, cy - size * 0.05, m1[0], m1[1]); ctx.stroke();
      ctx.restore();
    }
    const rng = makeRng((hashCoord(tile.q, tile.r) ^ 0x5a5a) >>> 0);
    ctx.save(); ctx.fillStyle = 'rgba(245,248,252,0.5)';
    for (let s = 0; s < 7; s++) {
      const ang = rng() * Math.PI * 2, rad = rng() * size * 0.82;
      ctx.beginPath(); ctx.arc(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, size * 0.045, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}
