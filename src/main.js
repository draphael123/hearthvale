// Entry point: game loop, input, pan/zoom, and meta-save wiring.
import { pixelToHex, hexToPixel, key } from './hex.js';
import { newGame, place, rotateCW, skipTile, hold, serialize, deserialize, JOURNEY_PALETTE, WEATHER, igniteTile, harvestRegion } from './game.js';
import { render, renderTitle, titleHit, copyButtonRect, dailyShareText,
  drawPauseMenu, pauseHit, drawSettingsMenu, settingsHit,
  renderTutorial, tutorialHit, tutorialCount, holdSlotRect, renderDraft, draftHit, renderThemed, themedHit,
  renderModeSelect, modeSelHit, renderMusic, musicHit, musicMaxScroll, setRenderScale, setUiScale, BOARD_TILT, setBoardTilt, perspInvX, zoomHit, controlHit, W, H } from './render.js';
import { START_OPTIONS } from './tiles.js';
import { loadSave, saveRun, paletteFor, todayYmd, persist, THEMES } from './meta.js';
import { setRng } from './tiles.js';
import { makeRng } from './art.js';
import { settings, set as setSetting } from './settings.js';
import { checkAchievements } from './achievements.js';
import * as hints from './hints.js';
import * as fx from './fx.js';
import * as audio from './audio.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const PANEL_W = 232;
const BOARD_W = W - PANEL_W;

// ---- Crisp rendering: back the canvas at the real display resolution rather
// than a fixed 960×540, so nothing is upscaled/soft. All drawing stays in 960×540
// logical units via a base transform; the backing store is larger.
let RENDER_SCALE = 1;
function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const rs = Math.min(2, Math.max(1, (rect.width * dpr) / W));
  RENDER_SCALE = rs;
  const bw = Math.round(W * rs), bh = Math.round(H * rs);
  if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
  setRenderScale(rs);
  // Phone-sized canvas → grow on-screen buttons toward ~44px physical.
  setUiScale(rect.width / W < 0.8 ? 1.4 : 1);
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// Preload the vendored fonts so canvas text renders in them, not the fallback.
if (document.fonts && document.fonts.load) {
  ['400 16px Nunito', '700 16px Nunito', '800 16px Nunito', '600 24px Cinzel', '700 24px Cinzel'].forEach(f => document.fonts.load(f).catch(() => { }));
}

// A one-off showcase vale rendered (full-screen, living) behind the title menu.
function buildShowcase() {
  setRng(makeRng(0x5eedface));
  const sg = newGame(['forest', 'field', 'water', 'village', 'mountain', 'coast', 'fae', 'orchard']);
  sg.corruptionOn = false;
  const kk = (q, r) => q + ',' + r, D = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
  for (let i = 0; i < 42; i++) {
    let best = null;
    for (const tl of sg.board.values()) { for (const [dq, dr] of D) { const nq = tl.q + dq, nr = tl.r + dr; if (!sg.board.has(kk(nq, nr))) { best = { q: nq, r: nr }; break; } } if (best) break; }
    if (!best) break;
    place(sg, best.q, best.r);
  }
  setRng(Math.random);
  let center = false;
  for (const tl of sg.board.values()) if (tl.edges.includes('village')) { tl.townSize = 4; if (!center) { tl.townCenter = true; center = true; } }
  sg.placed = 18;   // show it in lush summer
  return sg;
}

// Restore the saved camera pitch (up/down tilt).
try { const tv = parseFloat(localStorage.getItem('hearthvale.tilt')); if (tv) setBoardTilt(tv); } catch (e) { /* ignore */ }
function saveTilt() { try { localStorage.setItem('hearthvale.tilt', String(BOARD_TILT)); } catch (e) { /* ignore */ } }

const save = loadSave();
const view = {
  size: 38,
  panX: 0,
  panY: 0,
  save,
  savedThisRun: false,
  runStartBest: save.best || 0,   // best score going INTO this run (for NEW BEST + unlocks)
  daily: false,
};
try { view.showcase = buildShowcase(); view.showcaseView = { size: 46, panX: 0, panY: 16 }; } catch (e) { console.error('showcase build failed', e); }

