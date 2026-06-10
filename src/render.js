// All canvas drawing for Hearthvale.
import { hexToPixel, hexCorner, key, neighbor } from './hex.js';
import { TERRAIN, START_OPTIONS } from './tiles.js';
import { currentEdges, openSlots, evaluate, refreshQuestProgress, upcoming, comboMult, townTier, regionTiles, compatible, previewScore, hexDist, journeyCurrent, JOURNEY, weatherInfo } from './game.js';
import { nextUnlock, UNLOCKS, dailyBestToday, recentRuns, todayYmd, THEMES } from './meta.js';
import { ACHIEVEMENTS, achievementCount } from './achievements.js';
import { drawTile, drawTileBase, drawStructures, drawFoliage, drawLife, drawTownLights, drawNightFireflies, hashCoord, setSun } from './art.js';
import * as fx from './fx.js';
import { isMuted, getVolume, musicTracks, musicState } from './audio.js';
import { settings } from './settings.js';

export const W = 960;
export const H = 540;
const PANEL_W = 232;            // right-hand HUD panel width
const BOARD_W = W - PANEL_W;    // normal board area (left of the HUD panel)
// The active board drawing width — normally BOARD_W, but the title screen sets
// it to the full W to render a full-screen showcase vale behind the menu.
let BOARD_AREA = BOARD_W;
export function setBoardArea(w) { BOARD_AREA = w; }

// ---- True-perspective keystone (post-process image warp) ----
// The finished flat board is re-blit as horizontal strips, each scaled toward a
// vanishing point so distant rows converge — a real perspective look. It's a
// pure post-process (no draw code changes); the picker inverts the same warp
// via perspInvX so click-to-place stays exact.
let PERSP_K = 0.00085;            // convergence strength (0 = off / orthographic)
const PERSP_MIN = 0.72, PERSP_MAX = 1.26;
let _boardLayer = null;
function getBoardLayer(w, h) {
  if (!_boardLayer) _boardLayer = document.createElement('canvas');
  if (_boardLayer.width !== w || _boardLayer.height !== h) { _boardLayer.width = w; _boardLayer.height = h; }
  return _boardLayer;
}
function perspF(y, oy) {
  const f = 1 + (y - oy) * PERSP_K;
  return f < PERSP_MIN ? PERSP_MIN : f > PERSP_MAX ? PERSP_MAX : f;
}
export function setPerspective(k) { PERSP_K = k; }
// Inverse for picking: screen x at row my → flat layout-relative x.
export function perspInvX(mx, my, ox, oy) { return (mx - ox) / perspF(my, oy); }
function applyPerspectiveWarp(ctx, ox, oy) {
  const cv = ctx.canvas;
  const RS = cv.width / W;                       // device px per logical px
  const lay = getBoardLayer(cv.width, cv.height);
  const lc = lay.getContext('2d');
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.clearRect(0, 0, cv.width, cv.height);
  lc.drawImage(cv, 0, 0);                        // snapshot the flat board
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, BOARD_AREA, H); ctx.clip();
  ctx.fillStyle = '#100b07'; ctx.fillRect(0, 0, BOARD_AREA, H);   // fill keystone gaps
  const STRIP = 2;
  for (let y = 0; y < H; y += STRIP) {
    const f = perspF(y + STRIP / 2, oy);
    const dw = BOARD_AREA * f, dx = ox - ox * f;
    ctx.drawImage(lay, 0, y * RS, BOARD_AREA * RS, STRIP * RS, dx, y, dw, STRIP);
  }
  ctx.restore();
}

// Pseudo-isometric tilt: vertical foreshorten factor for the board. 1 = flat
// top-down; lower = camera pitched lower (more "viewed at an angle"). Adjustable
// live (camera up/down); main.js imports the live binding for picking.
export let BOARD_TILT = 0.62;
export function setBoardTilt(v) { BOARD_TILT = Math.max(0.42, Math.min(1, v)); }
export function getBoardTilt() { return BOARD_TILT; }

// Clickable bounds of the HUD hold slot (set during panel render).
let _holdRect = null;
export function holdSlotRect() { return _holdRect; }

// ---- Offscreen tile cache ----
// Each placed tile's painterly art is rendered once at a fixed base size, then
// blitted (scaled) every frame. Keeps the framerate flat no matter how full
// the board gets, and avoids re-running prop scatter each frame.
const BASE = 60;               // hex size used inside the cache bitmap
const CW = 128, CH = 128;      // cache canvas dims (center at 64,64)
const tileCache = new Map();

// Tile bitmaps are baked at this density multiplier so they stay sharp when the
// board is rendered at higher-than-960×540 device resolution. Set by main.
let Q = 1;
export function setRenderScale(s) {
  const q = Math.min(1.5, Math.max(1, s || 1));
  if (q !== Q) { Q = q; tileCache.clear(); }
}

function tileBitmap(edges, seed, landmark, town) {
  const tk = town ? `${town.tier}${town.center ? 'C' : ''}` : '';
  const ck = seed + '|' + edges.join('') + '|' + (landmark || '') + '|' + tk;
  let cv = tileCache.get(ck);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = Math.round(CW * Q); cv.height = Math.round(CH * Q);
  const c = cv.getContext('2d');
  c.scale(Q, Q);
  drawTileBase(c, CW / 2, CH / 2, BASE, edges, seed, landmark, town);
  tileCache.set(ck, cv);
  // Cap the cache so a long session can't grow it unbounded.
  if (tileCache.size > 450) tileCache.delete(tileCache.keys().next().value);
  return cv;
}

// Blit a cached tile (ground + static props) centered at (cx,cy) scaled to `size`.
function blitTile(ctx, cx, cy, size, edges, seed, landmark, town) {
  const bmp = tileBitmap(edges, seed, landmark, town);
  const scale = size / BASE;
  const dw = CW * scale, dh = CH * scale;
  ctx.drawImage(bmp, cx - dw / 2, cy - dh / 2, dw, dh);
}

function drawHexOutline(ctx, cx, cy, size, color, lw = 2, dashed = false) {
  ctx.save();
  if (dashed) ctx.setLineDash([5, 4]);
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const c = hexCorner(cx, cy, size, k);
    if (k === 0) ctx.moveTo(c.x, c.y);
    else ctx.lineTo(c.x, c.y);
  }
  ctx.closePath();
  ctx.lineWidth = lw;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}

function hexPathLocal(ctx, cx, cy, size) {
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const c = hexCorner(cx, cy, size, k);
    k === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y);
  }
  ctx.closePath();
}

// The "side wall" beneath a tile's top face — a soil cross-section (topsoil →
// clay → rock → dark base lip) so the board's perimeter reads as a chunky
// pop-up diorama plinth. `light` (0..1) + `sunX` shade the face directionally so
// the block reads as a solid object lit by the sun.
function drawTileSide(ctx, cx, cy, size, depth, light = 1, sunX = 0.3) {
  const top = cy + size * 0.2, bottom = cy + depth + size * 0.95;
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0.00, '#6a4f34');   // topsoil just under the grass
  g.addColorStop(0.22, '#7c5838');   // warm subsoil
  g.addColorStop(0.46, '#6e4d33');   // clay
  g.addColorStop(0.68, '#574030');   // packed earth
  g.addColorStop(0.85, '#43342a');   // rock
  g.addColorStop(1.00, '#241a12');   // dark base lip
  ctx.fillStyle = g;
  hexPathLocal(ctx, cx, cy + depth, size);
  ctx.fill();
  // directional light across the face (warm on the sun side, dark opposite) —
  // re-fill the same hex path (no clip) for speed.
  const lg = ctx.createLinearGradient(cx - size, 0, cx + size, 0);
  const warm = `rgba(255,226,168,${0.18 * light})`, dk = `rgba(8,7,14,${0.34 - 0.12 * light})`;
  if (sunX >= 0) { lg.addColorStop(0, dk); lg.addColorStop(1, warm); }
  else { lg.addColorStop(0, warm); lg.addColorStop(1, dk); }
  ctx.fillStyle = lg;
  hexPathLocal(ctx, cx, cy + depth, size);
  ctx.fill();
}

// Per-edge terrain elevation → a tile's vertical lift (mountains rise, water
// sinks), so the land undulates in 3D. The hex footprint is unchanged, so
// placement / picking are unaffected.
const ELEV = { mountain: 0.95, ruins: 0.5, fae: 0.42, forest: 0.34, orchard: 0.3, village: 0.24, moor: 0.16, field: 0.12, marsh: -0.16, coast: -0.2, water: -0.3 };
function tileLift(edges, size) {
  let s = 0; for (let i = 0; i < 6; i++) s += (ELEV[edges[i]] || 0);
  return (s / 6) * size * 0.5;
}

// Ambient-occlusion: a soft inner shadow around a tile's perimeter so each piece
// reads as gently rounded and grounded, with darker creases where tiles meet.
function drawTileAO(ctx, cx, cy, size) {
  ctx.save();
  hexPathLocal(ctx, cx, cy, size); ctx.clip();
  const g = ctx.createRadialGradient(cx, cy, size * 0.46, cx, cy, size * 1.05);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.8, 'rgba(20,16,26,0.12)');
  g.addColorStop(1, 'rgba(16,12,22,0.3)');   // deeper, slightly cool crevice
  ctx.fillStyle = g;
  ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
  ctx.restore();
}

// Atmospheric perspective: tiles far from the vale's heart fade into a faint
// haze, giving the scene depth instead of reading flat.
function drawAtmosphere(ctx, cx, cy, size, dist) {
  const haze = Math.min(0.18, Math.max(0, dist - 2) * 0.03);
  if (haze <= 0.01) return;
  ctx.save();
  hexPathLocal(ctx, cx, cy, size); ctx.clip();
  ctx.fillStyle = `rgba(156,170,184,${haze})`;
  ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
  ctx.restore();
}

// A soft lit highlight on a tile's upper edges (light from above) for a bevel.
function drawTileTopEdge(ctx, cx, cy, size) {
  const c4 = hexCorner(cx, cy, size, 4), c5 = hexCorner(cx, cy, size, 5), c0 = hexCorner(cx, cy, size, 0);
  ctx.save();
  ctx.lineWidth = Math.max(1, size * 0.05);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,250,232,0.3)';   // warm sunlit top bevel
  ctx.beginPath(); ctx.moveTo(c4.x, c4.y); ctx.lineTo(c5.x, c5.y); ctx.lineTo(c0.x, c0.y); ctx.stroke();
  ctx.restore();
}

// Soft stacked drop-shadow so the vale feels like it sits on a table. `spread`
// grows the shadow for raised tiles (mountains cast bigger/longer shadows).
function drawTileShadow(ctx, cx, cy, size, spread = 1) {
  const layers = [[0.20, 0.10], [0.13, 0.13], [0.06, 0.16]];
  for (const [off, alpha] of layers) {
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    hexPathLocal(ctx, cx, cy + size * off, size * spread);
    ctx.fill();
  }
}

// Animated glints traveling along a tile's river ribbons (water edges).
function drawWaterShimmer(ctx, cx, cy, size, edges, t) {
  const APO = Math.sqrt(3) / 2;
  const ids = [];
  for (let i = 0; i < 6; i++) if (edges[i] === 'water') ids.push(i);
  if (ids.length === 0) return;
  const mid = (i) => {
    const a = (60 * i) * Math.PI / 180;
    return { x: cx + size * APO * Math.cos(a), y: cy + size * APO * Math.sin(a) };
  };
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  // Glints + small chevron ripples flowing downstream for a sense of current.
  const a = ids[0], b = ids.length >= 2 ? ids[1] : null;
  const m0 = mid(a);
  const c = { x: cx, y: cy };
  const m1 = b != null ? mid(b) : c;
  const at = (p) => { const u = 1 - p; return { x: u * u * m0.x + 2 * u * p * c.x + p * p * m1.x, y: u * u * m0.y + 2 * u * p * c.y + p * p * m1.y }; };
  const GLINTS = 4;
  for (let s = 0; s < GLINTS; s++) {
    const p = ((t / 1100) + s / GLINTS) % 1;
    const pt = at(p);
    const fade = Math.sin(p * Math.PI);
    const r = size * 0.09 * fade + 0.01;
    const grd = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r);
    grd.addColorStop(0, `rgba(205,238,255,${0.45 * fade})`);
    grd.addColorStop(1, 'rgba(205,238,255,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2); ctx.fill();
    // a little chevron ripple trailing the glint
    const back = at(Math.max(0, p - 0.04));
    ctx.strokeStyle = `rgba(225,245,255,${0.22 * fade})`;
    ctx.lineWidth = size * 0.018; ctx.lineCap = 'round';
    const ang = Math.atan2(pt.y - back.y, pt.x - back.x) + Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(pt.x + Math.cos(ang) * size * 0.06, pt.y + Math.sin(ang) * size * 0.06);
    ctx.lineTo(pt.x, pt.y);
    ctx.lineTo(pt.x - Math.cos(ang) * size * 0.06, pt.y - Math.sin(ang) * size * 0.06);
    ctx.stroke();
  }
  ctx.restore();
}

