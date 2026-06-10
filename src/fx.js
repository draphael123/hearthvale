// Lightweight juice layer: tile drop-in bounce, dust puffs, floating score
// text, and decree-completion bursts. Particles use absolute canvas coords
// captured at spawn (animations are < 1s, so panning mid-animation is rare and
// harmless). main.js spawns effects; render.js drives update + draw.

const E = [];                 // active particle effects
const drops = new Map();      // tileKey -> { age, life } drop-in animations
const ripples = new Map();    // neighbor tileKey -> { age, life } settle bounce
const RDIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
let lastT = null;

export function reset() {
  E.length = 0;
  drops.clear();
  ripples.clear();
  lastT = null;
}

// Introspection for headless verification.
export function debug() {
  const types = {};
  for (const e of E) types[e.type] = (types[e.type] || 0) + 1;
  return { effects: E.length, drops: drops.size, types };
}

// Called after a successful placement. (x,y) is the tile's screen center.
export function placeFx(x, y, size, lp) {
  drops.set(lp.q + ',' + lp.r, { age: 0, life: 300 });
  spawnDust(x, y + size * 0.3, size);
  // Flourish: a radial light-pulse + fluttering leaf scatter on every landing
  // (bigger and golden for a PERFECT placement).
  spawnPulse(x, y, size * (lp.perfect ? 1.5 : 1), lp.perfect ? '255,224,138' : '255,243,200');
  spawnLeaves(x, y, size, lp.perfect ? 14 : 7, lp.perfect);
  // settle ripple: nudge each neighbouring tile
  for (const [dq, dr] of RDIRS) ripples.set((lp.q + dq) + ',' + (lp.r + dr), { age: 0, life: 320 });
  // matched-edge flash: green glow along each seam that matched
  for (const i of (lp.matchedEdges || [])) {
    const a = 60 * i * Math.PI / 180;
    E.push({ type: 'flash', x: x + Math.cos(a) * size * 0.866, y: y + Math.sin(a) * size * 0.866, age: 0, life: 420, r: size * 0.2 });
  }
  if (lp.points > 0) {
    const multTag = lp.mult && lp.mult > 1 ? `  ×${lp.mult.toFixed(lp.mult % 1 ? 1 : 0)}` : '';
    spawnScore(x, y - size * 0.5, '+' + lp.points + multTag,
      lp.perfect ? '#ffe08a' : '#eaf3d8', lp.perfect ? 22 : 16);
  }
  if (lp.estuaryBonus > 0) spawnScore(x, y - size * 0.85, `Estuary +${lp.estuaryBonus}`, '#6fd6e0', 14);
  if (lp.combo >= 3) spawnScore(x, y - size * 1.0, `COMBO ${lp.combo}`, '#ff9a4d', 14);
  if (lp.landmark) spawnScore(x, y - size * 1.35, (lp.landmark[0].toUpperCase() + lp.landmark.slice(1)) + ` +${lp.landmarkBonus}`, '#ffd766', 15);
  if (lp.perfect) spawnRing(x, y, size, '#ffe08a');
  if (lp.completed && lp.completed.length) {
    for (let i = 0; i < lp.completed.length; i++) spawnBurst(x, y, size, '#ffd766');
    spawnRing(x, y, size, '#ffd766');
    spawnScore(x, y - size * 1.15, 'DECREE!', '#ffd766', 18);
  }
}

function spawnDust(x, y, size) {
  const parts = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (i / (n - 1)) * Math.PI; // upper hemisphere spray
    const sp = size * (1.6 + Math.random() * 1.4);
    parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7, r: size * (0.07 + Math.random() * 0.06) });
  }
  E.push({ type: 'dust', parts, age: 0, life: 420, grav: size * 5, color: '#cdbf9a' });
}

function spawnBurst(x, y, size, color) {
  const parts = [];
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const sp = size * (3 + Math.random() * 3);
    parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - size * 1.5, r: size * (0.06 + Math.random() * 0.05) });
  }
  E.push({ type: 'spark', parts, age: 0, life: 720, grav: size * 9, color });
}