let screen = 'title';             // 'title' | 'themed' | 'draft' | 'play' | 'pause' | 'settings' | 'tutorial'
let pendingMode = 'warden';       // mode chosen on the title, awaiting a start draft
let pendingPalette = null;        // themed-valley palette override (or null)
let tutorialIdx = 0;
let pauseT = 0, lastFrameT = 0;   // frozen clock while paused
audio.setVolume(settings.volume);
let g = newGame(paletteFor(save));

// ---- save / resume an in-progress run ----
const RUN_KEY = 'hearthvale.run.v1';
function hasSavedRun() { try { return !!localStorage.getItem(RUN_KEY); } catch (e) { return false; } }

// First-run onboarding: brand-new players walk through the tutorial before
// their first vale (once — skippable with ✕, never repeats after).
const TUT_SEEN = 'hearthvale.tutseen.v1';
function seenTutorial() { try { return !!localStorage.getItem(TUT_SEEN); } catch (e) { return true; } }
function markTutorialSeen() { try { localStorage.setItem(TUT_SEEN, '1'); } catch (e) { /* ignore */ } }
function saveRunState() {
  if (g.gameOver) { clearRunState(); return; }
  try { localStorage.setItem(RUN_KEY, JSON.stringify({ data: serialize(g), daily: view.daily })); } catch (e) { /* ignore */ }
}
function clearRunState() { try { localStorage.removeItem(RUN_KEY); } catch (e) { /* ignore */ } }
function resumeRun() {
  let blob; try { blob = JSON.parse(localStorage.getItem(RUN_KEY)); } catch (e) { blob = null; }
  if (!blob || !blob.data || blob.data.gameOver) { clearRunState(); startRun(false); return; }
  setRng(Math.random);
  g = deserialize(blob.data);
  g.mode = g.mode || (settings.corruption !== false ? 'warden' : 'calm');
  g.endless = g.mode === 'zen';
  g.corruptionOn = g.mode === 'warden';
  g.weatherOn = settings.weather !== false;
  view.panX = 0; view.panY = 0;
  view.savedThisRun = false;
  view.runStartBest = save.best || 0;
  view.daily = !!blob.daily;
  view.copied = false;
  fx.reset();
  screen = 'play';
}

// Start a fresh run. Daily runs seed the tile RNG from today's date so the
// board is identical for everyone that day.
function startRun(daily, mode, startEdges, paletteOverride) {
  if (daily) {
    const d = new Date();
    const seed = (d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()) >>> 0;
    setRng(makeRng(seed));
  } else {
    setRng(Math.random);
  }
  const m = mode || (settings.corruption !== false ? 'warden' : 'calm');
  const pal = paletteOverride || (m === 'journey' ? JOURNEY_PALETTE : paletteFor(save));
  g = newGame(pal, 50, daily ? null : startEdges || null);
  g.mode = m;
  g.endless = (m === 'zen' || m === 'journey');   // Zen + Journey never run out
  g.corruptionOn = m === 'warden';
  g.weatherOn = settings.weather !== false;        // weather fronts follow the Weather setting
  g.gentleStart = (save.runs || 0) === 0;          // very first vale: wilds hold off a while
  view.mode = g.mode;
  view.startEdges = daily ? null : (startEdges || null);
  view.palette = paletteOverride || null;       // remember themed palette for replay
  view.panX = 0; view.panY = 0;
  view.savedThisRun = false;
  view.runStartBest = save.best || 0;
  view.daily = !!daily;
  view.copied = false;
  clearRunState();
  fx.reset();
  screen = 'play';
}