// Slow caustic light ripples drifting across open-sea (coast) tiles, so the sea
// shimmers with depth instead of sitting as a flat gradient.
function drawCoastCaustics(ctx, cx, cy, size, edges, t) {
  let cn = 0; for (let i = 0; i < 6; i++) if (edges[i] === 'coast') cn++;
  if (cn < 2) return;
  ctx.save();
  hexPathLocal(ctx, cx, cy, size); ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `rgba(175,222,255,${0.05 + 0.05 * (cn / 6)})`;
  ctx.lineWidth = size * 0.05; ctx.lineCap = 'round';
  for (let b = 0; b < 3; b++) {
    const yy = cy - size * 0.55 + (((t / 2600) + b * 0.34) % 1) * size * 1.1;
    ctx.beginPath();
    for (let x = -1; x <= 1.001; x += 0.25) {
      const px = cx + x * size * 0.82;
      const py = yy + Math.sin(x * 3 + t / 700 + b) * size * 0.06;
      x <= -1 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Big soft shadows drifting across the vale like passing clouds. Drawn over
// the tiles with low alpha, so they only read where there's land beneath.
function drawCloudShadows(ctx, t) {
  const clouds = [
    { w: 260, h: 150, y: 150, speed: 0.010, off: 0, a: 0.07 },
    { w: 340, h: 190, y: 330, speed: 0.007, off: 1300, a: 0.06 },
    { w: 200, h: 120, y: 430, speed: 0.013, off: 700, a: 0.05 },
  ];
  ctx.save();
  for (const c of clouds) {
    const span = BOARD_AREA + c.w * 2;
    const x = ((t * c.speed + c.off) % span) - c.w;
    const g = ctx.createRadialGradient(x, c.y, 0, x, c.y, c.w);
    g.addColorStop(0, `rgba(0,0,0,${c.a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(x, c.y);
    ctx.scale(1, c.h / c.w);
    ctx.beginPath();
    ctx.arc(0, 0, c.w, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// Ambient motes — drifting pollen by day, fireflies in feel. Positions are a
// pure function of time + index, so no state to track or reset.
function drawMotes(ctx, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const N = 22;
  for (let i = 0; i < N; i++) {
    const seedX = (i * 137.5) % BOARD_AREA;
    const driftY = (H - ((t * 0.012 + i * 90) % (H + 80))) + 40;   // slow rise
    const x = seedX + Math.sin(t / 1400 + i * 1.7) * 26;
    const y = driftY + Math.cos(t / 1100 + i) * 12;
    const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t / 600 + i * 2.1)); // twinkle
    const r = 1.1 + (i % 3) * 0.6;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    g.addColorStop(0, `rgba(255,240,190,${0.5 * tw})`);
    g.addColorStop(1, 'rgba(255,240,190,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Twinkling stars across the sky at night (fixed positions, hashed).
function drawStars(ctx, night, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 90; i++) {
    const x = ((i * 137.51) % BOARD_AREA);
    const y = ((i * 53.13 + (i * i * 7) % 211)) % H;
    const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t / 700 + i * 1.3));
    ctx.fillStyle = `rgba(220,228,255,${0.5 * night * tw})`;
    const r = (i % 7 === 0) ? 1.6 : 0.9;
    ctx.fillRect(x, y, r, r);
  }
  ctx.restore();
}

// Slow aurora ribbons across the upper sky (Fae nights).
function drawAurora(ctx, night, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const cols = ['rgba(120,255,190,', 'rgba(150,170,255,', 'rgba(200,130,255,'];
  for (let b = 0; b < 3; b++) {
    ctx.beginPath();
    for (let x = 0; x <= BOARD_AREA; x += 24) {
      const y = 70 + b * 26 + Math.sin(x / 130 + t / 2600 + b) * 26 + Math.sin(x / 47 - t / 3400) * 8;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.lineWidth = 34;
    ctx.strokeStyle = cols[b] + (0.06 * night) + ')';
    ctx.stroke();
  }
  ctx.restore();
}

// Creeping blight overlay on a corrupted tile.
function drawCorruption(ctx, cx, cy, size, tile, t) {
  if (!tile.corrupt) return;
  const seed = hashCoord(tile.q, tile.r);
  const pulse = 0.5 + 0.5 * Math.sin(t / 600 + seed);
  ctx.save();
  hexPathLocal(ctx, cx, cy, size); ctx.clip();
  ctx.fillStyle = `rgba(28,10,36,${0.5 + 0.16 * pulse})`;
  ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `rgba(150,60,180,${0.28 + 0.2 * pulse})`;
  ctx.lineWidth = size * 0.045; ctx.lineCap = 'round';
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + t / 2200;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx + Math.cos(a) * size * 0.4, cy + Math.sin(a) * size * 0.4 + Math.sin(t / 420 + k) * size * 0.1, cx + Math.cos(a) * size * 0.85, cy + Math.sin(a) * size * 0.85);
    ctx.stroke();
  }
  ctx.fillStyle = `rgba(185,85,205,${0.35 + 0.3 * pulse})`;
  for (let k = 0; k < 4; k++) { const a = k * 1.7 + seed; const r = size * 0.5; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, size * 0.06, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();

  // The Blightheart itself: a pulsing dark crystal core (the spread's source).
  if (tile.blightheart) {
    ctx.save();
    const beat = 0.5 + 0.5 * Math.sin(t / 360);
    const gl = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.7);
    gl.addColorStop(0, `rgba(220,70,210,${0.5 + 0.3 * beat})`);
    gl.addColorStop(1, 'rgba(120,20,120,0)');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(cx, cy, size * 0.7, 0, Math.PI * 2); ctx.fill();
    // jagged crystal
    const cr = size * (0.26 + 0.03 * beat);
    ctx.fillStyle = '#2a0a30'; ctx.strokeStyle = `rgba(240,140,255,${0.6 + 0.4 * beat})`; ctx.lineWidth = size * 0.03;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) { const a = -Math.PI / 2 + k * Math.PI / 3; const rr = k % 2 ? cr * 0.55 : cr; const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = `rgba(255,210,255,${0.7 * beat})`;
    ctx.beginPath(); ctx.arc(cx - cr * 0.2, cy - cr * 0.2, size * 0.05, 0, Math.PI * 2); ctx.fill();
    // purge progress ring (fills as a Wardtower aura grinds it down)
    const prog = Math.max(0, Math.min(1, (tile.purge || 0) / 3));
    if (prog > 0) {
      ctx.strokeStyle = 'rgba(150,225,255,0.9)'; ctx.lineWidth = size * 0.07; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(cx, cy, size * 0.42, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
}

// Soft protective domes over every Wardtower's aura — the "warded" zone where
// blight cannot spread. Drawn in the live layer so it gently pulses.
function drawWardAuras(ctx, g, size, ox, oy, t) {
  const APO = Math.sqrt(3) / 2;
  for (const w of g.board.values()) {
    if (w.landmark !== 'wardtower') continue;
    const p = hexToPixel(w.q, w.r, size);
    const cx = ox + p.x, cy = oy + p.y;
    const R = size * APO * 2 * 2.15;                 // ~2-hex radius
    const beat = 0.5 + 0.5 * Math.sin(t / 900 + w.q);
    ctx.save();
    const gl = ctx.createRadialGradient(cx, cy, R * 0.4, cx, cy, R);
    gl.addColorStop(0, 'rgba(140,215,255,0)');
    gl.addColorStop(0.82, `rgba(150,220,255,${0.06 + 0.04 * beat})`);
    gl.addColorStop(1, `rgba(170,230,255,${0.16 + 0.06 * beat})`);
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(190,235,255,${0.22 + 0.12 * beat})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

// A gold star over a prosperous town + a small anchor for a port.
function star5(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  ctx.closePath(); ctx.fill();
}
function drawProsperity(ctx, cx, cy, size, tile, t) {
  if (!tile.townCenter) return;
  if (tile.prosperity >= 3) {
    const yy = cy - size * 0.58, tw = 0.6 + 0.4 * Math.sin(t / 420);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(cx, yy, 0, cx, yy, size * 0.3);
    g.addColorStop(0, `rgba(255,215,110,${0.5 * tw})`); g.addColorStop(1, 'rgba(255,215,110,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, yy, size * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ffd766'; star5(ctx, cx, yy, size * 0.12);
  }
  if (tile.port) {
    const ax = cx + size * 0.52, ay = cy - size * 0.32;
    ctx.save(); ctx.strokeStyle = '#dfeccd'; ctx.lineWidth = Math.max(1, size * 0.03); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(ax, ay - size * 0.09, size * 0.04, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ax, ay - size * 0.05); ctx.lineTo(ax, ay + size * 0.12); ctx.stroke();
    ctx.beginPath(); ctx.arc(ax, ay + size * 0.05, size * 0.1, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
    ctx.restore();
  }
}

// Colorblind aid: a distinct glyph per terrain at each edge midpoint.
function drawTerrainSymbols(ctx, cx, cy, size, edges) {
  const APO = Math.sqrt(3) / 2;
  for (let i = 0; i < 6; i++) {
    const a = 60 * i * Math.PI / 180;
    drawSymbol(ctx, cx + Math.cos(a) * size * APO * 0.8, cy + Math.sin(a) * size * APO * 0.8, edges[i], size);
  }
}
function symWave(ctx, x, y, s) { ctx.beginPath(); ctx.moveTo(x - s * 0.9, y); ctx.quadraticCurveTo(x - s * 0.45, y - s * 0.5, x, y); ctx.quadraticCurveTo(x + s * 0.45, y + s * 0.5, x + s * 0.9, y); ctx.stroke(); }
function drawSymbol(ctx, x, y, terr, size) {
  const s = size * 0.15;
  ctx.save();
  ctx.fillStyle = 'rgba(14,18,14,0.5)'; ctx.beginPath(); ctx.arc(x, y, s * 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#f2eeda'; ctx.fillStyle = '#f2eeda'; ctx.lineWidth = Math.max(1, s * 0.22); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (terr) {
    case 'forest': ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.8, y + s * 0.7); ctx.lineTo(x - s * 0.8, y + s * 0.7); ctx.closePath(); ctx.fill(); break;
    case 'mountain': ctx.beginPath(); ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.8, y + s * 0.7); ctx.lineTo(x - s * 0.8, y + s * 0.7); ctx.closePath(); ctx.stroke(); break;
    case 'field': for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(x - s * 0.8, y + k * s * 0.55); ctx.lineTo(x + s * 0.8, y + k * s * 0.55); ctx.stroke(); } break;
    case 'water': symWave(ctx, x, y, s); break;
    case 'coast': symWave(ctx, x, y - s * 0.4, s); symWave(ctx, x, y + s * 0.4, s); break;
    case 'village': ctx.fillRect(x - s * 0.7, y - s * 0.25, s * 1.4, s * 0.95); ctx.beginPath(); ctx.moveTo(x - s * 0.85, y - s * 0.25); ctx.lineTo(x, y - s); ctx.lineTo(x + s * 0.85, y - s * 0.25); ctx.closePath(); ctx.fill(); break;
    case 'fae': ctx.beginPath(); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s); } ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, s * 0.22, 0, Math.PI * 2); ctx.fill(); break;
    case 'moor': for (const [dx, dy] of [[-0.55, 0.35], [0.55, 0.35], [0, -0.6]]) { ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, s * 0.3, 0, Math.PI * 2); ctx.fill(); } break;
    case 'marsh': for (let k = -1; k <= 1; k++) { const bx = x + k * s * 0.5; ctx.beginPath(); ctx.moveTo(bx, y + s * 0.8); ctx.quadraticCurveTo(bx + s * 0.35, y, bx, y - s * 0.8); ctx.stroke(); } break;
    case 'orchard': ctx.beginPath(); ctx.arc(x, y, s * 0.8, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, s * 0.18, 0, Math.PI * 2); ctx.fill(); break;
    case 'ruins': for (const dx of [-0.45, 0.45]) ctx.fillRect(x + dx * s - s * 0.18, y - s * 0.8, s * 0.36, s * 1.4); break;
  }
  ctx.restore();
}

// Hand-lettered place name centered on a region. Faint sepia ink with a halo.
function drawPlaceLabel(ctx, x, y, size, text, kind) {
  if (size < 30) return;                          // unreadable when zoomed out
  const fs = Math.max(11, size * 0.3);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `italic 600 ${fs}px Georgia, "Times New Roman", serif`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(fs * 0.12)}px`;
  // light halo for legibility over busy terrain
  ctx.lineWidth = fs * 0.32;
  ctx.strokeStyle = 'rgba(244,236,214,0.55)';
  ctx.lineJoin = 'round';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = kind === 'village' ? 'rgba(60,38,22,0.92)' : 'rgba(48,40,26,0.82)';
  ctx.fillText(text, x, y);
  ctx.restore();
}

// Lazily-built tileable paper-grain texture.
let _grain = null;
function getGrain() {
  if (_grain) return _grain;
  const n = 220;
  _grain = document.createElement('canvas');
  _grain.width = n; _grain.height = n;
  const c = _grain.getContext('2d');
  const img = c.createImageData(n, n);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + Math.floor(Math.random() * 90);
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  return _grain;
}

// Paper grain + a gentle warm grade to unify the whole picture.
function drawPaperGrade(ctx) {
  // warm grade (soft-light keeps colours rich)
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = 'rgba(255,226,170,0.1)';
  ctx.fillRect(0, 0, BOARD_AREA, H);
  ctx.restore();
  // paper grain, tiled, very subtle
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.05;
  const g = getGrain();
  for (let y = 0; y < H; y += g.height) for (let x = 0; x < BOARD_AREA; x += g.width) ctx.drawImage(g, x, y);
  ctx.restore();
}

// Parchment border vignette + a compass rose, framing the vale as an old map.
function drawMapFrame(ctx, t) {
  // torn-parchment edge darkening
  ctx.save();
  const m = 0;
  const grdT = ctx.createLinearGradient(0, 0, 0, 70);
  grdT.addColorStop(0, 'rgba(40,30,16,0.45)'); grdT.addColorStop(1, 'rgba(40,30,16,0)');
  ctx.fillStyle = grdT; ctx.fillRect(0, 0, BOARD_AREA, 70);
  const grdB = ctx.createLinearGradient(0, H - 70, 0, H);
  grdB.addColorStop(0, 'rgba(40,30,16,0)'); grdB.addColorStop(1, 'rgba(40,30,16,0.5)');
  ctx.fillStyle = grdB; ctx.fillRect(0, H - 70, BOARD_AREA, 70);
  const grdL = ctx.createLinearGradient(0, 0, 70, 0);
  grdL.addColorStop(0, 'rgba(40,30,16,0.45)'); grdL.addColorStop(1, 'rgba(40,30,16,0)');
  ctx.fillStyle = grdL; ctx.fillRect(0, 0, 70, H);
  const grdR = ctx.createLinearGradient(BOARD_AREA - 70, 0, BOARD_AREA, 0);
  grdR.addColorStop(0, 'rgba(40,30,16,0)'); grdR.addColorStop(1, 'rgba(40,30,16,0.45)');
  ctx.fillStyle = grdR; ctx.fillRect(BOARD_AREA - 70, 0, 70, H);
  ctx.restore();
  // compass rose, bottom-left
  drawCompass(ctx, 56, H - 56, 30, t);
}

function drawCompass(ctx, x, y, r, t) {
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.translate(x, y);
  ctx.strokeStyle = '#d8c9a4'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, r * 0.78, 0, Math.PI * 2); ctx.stroke();
  // 4-point star
  for (let d = 0; d < 4; d++) {
    const a = d * Math.PI / 2;
    ctx.fillStyle = d === 0 ? '#e8d8b0' : '#b8a880';
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
    ctx.lineTo(Math.cos(a + 0.35) * r * 0.22, Math.sin(a + 0.35) * r * 0.22);
    ctx.lineTo(Math.cos(a - 0.35) * r * 0.22, Math.sin(a - 0.35) * r * 0.22);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#e8d8b0'; ctx.font = 'bold 11px Georgia, serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('N', 0, -r - 8);
  ctx.restore();
}

// The vale advances one season every 13 tiles placed.
export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];
export function seasonOf(g) { return Math.floor((g.placed || 0) / 13) % 4; }

// Seasonal colour wash + falling weather over the board.
function drawSeason(ctx, season, t) {
  ctx.save();
  if (season === 0) { ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = 'rgba(150,220,140,0.16)'; ctx.fillRect(0, 0, BOARD_AREA, H); }
  else if (season === 2) { ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = 'rgba(225,140,45,0.22)'; ctx.fillRect(0, 0, BOARD_AREA, H); }
  else if (season === 3) {
    ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = 'rgba(150,185,235,0.26)'; ctx.fillRect(0, 0, BOARD_AREA, H);
    ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = 'rgba(205,220,240,0.09)'; ctx.fillRect(0, 0, BOARD_AREA, H);
  }
  ctx.restore();
  if (settings.reducedMotion) return;
  if (season === 0) seasonParticles(ctx, t, '#f7c6dd', 0.8, 12, 'petal');
  else if (season === 2) seasonParticles(ctx, t, '#d98a3a', 1.0, 16, 'leaf');
  else if (season === 3) seasonParticles(ctx, t, '#ffffff', 0.7, 30, 'snow');
}

function seasonParticles(ctx, t, color, speed, count, kind) {
  ctx.save();
  ctx.fillStyle = color;
  const wind = Math.sin(t / 5200) * 46 + Math.sin(t / 1700) * 14;   // gusting wind
  for (let i = 0; i < count; i++) {
    const seedX = (i * 97.3) % BOARD_AREA;
    const fall = ((t * 0.03 * speed) + i * 120) % (H + 60);
    const x = seedX + Math.sin(t / 900 + i * 1.3) * 20 + wind;
    const y = fall - 30;
    ctx.globalAlpha = 0.75;
    if (kind === 'snow') { ctx.beginPath(); ctx.arc(x, y, i % 4 === 0 ? 2.4 : 1.5, 0, Math.PI * 2); ctx.fill(); }
    else {
      ctx.save(); ctx.translate(x, y); ctx.rotate(t / 400 + i);
      ctx.beginPath(); ctx.ellipse(0, 0, 3.2, 1.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// Winter ground cover: soft snow settled on the upper face of a tile, heavier
// toward the top edge — ties the snowfall to the land so winter is *felt*.
function drawSnowCap(ctx, cx, cy, size, seed) {
  const APO = Math.sqrt(3) / 2;
  ctx.save();
  hexPathLocal(ctx, cx, cy, size); ctx.clip();
  const top = cy - size * APO;
  const grd = ctx.createLinearGradient(0, top, 0, cy + size * 0.3);
  grd.addColorStop(0, 'rgba(248,251,255,0.72)');
  grd.addColorStop(0.55, 'rgba(240,246,255,0.34)');
  grd.addColorStop(1, 'rgba(240,246,255,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(cx - size, top, size * 2, size * 1.6);
  // a few soft drifts for texture
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  for (let i = 0; i < 3; i++) {
    const a = ((seed >> (i * 3)) & 7) / 7 * Math.PI - Math.PI / 2;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * size * 0.5, cy - size * 0.45 + Math.sin(a) * size * 0.1, size * 0.26, size * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Cozy wisps of chimney smoke rising from a settlement, more from bigger towns.
function drawChimneySmoke(ctx, cx, cy, size, tile, seed, t) {
  const puffs = 1 + Math.min(2, townTier(tile.townSize));
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  for (let p = 0; p < puffs; p++) {
    const ox = ((((seed >> (p * 4)) & 15) / 15) - 0.5) * size * 0.7;
    const baseX = cx + ox, baseY = cy - size * 0.28;
    const phase = (t / 1400 + p * 0.37 + (seed % 7) * 0.1);
    for (let i = 0; i < 4; i++) {
      const rise = ((phase + i * 0.25) % 1);
      const y = baseY - rise * size * 1.1;
      const x = baseX + Math.sin(phase * 6 + i) * size * 0.12;
      const r = size * (0.07 + rise * 0.13);
      ctx.fillStyle = `rgba(225,222,216,${0.22 * (1 - rise)})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

// A small flock of birds drifting across the sky on a slow cycle.
function drawBirds(ctx, t) {
  const CYCLE = 46000;                       // a flock crosses roughly every ~46s
  const ph = (t % CYCLE) / CYCLE;
  if (ph > 0.6) return;                       // only on-screen for part of the cycle
  const x0 = -40 + ph / 0.6 * (BOARD_AREA + 80);
  const y0 = 70 + Math.sin(t / 9000) * 24;
  const n = 5;
  ctx.save();
  ctx.strokeStyle = 'rgba(40,46,54,0.5)';
  ctx.lineWidth = 2; ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const bx = x0 - i * 22 + (i % 2 ? 0 : 6);
    const by = y0 + Math.abs(i - (n - 1) / 2) * 12;
    const flap = Math.sin(t / 150 + i) * 4;
    ctx.beginPath();
    ctx.moveTo(bx - 7, by + flap);
    ctx.lineTo(bx, by - 3);
    ctx.lineTo(bx + 7, by + flap);
    ctx.stroke();
  }
  ctx.restore();
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// Animate queued bloom waves: a ring of the region's colour rolls outward from
// the seed tile, each tile popping a few flowers as the wave reaches it.
function drawBlooms(ctx, g, ox, oy, size, t) {
  if (!g.blooms || !g.blooms.length) return;
  for (const b of g.blooms) {
    if (b.bornT == null) { b.bornT = t; b.maxD = b.tiles.reduce((m, x) => Math.max(m, x.d), 0); }
    const age = t - b.bornT;
    const col = TERRAIN[b.terrain] || TERRAIN.field;
    for (const tl of b.tiles) {
      const reach = age - tl.d * 150;
      if (reach < 0 || reach > 700) continue;
      const p = reach / 700, ease = 1 - Math.pow(1 - p, 3);
      const pos = hexToPixel(tl.q, tl.r, size);
      const cx = ox + pos.x, cy = oy + pos.y;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const r = size * 0.5 * ease + 0.01;
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, hexToRgba(col.c1, 0.5 * (1 - p)));
      grd.addColorStop(1, hexToRgba(col.c1, 0));
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = (1 - p);
      ctx.fillStyle = col.c1;
      for (let f = 0; f < 4; f++) {
        const a = f * 1.7 + tl.d, fr = r * 0.6;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * fr, cy + Math.sin(a) * fr, size * 0.05 * (1 - p) + 1, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }
  g.blooms = g.blooms.filter(b => (t - (b.bornT || t)) < (b.maxD || 0) * 150 + 900);
}

// Firework celebrations over a town that hit a new tier. Each festival fires a
// few staggered shells over ~3.5s, then is removed.
const FW_COLORS = ['#ffd766', '#ff7a6e', '#8ff08a', '#7cb6e0', '#d39bff', '#ffffff'];
function drawFestivals(ctx, g, ox, oy, size, t) {
  if (!g.festivals || !g.festivals.length) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const f of g.festivals) {
    if (f.bornT == null) f.bornT = t;
    const age = t - f.bornT;
    const pos = hexToPixel(f.q, f.r, size);
    const baseX = ox + pos.x, baseY = oy + pos.y;
    const shells = 5;
    for (let s = 0; s < shells; s++) {
      const launch = s * 540 + ((s * 97) % 220);
      const sa = age - launch;
      if (sa < 0 || sa > 1100) continue;
      const sp = sa / 1100;
      const sx = baseX + ((s % 2 ? 1 : -1) * (0.3 + (s % 3) * 0.25)) * size;
      const sy = baseY - size * (0.8 + (s % 2) * 0.5);
      const col = FW_COLORS[s % FW_COLORS.length];
      const burstR = size * (0.1 + sp * 0.75);
      const fade = 1 - sp;
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2;
        const px = sx + Math.cos(a) * burstR, py = sy + Math.sin(a) * burstR + sp * sp * size * 0.4;
        ctx.fillStyle = hexToRgba(col, 0.9 * fade);
        ctx.beginPath(); ctx.arc(px, py, size * 0.035 * fade + 0.5, 0, Math.PI * 2); ctx.fill();
      }
      // flash core early
      if (sp < 0.25) { ctx.fillStyle = hexToRgba(col, 0.5 * (1 - sp / 0.25)); ctx.beginPath(); ctx.arc(sx, sy, size * 0.2, 0, Math.PI * 2); ctx.fill(); }
    }
  }
  ctx.restore();
  g.festivals = g.festivals.filter(f => (t - (f.bornT || t)) < 3600);
}

// Soft outline + tint over the connected region the cursor is resting on.
function drawRegionHighlight(ctx, g, tile, ox, oy, size, t) {
  // dominant terrain of the hovered tile
  const counts = {}; let terr = tile.edges[0], best = 0;
  for (const e of tile.edges) { counts[e] = (counts[e] || 0) + 1; if (counts[e] > best) { best = counts[e]; terr = e; } }
  const region = regionTiles(g, tile, terr);
  if (region.size < 2) return;
  const col = TERRAIN[terr] || TERRAIN.field;
  const pulse = 0.5 + 0.5 * Math.sin(t / 240);
  ctx.save();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = hexToRgba(col.c1, 0.35 + 0.3 * pulse);
  for (const rk of region) {
    const tt = g.board.get(rk);
    const p = hexToPixel(tt.q, tt.r, size);
    drawHexOutline(ctx, ox + p.x, oy + p.y, size * 0.9, hexToRgba(col.c1, 0.45 + 0.3 * pulse), 2.5, false);
  }
  ctx.restore();
}

// Warm vignette from the board edges, intensifying with the combo.
function drawComboGlow(ctx, combo) {
  if (combo < 2) return;
  const intensity = Math.min(1, (combo - 1) / 6);
  ctx.save();
  const g = ctx.createRadialGradient(BOARD_AREA / 2, H / 2, H * 0.32, BOARD_AREA / 2, H / 2, H * 0.78);
  g.addColorStop(0, 'rgba(255,130,50,0)');
  g.addColorStop(1, `rgba(255,130,50,${0.2 * intensity})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, BOARD_AREA, H);
  ctx.restore();
}

// Slow weather cycle (~58s): a rain shower that passes, then a brief rainbow.
function weatherOf(t) {
  const c = (t / 58000) % 1;
  let rain = 0, rainbow = 0;
  if (c > 0.55 && c < 0.8) rain = Math.sin((c - 0.55) / 0.25 * Math.PI);
  if (c >= 0.78 && c < 0.93) rainbow = 1 - (c - 0.78) / 0.15;
  return { rain, rainbow };
}

function drawWeather(ctx, t, season) {
  const { rain, rainbow } = weatherOf(t);
  // In winter the shower falls as snow (handled by drawSeason), not rain.
  if (rain > 0.02 && season !== 3) {
    ctx.save();
    ctx.strokeStyle = `rgba(170,195,225,${0.35 * rain})`;
    ctx.lineWidth = 1.2;
    const n = Math.floor(120 * rain);
    for (let i = 0; i < n; i++) {
      const x = (i * 79.3 + (t * 0.5)) % BOARD_AREA;
      const y = (i * 53.7 + t * 1.1 * (0.8 + rain)) % H;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 14); ctx.stroke();
    }
    ctx.fillStyle = `rgba(30,40,60,${0.18 * rain})`;
    ctx.fillRect(0, 0, BOARD_AREA, H);
    if (rain > 0.55 && Math.sin(t / 71) > 0.985) { ctx.fillStyle = 'rgba(235,240,255,0.4)'; ctx.fillRect(0, 0, BOARD_AREA, H); }
    ctx.restore();
  }
  if (rainbow > 0.02) {
    ctx.save();
    ctx.globalAlpha = rainbow * 0.5;
    ctx.lineWidth = 5;
    const bands = ['#e06b6b', '#e0b15b', '#d9d96b', '#7fce6f', '#6fa8d9', '#9b6fd9'];
    bands.forEach((c, i) => { ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(BOARD_AREA * 0.5, H * 1.05, 230 + i * 5, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); });
    ctx.restore();
  }
}

// Diagonal volumetric light shafts at dawn/dusk.
function drawGodRays(ctx, warmth, t) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const sway = Math.sin(t / 4000) * 20;
  for (let i = 0; i < 5; i++) {
    const x = 40 + i * 150 + sway;
    const g = ctx.createLinearGradient(x, 0, x - 120, H);
    g.addColorStop(0, `rgba(255,225,150,${0.05 * warmth})`);
    g.addColorStop(1, 'rgba(255,225,150,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 60, 0); ctx.lineTo(x - 60, H); ctx.lineTo(x - 120, H); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

// Time of day from the clock: a full day every ~96s. Returns helpers in
// 0..1 — `night` (0 noon … 1 midnight) and `warmth` (peaks at dawn/dusk).
function dayCycle(t) {
  const phase = (t / 96000) % 1;                 // 0 = noon
  const dayLight = 0.5 + 0.5 * Math.cos(phase * 2 * Math.PI);
  const night = 1 - dayLight;
  const warmth = Math.max(0, 1 - Math.abs(dayLight - 0.5) * 2);
  return { night, warmth };
}

// Directional sun + time-of-day tint over the board. Returns the night amount.
function drawDaylight(ctx, t) {
  const { night, warmth } = settings.dayNight ? dayCycle(t) : { night: 0, warmth: 0 };
  // warm directional sun (soft-light keeps colors rich)
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  const warm = ctx.createLinearGradient(0, 0, BOARD_AREA * 0.6, H);
  warm.addColorStop(0, `rgba(255,205,130,${0.34 + 0.34 * warmth})`);
  warm.addColorStop(0.5, 'rgba(255,225,180,0.06)');
  warm.addColorStop(1, `rgba(30,40,80,${0.28 + 0.34 * night})`);
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, BOARD_AREA, H);
  ctx.restore();
  // night darkening (cool blue)
  if (night > 0.02) {
    ctx.fillStyle = `rgba(14,20,48,${night * 0.52})`;
    ctx.fillRect(0, 0, BOARD_AREA, H);
  }
  // dawn/dusk orange wash
  if (warmth > 0.02) {
    ctx.fillStyle = `rgba(255,120,40,${warmth * 0.12})`;
    ctx.fillRect(0, 0, BOARD_AREA, H);
  }
  // focus vignette
  ctx.save();
  const vig = ctx.createRadialGradient(BOARD_AREA / 2, H / 2, H * 0.35, BOARD_AREA / 2, H / 2, H * 0.8);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, `rgba(0,0,0,${0.28 + night * 0.18})`);
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, BOARD_AREA, H);
  ctx.restore();
  return night;
}

export function render(ctx, g, view, mouse, t, opts) {
  const bgMode = !!(opts && opts.bg);   // background-showcase mode (title screen)
  ctx.clearRect(0, 0, W, H);

  // ---- Board area (clipped so tiles don't bleed under the panel) ----
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, BOARD_AREA, H);
  ctx.clip();

  // Diorama backdrop: a cool "back wall" card up top fades to a warm wood
  // tabletop below, with a radial focus vignette — so the vale reads as a model
  // in a little display box, not a flat map on void.
  const back = ctx.createLinearGradient(0, 0, 0, H);
  back.addColorStop(0.00, '#23353b');   // cool sky back-card
  back.addColorStop(0.40, '#1a2a26');
  back.addColorStop(0.58, '#20211a');   // horizon → tabletop
  back.addColorStop(0.78, '#1b1410');
  back.addColorStop(1.00, '#120d08');   // dark wood table
  ctx.fillStyle = back; ctx.fillRect(0, 0, BOARD_AREA, H);
  const vg = ctx.createRadialGradient(BOARD_AREA / 2, H * 0.46, 90, BOARD_AREA / 2, H * 0.52, 560);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(4,6,4,0.5)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, BOARD_AREA, H);

  // Night sky behind the land: stars (always at night) + aurora (once Fae is in
  // the palette). The vale is drawn on top, so these read as the surrounding sky.
  const nightSky = settings.dayNight ? dayCycle(t).night : 0;
  if (nightSky > 0.15) drawStars(ctx, nightSky, t);
  if (nightSky > 0.35 && g.palette && g.palette.includes('fae')) drawAurora(ctx, nightSky, t);

  const size = view.size;
  const ox = BOARD_AREA / 2 + view.panX;
  const oy = H / 2 + view.panY;

  // Open slots (where you may place).
  const slots = g.gameOver ? new Map() : openSlots(g);
  const edges = currentEdges(g);

  // Hovered slot under the mouse.
  let hoverKey = null;
  if (mouse.hex && slots.has(key(mouse.hex.q, mouse.hex.r))) {
    hoverKey = key(mouse.hex.q, mouse.hex.r);
  }

  fx.update(t);
  const season = seasonOf(g);
  const envNight = settings.dayNight ? dayCycle(t).night : 0;
  // Drive prop shadows from the sun: sweep east→west and stretch as it lowers.
  let dayLight = 0.92, hx = 0.34;
  if (settings.dayNight) {
    const ph = (t / 96000) % 1;                          // 0 = noon (matches dayCycle)
    dayLight = 0.5 + 0.5 * Math.cos(ph * 2 * Math.PI);
    hx = Math.sin(ph * 2 * Math.PI);                     // -1 dawn (shadow left) .. +1 dusk (right)
    setSun(hx * 0.95, 0.5 + 0.5 * dayLight, 0.5 + (1 - dayLight) * 1.5, 0.42 + 0.58 * dayLight);
  } else {
    setSun(0.34, 0.94, 0.8, 1);                          // fixed gentle late-morning sun
  }
  const sideLight = 0.4 + 0.6 * dayLight;   // plinth-face brightness over the day
  const depth = size * 0.46;   // chunky tile thickness for the pop-up diorama plinth

  // Depth-sorted (back row first) so each tile's thick side is overlapped by
  // the tile in front — the trick that makes a flat board look 3D.
  const ordered = [...g.board.values()].sort((a, b) => (a.r - b.r) || (a.q - b.q));

  // Smooth each tile's elevation against its neighbours (2 relaxation passes)
  // so the land slopes gently instead of stepping into hard cliffs where tiles
  // of different terrain meet. Footprint is unchanged, so picking is unaffected.
  const HEXN = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  let liftMap = new Map();
  for (const tile of ordered) liftMap.set(key(tile.q, tile.r), tileLift(tile.edges, size));
  for (let pass = 0; pass < 2; pass++) {
    const next = new Map();
    for (const tile of ordered) {
      const kk = key(tile.q, tile.r);
      let sum = liftMap.get(kk), n = 1;
      for (const [dq, dr] of HEXN) { const v = liftMap.get(key(tile.q + dq, tile.r + dr)); if (v !== undefined) { sum += v; n++; } }
      next.set(kk, liftMap.get(kk) * 0.45 + (sum / n) * 0.55);
    }
    liftMap = next;
  }
  const liftOf = (tile) => liftMap.get(key(tile.q, tile.r)) || 0;

  // ---- Begin tilted board space (foreshorten vertically around the layout
  // origin). All board-positioned draws below inherit the tilt; full-screen
  // washes are drawn outside it. BOARD_TILT=1 makes this a no-op (flat).
  ctx.save();
  ctx.translate(0, oy); ctx.scale(1, BOARD_TILT); ctx.translate(0, -oy);

  // Unified soft contact shadow: the whole diorama casts onto the tabletop.
  {
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const tile of ordered) { const p = hexToPixel(tile.q, tile.r, size); const px = ox + p.x, py = oy + p.y; if (px < minX) minX = px; if (px > maxX) maxX = px; if (py < minY) minY = py; if (py > maxY) maxY = py; }
    if (minX < maxX) {
      const bcx = (minX + maxX) / 2, bcy = (minY + maxY) / 2, brx = (maxX - minX) / 2 + size * 1.6;
      ctx.save();
      ctx.translate(bcx + size * 0.3, bcy + depth * 1.5); ctx.scale(1, 0.46);
      const sh = ctx.createRadialGradient(0, 0, size, 0, 0, brx);
      sh.addColorStop(0, 'rgba(0,0,0,0.4)'); sh.addColorStop(0.7, 'rgba(0,0,0,0.18)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(0, 0, brx, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  // Pass 1: a soft ground shadow under each raised tile — offset opposite the
  // sun and grown by the tile's height, so mountains cast longer shadows.
  for (const tile of ordered) {
    const p = hexToPixel(tile.q, tile.r, size);
    const lift = Math.max(0, liftOf(tile));
    const lf = lift / size;                              // 0..~0.5
    drawTileShadow(ctx, ox + p.x - hx * lf * size * 0.7, oy + p.y + depth / BOARD_TILT, size, 1 + lf * 0.9);
  }

  // Pass 2: extruded side wall + cached top face + live foliage/life.
  for (const tile of ordered) {
    const p = hexToPixel(tile.q, tile.r, size);
    const cx = ox + p.x;
    const lift = liftOf(tile);                           // neighbour-smoothed terrain elevation
    const cy = oy + p.y - lift;                          // raised top; footprint stays on the plane
    const tk = key(tile.q, tile.r);
    const sz = size * (fx.dropScale(tk) || 1) * fx.rippleScale(tk);
    const seed = hashCoord(tile.q, tile.r);
    const town = tile.townSize ? { tier: townTier(tile.townSize), center: !!tile.townCenter } : null;
    const sideDepth = Math.max(depth * 0.3, depth + lift) / BOARD_TILT;
    drawTileSide(ctx, cx, cy, sz, sideDepth, sideLight, hx);   // lit, height-aware front face
    blitTile(ctx, cx, cy, sz, tile.edges, seed, tile.landmark, town);
    drawTileAO(ctx, cx, cy, sz);
    drawAtmosphere(ctx, cx, cy, sz, hexDist(tile.q, tile.r, 0, 0));
    drawTileTopEdge(ctx, cx, cy, sz);
    if (season === 3 && !tile.corrupt) drawSnowCap(ctx, cx, cy, sz, seed);
    // Ground-level life stays foreshortened (on the plane).
    drawWaterShimmer(ctx, cx, cy, size, tile.edges, t);
    drawCoastCaustics(ctx, cx, cy, size, tile.edges, t);
    drawLife(ctx, cx, cy, size, tile, t, envNight, season);
    // Stand the tall props up: undo the vertical foreshorten around this tile's
    // base, so trees / buildings / landmarks rise off the tilted ground.
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(1, 1 / BOARD_TILT); ctx.translate(-cx, -cy);
    drawFoliage(ctx, cx, cy, sz, tile.edges, seed, t, season);
    if (tile.edges.includes('village') || tile.landmark) drawStructures(ctx, cx, cy, sz, tile.edges, seed, tile.landmark, town);
    ctx.restore();
    if (tile.townSize && !tile.corrupt && !settings.reducedMotion) drawChimneySmoke(ctx, cx, cy, size, tile, seed, t);
    if (tile.corrupt) drawCorruption(ctx, cx, cy, size, tile, t);
    if (tile.burning) drawFireFx(ctx, cx, cy, sz, t, seed);
    else if (tile.ash) drawAshFx(ctx, cx, cy, sz, seed, t);
    if (tile.flooded) drawFloodFx(ctx, cx, cy, sz, t, seed);
    else if (tile.floodplain) drawFloodplainFx(ctx, cx, cy, sz, seed);
    if (tile.harvested) drawStubbleFx(ctx, cx, cy, sz, seed);
    if (tile.heirloom) drawHexOutline(ctx, cx, cy, sz * 0.97, `rgba(255,214,102,${0.3 + 0.2 * Math.sin(t / 420)})`, 2, false);
    if (tile.overgrown && !tile.burning) drawOvergrowthFx(ctx, cx, cy, sz, seed, t);
    if (tile.irrigated && !tile.corrupt && !tile.burning && !settings.reducedMotion) drawIrrigationGlints(ctx, cx, cy, sz, t, seed);
    if (!settings.reducedMotion && tile.edges.includes('water')) drawFlowStreaks(ctx, cx, cy, size, tile, g, liftOf, t);
    if (settings.symbols) drawTerrainSymbols(ctx, cx, cy, size, tile.edges);
    if (!tile.corrupt) drawProsperity(ctx, cx, cy, size, tile, t);
    const qd = g.quests.find(q => q.q === tile.q && q.r === tile.r);
    if (qd) drawQuestFlag(ctx, cx, cy, size, qd, t);
  }

  // A visiting traveller strolling the vale.
  if (g.visitor) {
    const vt = g.board.get(key(g.visitor.q, g.visitor.r));
    const vp = hexToPixel(g.visitor.q, g.visitor.r, size);
    drawVisitor(ctx, ox + vp.x, oy + vp.y - (vt ? liftOf(vt) : 0), size, g.visitor, t);
  }

  // Wardtower protective domes (the "warded" zones blight cannot enter).
  if (g.corruptionOn !== false) drawWardAuras(ctx, g, size, ox, oy, t);

  // Region bloom waves — color ripples outward from a just-completed decree.
  drawBlooms(ctx, g, ox, oy, size, t);

  // Festival fireworks when a town reaches a new milestone.
  drawFestivals(ctx, g, ox, oy, size, t);

  // Highlight the connected region under the cursor (over a placed tile).
  if (mouse.hex) {
    const ht = g.board.get(key(mouse.hex.q, mouse.hex.r));
    if (ht && !hoverKey) drawRegionHighlight(ctx, g, ht, ox, oy, size, t);
  }

  // Drifting cloud shadows over the land (only visible where tiles are).
  if (!settings.reducedMotion) drawCloudShadows(ctx, t);

  // Draw open slots as subtle pulsing rings.
  const pulse = 0.5 + 0.5 * Math.sin(t / 360);
  if (!bgMode) for (const s of slots.values()) {
    const p = hexToPixel(s.q, s.r, size);
    drawHexOutline(ctx, ox + p.x, oy + p.y, size * 0.94,
      `rgba(190,220,170,${0.18 + 0.16 * pulse})`, 1.5, true);
  }

  // Ghost preview of the current tile under the hovered slot — lifts and bobs
  // gently, casting a shadow below so it reads as held above the board.
  if (!bgMode && hoverKey && edges) {
    const s = slots.get(hoverKey);
    const p = hexToPixel(s.q, s.r, size);
    const baseX = ox + p.x, baseY = oy + p.y;
    const lift = size * (0.16 + 0.05 * Math.sin(t / 300));   // hover bob
    const cx = baseX, cy = baseY - lift;
    // shadow on the slot it will drop into
    ctx.save();
    ctx.globalAlpha = 0.28;
    drawTileShadow(ctx, baseX, baseY + size * 0.06, size * 0.96);
    ctx.restore();
    drawTileSide(ctx, cx, cy, size, size * 0.3 / BOARD_TILT);
    drawTile(ctx, cx, cy, size, edges, hashCoord(s.q, s.r), g.current && g.current.landmark, t);
    drawTileTopEdge(ctx, cx, cy, size);
    if (settings.symbols) drawTerrainSymbols(ctx, cx, cy, size, edges);
    drawHexOutline(ctx, cx, cy, size, '#f3ead0', 3, false);
    // Show per-edge match ticks (on the lifted tile).
    drawMatchTicks(ctx, cx, cy, size, g, s.q, s.r, edges);
    // Live scoring breakdown so the player learns how points work.
    drawScoreBreakdown(ctx, cx + size * 0.7, cy - size * 1.3, previewScore(g, s.q, s.r, edges));
  }

  ctx.restore();   // ---- End tilted board space ----

  // Day -> dusk -> night lighting wash over the whole vale (full-screen).
  const night = drawDaylight(ctx, t);

  // Lit-town pass: settlements glow warm at dusk & night (over the darkening).
  if (night > 0.04) {
    ctx.save();
    ctx.translate(0, oy); ctx.scale(1, BOARD_TILT); ctx.translate(0, -oy);
    // Hungry folk dim the hearths: window glow softens while needs go unmet.
    const litNight = (g.needs && !g.needs.met && g.needs.pop >= 6) ? night * 0.55 : night;
    for (const tile of g.board.values()) {
      if (!tile.townSize || tile.corrupt) continue;
      const p = hexToPixel(tile.q, tile.r, size);
      const lx = ox + p.x, ly = oy + p.y;
      // Bloom: the settlement radiates a soft warm halo, not just lit windows.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const tier = townTier(tile.townSize);
      const hr = size * (1.3 + tier * 0.25);
      const hg = ctx.createRadialGradient(lx, ly, size * 0.1, lx, ly, hr);
      hg.addColorStop(0, `rgba(255,178,84,${(0.14 + tier * 0.05) * litNight})`);
      hg.addColorStop(1, 'rgba(255,178,84,0)');
      ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(lx, ly, hr, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      drawTownLights(ctx, lx, ly, size, tile, t, litNight);
    }
    ctx.restore();
  }

  // Fireflies over the countryside at night (after the dark wash so they glow).
  if (night > 0.35) {
    ctx.save();
    ctx.translate(0, oy); ctx.scale(1, BOARD_TILT); ctx.translate(0, -oy);
    for (const tile of g.board.values()) {
      const p = hexToPixel(tile.q, tile.r, size);
      drawNightFireflies(ctx, ox + p.x, oy + p.y, size, tile, t, night);
    }
    ctx.restore();
  }

  // Seasonal tint + weather (the vale ages through the seasons as it grows).
  drawSeason(ctx, seasonOf(g), t);

  // Hand-lettered place names over large regions & towns.
  if (settings.labels) {
    ctx.save();
    ctx.translate(0, oy); ctx.scale(1, BOARD_TILT); ctx.translate(0, -oy);
    for (const tile of g.board.values()) {
      if (!tile.label) continue;
      const p = hexToPixel(tile.q, tile.r, size);
      drawPlaceLabel(ctx, ox + p.x, oy + p.y, size, tile.label, tile.labelKind);
    }
    ctx.restore();
  }

  // Sky drama: god rays at golden hour, passing rain showers + rainbow.
  if (settings.weather) {
    const { warmth } = settings.dayNight ? dayCycle(t) : { warmth: 0 };
    if (warmth > 0.15) drawGodRays(ctx, warmth, t);
    drawWeather(ctx, t, season);
    // Active weather front: a soft colour wash telegraphs the change.
    const wt = g.weather && g.weather.type;
    if (wt) {
      const col = wt === 'sun' ? '255,206,118' : wt === 'rain' ? '116,166,200' : '178,204,236';
      const vg = ctx.createRadialGradient(BOARD_AREA / 2, H / 2, H * 0.3, BOARD_AREA / 2, H / 2, H * 0.78);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(${col},0.15)`);
      ctx.fillStyle = vg; ctx.fillRect(0, 0, BOARD_AREA, H);
    }
  }

  // Warm glow creeps from the edges as the combo climbs.
  if (!bgMode) drawComboGlow(ctx, g.combo || 0);

  // Particle juice (dust, sparks, rings, floating score) above the tiles.
  if (!bgMode) fx.draw(ctx);

  // Ambient motes (drifting pollen / fireflies) float over the whole vale.
  if (!settings.reducedMotion) drawMotes(ctx, t);

  // A flock of birds occasionally drifts across the sky.
  if (!settings.reducedMotion) drawBirds(ctx, t);

  // Unifying pass: subtle paper grain + warm grade so it reads as one painting.
  drawPaperGrade(ctx);

  // Parchment frame + compass rose around the vale (not in showcase mode).
  if (!bgMode) drawMapFrame(ctx, t);

  ctx.restore();

  // True-perspective keystone: warp the finished board so distant rows converge.
  if (PERSP_K > 0) applyPerspectiveWarp(ctx, ox, oy);

  // Cinematic finish: time-of-day colour grade + tilt-shift miniature blur.
  applyCinematic(ctx, oy, dayLight, night, settings.dayNight ? dayCycle(t).warmth : 0);

  if (bgMode) return;
  if (!g.gameOver) {
    drawZoomButtons(ctx, mouse);
    if (g.current) drawControlButtons(ctx, mouse, g, view);
  }
  // ---- Right HUD panel ----
  drawPanel(ctx, g, view, t);

  if (g.gameOver) drawGameOver(ctx, g, view, t);
}

// Small ticks on each edge of the ghost showing match (green) / mismatch (red).
function drawMatchTicks(ctx, cx, cy, size, g, q, r, edges) {
  for (let i = 0; i < 6; i++) {
    const n = neighbor(q, r, i);
    const nb = g.board.get(key(n.q, n.r));
    if (!nb) continue;
    const opp = (i + 3) % 6;
    const nbEdge = nb.edges[opp];
    const exact = edges[i] === nbEdge;
    const ok = compatible(edges[i], nbEdge);
    const a = hexCorner(cx, cy, size, i);
    const b = hexCorner(cx, cy, size, (i + 1) % 6);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    ctx.beginPath();
    ctx.arc(mx, my, 4.5, 0, Math.PI * 2);
    // green = exact match, cyan = compatible blend, red = mismatch
    ctx.fillStyle = exact ? '#8ff08a' : (ok ? '#6fd6e0' : '#ff7a6e');
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.stroke();
  }
}

function drawQuestFlag(ctx, cx, cy, size, qd, t) {
  const terr = TERRAIN[qd.terrain];
  const done = qd.done;
  const phase = (cx + cy) * 0.05;       // de-sync flags so they don't wave in lockstep
  const wave = Math.sin(t / 220 + phase);
  ctx.save();
  ctx.translate(cx, cy - size * 0.18);
  // pole
  ctx.strokeStyle = '#2a1d12';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 10);
  ctx.lineTo(0, -12);
  ctx.stroke();
  // banner — a fluttering pennant (tip curls with the wave)
  const flutter = wave * 2.2;
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.quadraticCurveTo(8, -11 + flutter, 15, -8 + flutter * 0.6);
  ctx.quadraticCurveTo(8, -6 + flutter, 0, -4);
  ctx.closePath();
  ctx.fillStyle = done ? '#7bd86b' : terr.c1;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // progress text under the flag
  ctx.fillStyle = done ? '#bdf3b0' : '#f3ead0';
  ctx.font = 'bold 10px Nunito, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(done ? '✓' : `${qd.size ?? 1}/${qd.target}`, 0, 22);
  ctx.restore();
}

// Compact breakdown panel near the ghost tile showing how the score is built.
function drawScoreBreakdown(ctx, px, py, bd) {
  const rows = [];
  if (bd.matches > 0) rows.push([`${bd.matches} matched edge${bd.matches > 1 ? 's' : ''}`, `+${bd.baseMatch}`, '#cdd9c2']);
  else rows.push(['no edges matched', '+0', '#9a8a8a']);
  if (bd.perfect) rows.push(['PERFECT placement', '+30', '#ffe08a']);
  if (bd.mult > 1) rows.push(['combo bonus', `×${bd.mult % 1 ? bd.mult.toFixed(1) : bd.mult}`, '#ff9a4d']);
  if (bd.estuaries) rows.push(['estuary', `+${bd.estuaryBonus}`, '#6fd6e0']);
  if (bd.seasonBonus) rows.push([`${bd.seasonFavor} (in season)`, `+${bd.seasonBonus}`, '#9bd86b']);
  if (bd.weatherBonus) rows.push([bd.weatherName || 'weather front', `+${bd.weatherBonus}`, '#8fd0e0']);
  if (bd.frozen) rows.push(['frozen river', '+0', '#9fc0d6']);
  if (bd.landmark) rows.push([bd.landmark, `+${bd.landmarkBonus}`, '#b89bd8']);
  const w = 168, lh = 16, h = 14 + rows.length * lh + 26;
  px = Math.max(8, Math.min(BOARD_AREA - w - 8, px));
  py = Math.max(8, Math.min(H - h - 8, py));
  ctx.save();
  roundRect(ctx, px, py, w, h, 8); ctx.fillStyle = 'rgba(14,22,16,0.92)'; ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,224,138,0.25)'; roundRect(ctx, px, py, w, h, 8); ctx.stroke();
  let y = py + 18;
  ctx.font = '11px Nunito, sans-serif';
  for (const [label, val, col] of rows) {
    ctx.textAlign = 'left'; ctx.fillStyle = '#8fa386'; ctx.fillText(label, px + 10, y);
    ctx.textAlign = 'right'; ctx.fillStyle = col; ctx.fillText(val, px + w - 10, y);
    y += lh;
  }
  y += 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px + 10, y); ctx.lineTo(px + w - 10, y); ctx.stroke();
  y += 16;
  ctx.textAlign = 'left'; ctx.fillStyle = '#efe7cf'; ctx.font = 'bold 13px Nunito, sans-serif'; ctx.fillText('Score', px + 10, y);
  ctx.textAlign = 'right'; ctx.fillStyle = '#ffe08a'; ctx.fillText(`+${bd.total}`, px + w - 10, y);
  ctx.restore();
}

function drawFloatLabel(ctx, x, y, text, color) {
  ctx.font = 'bold 15px Nunito, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

// ---- wild forces & living-valley tile effects ----
// Burning tile: licking flames, a warm pulsing glow, and rising smoke.
function drawFireFx(ctx, cx, cy, size, t, seed) {
  const r1 = (seed % 97) / 97, r2 = (seed % 53) / 53;
  ctx.save();
  hexPathLocal(ctx, cx, cy, size); ctx.clip();
  const pulse = 0.55 + 0.25 * Math.sin(t / 110 + r1 * 9);
  ctx.globalCompositeOperation = 'lighter';                  // luminous, not painted
  const g = ctx.createRadialGradient(cx, cy, size * 0.1, cx, cy, size);
  g.addColorStop(0, `rgba(255,140,40,${0.38 * pulse})`);
  g.addColorStop(1, 'rgba(120,30,0,0)');
  ctx.fillStyle = g; ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
  ctx.restore();
  for (let i = 0; i < 3; i++) {
    const fx0 = cx + (i - 1) * size * 0.34 + Math.sin(t / 150 + i * 2 + r2 * 6) * size * 0.05;
    const fy = cy + size * 0.18;
    const h = size * (0.34 + 0.1 * Math.sin(t / 90 + i * 1.7 + r1 * 4));
    ctx.fillStyle = 'rgba(255,120,30,0.85)';
    ctx.beginPath(); ctx.moveTo(fx0 - size * 0.1, fy);
    ctx.quadraticCurveTo(fx0 - size * 0.12, fy - h * 0.5, fx0, fy - h);
    ctx.quadraticCurveTo(fx0 + size * 0.12, fy - h * 0.5, fx0 + size * 0.1, fy);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,220,120,0.9)';
    ctx.beginPath(); ctx.moveTo(fx0 - size * 0.05, fy);
    ctx.quadraticCurveTo(fx0, fy - h * 0.45, fx0 + size * 0.05, fy);
    ctx.closePath(); ctx.fill();
    const sp = ((t / 14 + i * 37 + (seed % 211)) % 90) / 90;   // smoke puff lifecycle
    ctx.fillStyle = `rgba(70,60,58,${0.3 * (1 - sp)})`;
    ctx.beginPath(); ctx.arc(fx0 + sp * size * 0.18, fy - h - sp * size * 0.7, size * (0.08 + sp * 0.12), 0, Math.PI * 2); ctx.fill();
  }
}
// Burnt-out tile: a scorched wash with slowly fading embers.
function drawAshFx(ctx, cx, cy, size, seed, t) {
  ctx.save();
  hexPathLocal(ctx, cx, cy, size); ctx.clip();
  ctx.fillStyle = 'rgba(28,22,20,0.58)';
  ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
  for (let i = 0; i < 4; i++) {
    const a = ((seed >> i) % 7) / 7 * Math.PI * 2, rr = size * (0.2 + ((seed >> (i + 2)) % 5) / 10);
    const e = 0.25 + 0.2 * Math.sin(t / 300 + i * 2.1);
    ctx.fillStyle = `rgba(255,110,40,${e})`;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.7, size * 0.035, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
// Flooded tile: a translucent water sheet with drifting ripple rings.
function drawFloodFx(ctx, cx, cy, size, t, seed) {
  ctx.save(); hexPathLocal(ctx, cx, cy, size); ctx.clip();
  ctx.fillStyle = 'rgba(62,112,150,0.5)';
  ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
  for (let i = 0; i < 2; i++) {
    const ph = ((t / 1400 + i * 0.5 + (seed % 9) / 9) % 1);
    ctx.strokeStyle = `rgba(210,235,250,${0.3 * (1 - ph)})`;
    ctx.lineWidth = 1.2;
    const rr = size * 0.2 + ph * size * 0.5;
    ctx.beginPath(); ctx.ellipse(cx, cy + size * 0.08, rr, rr * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}
// Receded floodplain: rich dark silt dotted with new green sprouts.
function drawFloodplainFx(ctx, cx, cy, size, seed) {
  ctx.save(); hexPathLocal(ctx, cx, cy, size); ctx.clip();
  ctx.fillStyle = 'rgba(74,58,38,0.4)';
  ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
  ctx.fillStyle = 'rgba(140,200,110,0.8)';
  for (let i = 0; i < 4; i++) {
    const a = ((seed >> i) % 9) / 9 * Math.PI * 2, rr = size * (0.15 + ((seed >> (i + 3)) % 5) / 12);
    ctx.fillRect(cx + Math.cos(a) * rr - 0.8, cy + Math.sin(a) * rr * 0.7 - 2.5, 1.6, 3.5);
  }
  ctx.restore();
}
// Overgrown tile: tangled bramble vines creeping over tame land.
function drawOvergrowthFx(ctx, cx, cy, size, seed, t) {
  ctx.save(); hexPathLocal(ctx, cx, cy, size); ctx.clip();
  ctx.fillStyle = 'rgba(30,52,26,0.38)';
  ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
  ctx.strokeStyle = 'rgba(46,82,38,0.9)'; ctx.lineWidth = Math.max(1, size * 0.04); ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const a0 = ((seed >> i) % 6) / 6 * Math.PI * 2;
    const sway = Math.sin(t / 800 + i * 2) * size * 0.03;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a0) * size * 0.8, cy + Math.sin(a0) * size * 0.55);
    ctx.quadraticCurveTo(cx + sway, cy - size * 0.05, cx + Math.cos(a0 + 2.5) * size * 0.55, cy + Math.sin(a0 + 2.5) * size * 0.4);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(120,60,90,0.85)';
  for (let i = 0; i < 3; i++) { const a = ((seed >> (i + 2)) % 8) / 8 * Math.PI * 2; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * size * 0.4, cy + Math.sin(a) * size * 0.3, size * 0.04, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}
// Rivers visibly flow downhill: light streaks drift toward the lower
// neighbouring water tile (direction from the smoothed elevation map).
const FLOWN = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
function drawFlowStreaks(ctx, cx, cy, size, tile, g, liftOf, t) {
  let vx = 0, vy = 0, wn = 0;
  const own = liftOf(tile);
  for (let i = 0; i < 6; i++) {
    if (tile.edges[i] !== 'water') continue;
    wn++;
    const nb = g.board.get(key(tile.q + FLOWN[i][0], tile.r + FLOWN[i][1]));
    if (!nb || !nb.edges.includes('water')) continue;
    const d = own - liftOf(nb);                       // positive → downhill that way
    const a = 60 * i * Math.PI / 180;
    vx += Math.cos(a) * d; vy += Math.sin(a) * d;
  }
  if (!wn) return;
  const mag = Math.hypot(vx, vy);
  if (mag < size * 0.012) return;                     // essentially still water
  vx /= mag; vy /= mag;
  const seed = hashCoord(tile.q, tile.r);
  for (let i = 0; i < 2; i++) {
    const ph = ((t / 800 + i * 0.5 + ((seed >> i) % 7) / 7) % 1);
    const d0 = (ph - 0.5) * size * 0.9;
    const px = cx + vx * d0, py = cy + vy * d0 * 0.85;
    ctx.strokeStyle = `rgba(220,245,255,${0.35 * Math.sin(ph * Math.PI)})`;
    ctx.lineWidth = Math.max(1, size * 0.045); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(px - vx * size * 0.12, py - vy * size * 0.12);
    ctx.lineTo(px + vx * size * 0.12, py + vy * size * 0.12); ctx.stroke();
  }
}

// A named visitor strolling the vale: cloaked figure + staff + name tag.
const VISITOR_COLS = { maren: '#c9a13b', sylfa: '#9b6fd0', bram: '#7a8b9b', tilda: '#c96f3b', rook: '#6b6b6b' };
function drawVisitor(ctx, cx, cy, size, v, t) {
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(1, 1 / BOARD_TILT); ctx.translate(-cx, -cy);   // stand upright
  const bob = Math.sin(t / 420) * size * 0.02;
  const s = size * 0.36, y0 = cy + bob;
  const col = VISITOR_COLS[v.id] || '#c9a13b';
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(cx, y0 + s * 0.55, s * 0.45, s * 0.16, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = col;                                          // cloak
  ctx.beginPath(); ctx.moveTo(cx - s * 0.35, y0 + s * 0.5);
  ctx.quadraticCurveTo(cx, y0 - s * 0.75, cx + s * 0.35, y0 + s * 0.5);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#e8c9a0';                                    // head
  ctx.beginPath(); ctx.arc(cx, y0 - s * 0.62, s * 0.22, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#5a3d22'; ctx.lineWidth = Math.max(1.4, s * 0.09); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx + s * 0.45, y0 + s * 0.5); ctx.lineTo(cx + s * 0.45, y0 - s * 0.72); ctx.stroke();   // staff
  ctx.font = '700 10px Nunito, sans-serif'; ctx.textAlign = 'center';
  const name = v.name.split(' ')[0];
  const w = ctx.measureText(name).width + 14;
  roundRect(ctx, cx - w / 2, y0 - s * 1.55, w, 15, 7);
  ctx.fillStyle = 'rgba(14,20,14,0.85)'; ctx.fill();
  roundRect(ctx, cx - w / 2, y0 - s * 1.55, w, 15, 7);
  ctx.lineWidth = 1.2; ctx.strokeStyle = hexToRgba(col, 0.8); ctx.stroke();
  ctx.fillStyle = '#ffe9b0'; ctx.fillText(name, cx, y0 - s * 1.55 + 11);
  ctx.restore();
}

// Harvested land: pale stubble wash with cut-stalk stubs while it regrows.
function drawStubbleFx(ctx, cx, cy, size, seed) {
  ctx.save(); hexPathLocal(ctx, cx, cy, size); ctx.clip();
  ctx.fillStyle = 'rgba(216,196,140,0.32)';
  ctx.fillRect(cx - size, cy - size, size * 2, size * 2);
  ctx.strokeStyle = 'rgba(150,126,80,0.8)'; ctx.lineWidth = Math.max(1, size * 0.03); ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const a = ((seed >> i) % 9) / 9 * Math.PI * 2, rr = size * (0.15 + ((seed >> (i + 2)) % 5) / 11);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.7;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - size * 0.08); ctx.stroke();
  }
  ctx.restore();
}

// Irrigated farm: tiny water glints so you can see the river feeding it.
function drawIrrigationGlints(ctx, cx, cy, size, t, seed) {
  for (let i = 0; i < 2; i++) {
    const a = ((seed >> (i * 3)) % 11) / 11 * Math.PI * 2, rr = size * 0.42;
    const tw = 0.25 + 0.25 * Math.sin(t / 420 + i * 2.6 + (seed % 13));
    ctx.fillStyle = `rgba(150,210,235,${tw})`;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.6, size * 0.045, 0, Math.PI * 2); ctx.fill();
  }
}

// ---- On-screen zoom buttons (board corner; drawn after the perspective warp
// so they stay crisp UI, not part of the warped scene) ----
// On small (phone) screens the canvas is scaled down, so logical buttons grow
// to keep their PHYSICAL size near the ~44px touch guideline.
let UI_SCALE = 1;
export function setUiScale(s) { UI_SCALE = s; }
export function zoomButtonRects() {
  const s = Math.round(42 * UI_SCALE), gap = 10, x = BOARD_W - 14 - s, yb = H - 16 - s;
  return {
    zin: { x, y: yb - s - gap, w: s, h: s, label: '+' },
    zout: { x, y: yb, w: s, h: s, label: '−' },
  };
}
export function zoomHit(x, y) {
  const r = zoomButtonRects();
  for (const k of ['zin', 'zout']) { const b = r[k]; if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return k; }
  return null;
}
function drawZoomButtons(ctx, mouse) {
  const r = zoomButtonRects();
  for (const k of ['zin', 'zout']) {
    const b = r[k];
    const hover = mouse && mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
    roundRect(ctx, b.x, b.y, b.w, b.h, 10);
    ctx.fillStyle = hover ? 'rgba(42,34,20,0.96)' : 'rgba(20,16,10,0.82)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = hover ? '#cdb24a' : 'rgba(205,178,74,0.45)'; ctx.stroke();
    ctx.fillStyle = hover ? '#fff7e0' : '#e6ddc6'; ctx.textAlign = 'center';
    ctx.font = '700 25px Nunito, sans-serif';
    ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 9);
  }
  ctx.textAlign = 'left';
}

// ---- Rotate / Skip touch buttons (bottom-left of board) so the game is fully
// playable on touch without a keyboard. ----
export function controlButtonRects() {
  const s = Math.round(52 * UI_SCALE), gap = 12, x0 = 16, yb = H - 16 - s;
  return {
    rotate: { x: x0, y: yb, w: s, h: s },
    skip: { x: x0 + s + gap, y: yb, w: s, h: s },
    harvest: { x: x0 + 2 * (s + gap), y: yb, w: s, h: s },
    torch: { x: x0 + 3 * (s + gap), y: yb, w: s, h: s },
  };
}
export function controlHit(x, y) {
  const r = controlButtonRects();
  for (const k of ['rotate', 'skip', 'harvest', 'torch']) { const b = r[k]; if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return k; }
  return null;
}
function drawControlButtons(ctx, mouse, g, view) {
  const r = controlButtonRects();
  const defs = [['rotate', '#cdb24a'], ['skip', '#9d8ac0'], ['harvest', '#9bd86b']];
  if ((g.torches || 0) > 0) defs.push(['torch', '#ff9a4d']);
  for (const [k, acc] of defs) {
    const b = r[k];
    const armed = view && ((k === 'torch' && view.torchMode) || (k === 'harvest' && view.harvestMode));
    const hover = (mouse && mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h) || armed;
    roundRect(ctx, b.x, b.y, b.w, b.h, 12);
    ctx.fillStyle = armed ? (k === 'torch' ? 'rgba(80,40,14,0.96)' : 'rgba(34,58,22,0.96)') : hover ? 'rgba(42,34,20,0.96)' : 'rgba(20,16,10,0.82)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = hover ? acc : hexToRgba(acc, 0.5); ctx.stroke();
    const cxp = b.x + b.w / 2, cyp = b.y + b.h / 2 - 4, col = hover ? '#fff7e0' : '#e6ddc6';
    if (k === 'torch') {
      panelIcon(ctx, cxp, cyp, 20, 'flame', armed ? '#ffcf6e' : '#ff9a4d');
      ctx.fillStyle = hover ? '#ffd9b0' : '#c0a08a'; ctx.textAlign = 'center'; ctx.font = '700 9px Nunito, sans-serif';
      ctx.fillText(armed ? 'TAP A TILE' : 'BURN ×' + g.torches, cxp, b.y + b.h - 7);
      continue;
    }
    if (k === 'harvest') {
      // sickle: curved blade + short handle
      ctx.strokeStyle = armed ? '#cdf0a0' : col; ctx.lineWidth = 2.8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(cxp + 2, cyp - 2, 9, Math.PI * 0.15, Math.PI * 1.05); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cxp + 4, cyp + 5); ctx.lineTo(cxp + 9, cyp + 11); ctx.stroke();
      ctx.fillStyle = hover ? '#d6f0c0' : '#9aa893'; ctx.textAlign = 'center'; ctx.font = '700 9px Nunito, sans-serif';
      ctx.fillText(armed ? 'TAP A REGION' : 'REAP', cxp, b.y + b.h - 7);
      continue;
    }
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (k === 'rotate') {
      const R = 11;
      ctx.beginPath(); ctx.arc(cxp, cyp, R, -2.3, 1.5); ctx.stroke();      // circular arrow
      const ex = cxp + Math.cos(1.5) * R, ey = cyp + Math.sin(1.5) * R;
      ctx.beginPath(); ctx.moveTo(ex - 6, ey - 2); ctx.lineTo(ex, ey + 4); ctx.lineTo(ex + 5, ey - 3); ctx.stroke();
    } else {
      const w = 7;                                                          // skip: » + bar
      ctx.beginPath(); ctx.moveTo(cxp - w * 1.7, cyp - w); ctx.lineTo(cxp - w * 0.4, cyp); ctx.lineTo(cxp - w * 1.7, cyp + w); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cxp - w * 0.1, cyp - w); ctx.lineTo(cxp + w * 1.2, cyp); ctx.lineTo(cxp - w * 0.1, cyp + w); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cxp + w * 1.5, cyp - w); ctx.lineTo(cxp + w * 1.5, cyp + w); ctx.stroke();
    }
    ctx.fillStyle = hover ? '#cdd9c2' : '#9aa893'; ctx.textAlign = 'center'; ctx.font = '700 9px Nunito, sans-serif';
    ctx.fillText(k === 'rotate' ? 'ROTATE' : 'SKIP', cxp, b.y + b.h - 7);
  }
  ctx.textAlign = 'left';
}

// ---- cinematic post: time-of-day colour grade + tilt-shift miniature blur ----
// One snapshot of the finished board is re-drawn in horizontal bands: the
// middle stays sharp while the top/bottom bands blur (the classic miniature-
// photography trick — amplifies the pop-up-diorama look), and every band gets
// a colour grade tuned to the time of day (rich noon, honey dusk, cool night).
function applyCinematic(ctx, oy, dayLight, night, warmth) {
  const cv = ctx.canvas;
  const lay = getBoardLayer(cv.width, cv.height);
  const lc = lay.getContext('2d');
  lc.setTransform(1, 0, 0, 1, 0, 0);
  lc.clearRect(0, 0, cv.width, cv.height);
  lc.drawImage(cv, 0, 0);
  const sat = Math.max(0.8, 1.08 + 0.12 * dayLight - 0.28 * night).toFixed(3);
  const bri = (1 - 0.04 * night).toFixed(3);
  const grade = `saturate(${sat}) contrast(1.06) brightness(${bri})`;
  const fT = Math.max(40, Math.min(H * 0.45, oy - 150));      // sharp-focus band
  const fB = Math.min(H - 24, Math.max(H * 0.55, oy + 170));
  const bands = [
    { y0: 0, y1: fT * 0.55, blur: 3 },
    { y0: fT * 0.55, y1: fT, blur: 1.4 },
    { y0: fT, y1: fB, blur: 0 },
    { y0: fB, y1: fB + (H - fB) * 0.45, blur: 1.4 },
    { y0: fB + (H - fB) * 0.45, y1: H, blur: 3 },
  ];
  for (const b of bands) {
    if (b.y1 - b.y0 < 1) continue;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, b.y0, BOARD_AREA, b.y1 - b.y0); ctx.clip();
    ctx.filter = b.blur ? `${grade} blur(${b.blur}px)` : grade;
    ctx.drawImage(lay, 0, 0, cv.width, cv.height, 0, 0, W, H);
    ctx.restore();
  }
  ctx.filter = 'none';
  // warm dusk glow / cool moonlight tint over the grade
  if (warmth > 0.1) { ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = `rgba(255,166,80,${0.5 * warmth})`; ctx.fillRect(0, 0, BOARD_AREA, H); ctx.restore(); }
  if (night > 0.1) { ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.fillStyle = `rgba(70,110,210,${0.4 * night})`; ctx.fillRect(0, 0, BOARD_AREA, H); ctx.restore(); }
}

// Small vector icons for the HUD, so sections read at a glance instead of
// ALL-CAPS text labels.
function panelIcon(ctx, x, y, s, kind, col) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = col; ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(1, s * 0.12); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (kind === 'coin') {
    ctx.beginPath(); ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.font = '700 ' + (s * 0.7) + 'px Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('✦', 0, s * 0.25);
  } else if (kind === 'flag') {
    ctx.beginPath(); ctx.moveTo(-s * 0.28, -s * 0.5); ctx.lineTo(-s * 0.28, s * 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-s * 0.28, -s * 0.5); ctx.lineTo(s * 0.4, -s * 0.28); ctx.lineTo(-s * 0.28, -s * 0.06); ctx.closePath(); ctx.fill();
  } else if (kind === 'hex') {
    ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = (60 * k - 30) * Math.PI / 180, px = Math.cos(a) * s * 0.5, py = Math.sin(a) * s * 0.5; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); ctx.stroke();
  } else if (kind === 'skip') {
    ctx.beginPath(); ctx.moveTo(-s * 0.45, -s * 0.35); ctx.lineTo(-s * 0.05, 0); ctx.lineTo(-s * 0.45, s * 0.35); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * 0.05, -s * 0.35); ctx.lineTo(s * 0.45, 0); ctx.lineTo(s * 0.05, s * 0.35); ctx.stroke();
  } else if (kind === 'hold') {
    ctx.strokeRect(-s * 0.45, -s * 0.42, s * 0.9, s * 0.84);
    ctx.beginPath(); ctx.moveTo(-s * 0.18, 0); ctx.lineTo(s * 0.2, 0); ctx.moveTo(s * 0.04, -s * 0.16); ctx.lineTo(s * 0.2, 0); ctx.lineTo(s * 0.04, s * 0.16); ctx.stroke();
  } else if (kind === 'flame') {
    ctx.beginPath(); ctx.moveTo(0, s * 0.5); ctx.quadraticCurveTo(s * 0.5, s * 0.12, s * 0.08, -s * 0.5); ctx.quadraticCurveTo(s * 0.08, -s * 0.1, -s * 0.16, -s * 0.22); ctx.quadraticCurveTo(-s * 0.5, s * 0.22, 0, s * 0.5); ctx.fill();
  } else if (kind === 'blight') {
    ctx.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, rr = k % 2 ? s * 0.22 : s * 0.5, px = Math.cos(a) * rr, py = Math.sin(a) * rr; k ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); ctx.fill();
  } else if (kind === 'sun') {
    ctx.beginPath(); ctx.arc(0, 0, s * 0.3, 0, Math.PI * 2); ctx.fill();
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; ctx.beginPath(); ctx.moveTo(Math.cos(a) * s * 0.42, Math.sin(a) * s * 0.42); ctx.lineTo(Math.cos(a) * s * 0.54, Math.sin(a) * s * 0.54); ctx.stroke(); }
  } else if (kind === 'leaf') {
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.24, s * 0.46, Math.PI / 4, 0, Math.PI * 2); ctx.fill();
  } else if (kind === 'snow') {
    for (let k = 0; k < 3; k++) { const a = k * Math.PI / 3; ctx.beginPath(); ctx.moveTo(-Math.cos(a) * s * 0.5, -Math.sin(a) * s * 0.5); ctx.lineTo(Math.cos(a) * s * 0.5, Math.sin(a) * s * 0.5); ctx.stroke(); }
  } else if (kind === 'rain') {
    ctx.beginPath(); ctx.arc(-s * 0.16, -s * 0.06, s * 0.22, 0, Math.PI * 2); ctx.arc(s * 0.14, -s * 0.06, s * 0.26, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(-s * 0.38, -s * 0.12, s * 0.7, s * 0.2);
    ctx.lineWidth = Math.max(1, s * 0.1);
    ctx.beginPath(); ctx.moveTo(-s * 0.18, s * 0.2); ctx.lineTo(-s * 0.26, s * 0.42); ctx.moveTo(s * 0.14, s * 0.2); ctx.lineTo(s * 0.06, s * 0.42); ctx.stroke();
  } else if (kind === 'person') {
    ctx.beginPath(); ctx.arc(0, -s * 0.24, s * 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, s * 0.42, s * 0.4, Math.PI, 0); ctx.fill();
  } else if (kind === 'sprout') {
    ctx.beginPath(); ctx.moveTo(0, s * 0.5); ctx.lineTo(0, -s * 0.08); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-s * 0.18, -s * 0.18, s * 0.18, s * 0.1, Math.PI / 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(s * 0.18, -s * 0.18, s * 0.18, s * 0.1, -Math.PI / 4, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
function panelHead(ctx, x, y, icon, text, iconCol) {
  panelIcon(ctx, x + 6, y - 4, 13, icon, iconCol || '#cdb24a');
  ctx.fillStyle = '#9fb094'; ctx.font = '800 11px Nunito, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(text, x + 19, y);
}
function panelDivider(ctx, x, y, w) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, 'rgba(205,178,74,0)'); g.addColorStop(0.5, 'rgba(205,178,74,0.32)'); g.addColorStop(1, 'rgba(205,178,74,0)');
  ctx.fillStyle = g; ctx.fillRect(x, y, w, 1);
}

function drawPanel(ctx, g, view, t) {
  const x = W - PANEL_W;
  const pg = ctx.createLinearGradient(x, 0, x, H);
  pg.addColorStop(0, '#1b160e'); pg.addColorStop(1, '#0c0905');
  ctx.fillStyle = pg; ctx.fillRect(x, 0, PANEL_W, H);
  ctx.save(); ctx.beginPath(); ctx.rect(x, 0, PANEL_W, H); ctx.clip();
  ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.04;
  const grp = getGrain();
  for (let yy = 0; yy < H; yy += grp.height) ctx.drawImage(grp, x, yy);
  ctx.restore();
  ctx.fillStyle = 'rgba(205,178,74,0.45)'; ctx.fillRect(x, 0, 2, H);          // gold edge
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x + 2, 0, 4, H);           // inner shade

  const pad = x + 18;
  const barW = PANEL_W - 36;
  let y = 30;

  ctx.textAlign = 'left';
  // ---- Header: wordmark + season ----
  ctx.fillStyle = '#d9c89a'; ctx.font = '700 19px Cinzel, serif';
  ctx.fillText('Hearthvale', pad, y + 4);
  const seasonIcons = ['sprout', 'sun', 'leaf', 'snow'];
  const seasonCols = ['#7fc56a', '#e8c24a', '#d98a3a', '#bcd2e6'];
  const seasonFav = ['Forest', 'Field', 'Orchard', 'Village'];
  const sIdx = seasonOf(g);
  panelIcon(ctx, W - 100, y - 1, 13, seasonIcons[sIdx], seasonCols[sIdx]);
  ctx.textAlign = 'right'; ctx.font = '700 12px Nunito, sans-serif'; ctx.fillStyle = seasonCols[sIdx];
  ctx.fillText(SEASON_NAMES[sIdx] + (view.daily ? ' · Daily' : ''), W - 16, y - 1);
  ctx.font = '10px Nunito, sans-serif'; ctx.fillStyle = '#8fa386';
  ctx.fillText(sIdx === 3 ? '+Village · frozen' : '+' + seasonFav[sIdx], W - 16, y + 11);
  ctx.textAlign = 'left';
  y += 22;
  panelDivider(ctx, pad, y, barW); y += 24;

  // ---- Score (coin + big number; the icon replaces the SCORE label) ----
  panelIcon(ctx, pad + 11, y - 5, 20, 'coin', '#ffcf5e');
  ctx.fillStyle = '#ffe08a'; ctx.font = '800 31px Nunito, sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(g.score.toLocaleString(), pad + 30, y + 4);
  y += 26;

  // ---- Hearthfolk: population & the three needs ----
  const nd = g.needs;
  if (nd && nd.pop > 0) {
    panelDivider(ctx, pad, y, barW); y += 16;
    panelHead(ctx, pad, y, 'person', 'HEARTHFOLK', nd.met ? '#e0b66f' : '#d49a6a');
    ctx.textAlign = 'right'; ctx.fillStyle = '#efe7cf'; ctx.font = '800 13px Nunito, sans-serif';
    ctx.fillText(String(nd.pop), W - 16, y); ctx.textAlign = 'left'; y += 17;
    const pips = [['sprout', nd.food, nd.foodNeed], ['rain', nd.water, nd.waterNeed], ['leaf', nd.wood, nd.woodNeed]];
    let px2 = pad;
    for (const [icon, have, need] of pips) {
      const ok = nd.pop < 6 || have >= need;
      panelIcon(ctx, px2 + 6, y - 4, 12, icon, ok ? '#9bd86b' : '#e0905a');
      ctx.fillStyle = ok ? '#9fb094' : '#e0a87a'; ctx.font = '700 11px Nunito, sans-serif';
      ctx.fillText(have + '/' + need, px2 + 15, y);
      px2 += 64;
    }
    y += 15;
    if (!nd.met) {
      const shorts = [];
      if (nd.food < nd.foodNeed) shorts.push('food');
      if (nd.water < nd.waterNeed) shorts.push('water');
      if (nd.wood < nd.woodNeed) shorts.push('wood');
      ctx.fillStyle = '#e0a87a'; ctx.font = '10px Nunito, sans-serif';
      ctx.fillText('folk need more ' + shorts.join(' & ') + ' — growth waits', pad, y); y += 14;
    } else if (nd.pop >= 6) {
      ctx.fillStyle = '#9bd86b'; ctx.font = '10px Nunito, sans-serif';
      ctx.fillText('every need met — the vale thrives', pad, y); y += 14;
    }
    if (nd.winter && nd.pop >= 6) {
      ctx.fillStyle = '#bcd2e6'; ctx.font = '10px Nunito, sans-serif';
      ctx.fillText('❄ winter — hearths burn extra wood', pad, y); y += 14;
    }
  }

  // ---- Weather front (telegraphed; tweaks scoring for a few tiles) ----
  const wf = weatherInfo(g);
  if (wf) {
    panelDivider(ctx, pad, y, barW); y += 16;
    const wcol = wf.type === 'sun' ? '#ffcf5e' : wf.type === 'rain' ? '#8fd0e0' : '#cfe0ee';
    panelHead(ctx, pad, y, wf.icon, wf.name.toUpperCase(), wcol);
    ctx.textAlign = 'right'; ctx.fillStyle = '#cdd9c2'; ctx.font = '800 11px Nunito, sans-serif';
    ctx.fillText(wf.left + (wf.left === 1 ? ' tile' : ' tiles'), W - 16, y); ctx.textAlign = 'left';
    y += 15;
    ctx.fillStyle = '#9fb094'; ctx.font = '11px Nunito, sans-serif';
    ctx.fillText(wf.note, pad, y); y += 16;
  }

  // ---- Living-valley growth (rivers water farms; they yield each tile) ----
  let irrN = 0; for (const tt of g.board.values()) if (tt.irrigated) irrN++;
  if (irrN > 0) {
    const frozenW = seasonOf(g) === 3 || (wf && wf.type === 'frost');
    const gpt = frozenW ? 0 : Math.min(10, Math.floor(irrN / 2));
    panelHead(ctx, pad, y, 'sprout', 'GROWTH', '#9bd86b');
    ctx.textAlign = 'right'; ctx.fillStyle = frozenW ? '#9fc0d6' : '#9bd86b'; ctx.font = '800 11px Nunito, sans-serif';
    ctx.fillText(frozenW ? 'frozen' : '+' + gpt + ' / tile', W - 16, y); ctx.textAlign = 'left';
    y += 14;
    ctx.fillStyle = '#9fb094'; ctx.font = '11px Nunito, sans-serif';
    ctx.fillText(irrN + ' farm' + (irrN > 1 ? 's' : '') + ' watered by rivers', pad, y); y += 16;
  }

  // ---- Visiting traveller & their wish ----
  if (g.visitor) {
    const v = g.visitor;
    panelDivider(ctx, pad, y, barW); y += 16;
    panelHead(ctx, pad, y, 'person', v.name.toUpperCase(), '#e0b66f');
    ctx.textAlign = 'right'; ctx.fillStyle = '#cdb892'; ctx.font = '800 11px Nunito, sans-serif';
    ctx.fillText(v.left + (v.left === 1 ? ' tile' : ' tiles'), W - 16, y);
    ctx.textAlign = 'left'; y += 16;
    ctx.fillStyle = '#d6e2cc'; ctx.font = 'italic 12px Nunito, sans-serif';
    const words = ('“' + v.wish + '”').split(' '); let line = '', ly = y;
    for (const w2 of words) { const test = line ? line + ' ' + w2 : w2; if (ctx.measureText(test).width > barW && line) { ctx.fillText(line, pad, ly); ly += 14; line = w2; } else line = test; }
    if (line) ctx.fillText(line, pad, ly);
    y = ly + 16;
  }

  // ---- Wildfire warning ----
  let burningN = 0; for (const tt of g.board.values()) if (tt.burning) burningN++;
  if (burningN) {
    panelDivider(ctx, pad, y, barW); y += 16;
    const fp = 0.6 + 0.4 * Math.sin(t / 160);
    panelHead(ctx, pad, y, 'flame', 'WILDFIRE', `rgba(255,140,50,${fp})`);
    ctx.textAlign = 'right'; ctx.fillStyle = `rgba(255,160,80,${fp})`; ctx.font = '800 12px Nunito, sans-serif';
    ctx.fillText(burningN + ' burning', W - 16, y); ctx.textAlign = 'left'; y += 15;
    ctx.fillStyle = '#c0a08a'; ctx.font = '10px Nunito, sans-serif';
    ctx.fillText('Place water beside flames · rain douses all', pad, y); y += 16;
  }

  // ---- Flood & overgrowth warnings ----
  let floodN = 0, overN = 0;
  for (const tt of g.board.values()) { if (tt.flooded) floodN++; if (tt.overgrown) overN++; }
  if (floodN) {
    panelHead(ctx, pad, y, 'rain', 'FLOOD', '#6fa6d0');
    ctx.textAlign = 'right'; ctx.fillStyle = '#9cc4e0'; ctx.font = '800 12px Nunito, sans-serif';
    ctx.fillText(floodN + ' under water', W - 16, y); ctx.textAlign = 'left'; y += 14;
    ctx.fillStyle = '#8aa6bc'; ctx.font = '10px Nunito, sans-serif';
    ctx.fillText('Recedes when the rain passes', pad, y); y += 16;
  }
  if (overN) {
    panelHead(ctx, pad, y, 'leaf', 'OVERGROWTH', '#7aa05a');
    ctx.textAlign = 'right'; ctx.fillStyle = '#9bc086'; ctx.font = '800 12px Nunito, sans-serif';
    ctx.fillText(overN + ' overgrown', W - 16, y); ctx.textAlign = 'left'; y += 14;
    ctx.fillStyle = '#8fa386'; ctx.font = '10px Nunito, sans-serif';
    ctx.fillText('Build beside the brambles to prune', pad, y); y += 16;
  }

  // ---- Journey objective ----
  if (g.mode === 'journey') {
    panelDivider(ctx, pad, y, barW); y += 16;
    const obj = journeyCurrent(g);
    panelHead(ctx, pad, y, 'flag', 'JOURNEY', '#7fd0a0');
    ctx.textAlign = 'right'; ctx.fillStyle = '#7fd0a0'; ctx.font = '800 11px Nunito, sans-serif';
    ctx.fillText(Math.min(g.journeyIdx || 0, JOURNEY.length) + ' / ' + JOURNEY.length, W - 16, y);
    ctx.textAlign = 'left'; y += 17;
    ctx.fillStyle = '#d6e2cc'; ctx.font = '12px Nunito, sans-serif';
    if (obj) {
      const words = obj.text.split(' '); let line = '', ly = y;
      for (const w of words) { const test = line ? line + ' ' + w : w; if (ctx.measureText(test).width > barW && line) { ctx.fillText(line, pad, ly); ly += 14; line = w; } else line = test; }
      if (line) ctx.fillText(line, pad, ly);
      y = ly + 16;
    } else { ctx.fillStyle = '#ffd766'; ctx.fillText('All objectives complete! ★', pad, y); y += 18; }
  }

  // ---- Blight threat tracker ----
  if (g.blightStarted) {
    panelDivider(ctx, pad, y, barW); y += 16;
    const n = Object.keys(g.corrupted || {}).length;
    const hearts = (g.blighthearts || []).length;
    let wards = 0; for (const tt of g.board.values()) if (tt.landmark === 'wardtower') wards++;
    const p2 = 0.6 + 0.4 * Math.sin(t / 200);
    panelHead(ctx, pad, y, 'blight', 'BLIGHT', `rgba(210,95,210,${p2})`);
    ctx.textAlign = 'right'; ctx.fillStyle = `rgba(210,95,210,${p2})`; ctx.font = '800 12px Nunito, sans-serif';
    ctx.fillText(hearts + (hearts === 1 ? ' heart' : ' hearts'), W - 16, y);
    ctx.textAlign = 'left'; y += 15;
    ctx.fillStyle = '#9a8aa2'; ctx.font = '11px Nunito, sans-serif';
    ctx.fillText(`Corrupted ${n} · Wardtowers ${wards}`, pad, y); y += 13;
    ctx.fillStyle = '#7aa0c0'; ctx.font = '10px Nunito, sans-serif';
    ctx.fillText(wards > 0 ? 'Hold a ward aura on a heart to purge' : 'Build a Wardtower near a heart', pad, y); y += 16;
  }

  // ---- Combo meter ----
  const mult = comboMult(g);
  if (g.combo >= 2) {
    const pulse = 0.6 + 0.4 * Math.sin(t / 120);
    panelHead(ctx, pad, y, 'flame', `COMBO ×${mult.toFixed(mult % 1 ? 1 : 0)}`, `rgba(255,150,70,${pulse})`);
    ctx.textAlign = 'right'; ctx.fillStyle = '#9a8460'; ctx.font = '11px Nunito, sans-serif';
    ctx.fillText(`${g.combo} in a row`, W - 16, y); ctx.textAlign = 'left';
    y += 7;
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(pad, y, barW, 5);
    const frac = Math.min(1, (mult - 1) / 3);
    const grd = ctx.createLinearGradient(pad, 0, pad + barW, 0);
    grd.addColorStop(0, '#ffcf6e'); grd.addColorStop(1, '#ff6a3d');
    ctx.fillStyle = grd; ctx.fillRect(pad, y, barW * frac, 5);
    y += 16;
  } else { y += 2; }

  // ---- Tiles remaining ----
  panelDivider(ctx, pad, y, barW); y += 16;
  const remaining = g.stack.length + (g.current ? 1 : 0);
  panelHead(ctx, pad, y, 'hex', g.endless ? 'TILES · ENDLESS' : 'TILES LEFT', '#7fae5a');
  ctx.textAlign = 'right'; ctx.fillStyle = '#cdd9c2'; ctx.font = '800 13px Nunito, sans-serif';
  ctx.fillText(String(remaining), W - 16, y); ctx.textAlign = 'left';
  y += 8;
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(pad, y, barW, 7);
  ctx.fillStyle = '#5fae54'; ctx.fillRect(pad, y, barW * Math.min(1, remaining / 50), 7);
  y += 22;

  // ---- Next tile + upcoming queue + skips ----
  panelDivider(ctx, pad, y, barW); y += 16;
  panelHead(ctx, pad, y, 'hex', 'NEXT', '#cdb24a');
  panelIcon(ctx, W - 56, y - 4, 12, 'skip', g.skips > 0 ? '#cdb24a' : '#6e6354');
  ctx.textAlign = 'right'; ctx.fillStyle = g.skips > 0 ? '#cdd9c2' : '#7a7060'; ctx.font = '800 12px Nunito, sans-serif';
  ctx.fillText(String(g.skips), W - 16, y); ctx.textAlign = 'left';
  y += 12;
  const cx = pad + 34, cy = y + 32;
  const edges = currentEdges(g);
  if (edges) {
    drawTile(ctx, cx, cy, 32, edges, 0x1234, g.current && g.current.landmark, t);
    drawHexOutline(ctx, cx, cy, 32, '#f3ead0', 2.5, false);
  }
  const up = upcoming(g, 3);
  let qx = cx + 60;
  for (let i = 0; i < up.length; i++) {
    drawTile(ctx, qx, cy, 20, up[i].edges, 0x55 + i * 7, up[i].landmark, t);
    drawHexOutline(ctx, qx, cy, 20, 'rgba(243,234,208,0.5)', 1.5, false);
    qx += 44;
  }
  ctx.fillStyle = '#5d6e5a'; ctx.font = '10px Nunito, sans-serif';
  ctx.fillText('R rotate · S skip · H hold', cx + 60, cy + 30);
  y = cy + 46;

  // ---- Hold slot ----
  panelHead(ctx, pad, y, 'hold', 'HOLD', g.heldUsed ? '#7e7060' : '#cdb24a');
  const hcx = pad + 26, hcy = y + 26;
  if (g.held) {
    drawTile(ctx, hcx, hcy, 20, g.held.edges, 0x77, g.held.landmark, t);
    drawHexOutline(ctx, hcx, hcy, 20, 'rgba(243,234,208,0.6)', 2, false);
  } else {
    drawHexOutline(ctx, hcx, hcy, 20, 'rgba(180,200,170,0.3)', 1.4, true);
  }
  ctx.fillStyle = g.heldUsed ? '#7e7060' : '#bdcab2'; ctx.font = '11px Nunito, sans-serif';
  ctx.fillText(g.held ? 'press H to swap' : 'press H to stash', hcx + 30, hcy - 2);
  ctx.fillStyle = '#5d6e5a'; ctx.font = '10px Nunito, sans-serif';
  ctx.fillText(g.heldUsed ? 'already swapped this turn' : 'once per turn', hcx + 30, hcy + 12);
  _holdRect = { x: hcx - 22, y: hcy - 22, w: 44, h: 44 };
  y = hcy + 30;

  // ---- Decrees ----
  panelDivider(ctx, pad, y, barW); y += 16;
  refreshQuestProgress(g);
  panelHead(ctx, pad, y, 'flag', 'DECREES', '#cdb24a');
  y += 18;
  const active = g.quests.filter(q => !q.done).slice(-4);
  if (active.length === 0) {
    ctx.fillStyle = '#5d6e5a'; ctx.font = 'italic 12px Nunito, sans-serif';
    ctx.fillText('Place feature tiles to', pad, y);
    ctx.fillText('attract a decree…', pad, y + 14);
    y += 30;
  }
  for (const qd of active) {
    const tt = TERRAIN[qd.terrain];
    ctx.fillStyle = tt.c1; roundRect(ctx, pad, y - 9, 11, 11, 2); ctx.fill();
    ctx.fillStyle = '#e6ddc6'; ctx.font = '12px Nunito, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`${tt.name} region`, pad + 18, y);
    ctx.textAlign = 'right'; ctx.fillStyle = '#9fb094'; ctx.font = '700 12px Nunito, sans-serif';
    ctx.fillText(`${qd.size ?? 1}/${qd.target}`, W - 16, y); ctx.textAlign = 'left';
    y += 20;
  }

  // ---- Footer: best / next unlock · sound · pause ----
  panelDivider(ctx, pad, H - 50, barW);
  const nu = nextUnlock(view.save);
  panelIcon(ctx, pad + 7, H - 33, 12, 'coin', '#cdb24a');
  ctx.font = '700 11px Nunito, sans-serif'; ctx.fillStyle = '#bdcab2'; ctx.textAlign = 'left';
  ctx.fillText(`Best ${(view.save.best || 0).toLocaleString()}`, pad + 20, H - 30);
  ctx.font = '11px Nunito, sans-serif';
  if (nu) { ctx.fillStyle = '#b89bd8'; ctx.fillText(`Next: ${nu.name} @ ${nu.score}`, pad + 20, H - 14); }
  else { ctx.fillStyle = '#7e9277'; ctx.fillText('all biomes unlocked', pad + 20, H - 14); }
  ctx.textAlign = 'right';
  ctx.fillStyle = isMuted() ? '#7a5a5a' : '#6f8a68';
  ctx.fillText(isMuted() ? '♪ muted (M)' : '♪ sound (M)', W - 16, H - 14);
  ctx.fillStyle = '#5d6e5a';
  ctx.fillText('⏸ Esc', W - 16, H - 30);
  ctx.textAlign = 'left';
}

function drawGameOver(ctx, g, view, t) {
  const BW = W - PANEL_W;
  ctx.fillStyle = 'rgba(6,10,8,0.82)';
  ctx.fillRect(0, 0, BW, H);

  // Card.
  const cw = GO_CW, ch = GO_CH;
  const cardX = (BW - cw) / 2, cardY = (H - ch) / 2;
  themedCard(ctx, cardX, cardY, cw, ch, 16);

  const cx = BW / 2;
  ctx.textAlign = 'center';
  let y = cardY + 46;

  ctx.fillStyle = '#efe7cf';
  ctx.font = 'bold 30px Nunito, sans-serif';
  const years = Math.max(1, Math.round(g.placed / 52));
  ctx.fillText(`Winter Solstice — year ${years} rests`, cx, y);
  y += 18;
  ctx.fillStyle = '#8aa080';
  ctx.font = '12px Nunito, sans-serif';
  ctx.fillText('YOUR FINAL SCORE', cx, y);
  y += 44;
  ctx.fillStyle = '#ffe08a';
  ctx.font = 'bold 52px Nunito, sans-serif';
  ctx.fillText(g.score.toLocaleString(), cx, y);
  y += 18;

  // NEW BEST badge.
  const prevBest = view.runStartBest || 0;
  if (g.score > prevBest) {
    const pulse = 0.7 + 0.3 * Math.sin(t / 200);
    ctx.fillStyle = `rgba(255,150,70,${pulse})`;
    ctx.font = 'bold 15px Nunito, sans-serif';
    ctx.fillText('★ NEW BEST VALE ★', cx, y);
  } else {
    ctx.fillStyle = '#7e9277';
    ctx.font = '13px Nunito, sans-serif';
    ctx.fillText(`Best: ${view.save.best.toLocaleString()}`, cx, y);
  }
  y += 26;

  // Stat grid (two columns).
  let biggest = 0;
  for (const tl of g.board.values()) biggest = Math.max(biggest, tl.townSize || 0);
  const bestMult = Math.min(4, 1 + Math.max(0, g.bestCombo - 1) * 0.5);
  const stats = [
    ['Tiles placed', g.placed],
    ['Best combo', `${g.bestCombo}  (×${bestMult % 1 ? bestMult.toFixed(1) : bestMult})`],
    ['Decrees fulfilled', g.decreesDone],
    ['Perfect placements', g.perfects],
    ['Regions bloomed', g.regionsBloomed],
    ['Landmarks built', g.landmarksPlaced],
    ['Largest town', biggest > 1 ? `${biggest} tiles` : '—'],
    ['Skips used', 3 - g.skips],
  ];
  const colX = [cardX + 34, cardX + cw / 2 + 18];
  const rowH = 30;
  ctx.font = '14px Nunito, sans-serif';
  for (let i = 0; i < stats.length; i++) {
    const col = i % 2, row = Math.floor(i / 2);
    const sx = colX[col], sy = y + row * rowH;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9fb398';
    ctx.fillText(stats[i][0], sx, sy);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#efe7cf';
    ctx.font = 'bold 14px Nunito, sans-serif';
    ctx.fillText(String(stats[i][1]), sx + (cw / 2 - 50), sy);
    ctx.font = '14px Nunito, sans-serif';
  }
  y += Math.ceil(stats.length / 2) * rowH + 8;

  // The story of your vale — what the living world did this run.
  {
    const st = g.stats || {};
    const story = [];
    if (st.peakPop >= 10) story.push(`${st.peakPop} hearthfolk came to call your vale home`);
    if (st.visitors) story.push(`${st.visitors} traveller${st.visitors > 1 ? 's' : ''} left the vale delighted`);
    if (st.harvests) story.push(`${st.harvests} harvest${st.harvests > 1 ? 's' : ''} reaped from ripe land`);
    if (st.sprouted) story.push(`the wild took root ${st.sprouted} time${st.sprouted > 1 ? 's' : ''} on its own`);
    if (st.growth) story.push(`Your rivers fed the farms — +${st.growth} grown`);
    if (st.fires) story.push(`${st.fires} wildfire${st.fires > 1 ? 's' : ''} · ${st.doused || 0} doused · ${st.burned || 0} tile${(st.burned || 0) === 1 ? '' : 's'} burnt`);
    if (st.floods) story.push(`${st.floods} field${st.floods > 1 ? 's' : ''} flooded · rich silt claimed +${st.silt || 0}`);
    if (st.pruned) story.push(`${st.pruned} bramble patch${st.pruned > 1 ? 'es' : ''} pruned back`);
    if (st.torched) story.push(`${st.torched} controlled burn${st.torched > 1 ? 's' : ''} set by your own hand`);
    if (story.length) {
      ctx.textAlign = 'center';
      panelDivider(ctx, cardX + 60, y - 10, cw - 120);
      ctx.fillStyle = '#b9a86b'; ctx.font = '700 11px Nunito, sans-serif';
      ctx.fillText('THE STORY OF YOUR VALE', cx, y + 4); y += 20;
      ctx.fillStyle = '#cdd9c2'; ctx.font = 'italic 13px Nunito, sans-serif';
      for (const line of story.slice(0, 3)) { ctx.fillText(line, cx, y); y += 17; }
      y += 4;
    }
  }

  // Biome unlocks earned this run.
  const newUnlocks = UNLOCKS.filter(u => g.score >= u.score && u.score > prevBest);
  ctx.textAlign = 'center';
  if (newUnlocks.length) {
    ctx.fillStyle = '#b89bd8';
    ctx.font = 'bold 14px Nunito, sans-serif';
    ctx.fillText(`✦ Unlocked: ${newUnlocks.map(u => u.name).join(' & ')} ✦`, cx, y);
    y += 22;
  }

  // Legacy: this run's first landmark endures into the next vale.
  if (!view.daily) {
    const endure = [...g.board.values()].find(tl => tl.landmark && !tl.heirloom);
    if (endure) {
      ctx.fillStyle = '#e0c46f'; ctx.font = 'italic 12px Nunito, sans-serif';
      ctx.fillText(`✦ Your ${endure.landmark} will endure into the next vale ✦`, cx, y);
      y += 18;
    }
  }

  // Daily runs get a shareable result + copy button.
  if (view.daily) {
    const cb = copyButtonRect();
    roundRect(ctx, cb.x, cb.y, cb.w, cb.h, 8);
    ctx.fillStyle = view.copied ? '#21381f' : '#1b2a1c';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(184,155,216,0.55)';
    ctx.stroke();
    ctx.fillStyle = view.copied ? '#bdf3b0' : '#dcd2ea';
    ctx.font = 'bold 13px Nunito, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(view.copied ? '✓ Copied — share it!' : '⧉ Copy daily result', cx, cb.y + cb.h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
  }

  ctx.fillStyle = '#9fb398';
  ctx.font = '14px Nunito, sans-serif';
  ctx.fillText('Press  N  or click  to raise a new vale', cx, cardY + ch - 18);
  ctx.textAlign = 'left';
}

const GO_CW = 470, GO_CH = 472;

// Rect of the daily "copy result" button on the summary card.
export function copyButtonRect() {
  const BW = W - PANEL_W;
  const cardX = (BW - GO_CW) / 2, cardY = (H - GO_CH) / 2;
  return { x: BW / 2 - 95, y: cardY + GO_CH - 56, w: 190, h: 30 };
}

// The copy-to-clipboard text for a finished daily run.
export function dailyShareText(g) {
  const ymd = todayYmd();
  const date = `${Math.floor(ymd / 10000)}-${String(Math.floor(ymd / 100) % 100).padStart(2, '0')}-${String(ymd % 100).padStart(2, '0')}`;
  const mult = Math.min(4, 1 + Math.max(0, g.bestCombo - 1) * 0.5);
  let biggest = 0;
  for (const tl of g.board.values()) biggest = Math.max(biggest, tl.townSize || 0);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return `Hearthvale Daily ${date}\n▦ ${g.score.toLocaleString()} · ${plural(g.placed, 'tile')}\n🔥 x${mult % 1 ? mult.toFixed(1) : mult} · ✦ ${plural(g.decreesDone, 'decree')} · ⌂ town ${biggest > 1 ? biggest : 0} · ★ ${plural(g.landmarksPlaced, 'landmark')}`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// A crafted aged-wood / dark-parchment card: warm gradient + grain + a gold
// double border. Used for all menus so the UI matches the illustrated map.
function themedCard(ctx, x, y, w, h, r) {
  roundRect(ctx, x, y, w, h, r);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#241d12'); g.addColorStop(1, '#140f09');
  ctx.fillStyle = g; ctx.fill();
  ctx.save();
  roundRect(ctx, x, y, w, h, r); ctx.clip();
  ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.05;
  const gr = getGrain();
  for (let yy = y; yy < y + h; yy += gr.height) for (let xx = x; xx < x + w; xx += gr.width) ctx.drawImage(gr, xx, yy);
  ctx.restore();
  roundRect(ctx, x, y, w, h, r); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(205,178,74,0.5)'; ctx.stroke();
  roundRect(ctx, x + 3.5, y + 3.5, w - 7, h - 7, Math.max(2, r - 3)); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(205,178,74,0.18)'; ctx.stroke();
}

// ---- Title screen ----
function titleButtonRects(hasRun) {
  const rects = {};
  const pw = 308, px = (W - pw) / 2;
  let y = hasRun ? 304 : 322;
  if (hasRun) {
    rects.continue = { x: px, y, w: pw, h: 52, label: 'Continue Vale', accent: '#cdb24a', fs: 21 };
    y += 64;
    rects.newgame = { x: px, y, w: pw, h: 46, label: 'New Vale  ▸', accent: '#4a9a3f', fs: 19 };
    y += 64;
  } else {
    rects.newgame = { x: px, y, w: pw, h: 56, label: 'New Vale  ▸', accent: '#4a9a3f', fs: 22 };
    y += 72;
  }
  // quieter secondary row
  const ws = 150, gs = 14, ts = ws * 3 + gs * 2, xs = (W - ts) / 2;
  rects.daily = { x: xs, y, w: ws, h: 40, label: 'Daily', accent: '#9d5bd0', fs: 16 };
  rects.howto = { x: xs + (ws + gs), y, w: ws, h: 40, label: 'How to Play', accent: '#6fa8c0', fs: 16 };
  rects.music = { x: xs + 2 * (ws + gs), y, w: ws, h: 40, label: '♪ Music', accent: '#d4a93a', fs: 16 };
  return rects;
}

// Returns 'continue' | 'newgame' | 'daily' | 'howto' | 'music' | null.
export function titleHit(x, y, hasRun) {
  const r = titleButtonRects(hasRun);
  for (const k of Object.keys(r)) {
    const b = r[k];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return k;
  }
  return null;
}

// Shared UI button: accent-tinted fill, hover glow, soft press-down. Used by
// every menu so they all feel consistent and responsive.
function titleButton(ctx, b, mouse) {
  const hover = mouse && mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
  const press = hover && mouse && mouse.down;
  const acc = b.accent || '#cdb24a';
  const yo = press ? 1.5 : 0;                                  // micro press-down
  const rad = b.rad || 12;
  ctx.save();
  roundRect(ctx, b.x, b.y + yo, b.w, b.h, rad); ctx.fillStyle = '#0e1209'; ctx.fill();
  roundRect(ctx, b.x, b.y + yo, b.w, b.h, rad);
  const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
  g.addColorStop(0, hexToRgba(acc, press ? 0.6 : hover ? 0.52 : 0.3));
  g.addColorStop(1, hexToRgba(acc, press ? 0.34 : hover ? 0.26 : 0.1));
  ctx.fillStyle = g; ctx.fill();
  if (hover && !press) { ctx.save(); ctx.shadowColor = acc; ctx.shadowBlur = 16; roundRect(ctx, b.x, b.y, b.w, b.h, rad); ctx.lineWidth = 2; ctx.strokeStyle = hexToRgba(acc, 0.5); ctx.stroke(); ctx.restore(); }
  roundRect(ctx, b.x, b.y + yo, b.w, b.h, rad);
  ctx.lineWidth = 2; ctx.strokeStyle = hover ? acc : hexToRgba(acc, 0.5); ctx.stroke();
  ctx.fillStyle = hover ? '#ffffff' : '#f3ead0'; ctx.textAlign = 'center';
  const fs = b.fs || Math.min(20, Math.max(15, b.h * 0.42));
  ctx.font = '700 ' + fs + 'px Nunito, sans-serif';
  ctx.fillText(b.label, b.x + b.w / 2, b.y + yo + b.h / 2 + fs * 0.35);
  ctx.restore();
}

function pineSil(ctx, x, baseY, s) {
  ctx.fillRect(x - s * 0.06, baseY - s * 0.4, s * 0.12, s * 0.4);
  ctx.beginPath();
  ctx.moveTo(x - s * 0.42, baseY - s * 0.3); ctx.lineTo(x, baseY - s * 1.3); ctx.lineTo(x + s * 0.42, baseY - s * 0.3);
  ctx.closePath(); ctx.fill();
}

// A colourful sunset vale behind the menu: graded sky, sun, drifting clouds,
// birds, and layered rolling hills with a pine ridge.
function drawTitleScene(ctx, t) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#22305c'); sky.addColorStop(0.4, '#5d4a7a');
  sky.addColorStop(0.64, '#c8743f'); sky.addColorStop(0.78, '#f0a85a'); sky.addColorStop(1, '#f6cd86');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  const sunX = W * 0.5, sunY = H * 0.72;
  const sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 260);
  sg.addColorStop(0, 'rgba(255,244,205,0.95)'); sg.addColorStop(0.32, 'rgba(255,200,120,0.5)'); sg.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(sunX, sunY, 260, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff0c4'; ctx.beginPath(); ctx.arc(sunX, sunY, 48, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,225,195,0.22)';
  for (const [cxr, cyr, s] of [[0.22, 0.2, 74], [0.8, 0.17, 92], [0.58, 0.31, 58]]) {
    const x = cxr * W + Math.sin(t / 9000 + cxr * 9) * 18, y = cyr * H;
    ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.4, 0, 0, Math.PI * 2); ctx.ellipse(x + s * 0.5, y + 6, s * 0.7, s * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(35,35,50,0.45)'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  for (let i = 0; i < 5; i++) { const bx = ((t / 36 + i * 70) % (W + 100)) - 50, by = H * 0.24 + Math.sin(t / 900 + i) * 8 + i * 7; ctx.beginPath(); ctx.moveTo(bx - 6, by); ctx.lineTo(bx, by - 3); ctx.lineTo(bx + 6, by); ctx.stroke(); }
  const hill = (baseY, col, amp, ph) => {
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 16) { const y = baseY + Math.sin(x * 0.006 + ph) * amp + Math.sin(x * 0.013 + ph * 2) * amp * 0.4; ctx.lineTo(x, y); }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();
  };
  hill(H * 0.8, '#6a5a4a', 16, 0.4);
  hill(H * 0.86, '#4a6a3c', 22, 1.7);
  hill(H * 0.93, '#33522b', 26, 2.9);
  ctx.fillStyle = '#26421f';
  for (let i = 0; i < 8; i++) { const x = (i + 0.5) / 8 * W + Math.sin(i * 2.7) * 18; const y = H * 0.93 + Math.sin(x * 0.006 + 2.9) * 26 + Math.sin(x * 0.013 + 5.8) * 10; pineSil(ctx, x, y, 26 + (i % 3) * 7); }
}

const NOHOVER = { x: -9999, y: -9999, down: false };
export function renderTitle(ctx, view, mouse, t, hasRun) {
  ctx.clearRect(0, 0, W, H);
  // Background: a living showcase vale rendered full-screen behind the menu.
  if (view.showcase && view.showcaseView) {
    view.showcaseView.panX = Math.sin(t / 14000) * 42;          // gentle camera drift
    view.showcaseView.panY = 16 + Math.cos(t / 19000) * 12;
    setBoardArea(W);
    render(ctx, view.showcase, view.showcaseView, NOHOVER, t, { bg: true });
    setBoardArea(BOARD_W);
  } else {
    drawTitleScene(ctx, t);
  }
  ctx.textAlign = 'center';
  // Scrims so the logo + menu stay legible over the busy vale.
  ctx.save();
  const scrim = ctx.createLinearGradient(0, 60, 0, 330);
  scrim.addColorStop(0, 'rgba(8,12,24,0.66)'); scrim.addColorStop(1, 'rgba(8,12,24,0.04)');
  ctx.fillStyle = scrim; ctx.fillRect(0, 0, W, 340);
  const v = ctx.createRadialGradient(W / 2, 370, 50, W / 2, 370, 380);
  v.addColorStop(0, 'rgba(8,12,20,0.5)'); v.addColorStop(1, 'rgba(8,12,20,0)');
  ctx.fillStyle = v; ctx.fillRect(0, 180, W, 360);
  ctx.restore();

  ctx.font = '700 60px Cinzel, serif';
  const tgr = ctx.createLinearGradient(0, 108, 0, 170);
  tgr.addColorStop(0, '#fff0bf'); tgr.addColorStop(0.5, '#ffc24d'); tgr.addColorStop(1, '#e8853a');
  ctx.fillStyle = tgr;
  ctx.fillText('Hearthvale', W / 2, 156);
  ctx.fillStyle = '#a9c4a0';
  ctx.font = '17px Nunito, sans-serif';
  ctx.fillText('Lay tiles · grow a vale · watch it come to life', W / 2, 190);
  ctx.fillStyle = '#cdb24a';
  ctx.font = '15px Nunito, sans-serif';
  ctx.fillText(`Best vale: ${(view.save.best || 0).toLocaleString()}`, W / 2, 232);
  const db = dailyBestToday(view.save);
  if (db > 0) {
    ctx.fillStyle = '#b89bd8';
    ctx.font = '13px Nunito, sans-serif';
    ctx.fillText(`Today's daily best: ${db.toLocaleString()}`, W / 2, 254);
  }

  // Achievements count + dot row (filled = unlocked).
  const ac = achievementCount(view.save);
  ctx.fillStyle = '#cdb24a';
  ctx.font = '13px Nunito, sans-serif';
  ctx.fillText(`✦ Achievements  ${ac.unlocked} / ${ac.total}`, W / 2, db > 0 ? 274 : 262);
  const dy = db > 0 ? 288 : 276;
  const got = view.save.achievements || {};
  const dw = 15, x0 = W / 2 - (ACHIEVEMENTS.length * dw) / 2 + dw / 2;
  for (let i = 0; i < ACHIEVEMENTS.length; i++) {
    ctx.fillStyle = got[ACHIEVEMENTS[i].id] ? '#ffd766' : 'rgba(255,255,255,0.15)';
    ctx.beginPath(); ctx.arc(x0 + i * dw, dy, 4, 0, Math.PI * 2); ctx.fill();
  }

  const r = titleButtonRects(hasRun);
  if (r.continue) titleButton(ctx, r.continue, mouse);
  titleButton(ctx, r.newgame, mouse);
  titleButton(ctx, r.daily, mouse);
  titleButton(ctx, r.howto, mouse);
  titleButton(ctx, r.music, mouse);

  // Recent runs strip (◆ = daily).
  const rec = recentRuns(view.save, 6);
  if (rec.length) {
    ctx.fillStyle = '#5d6e5a';
    ctx.font = '12px Nunito, sans-serif';
    ctx.fillText('Recent  ' + rec.map(rn => (rn.daily ? '◆' : '') + rn.score.toLocaleString()).join('   ·   '), W / 2, H - 44);
  }

  ctx.fillStyle = isMuted() ? '#7a5a5a' : '#6f8a68';
  ctx.font = '12px Nunito, sans-serif';
  ctx.fillText(isMuted() ? '♪ muted (M)' : '♪ sound on (M)', W / 2, H - 20);
  ctx.textAlign = 'left';
}

// ---- Draft-your-start screen ----
function draftRects() {
  const rects = {};
  const cw = 198, gap = 28, ch = 212;
  const total = cw * 3 + gap * 2, x0 = (W - total) / 2, y = 224;
  START_OPTIONS.forEach((o, i) => { rects[o.id] = { x: x0 + i * (cw + gap), y, w: cw, h: ch }; });
  rects.back = { x: (W - 170) / 2, y: y + ch + 26, w: 170, h: 40, label: '◂ Back' };
  return rects;
}
export function draftHit(x, y) {
  const r = draftRects();
  for (const k of Object.keys(r)) { const b = r[k]; if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return k; }
  return null;
}
export function renderDraft(ctx, view, mouse, t, mode) {
  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createRadialGradient(W / 2, H * 0.42, 80, W / 2, H * 0.42, 580);
  bg.addColorStop(0, '#24371f'); bg.addColorStop(1, '#0b120c');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  drawMotes(ctx, t);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe9b0'; ctx.font = '700 38px Cinzel, serif';
  ctx.fillText('Choose your start', W / 2, 120);
  ctx.fillStyle = mode === 'warden' ? '#c79bdb' : '#8fae86';
  ctx.font = '16px Nunito, sans-serif';
  ctx.fillText(mode === 'warden' ? 'Warden Vale — fortresses vs the blight' : 'Calm Vale — cozy, no blight', W / 2, 152);

  const r = draftRects();
  START_OPTIONS.forEach((o) => {
    const b = r[o.id];
    const hover = mouse && mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
    themedCard(ctx, b.x, b.y, b.w, b.h, 14);
    if (hover) { roundRect(ctx, b.x, b.y, b.w, b.h, 14); ctx.lineWidth = 2.5; ctx.strokeStyle = '#ffd766'; ctx.stroke(); }
    drawTile(ctx, b.x + b.w / 2, b.y + 78, 48, o.edges, 0x2200 + o.id.length, null, t);
    drawHexOutline(ctx, b.x + b.w / 2, b.y + 78, 48, '#f3ead0', 2.5, false);
    ctx.textAlign = 'center';
    ctx.fillStyle = hover ? '#fff7e0' : '#ffe9b0'; ctx.font = 'bold 22px Nunito, sans-serif';
    ctx.fillText(o.name, b.x + b.w / 2, b.y + 158);
    ctx.fillStyle = '#b9c8ad'; ctx.font = '13px Nunito, sans-serif';
    ctx.fillText(o.desc, b.x + b.w / 2, b.y + 182);
  });
  titleButton(ctx, r.back, mouse);
  ctx.textAlign = 'left';
}

// ---- Mode-select screen (reached from "New Vale") ----
const MODE_DEFS = [
  { id: 'calm', name: 'Calm', desc: 'Cozy tile-laying — no blight, just grow a vale.', accent: '#4a9a3f' },
  { id: 'zen', name: 'Zen', desc: 'Endless. No game-over. Build forever.', accent: '#2fa6b8' },
  { id: 'warden', name: 'Warden', desc: 'Defend the vale against the creeping blight.', accent: '#b24bcf' },
  { id: 'journey', name: 'Journey', desc: 'Follow directed map objectives, one by one.', accent: '#3a9a6a' },
  { id: 'themed', name: 'Themed Valleys  ▸', desc: 'Fixed palettes — Isles, Wildwood, Highlands.', accent: '#e08a3a' },
];
function modeSelRects() {
  const rects = {};
  const cw = 460, cx = (W - cw) / 2, ch = 52, gap = 10, y0 = 178;
  MODE_DEFS.forEach((m, i) => { rects[m.id] = { x: cx, y: y0 + i * (ch + gap), w: cw, h: ch }; });
  rects.back = { x: (W - 160) / 2, y: y0 + MODE_DEFS.length * (ch + gap) + 6, w: 160, h: 38, label: '◂ Back', accent: '#6fa8c0' };
  return rects;
}
export function modeSelHit(x, y) {
  const r = modeSelRects();
  for (const k of Object.keys(r)) { const b = r[k]; if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return k; }
  return null;
}
export function renderModeSelect(ctx, view, mouse, t) {
  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createRadialGradient(W / 2, H * 0.42, 80, W / 2, H * 0.42, 580);
  bg.addColorStop(0, '#24371f'); bg.addColorStop(1, '#0b120c');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  drawMotes(ctx, t);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe9b0'; ctx.font = '700 38px Cinzel, serif'; ctx.fillText('New Vale', W / 2, 120);
  ctx.fillStyle = '#a9c4a0'; ctx.font = '16px Nunito, sans-serif'; ctx.fillText('Choose how you’d like to play', W / 2, 150);
  const r = modeSelRects();
  MODE_DEFS.forEach(m => {
    const b = r[m.id];
    const hover = mouse && mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
    const yo = hover && mouse && mouse.down ? 1.5 : 0;
    roundRect(ctx, b.x, b.y + yo, b.w, b.h, 12); ctx.fillStyle = '#11160d'; ctx.fill();
    roundRect(ctx, b.x, b.y + yo, b.w, b.h, 12);
    const g = ctx.createLinearGradient(b.x, 0, b.x + b.w, 0);
    g.addColorStop(0, hexToRgba(m.accent, hover ? 0.42 : 0.22)); g.addColorStop(1, hexToRgba(m.accent, 0.04));
    ctx.fillStyle = g; ctx.fill();
    if (hover) { ctx.save(); ctx.shadowColor = m.accent; ctx.shadowBlur = 14; roundRect(ctx, b.x, b.y, b.w, b.h, 12); ctx.lineWidth = 2; ctx.strokeStyle = hexToRgba(m.accent, 0.5); ctx.stroke(); ctx.restore(); }
    roundRect(ctx, b.x, b.y + yo, b.w, b.h, 12); ctx.lineWidth = 2; ctx.strokeStyle = hover ? m.accent : hexToRgba(m.accent, 0.45); ctx.stroke();
    ctx.fillStyle = m.accent; roundRect(ctx, b.x + 11, b.y + yo + 11, 5, b.h - 22, 3); ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = hover ? '#ffffff' : '#ffe9b0'; ctx.font = '700 21px Cinzel, serif';
    ctx.fillText(m.name, b.x + 32, b.y + yo + 25);
    ctx.fillStyle = '#b9c8ad'; ctx.font = '14px Nunito, sans-serif';
    ctx.fillText(m.desc, b.x + 32, b.y + yo + 44);
  });
  titleButton(ctx, r.back, mouse);
  ctx.textAlign = 'left';
}

// ---- Themed-valleys screen ----
function themedRects() {
  const rects = {};
  const cw = 200, gap = 28, ch = 200;
  const total = cw * THEMES.length + gap * (THEMES.length - 1), x0 = (W - total) / 2, y = 234;
  THEMES.forEach((th, i) => { rects[th.id] = { x: x0 + i * (cw + gap), y, w: cw, h: ch }; });
  rects.back = { x: (W - 170) / 2, y: y + ch + 26, w: 170, h: 40, label: '◂ Back', accent: '#6fa8c0' };
  return rects;
}
export function themedHit(x, y) {
  const r = themedRects();
  for (const k of Object.keys(r)) { const b = r[k]; if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return k; }
  return null;
}
export function renderThemed(ctx, view, mouse, t) {
  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createRadialGradient(W / 2, H * 0.42, 80, W / 2, H * 0.42, 580);
  bg.addColorStop(0, '#24371f'); bg.addColorStop(1, '#0b120c');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  drawMotes(ctx, t);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe9b0'; ctx.font = '700 38px Cinzel, serif';
  ctx.fillText('Themed Valleys', W / 2, 122);
  ctx.fillStyle = '#a9c4a0'; ctx.font = '16px Nunito, sans-serif';
  ctx.fillText('A fixed palette for a different feel · cozy rules', W / 2, 152);
  const r = themedRects();
  THEMES.forEach(th => {
    const b = r[th.id];
    const hover = mouse && mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
    themedCard(ctx, b.x, b.y, b.w, b.h, 14);
    if (hover) { roundRect(ctx, b.x, b.y, b.w, b.h, 14); ctx.lineWidth = 2.5; ctx.strokeStyle = th.accent; ctx.stroke(); }
    const sw = th.palette.slice(0, 6);
    const swW = (b.w - 36) / sw.length;
    sw.forEach((terr, i) => { const col = TERRAIN[terr] || TERRAIN.field; ctx.fillStyle = col.c1; roundRect(ctx, b.x + 18 + i * swW, b.y + 30, swW - 5, 42, 6); ctx.fill(); });
    ctx.textAlign = 'center';
    ctx.fillStyle = hover ? '#fff7e0' : '#ffe9b0'; ctx.font = 'bold 23px Nunito, sans-serif';
    ctx.fillText(th.name, b.x + b.w / 2, b.y + 108);
    ctx.fillStyle = '#b9c8ad'; ctx.font = '13px Nunito, sans-serif';
    ctx.fillText(th.desc, b.x + b.w / 2, b.y + 134);
    ctx.fillStyle = th.accent; ctx.font = '12px Nunito, sans-serif';
    ctx.fillText('Calm rules', b.x + b.w / 2, b.y + 162);
  });
  titleButton(ctx, r.back, mouse);
  ctx.textAlign = 'left';
}

// ---- Music player screen ----
const MUS = { listX: (W - 580) / 2, listW: 580, top: 250, rowH: 30, rows: 7 };
function musicCtrlRects() {
  const cy = 198, bw = 54, gap = 16, total = bw * 3 + gap * 2, x0 = W / 2 - total / 2;
  return {
    prev: { x: x0, y: cy, w: bw, h: 40 },
    play: { x: x0 + bw + gap, y: cy, w: bw, h: 40 },
    next: { x: x0 + 2 * (bw + gap), y: cy, w: bw, h: 40 },
    back: { x: (W - 160) / 2, y: MUS.top + MUS.rows * MUS.rowH + 28, w: 160, h: 38, label: '◂ Back', accent: '#6fa8c0' },
  };
}
export function musicMaxScroll() { return Math.max(0, musicTracks().length - MUS.rows); }
export function musicHit(x, y, view) {
  const c = musicCtrlRects();
  for (const k of ['prev', 'play', 'next', 'back']) { const b = c[k]; if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return k; }
  if (x >= MUS.listX && x <= MUS.listX + MUS.listW && y >= MUS.top && y < MUS.top + MUS.rows * MUS.rowH) {
    const idx = (view.musicScroll || 0) + Math.floor((y - MUS.top) / MUS.rowH);
    if (idx < musicTracks().length) return 't' + idx;
  }
  return null;
}
export function renderMusic(ctx, view, mouse, t) {
  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#1b2433'); bg.addColorStop(1, '#0c1119');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const tracks = musicTracks(); const st = musicState();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe9b0'; ctx.font = '700 38px Cinzel, serif'; ctx.fillText('♪ Music', W / 2, 108);
  ctx.fillStyle = st.playing ? '#8fd0dc' : '#8a98a4'; ctx.font = '15px Nunito, sans-serif';
  ctx.fillText(tracks.length ? (st.playing ? 'Now playing — ' : 'Paused — ') + (tracks[st.idx] || '—') : 'No tracks loaded', W / 2, 146);
  ctx.fillStyle = '#5d6e7a'; ctx.font = '12px Nunito, sans-serif';
  ctx.fillText(tracks.length + ' tracks · all public-domain', W / 2, 168);
  const c = musicCtrlRects();
  for (const k of ['prev', 'play', 'next']) {
    const b = c[k], hover = mouse && mouse.x >= b.x && mouse.x <= b.x + b.w && mouse.y >= b.y && mouse.y <= b.y + b.h;
    roundRect(ctx, b.x, b.y, b.w, b.h, 10); ctx.fillStyle = hover ? '#2a3a4a' : '#18222e'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = hover ? '#8fd0dc' : 'rgba(255,255,255,0.2)'; ctx.stroke();
    ctx.fillStyle = '#e6ddc6'; ctx.font = 'bold 17px Nunito, sans-serif';
    ctx.fillText(k === 'play' ? (st.playing ? '❚❚' : '▶') : (k === 'prev' ? '◂◂' : '▸▸'), b.x + b.w / 2, b.y + b.h / 2 + 6);
  }
  const scroll = Math.max(0, Math.min(musicMaxScroll(), view.musicScroll || 0));
  ctx.textAlign = 'left';
  for (let r = 0; r < MUS.rows; r++) {
    const idx = scroll + r; if (idx >= tracks.length) break;
    const ry = MUS.top + r * MUS.rowH;
    const hover = mouse && mouse.x >= MUS.listX && mouse.x <= MUS.listX + MUS.listW && mouse.y >= ry && mouse.y < ry + MUS.rowH;
    const cur = idx === st.idx;
    if (hover || cur) { roundRect(ctx, MUS.listX, ry + 2, MUS.listW, MUS.rowH - 4, 6); ctx.fillStyle = cur ? 'rgba(143,208,220,0.18)' : 'rgba(255,255,255,0.06)'; ctx.fill(); }
    ctx.fillStyle = cur ? '#9fe0ec' : (hover ? '#fff7e0' : '#cdd6cf');
    ctx.font = (cur ? 'bold ' : '') + '15px Nunito, sans-serif';
    ctx.fillText((cur ? (st.playing ? '♪ ' : '❚ ') : '') + (idx + 1) + '.  ' + tracks[idx], MUS.listX + 16, ry + MUS.rowH / 2 + 5);
  }
  if (tracks.length > MUS.rows) {
    ctx.textAlign = 'center'; ctx.fillStyle = '#5d6e7a'; ctx.font = '11px Nunito, sans-serif';
    ctx.fillText('scroll for more · ' + (scroll + 1) + '–' + Math.min(tracks.length, scroll + MUS.rows) + ' of ' + tracks.length, W / 2, MUS.top + MUS.rows * MUS.rowH + 10);
  }
  titleButton(ctx, c.back, mouse);
  ctx.textAlign = 'left';
}

// ---- How-to-Play tutorial (click-through cards) ----
const TUT = [
  { title: 'Welcome to Hearthvale', body: ['Place hexagonal tiles to grow a living vale —', 'forests, rivers, farms and towns that breathe,', 'lit by a moving sun through day and night.', '', 'This guide walks through every mechanic.'], art: 'tile' },
  { title: '1 · Match the edges', body: ['Each tile has 6 terrain edges. When tiles', 'meet, edges of the SAME terrain score —', 'green ticks. Neighbours on the "terrain', 'wheel" blend too (coast & river, moor &', 'field) — cyan ticks. Mismatches just don’t score.'], art: 'match' },
  { title: '2 · Controls', body: ['Click a glowing slot to place a tile.', 'R / Space / right-click  ·  rotate', 'H  ·  hold a tile for later (swap once a turn)', 'S  ·  skip the current tile', 'Drag to pan · scroll to zoom · ↑ ↓ tilt camera'], art: 'controls' },
  { title: '3 · Scoring', body: ['Each matched edge  ·······  +10', 'A flawless tile (all 6 edges)  ·  PERFECT +30', 'Chain perfect-ish placements  ·  combo ×2 … ×4', 'Coast meets a river  ·  Estuary +15', 'Landmark tiles  ·  a big bonus', 'Hover any slot to see the live breakdown.'], art: 'scoring' },
  { title: '4 · Decrees', body: ['Some tiles raise a Decree — a little flag', 'with a goal (e.g. "grow this forest to 5").', 'Reach it for a big bonus AND extra tiles,', 'so fulfilling decrees keeps your run going.'], art: 'decree' },
  { title: '5 · Towns & hearthfolk', body: ['Connect village tiles and a cottage grows', 'into a hamlet, then a bustling town. Your', 'folk need food, water & wood from the land —', 'meet every need and the vale thrives (★, ⚓,', 'steady income); fall short and growth waits.'], art: 'town' },
  { title: '6 · Seasons', body: ['The vale turns through the seasons as it', 'grows. Each season favours one terrain for', 'bonus points — winter freezes the rivers and', 'your folk burn extra wood to stay warm,', 'so lay in forests before the snow.'], art: 'seasons' },
  { title: '7 · Weather fronts', body: ['Weather rolls in for a few tiles at a time —', 'watch the panel. Harvest Sun ripens fields', '& orchards; a Downpour swells rivers (but', 'floods low fields — high ground holds);', 'a Cold Snap freezes the rivers solid.'], art: 'weather' },
  { title: '8 · The living valley', body: ['Rivers water farms beside them — watered', 'farms yield every turn. The wild also spreads', 'on its own: young woods take root unbidden.', 'Harvest ripe regions with the sickle (G) for', 'points & tiles — the land rests, then regrows.'], art: 'living' },
  { title: '9 · Wildfire', body: ['In a drought, dry growth can catch fire', 'and spread each turn. Water, marsh and', 'mountains block it — rain or a placed', 'water tile douses it for a reward. Burnt', 'land leaves fertile ash to build beside —', 'or set a controlled burn with the 🔥 torch (F).'], art: 'fire' },
  { title: '10 · The Blight & the Wardens', body: ['In Warden mode, a Blightheart rises and', 'corruption spreads from it (−points).', 'Wall it off with water / mountain / coast,', 'cleanse with fae tiles, and build a Wardtower —', 'its aura purges the heart over a few turns.'], art: 'blight' },
  { title: '11 · Choose your way', body: ['Calm — cozy, gentle wilds', 'Zen — endless, no game-over, just build', 'Warden — defend against blight & fire', 'Journey — directed map objectives', 'Themed & Daily — fixed palettes · seeded board.'], art: 'modes' },
  { title: 'Go grow a vale', body: ['That’s everything! Fulfil decrees for more', 'tiles, raise towns, and watch the world come', 'to life around you.', '', 'Press Play and lay your first tile.'], art: 'tile' },
];

function tutorialButtonRects(idx) {
  const cardW = 620, cardX = (W - cardW) / 2, cardY = 78, cardH = 384;
  const r = {};
  r.close = { x: cardX + cardW - 42, y: cardY + 14, w: 28, h: 28, label: '✕' };
  const by = cardY + cardH - 54, bw = 150, bh = 40;
  if (idx > 0) r.back = { x: cardX + 28, y: by, w: bw, h: bh, label: '◂ Back', accent: '#6f8ac0' };
  const last = idx >= TUT.length - 1;
  r.next = { x: cardX + cardW - 28 - bw, y: by, w: bw, h: bh, label: last ? 'Play ▸' : 'Next ▸', accent: last ? '#4a8a3f' : '#cdb24a' };
  return r;
}
export function tutorialHit(x, y, idx) {
  const r = tutorialButtonRects(idx);
  for (const k of Object.keys(r)) { const b = r[k]; if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return k; }
  return null;
}
export function tutorialCount() { return TUT.length; }

function drawTutArt(ctx, art, cx, cy, t) {
  const sz = 38;
  if (art === 'tile') { drawTile(ctx, cx, cy, sz, ['forest', 'forest', 'field', 'field', 'water', 'village'], 5, null, t); drawHexOutline(ctx, cx, cy, sz, 'rgba(243,234,208,0.5)', 2); }
  else if (art === 'match') {
    const dx = sz * Math.sqrt(3);
    drawTile(ctx, cx - dx / 2, cy, sz, ['forest', 'field', 'field', 'water', 'water', 'forest'], 7, null, t);
    drawTile(ctx, cx + dx / 2, cy, sz, ['field', 'field', 'forest', 'forest', 'water', 'water'], 11, null, t);
    // green tick at the shared (east/west) seam
    ctx.fillStyle = '#8ff08a'; ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
  } else if (art === 'rotate') {
    drawTile(ctx, cx, cy, sz, ['water', 'water', 'village', 'field', 'field', 'forest'], 5, null, t);
    drawHexOutline(ctx, cx, cy, sz, 'rgba(243,234,208,0.5)', 2);
    ctx.strokeStyle = '#cdb24a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, sz * 1.35, -0.9, 0.9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + sz * 1.35, cy + sz * 0.9); ctx.lineTo(cx + sz * 1.55, cy + sz * 0.7); ctx.lineTo(cx + sz * 1.15, cy + sz * 0.7); ctx.closePath(); ctx.fillStyle = '#cdb24a'; ctx.fill();
  } else if (art === 'decree') {
    drawTile(ctx, cx, cy, sz, ['field', 'field', 'field', 'water', 'forest', 'village'], 9, null, t);
    drawHexOutline(ctx, cx, cy, sz, 'rgba(243,234,208,0.5)', 2);
    ctx.strokeStyle = '#2a1d12'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(cx, cy + 6); ctx.lineTo(cx, cy - sz * 0.5); ctx.stroke();
    ctx.fillStyle = '#cdb24a'; ctx.beginPath(); ctx.moveTo(cx, cy - sz * 0.5); ctx.lineTo(cx + 22, cy - sz * 0.5 + 6); ctx.lineTo(cx, cy - sz * 0.5 + 12); ctx.closePath(); ctx.fill();
  } else if (art === 'town') {
    const dx = sz * Math.sqrt(3);
    drawTile(ctx, cx - dx / 2, cy, sz, ['village', 'village', 'field', 'field', 'forest', 'village'], 3, null, t, { tier: 2, center: true });
    drawTile(ctx, cx + dx / 2, cy, sz, ['village', 'field', 'forest', 'village', 'village', 'field'], 13, null, t);
  } else if (art === 'controls') {
    const keys = ['R', 'H', 'S']; const kw = 46;
    ctx.textAlign = 'center';
    keys.forEach((k, i) => {
      const x = cx - kw * 1.3 + i * kw * 1.3;
      roundRect(ctx, x - kw / 2, cy - 24, kw, 46, 8); ctx.fillStyle = '#2a2218'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#cdb24a'; ctx.stroke();
      ctx.fillStyle = '#ffe9b0'; ctx.font = 'bold 22px Nunito, sans-serif'; ctx.fillText(k, x, cy + 7);
    });
    ctx.fillStyle = '#9fb398'; ctx.font = '12px Nunito, sans-serif'; ctx.fillText('rotate · hold · skip', cx, cy + 42);
  } else if (art === 'scoring') {
    drawTile(ctx, cx, cy, sz, ['forest', 'forest', 'forest', 'forest', 'forest', 'forest'], 3, null, t);
    drawHexOutline(ctx, cx, cy, sz, '#f3ead0', 2.5);
    for (let i = 0; i < 6; i++) { const a = 60 * i * Math.PI / 180; ctx.fillStyle = '#8ff08a'; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * sz * 0.86, cy + Math.sin(a) * sz * 0.86, 5, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#ffd766'; ctx.font = 'bold 20px Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('PERFECT +30', cx, cy - sz - 12);
  } else if (art === 'seasons') {
    const cols = [['#7fc36a', 'Spring'], ['#e8c24a', 'Summer'], ['#d98a3a', 'Autumn'], ['#a9c8e8', 'Winter']];
    const sw = 70; ctx.textAlign = 'center';
    cols.forEach(([c, n], i) => { const x = cx - sw * 2 + i * sw + sw / 2; roundRect(ctx, x - sw / 2 + 4, cy - 26, sw - 8, 52, 8); ctx.fillStyle = c; ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.font = 'bold 12px Nunito, sans-serif'; ctx.fillText(n, x, cy + 4); });
  } else if (art === 'blight') {
    const dx = sz * Math.sqrt(3);
    drawTile(ctx, cx - dx / 2, cy, sz, ['forest', 'field', 'forest', 'field', 'forest', 'field'], 5, null, t);
    ctx.save(); ctx.globalAlpha = 0.62; ctx.fillStyle = '#5a1a6a'; ctx.beginPath(); ctx.arc(cx - dx / 2, cy, sz * 0.82, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t / 300); ctx.fillStyle = '#e24bd0'; ctx.beginPath(); ctx.arc(cx - dx / 2, cy, sz * 0.22, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    drawTile(ctx, cx + dx / 2, cy, sz, ['mountain', 'field', 'mountain', 'field', 'village', 'field'], 9, 'wardtower', t);
    ctx.strokeStyle = `rgba(150,220,255,${0.5 + 0.3 * Math.sin(t / 400)})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx + dx / 2, cy, sz * 1.08, 0, Math.PI * 2); ctx.stroke();
  } else if (art === 'modes') {
    const pills = [['Calm', '#4a9a3f'], ['Zen', '#2fa6b8'], ['Warden', '#b24bcf']];
    const pw = 116; ctx.textAlign = 'center';
    pills.forEach(([n, c], i) => { const x = cx - pw * 1.08 + i * pw * 1.04; roundRect(ctx, x - pw / 2, cy - 17, pw, 34, 17); ctx.fillStyle = hexToRgba(c, 0.4); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = c; ctx.stroke(); ctx.fillStyle = '#fff7e0'; ctx.font = 'bold 16px Nunito, sans-serif'; ctx.fillText(n, x, cy + 6); });
  } else if (art === 'weather') {
    const items = [['sun', '#ffcf5e', 'Harvest Sun'], ['rain', '#8fd0e0', 'Downpour'], ['snow', '#cfe0ee', 'Cold Snap']];
    ctx.textAlign = 'center';
    items.forEach(([icon, col, name], i) => {
      const x = cx + (i - 1) * 130;
      panelIcon(ctx, x, cy - 8, 26, icon, col);
      ctx.fillStyle = col; ctx.font = '700 12px Nunito, sans-serif'; ctx.fillText(name, x, cy + 30);
    });
  } else if (art === 'living') {
    const items = [['rain', '#8fd0e0', 'rivers water'], ['sprout', '#9bd86b', 'farms yield'], ['leaf', '#7aa05a', 'wild creeps']];
    ctx.textAlign = 'center';
    items.forEach(([icon, col, name], i) => {
      const x = cx + (i - 1) * 130;
      panelIcon(ctx, x, cy - 8, 26, icon, col);
      ctx.fillStyle = col; ctx.font = '700 12px Nunito, sans-serif'; ctx.fillText(name, x, cy + 30);
    });
  } else if (art === 'fire') {
    panelIcon(ctx, cx - 80, cy - 8, 30, 'flame', '#ff9a4d');
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9fb094'; ctx.font = '700 20px Nunito, sans-serif'; ctx.fillText('vs', cx, cy - 2);
    panelIcon(ctx, cx + 80, cy - 8, 30, 'rain', '#8fd0e0');
    ctx.fillStyle = '#ff9a4d'; ctx.font = '700 12px Nunito, sans-serif'; ctx.fillText('spreads in drought', cx - 80, cy + 30);
    ctx.fillStyle = '#8fd0e0'; ctx.fillText('rain & rivers douse', cx + 80, cy + 30);
  }
}

export function renderTutorial(ctx, idx, mouse, t) {
  ctx.clearRect(0, 0, W, H);
  const bg = ctx.createRadialGradient(W / 2, H * 0.45, 80, W / 2, H * 0.45, 580);
  bg.addColorStop(0, '#24371f'); bg.addColorStop(1, '#0b120c');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  drawMotes(ctx, t);

  const card = TUT[Math.max(0, Math.min(TUT.length - 1, idx))];
  const cardW = 620, cardX = (W - cardW) / 2, cardY = 78, cardH = 384;
  themedCard(ctx, cardX, cardY, cardW, cardH, 16);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe9b0'; ctx.font = '700 26px Cinzel, serif';
  ctx.fillText(card.title, W / 2, cardY + 48);

  if (card.art) drawTutArt(ctx, card.art, W / 2, cardY + 132, t);
  const bodyY = card.art ? cardY + 196 : cardY + 96;
  ctx.fillStyle = '#cdd9c2'; ctx.font = '16px Nunito, sans-serif';
  card.body.forEach((l, i) => ctx.fillText(l, W / 2, bodyY + i * 26));

  // step counter + dots
  ctx.fillStyle = '#8aa080'; ctx.font = '12px Nunito, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('Step ' + (idx + 1) + ' of ' + TUT.length, W / 2, cardY + cardH - 90);
  const dots = TUT.length, ddw = 18, dx0 = W / 2 - (dots * ddw) / 2 + ddw / 2;
  for (let i = 0; i < dots; i++) { ctx.fillStyle = i === idx ? '#ffd766' : 'rgba(255,255,255,0.2)'; ctx.beginPath(); ctx.arc(dx0 + i * ddw, cardY + cardH - 74, 4, 0, Math.PI * 2); ctx.fill(); }

  const r = tutorialButtonRects(idx);
  if (r.back) titleButton(ctx, r.back, mouse);
  titleButton(ctx, r.next, mouse);
  // close X
  const cl = r.close, hov = mouse && mouse.x >= cl.x && mouse.x <= cl.x + cl.w && mouse.y >= cl.y && mouse.y <= cl.y + cl.h;
  ctx.fillStyle = hov ? '#e6ddc6' : '#7e9277'; ctx.font = 'bold 20px Nunito, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('✕', cl.x + cl.w / 2, cl.y + cl.h / 2 + 7);
  ctx.textAlign = 'left';
}

// ---- Pause & Settings overlays (drawn over a frozen board) ----
function menuCard(h) {
  const BW = W - PANEL_W, w = 360;
  return { x: (BW - w) / 2, y: (H - h) / 2, w, h };
}
function menuOverlay(ctx, c, title) {
  ctx.fillStyle = 'rgba(6,10,8,0.78)';
  ctx.fillRect(0, 0, W - PANEL_W, H);
  themedCard(ctx, c.x, c.y, c.w, c.h, 16);
  ctx.fillStyle = '#ffe9b0'; ctx.font = '700 24px Cinzel, serif';
  ctx.textAlign = 'center'; ctx.fillText(title, c.x + c.w / 2, c.y + 38);
}
function menuBtn(ctx, r, mouse) {
  const hov = mouse && mouse.x >= r.x && mouse.x <= r.x + r.w && mouse.y >= r.y && mouse.y <= r.y + r.h;
  roundRect(ctx, r.x, r.y, r.w, r.h, 9);
  ctx.fillStyle = hov ? '#21351f' : '#172616'; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = hov ? (r.accent || '#88a') : 'rgba(255,255,255,0.16)'; ctx.stroke();
  ctx.fillStyle = hov ? '#fff7e0' : '#e6ddc6'; ctx.textAlign = 'center';
  ctx.font = 'bold 17px Nunito, sans-serif';
  ctx.fillText(r.label, r.x + r.w / 2, r.y + r.h / 2 + 6);
}

function pauseButtonRects() {
  const c = menuCard(300), bw = c.w - 48, x = c.x + 24, gap = 48;
  const defs = [['resume', 'Resume', '#4a8a3f'], ['settings', 'Settings', '#6f8ac0'], ['new', 'New Vale', '#9d5bd0'], ['title', 'Quit to Title', '#b05a4a']];
  return defs.map(([k, label, accent], i) => ({ k, label, accent, x, y: c.y + 70 + i * gap, w: bw, h: 38 }));
}
export function pauseHit(x, y) {
  for (const b of pauseButtonRects()) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.k;
  return null;
}
export function drawPauseMenu(ctx, mouse) {
  menuOverlay(ctx, menuCard(300), 'Paused');
  for (const b of pauseButtonRects()) menuBtn(ctx, b, mouse);
  ctx.textAlign = 'left';
}

const SET_ROWS = [
  { key: 'sound', label: 'Sound', type: 'toggle' },
  { key: 'volume', label: 'SFX volume', type: 'slider' },
  { key: 'music', label: 'Music', type: 'toggle' },
  { key: 'musicVolume', label: 'Music volume', type: 'slider' },
  { key: 'dayNight', label: 'Day – Night cycle', type: 'toggle' },
  { key: 'weather', label: 'Weather', type: 'toggle' },
  { key: 'labels', label: 'Place names', type: 'toggle' },
  { key: 'symbols', label: 'Terrain symbols', type: 'toggle' },
  { key: 'corruption', label: 'Corruption (late game)', type: 'toggle' },
  { key: 'reducedMotion', label: 'Reduced motion', type: 'toggle' },
];
function settingsLayout() {
  const rh = 40;
  const c = menuCard(54 + SET_ROWS.length * rh + 46);
  const rows = SET_ROWS.map((r, i) => ({ ...r, x: c.x + 26, y: c.y + 50 + i * rh, w: c.w - 52, h: rh }));
  const back = { k: 'back', label: 'Back', accent: '#6f8ac0', x: c.x + c.w / 2 - 80, y: c.y + c.h - 40, w: 160, h: 32 };
  return { c, rows, back };
}
function sliderTrack(row) { return { x: row.x + row.w - 130, y: row.y + row.h / 2 - 3, w: 120, h: 6 }; }
function settingValue(key) {
  if (key === 'sound') return !isMuted();
  if (key === 'volume') return getVolume();
  return settings[key];
}
export function settingsHit(x, y) {
  const L = settingsLayout();
  for (const r of L.rows) {
    if (y < r.y || y > r.y + r.h) continue;
    if (r.type === 'slider') {
      const tr = sliderTrack(r);
      if (x >= tr.x - 10 && x <= tr.x + tr.w + 10) return { action: 'slider', key: r.key, value: Math.max(0, Math.min(1, (x - tr.x) / tr.w)) };
      return null;
    }
    if (x >= r.x && x <= r.x + r.w) return { action: 'toggle', key: r.key };
  }
  const b = L.back;
  if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return { action: 'back' };
  return null;
}
export function drawSettingsMenu(ctx, mouse) {
  const L = settingsLayout();
  menuOverlay(ctx, L.c, 'Settings');
  for (const r of L.rows) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#cdd9c2'; ctx.font = '15px Nunito, sans-serif';
    ctx.fillText(r.label, r.x, r.y + r.h / 2 + 5);
    if (r.type === 'toggle') {
      const on = settingValue(r.key);
      const pw = 50, ph = 22, px = r.x + r.w - pw, py = r.y + r.h / 2 - ph / 2;
      roundRect(ctx, px, py, pw, ph, 11);
      ctx.fillStyle = on ? '#3f7d3a' : '#2a2f28'; ctx.fill();
      ctx.fillStyle = '#f0ead8'; ctx.beginPath();
      ctx.arc(on ? px + pw - 11 : px + 11, py + ph / 2, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#9fb398'; ctx.font = 'bold 10px Nunito, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(on ? 'ON' : 'OFF', on ? px + 14 : px + pw - 14, py + ph / 2 + 3);
    } else {
      const tr = sliderTrack(r), v = settingValue(r.key);
      roundRect(ctx, tr.x, tr.y, tr.w, tr.h, 3); ctx.fillStyle = '#2a2f28'; ctx.fill();
      roundRect(ctx, tr.x, tr.y, tr.w * v, tr.h, 3); ctx.fillStyle = '#5fae54'; ctx.fill();
      ctx.fillStyle = '#f0ead8'; ctx.beginPath(); ctx.arc(tr.x + tr.w * v, tr.y + tr.h / 2, 8, 0, Math.PI * 2); ctx.fill();
    }
  }
  menuBtn(ctx, L.back, mouse);
  ctx.textAlign = 'left';
}