function spawnRing(x, y, size, color) {
  E.push({ type: 'ring', x, y, age: 0, life: 520, color, r0: size * 0.3, r1: size * 1.5 });
}

// Soft expanding flash of light (additive) under a fresh placement.
function spawnPulse(x, y, size, rgb) {
  E.push({ type: 'pulse', x, y, age: 0, life: 360, rgb, r0: size * 0.25, r1: size * 1.9 });
}

// Little leaves/petals flutter up and out when a tile lands.
const LEAF_COLS = ['#7fc36a', '#9bd86b', '#5fae54', '#e8c24a'];
function spawnLeaves(x, y, size, n, gold) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
    const sp = size * (1.8 + Math.random() * 2.2);
    parts.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - size * 2.2,
      r: size * (0.09 + Math.random() * 0.05),
      rot: Math.random() * Math.PI * 2, rotV: (Math.random() - 0.5) * 9,
      col: gold && i % 2 ? '#ffe08a' : LEAF_COLS[(Math.random() * LEAF_COLS.length) | 0],
    });
  }
  E.push({ type: 'leaf', parts, age: 0, life: 760, grav: size * 6 });
}

function spawnScore(x, y, text, color, fontSize) {
  E.push({ type: 'score', x, y, text, color, fontSize, age: 0, life: 900 });
}

// A wild tile sprouting on its own: drop-in pop + a few drifting leaves.
export function sproutFx(tileKey, x, y, size) {
  drops.set(tileKey, { age: 0, life: 340 });
  spawnLeaves(x, y, size, 5, false);
}

// A celebratory banner that scales in and fades, centered over the board. Only
// one banner is ever shown — a new one replaces any lingering one (cohesion).
export function banner(text, color) {
  for (let i = E.length - 1; i >= 0; i--) if (E[i].type === 'banner') E.splice(i, 1);
  E.push({ type: 'banner', text, color, age: 0, life: 1800 });
}

// A small informational toast pill near the top. Only one toast at a time.
export function toast(text, sub, color) {
  for (let i = E.length - 1; i >= 0; i--) if (E[i].type === 'toast') E.splice(i, 1);
  E.push({ type: 'toast', text, sub: sub || '', color: color || '#ffe9b0', age: 0, life: 4400 });
}

function roundRectFx(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---- per-frame update ----
export function update(t) {
  if (lastT == null) lastT = t;
  let dt = (t - lastT) / 1000;
  lastT = t;
  if (dt < 0 || dt > 0.1) dt = 0.016; // clamp tab-switch / first-frame spikes

  for (let i = E.length - 1; i >= 0; i--) {
    const e = E[i];
    e.age += dt * 1000;
    if (e.parts) {
      for (const p of e.parts) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += e.grav * dt;
        if (p.rotV) p.rot += p.rotV * dt;
      }
    }
    if (e.age >= e.life) E.splice(i, 1);
  }
  for (const [k, d] of drops) {
    d.age += dt * 1000;
    if (d.age >= d.life) drops.delete(k);
  }
  for (const [k, d] of ripples) {
    d.age += dt * 1000;
    if (d.age >= d.life) ripples.delete(k);
  }
}

// Scale multiplier for a tile's drop-in pop (easeOutBack overshoot), or null.
export function dropScale(tileKey) {
  const d = drops.get(tileKey);
  if (!d) return null;
  const p = Math.min(1, d.age / d.life);
  const c1 = 1.70158, c3 = c1 + 1;
  const s = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  return Math.max(0.05, s);
}

// Small bounce multiplier (~1.0) for a tile rippling from a nearby placement.
export function rippleScale(tileKey) {
  const d = ripples.get(tileKey);
  if (!d) return 1;
  const p = d.age / d.life;
  return 1 + Math.sin(p * Math.PI) * 0.06;
}