const mouse = { x: 0, y: 0, hex: null, down: false, dragging: false, dragStart: null, moved: 0 };
const pointers = new Map();   // active touch/mouse pointers for pinch-zoom
let pinch = null;
const pdist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Map a client event to canvas-space coords (the canvas is CSS-scaled).
function toCanvas(e) {
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) / rect.width * W;
  const py = (e.clientY - rect.top) / rect.height * H;
  return { x: px, y: py };
}

function updateHex() {
  if (mouse.x >= BOARD_W) { mouse.hex = null; return; }
  const ox = BOARD_W / 2 + view.panX;
  const oy = H / 2 + view.panY;
  // Invert the perspective keystone (X) and the board tilt (Y) before mapping
  // to a hex, so click-to-place stays exact under the 3D warp.
  mouse.hex = pixelToHex(perspInvX(mouse.x, mouse.y, ox, oy), (mouse.y - oy) / BOARD_TILT, view.size);
}

function tryPlace() {
  if (g.gameOver || !mouse.hex) return;
  const res = place(g, mouse.hex.q, mouse.hex.r);
  if (!res) return;

  const p = hexToPixel(res.q, res.r, view.size);
  fx.placeFx(BOARD_W / 2 + view.panX + p.x, H / 2 + view.panY + p.y, view.size, res);
  audio.placement(res.combo, res.perfect);   // base placement sound always

  // A single placement can trigger many systems at once. Showing every banner,
  // toast and sound stacks into chaos — so we COLLECT the candidates and surface
  // only the single most important banner + toast + event sound. This is what
  // keeps the many systems reading as one calm game rather than a pile.
  const banners = [];     // [priority, text, color]
  const toasts = [];      // [priority, text, sub, color]
  let sound = null, soundPri = -1;
  const wantSound = (pri, fn) => { if (pri > soundPri) { soundPri = pri; sound = fn; } };

  if (g.gameOver) finishRun();   // before achievements so best-score ones see it
  const newly = checkAchievements(g, save);
  if (newly.length) { persist(save); banners.push([100, '★ ' + newly[0].name, '#ffd766']); wantSound(60, () => audio.bell(0.16)); }

  if (res.heartsPurged) { banners.push([92, `Blightheart purged! +${res.heartsPurged * 60}`, '#9be6ff']); wantSound(85, () => audio.cleanse()); }
  if (res.corruptionStarted) { banners.push([88, 'A Blightheart rises…', '#c44bd0']); wantSound(80, () => audio.blight()); }
  else if (res.heartRose) { banners.push([78, 'Another Blightheart rises…', '#c44bd0']); wantSound(80, () => audio.blight()); }
  else if (res.corruptedNew) wantSound(40, () => audio.blight());
  if (res.firstLandmark) { banners.push([70, 'Landmark Raised!', '#b89bd8']); wantSound(55, () => audio.bell(0.18)); }
  if (res.firstDecree) banners.push([60, 'First Decree!', '#ffd766']);
  if (res.journeyDone) {
    banners.push([96, res.journeyDone.all ? '★ Journey complete! ★' : `Objective complete!  +${res.journeyDone.reward}`, '#ffd766']);
    wantSound(72, () => { audio.decree(); audio.bell(0.18); });
  }

  if (res.festival) wantSound(75, () => audio.festival());
  if (res.completed && res.completed.length) wantSound(70, () => { audio.decree(); audio.bloom(); });
  if (res.estuaries) wantSound(50, () => audio.estuary());

  if (res.corruptionStarted && hints.fire('blight_intro')) toasts.push([100, 'The blight spreads from its heart', 'Build a Wardtower (it appears in your queue) and hold its aura on the heart to purge it', '#c79bdb']);
  if (res.prospered) { toasts.push([70, 'A town prospers!', 'Food, water & wood within reach · +30', '#ffd766']); wantSound(45, () => audio.bell(0.16)); }
  if (res.ported) { toasts.push([65, 'A port town!', 'Trade reaches the sea · +20', '#6fd6e0']); wantSound(44, () => audio.bell(0.14)); }
  if (res.wardPlaced) { toasts.push([62, 'Wardtower raised', 'Its aura wards nearby tiles & grinds down hearts', '#bfe6ff']); wantSound(46, () => audio.bell(0.16)); }
  else if (res.wardOffered) toasts.push([55, 'A Wardtower joins your queue', 'Place it near a Blightheart', '#bfe6ff']);
  if (res.cleansed) { toasts.push([50, 'Blight cleansed', `${res.cleansed} tile${res.cleansed > 1 ? 's' : ''} purified · +${res.cleansed * 10}`, '#aef0c0']); wantSound(48, () => audio.cleanse()); }
  if (res.weatherStarted) {
    const w = WEATHER[res.weatherStarted];
    const wcol = res.weatherStarted === 'sun' ? '#ffd766' : res.weatherStarted === 'rain' ? '#8fd0e0' : '#cfe0ee';
    toasts.push([72, w.name + ' rolls in', w.note, wcol]);
    wantSound(40, () => audio.bell(0.13));
  }
  if (res.fireStarted) {
    banners.push([86, '🔥 Wildfire!', '#ff9a4d']);
    toasts.push([86, 'Wildfire!', 'Rain douses it · water, marsh & mountains block it', '#ff9a4d']);
    wantSound(78, () => audio.fireStart());
  }
  if (res.fireDoused) { toasts.push([60, 'Fire doused', `the flames go out · +${res.fireDoused * 25}`, '#8fd0e0']); wantSound(47, () => audio.cleanse()); }
  if (res.ashBonus) toasts.push([45, 'Fertile ash', `new growth on burnt land · +${res.ashBonus}`, '#d9b48a']);
  if (res.flooded) { toasts.push([58, 'Floodwater rises', 'low fields drown until the rain passes — high ground holds', '#6fa6d0']); wantSound(52, () => audio.flood()); }
  if (res.receded) { toasts.push([56, 'The flood recedes', 'rich silt left behind — build beside it to claim it', '#8fd0a0']); wantSound(51, () => audio.recede()); }
  if (res.overgrew) toasts.push([62, 'The wild creeps in', 'brambles overgrow a farm — build beside it to prune them', '#7aa05a']);
  if (res.pruned) { toasts.push([44, 'Brambles pruned', `the farm breathes again · +${res.pruned * 15}`, '#9bd86b']); wantSound(43, () => audio.prune()); }
  if (res.siltBonus) { toasts.push([45, 'Rich silt', `the floodplain feeds new fields · +${res.siltBonus}`, '#a8c87a']); wantSound(42, () => audio.bell(0.12)); }
  if (res.growth && hints.fire('growth_intro')) toasts.push([42, 'The valley grows', 'Rivers water nearby farms — they yield a little each turn', '#9bd86b']);
  if (res.visitorHelped) {
    banners.push([94, `★ ${res.visitorHelped.name.split(' ')[0]} is delighted! +${res.visitorHelped.reward}`, '#ffd766']);
    wantSound(82, () => { audio.decree(); audio.bell(0.16); });
  }
  if (res.visitorArrived) {
    toasts.push([76, `${res.visitorArrived.name} pays a visit`, `“${res.visitorArrived.wish}”`, '#e0b66f']);
    wantSound(60, () => audio.visitor());
  }
  if (res.visitorGone) toasts.push([48, `${res.visitorGone.name.split(' ')[0]} waves farewell`, 'no harm done — another traveller may pass through', '#b8a98b']);
  if (res.sprouted) {
    toasts.push([38, 'The wild spreads', `a young ${res.sprouted.terr} takes root on its own`, '#8fc486']);
    const sp = hexToPixel(res.sprouted.q, res.sprouted.r, view.size);
    fx.sproutFx(res.sprouted.q + ',' + res.sprouted.r, BOARD_W / 2 + view.panX + sp.x, H / 2 + view.panY + sp.y, view.size);
  }

  // Teaching hints only fill a quiet moment — never compete with a real event.
  if (!toasts.length) { const h = pickHint(res); if (h) toasts.push([10, h.text, h.sub, h.color]); }

  banners.sort((a, b) => b[0] - a[0]);
  toasts.sort((a, b) => b[0] - a[0]);
  if (banners[0]) fx.banner(banners[0][1], banners[0][2]);
  if (toasts[0]) fx.toast(toasts[0][1], toasts[0][2], toasts[0][3]);

  audio.setBiomes(computeBiomes(g));
  if (g.gameOver) audio.gameover();
  else if (sound) sound();

  saveRunState();   // persist in-progress run (clears itself on game over)
}

