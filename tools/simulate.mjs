// Headless balance audit: plays hundreds of full runs per mode with simple
// bot strategies and reports score distributions + where points come from.
// Run: node tools/simulate.mjs
import { newGame, place, openSlots, rotateCW, currentEdges, previewScore, JOURNEY_PALETTE, JOURNEY } from '../src/game.js';

const BASE_PALETTE = ['forest', 'field', 'water', 'village'];

function makeRun(mode) {
  const pal = mode === 'journey' ? JOURNEY_PALETTE : BASE_PALETTE;
  const g = newGame(pal, 50, null);
  g.mode = mode === 'zen' ? 'zen' : mode === 'journey' ? 'journey' : mode;
  g.endless = (mode === 'zen' || mode === 'journey');
  g.corruptionOn = mode === 'warden';
  g.weatherOn = true;
  return g;
}

function pickGreedy(g) {
  const slots = [...openSlots(g).values()];
  if (!slots.length) return null;
  let best = { total: -1e9, slot: null, rot: 0 };
  for (let rot = 0; rot < 6; rot++) {
    const edges = currentEdges(g);
    for (const s of slots) {
      const ps = previewScore(g, s.q, s.r, edges);
      if (ps.total > best.total) best = { total: ps.total, slot: s, rot };
    }
    rotateCW(g);
  }
  for (let i = 0; i < best.rot; i++) rotateCW(g);
  return best.slot;
}

function pickRandom(g) {
  const slots = [...openSlots(g).values()];
  if (!slots.length) return null;
  const n = (Math.random() * 6) | 0;
  for (let i = 0; i < n; i++) rotateCW(g);
  return slots[(Math.random() * slots.length) | 0];
}

function playRun(mode, strategy, cap) {
  const g = makeRun(mode);
  const m = {
    score: 0, tiles: 0, decrees: 0, perfects: 0, objectives: 0,
    growth: 0, weather: 0, season: 0, estuary: 0, landmark: 0,
    firePen: 0, fireRew: 0, floodPen: 0, silt: 0, overPen: 0, prune: 0,
    fires: 0, burned: 0, floodTiles: 0, overTiles: 0, frozen: 0,
  };
  for (let turn = 0; turn < cap && !g.gameOver && g.current; turn++) {
    const slot = strategy === 'greedy' ? pickGreedy(g) : pickRandom(g);
    if (!slot) break;
    const res = place(g, slot.q, slot.r);
    if (!res) break;
    m.tiles++;
    if (res.perfect) m.perfects++;
    m.decrees += (res.completed || []).length;
    if (res.journeyDone) m.objectives++;
    m.growth += res.growth || 0;
    m.weather += res.weatherBonus || 0;
    m.season += res.seasonBonus || 0;
    m.estuary += res.estuaryBonus || 0;
    m.landmark += res.landmarkBonus || 0;
    m.firePen += ((res.fireSpread || 0) + (res.fireStarted ? 1 : 0)) * 8;
    m.fireRew += (res.fireDoused || 0) * 10 + (res.ashBonus || 0);
    m.floodPen += (res.flooded || 0) * 5;
    m.silt += res.siltBonus || 0;
    m.overPen += (res.overgrew || 0) * 4;
    m.prune += (res.pruned || 0) * 6;
    if (res.fireStarted) m.fires++;
    m.burned += res.fireBurnedOut || 0;
    m.floodTiles += res.flooded || 0;
    m.overTiles += res.overgrew || 0;
    m.frozen += res.frozen || 0;
  }
  m.score = g.score;
  return m;
}

function pct(arr, p) { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function f(x, d = 0) { return Number(x).toFixed(d); }

const MODES = [
  ['calm', 'greedy', 200, 150], ['calm', 'random', 200, 60],
  ['warden', 'greedy', 200, 150], ['warden', 'random', 200, 60],
  ['zen', 'greedy', 100, 60],
  ['journey', 'greedy', 100, 60],
];

for (const [mode, strat, cap, runs] of MODES) {
  const rs = [];
  const t0 = Date.now();
  for (let i = 0; i < runs; i++) rs.push(playRun(mode, strat, cap));
  const scores = rs.map(r => r.score);
  const g = k => mean(rs.map(r => r[k]));
  const fireRuns = rs.filter(r => r.fires > 0).length;
  console.log(`\n=== ${mode.toUpperCase()} / ${strat} — ${runs} runs (${Date.now() - t0}ms) ===`);
  console.log(`score  mean ${f(mean(scores))}  p10 ${f(pct(scores, 0.1))}  med ${f(pct(scores, 0.5))}  p90 ${f(pct(scores, 0.9))}   tiles ${f(g('tiles'), 1)}`);
  console.log(`decrees ${f(g('decrees'), 1)}  perfects ${f(g('perfects'), 1)}${mode === 'journey' ? `  objectives ${f(g('objectives'), 1)}/${JOURNEY.length}` : ''}`);
  const ms = mean(scores) || 1;
  console.log(`sources: growth ${f(g('growth'))} (${f(g('growth') / ms * 100, 1)}%)  weather ${f(g('weather'))} (${f(g('weather') / ms * 100, 1)}%)  season ${f(g('season'))}  estuary ${f(g('estuary'))}  landmark ${f(g('landmark'))}`);
  console.log(`forces:  fire ${f(fireRuns / runs * 100)}% of runs (pen ${f(g('firePen'))}, rew ${f(g('fireRew'))}, burned ${f(g('burned'), 1)} tiles)  flood pen ${f(g('floodPen'))} / silt ${f(g('silt'))} (${f(g('floodTiles'), 1)} tiles)  overgrowth pen ${f(g('overPen'))} / prune ${f(g('prune'))} (${f(g('overTiles'), 1)} tiles)  frozen ${f(g('frozen'), 1)}`);
}