// ---- draw (call inside the board clip, above tiles) ----
export function draw(ctx) {
  ctx.save();
  ctx.textAlign = 'center';
  for (const e of E) {
    const k = e.age / e.life;
    const fade = 1 - k;
    if (e.type === 'dust' || e.type === 'spark') {
      ctx.globalAlpha = fade;
      ctx.fillStyle = e.color;
      for (const p of e.parts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (e.type === 'spark' ? 1 : (0.6 + fade * 0.6)), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (e.type === 'pulse') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const r = e.r0 + (e.r1 - e.r0) * easeOut(k);
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
      g.addColorStop(0, `rgba(${e.rgb},${0.34 * fade})`);
      g.addColorStop(1, `rgba(${e.rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (e.type === 'leaf') {
      ctx.globalAlpha = fade;
      for (const p of e.parts) {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.col;
        ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    } else if (e.type === 'ring') {
      const r = e.r0 + (e.r1 - e.r0) * easeOut(k);
      ctx.globalAlpha = fade * 0.8;
      ctx.lineWidth = 3 * fade + 1;
      ctx.strokeStyle = e.color;
      ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.stroke();
    } else if (e.type === 'score') {
      const rise = easeOut(k) * 30;
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.font = `bold ${e.fontSize}px Nunito, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(e.text, e.x, e.y - rise);
      ctx.fillStyle = e.color;
      ctx.fillText(e.text, e.x, e.y - rise);
    } else if (e.type === 'flash') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const r = e.r * (0.5 + easeOut(k));
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
      g.addColorStop(0, `rgba(150,255,140,${0.7 * fade})`);
      g.addColorStop(1, 'rgba(150,255,140,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    } else if (e.type === 'banner') {
      const bx = (960 - 232) / 2, by = 540 * 0.3;
      let sc, al;
      if (k < 0.12) { const p = k / 0.12; sc = 0.6 + 0.4 * easeOut(p); al = p; }
      else if (k > 0.72) { al = (1 - k) / 0.28; sc = 1; }
      else { sc = 1; al = 1; }
      ctx.save();
      ctx.globalAlpha = al;
      ctx.translate(bx, by); ctx.scale(sc, sc);
      ctx.font = 'bold 32px Georgia, "Times New Roman", serif';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(e.text, 0, 0);
      ctx.fillStyle = e.color; ctx.fillText(e.text, 0, 0);
      ctx.strokeStyle = e.color; ctx.lineWidth = 2; ctx.globalAlpha = al * 0.8;
      ctx.beginPath(); ctx.moveTo(-95, 16); ctx.lineTo(95, 16); ctx.stroke();
      ctx.restore();
    } else if (e.type === 'toast') {
      const bx = (960 - 232) / 2, by = 64;
      let al; if (k < 0.07) al = k / 0.07; else if (k > 0.86) al = (1 - k) / 0.14; else al = 1;
      ctx.save();
      ctx.globalAlpha = al;
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px Nunito, sans-serif';
      const tw = ctx.measureText(e.text).width;
      ctx.font = '12px Nunito, sans-serif';
      const sw = e.sub ? ctx.measureText(e.sub).width : 0;
      const w = Math.max(tw, sw) + 44, h = e.sub ? 50 : 32;
      roundRectFx(ctx, bx - w / 2, by, w, h, 10);
      ctx.fillStyle = 'rgba(18,30,20,0.92)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,224,138,0.3)'; ctx.lineWidth = 1.5; roundRectFx(ctx, bx - w / 2, by, w, h, 10); ctx.stroke();
      ctx.fillStyle = e.color; ctx.font = 'bold 15px Nunito, sans-serif';
      ctx.fillText(e.text, bx, by + (e.sub ? 20 : 21));
      if (e.sub) { ctx.fillStyle = '#cdd9c2'; ctx.font = '12px Nunito, sans-serif'; ctx.fillText(e.sub, bx, by + 39); }
      ctx.restore();
    }
  }
  ctx.restore();
}

function easeOut(p) { return 1 - Math.pow(1 - p, 3); }