// One-time contextual hints, in priority order — returns at most one to show.
function pickHint(res) {
  if (hints.fire('welcome')) return { text: 'Match terrain edges to score', sub: 'Drag to pan · scroll to zoom · R to rotate', color: '#ffe9b0' };
  if (res.estuaries && hints.fire('estuary')) return { text: 'Estuary!', sub: 'Coasts and rivers blend — bonus points', color: '#6fd6e0' };
  if (res.firstLandmark && hints.fire('landmark')) return { text: 'A Landmark tile', sub: 'Worth a big bonus where its terrain gathers', color: '#b89bd8' };
  if (res.festival && hints.fire('town')) return { text: 'Your settlement is growing', sub: 'Connect village tiles to raise a town', color: '#c2683d' };
  if (g.quests.some(q => !q.done) && hints.fire('decree')) return { text: 'A Decree', sub: 'Grow this region to its goal for a bonus + more tiles', color: '#cdb24a' };
  return null;
}

// Fraction of each terrain across all placed tile edges (for ambient sound).
function computeBiomes(g) {
  const c = {}; let total = 0;
  for (const tile of g.board.values()) for (const e of tile.edges) { c[e] = (c[e] || 0) + 1; total++; }
  const mix = {};
  if (total) for (const kk in c) mix[kk] = c[kk] / total;
  return mix;
}

function finishRun() {
  if (view.savedThisRun) return;
  saveRun(save, g.score, g.placed, { daily: view.daily, ymd: todayYmd() });
  view.savedThisRun = true;
}

function restart() {
  startRun(view.daily, view.daily ? undefined : view.mode, view.startEdges, view.palette);   // replay same mode/start/theme
}

// ---- Pointer ----
canvas.addEventListener('pointerdown', (e) => {
  startAudio();
  const p = toCanvas(e);
  pointers.set(e.pointerId, p);
  if (pointers.size >= 2) {                 // begin pinch-zoom
    const [a, b] = [...pointers.values()];
    pinch = { d: pdist(a, b) || 1, size: view.size };
    mouse.dragging = true;                  // suppress tap-to-place
  }
  mouse.x = p.x; mouse.y = p.y;
  mouse.down = true;
  mouse.moved = 0;
  mouse.dragStart = { x: p.x, y: p.y, panX: view.panX, panY: view.panY };
  updateHex();
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
});

canvas.addEventListener('pointermove', (e) => {
  const p = toCanvas(e);
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
  if (pinch && pointers.size >= 2) {        // pinch overrides pan
    const [a, b] = [...pointers.values()];
    view.size = Math.max(22, Math.min(60, pinch.size * (pdist(a, b) / pinch.d)));
    mouse.x = p.x; mouse.y = p.y; mouse.dragging = true;
    return;
  }
  if (mouse.down && mouse.dragStart) {
    const dx = p.x - mouse.dragStart.x;
    const dy = p.y - mouse.dragStart.y;
    mouse.moved = Math.max(mouse.moved, Math.hypot(dx, dy));
    if (mouse.moved > 6) {
      mouse.dragging = true;
      view.panX = mouse.dragStart.panX + dx;
      view.panY = mouse.dragStart.panY + dy;
    }
  }
  mouse.x = p.x; mouse.y = p.y;
  updateHex();
});

canvas.addEventListener('pointercancel', (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
});

canvas.addEventListener('pointerup', (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  const wasDrag = mouse.dragging;
  mouse.down = false;
  mouse.dragging = false;
  if (wasDrag) return;
  if (screen === 'title') {
    const hit = titleHit(mouse.x, mouse.y, hasSavedRun());
    if (hit) {
      startAudio(); audio.click();
      if (hit === 'continue') resumeRun();
      else if (hit === 'howto') { tutorialIdx = 0; screen = 'tutorial'; }
      else if (hit === 'newgame') {
        if (!seenTutorial() && !(view.save.runs > 0)) { tutorialIdx = 0; screen = 'tutorial'; }
        else screen = 'modesel';
      }
      else if (hit === 'daily') startRun(true);
      else if (hit === 'music') { view.musicScroll = 0; screen = 'music'; }
    }
    return;
  }
  if (screen === 'modesel') {
    startAudio();
    const hit = modeSelHit(mouse.x, mouse.y);
    if (hit) {
      audio.click();
      if (hit === 'back') screen = 'title';
      else if (hit === 'themed') screen = 'themed';
      else { pendingMode = hit; pendingPalette = null; screen = 'draft'; }   // calm / zen / warden / journey
    }
    return;
  }
  if (screen === 'music') {
    startAudio();
    const hit = musicHit(mouse.x, mouse.y, view);
    if (hit) {
      audio.click();
      if (hit === 'back') screen = 'title';
      else if (hit === 'prev') audio.musicPrev();
      else if (hit === 'next') audio.musicNext();
      else if (hit === 'play') audio.musicToggle();
      else if (hit[0] === 't') audio.playMusicTrack(parseInt(hit.slice(1), 10));
    }
    return;
  }
  if (screen === 'themed') {
    startAudio();
    const hit = themedHit(mouse.x, mouse.y);
    if (hit) {
      audio.click();
      if (hit === 'back') screen = 'modesel';
      else { const th = THEMES.find(x => x.id === hit); if (th) { pendingMode = 'calm'; pendingPalette = th.palette; screen = 'draft'; } }
    }
    return;
  }
  if (screen === 'draft') {
    startAudio();
    const hit = draftHit(mouse.x, mouse.y);
    if (hit) {
      audio.click();
      if (hit === 'back') screen = 'modesel';
      else { const o = START_OPTIONS.find(s => s.id === hit); startRun(false, pendingMode, o ? o.edges : null, pendingPalette); }
    }
    return;
  }
  if (screen === 'tutorial') {
    startAudio();
    const hit = tutorialHit(mouse.x, mouse.y, tutorialIdx);
    if (hit) audio.click();
    if (hit === 'close') { markTutorialSeen(); screen = 'title'; }
    else if (hit === 'back') tutorialIdx = Math.max(0, tutorialIdx - 1);
    else if (hit === 'next') { if (tutorialIdx >= tutorialCount() - 1) { markTutorialSeen(); screen = 'modesel'; } else tutorialIdx++; }
    return;
  }
  if (screen === 'pause') {
    startAudio();
    const hit = pauseHit(mouse.x, mouse.y);
    if (hit) audio.click();
    if (hit === 'resume') screen = 'play';
    else if (hit === 'settings') screen = 'settings';
    else if (hit === 'new') restart();
    else if (hit === 'title') screen = 'title';
    return;
  }
  if (screen === 'settings') {
    startAudio();
    const a = settingsHit(mouse.x, mouse.y);
    if (a) { audio.click(); applySetting(a); }
    return;
  }
  if (g.gameOver) {
    if (view.daily && !view.copied) {
      const cb = copyButtonRect();
      if (mouse.x >= cb.x && mouse.x <= cb.x + cb.w && mouse.y >= cb.y && mouse.y <= cb.y + cb.h) {
        try { navigator.clipboard.writeText(dailyShareText(g)); } catch (e) { /* ignore */ }
        view.copied = true;
        return;
      }
    }
    restart();
  } else {
    const zh = zoomHit(mouse.x, mouse.y);
    if (zh) { view.size = Math.max(22, Math.min(60, view.size * (zh === 'zin' ? 1.18 : 0.85))); audio.click(); return; }
    const ch = g.current && controlHit(mouse.x, mouse.y);
    if (ch === 'rotate') { view.torchMode = false; rotateCW(g); audio.rotate(); return; }
    if (ch === 'skip') { view.torchMode = false; if (skipTile(g)) { audio.skip(); saveRunState(); } return; }
    if (ch === 'torch') {
      view.harvestMode = false;
      if ((g.torches || 0) > 0) { view.torchMode = !view.torchMode; audio.click(); }
      return;
    }
    if (ch === 'harvest') {
      view.torchMode = false;
      view.harvestMode = !view.harvestMode; audio.click();
      return;
    }
    // Torch armed: the next tap ignites a flammable tile (or cancels).
    if (view.torchMode) {
      view.torchMode = false;
      if (mouse.hex && igniteTile(g, mouse.hex.q, mouse.hex.r)) {
        audio.fireStart();
        fx.toast('Controlled burn', 'the fire is yours now — keep it contained', '#ff9a4d');
        saveRunState();
      }
      return;
    }
    // Sickle armed: the next tap reaps a ripe region (or cancels).
    if (view.harvestMode) {
      view.harvestMode = false;
      if (mouse.hex) {
        const hv2 = harvestRegion(g, mouse.hex.q, mouse.hex.r);
        if (hv2) {
          audio.bloom();
          fx.toast('Harvest!', `${hv2.size} ${hv2.terr} tiles reaped · +${hv2.points} · ${hv2.tiles} new tile${hv2.tiles === 1 ? '' : 's'}`, '#e8c24a');
          saveRunState();
        } else {
          fx.toast('Nothing ripe here', 'reap a healthy forest / field / orchard region of 4+', '#9aa893');
        }
      }
      return;
    }
    const hr = holdSlotRect();
    if (hr && mouse.x >= hr.x && mouse.x <= hr.x + hr.w && mouse.y >= hr.y && mouse.y <= hr.y + hr.h) {
      if (hold(g)) { audio.rotate(); saveRunState(); }
      return;
    }
    tryPlace();
  }
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (screen === 'play') { rotateCW(g); audio.rotate(); }
});

// Wheel to zoom around the board.
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (screen === 'music') { view.musicScroll = Math.max(0, Math.min(musicMaxScroll(), (view.musicScroll || 0) + (e.deltaY > 0 ? 1 : -1))); return; }
  const factor = e.deltaY < 0 ? 1.08 : 0.926;
  view.size = Math.max(22, Math.min(60, view.size * factor));
}, { passive: false });

// ---- Keyboard ----
window.addEventListener('keydown', (e) => {
  startAudio();
  if (e.key === 'r' || e.key === 'R' || e.key === ' ') {
    e.preventDefault();
    if (screen === 'play' && g.current) { rotateCW(g); audio.rotate(); }
  } else if (e.key === 's' || e.key === 'S') {
    if (skipTile(g)) audio.skip();
  } else if (e.key === 'h' || e.key === 'H') {
    if (screen === 'play' && hold(g)) { audio.rotate(); saveRunState(); }
  } else if (e.key === 'f' || e.key === 'F') {
    if (screen === 'play' && (g.torches || 0) > 0) { view.harvestMode = false; view.torchMode = !view.torchMode; audio.click(); }
  } else if (e.key === 'g' || e.key === 'G') {
    if (screen === 'play') { view.torchMode = false; view.harvestMode = !view.harvestMode; audio.click(); }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault(); setBoardTilt(BOARD_TILT + 0.05); saveTilt();   // raise camera (more top-down)
  } else if (e.key === 'ArrowDown') {
    e.preventDefault(); setBoardTilt(BOARD_TILT - 0.05); saveTilt();   // lower camera (more 3D / side-on)
  } else if (e.key === 'm' || e.key === 'M') {
    audio.toggleMute();
  } else if (e.key === 'n' || e.key === 'N') {
    if (screen === 'play') restart();
  } else if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    if (screen === 'play') { pauseT = lastFrameT; screen = 'pause'; }
    else if (screen === 'pause') screen = 'play';
    else if (screen === 'settings') screen = 'pause';
    else if (screen === 'tutorial') screen = 'title';
  }
});

// ---- Loop ----
let audioSynced = false;
function startAudio() {
  audio['ensureStarted']();
  if (!audioSynced) { audioSynced = true; audio.setMusicVolume(settings.musicVolume); audio.setMusicEnabled(settings.music); }
}

function applySetting(a) {
  if (a.action === 'back') { screen = 'pause'; return; }
  if (a.action === 'slider') {
    setSetting(a.key, a.value);
    if (a.key === 'volume') audio.setVolume(a.value);
    else if (a.key === 'musicVolume') audio.setMusicVolume(a.value);
    return;
  }
  if (a.action === 'toggle') {
    if (a.key === 'sound') { audio.toggleMute(); return; }
    const nv = !settings[a.key];
    setSetting(a.key, nv);
    if (a.key === 'music') audio.setMusicEnabled(nv);
  }
}

function frame(t) {
  lastFrameT = t;
  try {
    audio.update(t);
    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
    if (screen === 'title') {
      renderTitle(ctx, view, mouse, t, hasSavedRun());
    } else if (screen === 'modesel') {
      renderModeSelect(ctx, view, mouse, t);
    } else if (screen === 'draft') {
      renderDraft(ctx, view, mouse, t, pendingMode);
    } else if (screen === 'themed') {
      renderThemed(ctx, view, mouse, t);
    } else if (screen === 'music') {
      renderMusic(ctx, view, mouse, t);
    } else if (screen === 'tutorial') {
      renderTutorial(ctx, tutorialIdx, mouse, t);
    } else {
      const rt = (screen === 'pause' || screen === 'settings') ? pauseT : t;
      render(ctx, g, view, mouse, rt);
      if (screen === 'pause') drawPauseMenu(ctx, mouse);
      else if (screen === 'settings') drawSettingsMenu(ctx, mouse);
    }
  } catch (err) {
    window.__renderErr = (err && err.stack) || String(err);
    console.error('render error', err);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Expose a tiny harness for headless verification in the preview.
window.__hv = {
  state: () => g,
  view,
  place: (q, r) => place(g, q, r),               // logic only
  placeUI: (q, r) => {                            // mirrors a real click (spawns fx)
    const before = mouse.hex;
    mouse.hex = { q, r };
    tryPlace();
    mouse.hex = before;
  },
  rotate: () => rotateCW(g),
  skip: () => skipTile(g),
  restart,
  startRun: (daily) => startRun(daily),
  goTitle: () => { screen = 'title'; },
  setScreen: (s) => { screen = s; },
  getScreen: () => screen,
  applySetting: (a) => applySetting(a),
  getSettings: () => settings,
  fxDebug: () => fx.debug(),
  renderNow: (t = 1000) => {
    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
    if (screen === 'title') renderTitle(ctx, view, mouse, t, hasSavedRun());
    else if (screen === 'modesel') renderModeSelect(ctx, view, mouse, t);
    else if (screen === 'draft') renderDraft(ctx, view, mouse, t, pendingMode);
    else if (screen === 'themed') renderThemed(ctx, view, mouse, t);
    else if (screen === 'music') renderMusic(ctx, view, mouse, t);
    else if (screen === 'tutorial') renderTutorial(ctx, tutorialIdx, mouse, t);
    else { render(ctx, g, view, mouse, t); if (screen === 'pause') drawPauseMenu(ctx, mouse); else if (screen === 'settings') drawSettingsMenu(ctx, mouse); }
  },
  setDraft: (m) => { pendingMode = m || 'warden'; screen = 'draft'; },
  setTutorial: (i) => { tutorialIdx = i; screen = 'tutorial'; },
  hasSavedRun, resumeRun, saveRunState,
};
