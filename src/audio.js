// Synthesized audio for Hearthvale (WebAudio, no asset files) — tuned to be
// calm and spacious:
//  - a soft reverb bus gives everything a gentle tail
//  - a warm sine pad that slowly drifts through a calm chord progression
//  - biome layers (stream / wind / fae shimmer), birds by day, crickets by night
//  - soft placement chimes, a gentle decree/bell, festival, and game-over chord
// The AudioContext can only start after a user gesture — call ensureStarted()
// from the first pointer/key handler.

let ctx = null;
let master = null;        // master gain (also the mute switch)
let reverb = null;        // convolver
let reverbIn = null;      // wet send bus
let pad = null;           // { filter, gain, voices, chordIdx, nextChord }
let layers = null;        // biome ambient layers { stream, shimmer, wind }
let biomes = { water: 0, fae: 0, mountain: 0, forest: 0 };
let started = false;
let muted = false;
let vol = 0.5;
let nextChirp = 0;

// Background music — a playlist of CC0 tracks that crossfade. The list is
// loaded from music/manifest.json (so tracks can be added without code edits);
// this hand-picked set is the fallback if the manifest is missing.
let MUSIC_TRACKS = [
  'music/forest_ambience.mp3', 'music/field_of_dreams.mp3', 'music/bards_tale.mp3',
  'music/old_tower_inn.mp3', 'music/harvest_season.mp3', 'music/kings_feast.mp3', 'music/market_day.mp3',
];
function loadManifest() {
  fetch('music/manifest.json').then(r => r.ok ? r.json() : null).then(list => {
    if (Array.isArray(list) && list.length) MUSIC_TRACKS = list.map(n => n.startsWith('music/') ? n : 'music/' + n);
  }).catch(() => { /* keep fallback */ });
}
const MUSIC_XFADE = 4; // seconds
let musicGain = null, musicBuffers = [], musicIdx = 0, musicTimer = null, currentSrc = null;
let musicWanted = false, musicVol = 0.55, chainRunning = false, padBaseGain = 0.06, startedOnce = false;

const semis = (n) => Math.pow(2, n / 12);
const A3 = 220;
const PENT = [0, 2, 4, 7, 9];   // major pentatonic — placement notes always consonant

// Calm chord drift (A minor · C · F · G), voices sorted low→high so glides are
// small and smooth. The pad cross-fades between these every ~15s.
const CHORDS = [
  [220.00, 261.63, 329.63], // Am
  [261.63, 329.63, 392.00], // C
  [220.00, 261.63, 349.23], // F
  [246.94, 293.66, 392.00], // G
];

try { muted = localStorage.getItem('hearthvale.muted') === '1'; } catch (e) { /* ignore */ }

export function isMuted() { return muted; }
export function getVolume() { return vol; }

export function setVolume(v) {
  vol = Math.max(0, Math.min(1, v));
  if (master && !muted) master.gain.setTargetAtTime(vol, ctx.currentTime, 0.05);
}

export function setBiomes(mix) { if (mix) biomes = mix; }

export function ensureStarted() {
  if (started) { if (ctx && ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : vol;
  master.connect(ctx.destination);
  // reverb bus — a generated impulse response for a soft, roomy tail
  reverb = ctx.createConvolver();
  reverb.buffer = makeIR(2.9, 2.3);
  reverbIn = ctx.createGain();
  reverbIn.gain.value = 0.5;
  reverbIn.connect(reverb); reverb.connect(master);
  startPad();
  loadManifest();
  started = true;
}

export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('hearthvale.muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
  if (master) master.gain.linearRampToValueAtTime(muted ? 0 : vol, ctx.currentTime + 0.25);
  return muted;
}

function makeIR(seconds, decay) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function startPad() {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = 650; filter.Q.value = 0.4;
  const gain = ctx.createGain(); gain.gain.value = 0.06;
  filter.connect(gain); gain.connect(master); gain.connect(reverbIn);

  // grounding low drone
  const drone = ctx.createOscillator(); drone.type = 'sine'; drone.frequency.value = 55;
  const dg = ctx.createGain(); dg.gain.value = 0.5; drone.connect(dg); dg.connect(filter); drone.start();

  // three warm chord voices (retuned slowly by update)
  const voices = [];
  for (let i = 0; i < 3; i++) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = CHORDS[0][i];
    const vg = ctx.createGain(); vg.gain.value = 0.15; o.connect(vg); vg.connect(filter); o.start();
    // gentle per-voice detune drift so the pad never sits perfectly still
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + i * 0.018;
    const lg = ctx.createGain(); lg.gain.value = 1.4; lfo.connect(lg); lg.connect(o.frequency); lfo.start();
    voices.push(o);
  }

  // very slow filter shimmer
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.035;
  const lfoG = ctx.createGain(); lfoG.gain.value = 150; lfo.connect(lfoG); lfoG.connect(filter.frequency); lfo.start();

  pad = { filter, gain, voices, chordIdx: 0, nextChord: ctx.currentTime + 12 };
  padBaseGain = gain.gain.value;

  // background-music bus (volume); tracks created on demand when enabled
  musicGain = ctx.createGain(); musicGain.gain.value = 0; musicGain.connect(master);

  // biome ambient layers (start silent; update fades them in by terrain mix)
  const stream = loopNoise(820, 1.1);
  const wind = loopNoise(300, 0.6);
  const shOsc = ctx.createOscillator(); shOsc.type = 'sine'; shOsc.frequency.value = 1180;
  const shGain = ctx.createGain(); shGain.gain.value = 0;
  const shLfo = ctx.createOscillator(); shLfo.frequency.value = 0.6;
  const shLfoG = ctx.createGain(); shLfoG.gain.value = 32;
  shLfo.connect(shLfoG); shLfoG.connect(shOsc.frequency);
  shOsc.connect(shGain); shGain.connect(master); shGain.connect(reverbIn); shOsc.start(); shLfo.start();
  const murmur = loopNoise(220, 1.4);    // soft low burble of a town going about its day
  layers = { stream, wind, shimmer: shGain, murmur };
}

function loopNoise(freq, q) {
  const n = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(bp); bp.connect(g); g.connect(master); g.connect(reverbIn); src.start();
  return g;
}

// One enveloped note — soft attack, gentle release, sent to the reverb bus.
function note(freq, dur, type = 'sine', v = 0.18, when = 0, glideTo = null, attack = 0.03) {
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const o = ctx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(v, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master); g.connect(reverbIn);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

function noise(dur, v = 0.12, when = 0, freq = 1800, q = 8, wet = 0.4) {
  if (!ctx) return;
  const t0 = ctx.currentTime + when;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(v, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp); bp.connect(g); g.connect(master);
  if (reverbIn && wet) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w); w.connect(reverbIn); }
  src.start(t0); src.stop(t0 + dur);
}

// ---- background music playlist (crossfading) ----
function decodeTrack(i) {
  if (musicBuffers[i]) return Promise.resolve(musicBuffers[i]);
  return fetch(MUSIC_TRACKS[i]).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)).then(buf => { musicBuffers[i] = buf; return buf; });
}
// Play track i with a fade-in, schedule its fade-out, and queue the next track
// to start as this one fades — so consecutive tracks cross-fade.
function playTrack(i) {
  if (!ctx || !musicWanted) { chainRunning = false; return; }
  decodeTrack(i).then(buf => {
    if (!musicWanted) { chainRunning = false; return; }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const fg = ctx.createGain(); src.connect(fg); fg.connect(musicGain);
    const now = ctx.currentTime, dur = buf.duration;
    const inT = Math.min(MUSIC_XFADE, dur * 0.3);
    fg.gain.setValueAtTime(0.0001, now);
    fg.gain.linearRampToValueAtTime(1, now + inT);
    const fadeStart = now + Math.max(inT, dur - MUSIC_XFADE);
    fg.gain.setValueAtTime(1, fadeStart);
    fg.gain.linearRampToValueAtTime(0.0001, fadeStart + MUSIC_XFADE);
    src.start(now); src.stop(now + dur + 0.3);
    currentSrc = src; musicIdx = i;
    clearTimeout(musicTimer);
    musicTimer = setTimeout(() => playTrack((i + 1) % MUSIC_TRACKS.length), Math.max(500, (fadeStart - now) * 1000));
  }).catch(() => { chainRunning = false; });
}
function duckPad(on) {
  if (pad) pad.gain.gain.setTargetAtTime(on ? padBaseGain * 0.5 : padBaseGain, ctx.currentTime, 1.0);
}
export function setMusicEnabled(on) {
  musicWanted = on;
  if (!ctx || !musicGain) return;
  if (on) {
    musicGain.gain.setTargetAtTime(musicVol, ctx.currentTime, 0.8);
    duckPad(true);
    if (!chainRunning) {
      chainRunning = true;
      if (!startedOnce) { startedOnce = true; musicIdx = Math.floor(Math.random() * MUSIC_TRACKS.length); }
      playTrack(musicIdx);
    }
  } else {
    musicGain.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
    duckPad(false);
    chainRunning = false; clearTimeout(musicTimer);
    if (currentSrc) { const s = currentSrc; currentSrc = null; try { s.stop(ctx.currentTime + 1.0); } catch (e) { /* ignore */ } }
  }
}
export function setMusicVolume(v) {
  musicVol = Math.max(0, Math.min(1, v));
  if (musicGain && musicWanted) musicGain.gain.setTargetAtTime(musicVol, ctx.currentTime, 0.1);
}

// ---- music player API (track browsing + selection) ----
function prettyTrack(path) {
  let n = path.replace(/^music\//, '').replace(/\.(mp3|ogg|wav)$/i, '').replace(/^oga_/, '').replace(/_/g, ' ').trim();
  return n.charAt(0).toUpperCase() + n.slice(1);
}
export function musicTracks() { return MUSIC_TRACKS.map(prettyTrack); }
export function musicState() { return { idx: musicIdx, count: MUSIC_TRACKS.length, playing: chainRunning && musicWanted }; }
// Jump straight to a specific track (turns music on, crossfades from the old one).
export function playMusicTrack(i) {
  if (!ctx || !musicGain || !MUSIC_TRACKS.length) return;
  const n = MUSIC_TRACKS.length;
  musicWanted = true; startedOnce = true;
  musicGain.gain.setTargetAtTime(musicVol, ctx.currentTime, 0.3);
  duckPad(true);
  clearTimeout(musicTimer);
  if (currentSrc) { try { currentSrc.stop(ctx.currentTime + 0.4); } catch (e) { /* ignore */ } currentSrc = null; }
  chainRunning = true;
  playTrack(((i % n) + n) % n);
}
export function musicNext() { playMusicTrack(musicIdx + 1); }
export function musicPrev() { playMusicTrack(musicIdx - 1); }
export function musicToggle() { setMusicEnabled(!musicWanted); return musicWanted; }

// ---- per-frame ambient driver (day/night + chord drift) ----
export function update(t) {
  if (!ctx || muted) return;
  const phase = (t / 96000) % 1;
  const dayLight = 0.5 + 0.5 * Math.cos(phase * 2 * Math.PI);
  const night = 1 - dayLight;
  const now = ctx.currentTime;

  if (pad) {
    pad.filter.frequency.setTargetAtTime(440 + dayLight * 380, now, 2.5);
    if (now >= pad.nextChord) {
      pad.chordIdx = (pad.chordIdx + 1) % CHORDS.length;
      const ch = CHORDS[pad.chordIdx];
      pad.voices.forEach((o, i) => o.frequency.setTargetAtTime(ch[i], now, 3.5)); // slow glide
      pad.nextChord = now + 15;
    }
  }
  if (layers) {
    layers.stream.gain.setTargetAtTime(Math.min(0.06, (biomes.water || 0) * 0.12), now, 2.5);
    layers.wind.gain.setTargetAtTime(Math.min(0.045, (biomes.mountain || 0) * 0.12), now, 2.5);
    layers.shimmer.gain.setTargetAtTime(Math.min(0.025, (biomes.fae || 0) * 0.09), now, 2.5);
    // town murmur — louder by day, quiets at night as the village turns in
    layers.murmur.gain.setTargetAtTime(Math.min(0.04, (biomes.village || 0) * 0.16 * (0.35 + 0.65 * dayLight)), now, 2.5);
  }

  // gentle critters: soft birds by day (denser over forest), crickets at night
  const birdChance = 0.3 + 0.45 * (biomes.forest || 0);
  if (now >= nextChirp) {
    if (night > 0.5) {
      noise(0.04, 0.03, 0, 4200, 24);                 // crickets
      noise(0.04, 0.025, 0.08, 4200, 24);
      // an occasional distant owl over the woods
      if (night > 0.6 && Math.random() < 0.1 + 0.2 * (biomes.forest || 0)) {
        note(330, 0.5, 'sine', 0.045, 0, 300, 0.09);
        note(300, 0.42, 'sine', 0.03, 0.55, 280, 0.09);
      }
      nextChirp = now + 0.7 + Math.random() * 1.1;
    } else if (dayLight > 0.4 && Math.random() < birdChance) {
      const f = 2000 + Math.random() * 1200;
      note(f, 0.1, 'sine', 0.035, 0, f * 1.25, 0.01);
      if (Math.random() < 0.5) note(f * 1.18, 0.09, 'sine', 0.028, 0.12, f * 1.35, 0.01);
      nextChirp = now + 2.0 + Math.random() * 2.8;
    } else {
      nextChirp = now + 1.4;
    }
  }
}

// ---- one-shot events (all soft sines through the reverb) ----
// A soft woody "settle" so a placed tile feels like it lands.
function thud() {
  note(165, 0.12, 'sine', 0.1, 0, 80, 0.002);   // low body with a quick pitch drop
  noise(0.05, 0.045, 0, 360, 1.3, 0.1);          // muffled tap
}
export function placement(combo, perfect) {
  if (!ctx || muted) return;
  thud();
  const step = PENT[Math.min(combo, PENT.length * 2 - 1) % PENT.length] +
    12 * Math.floor(Math.min(combo, 9) / PENT.length);
  const f = A3 * semis(step);
  note(f, 0.5, 'sine', 0.11, 0, null, 0.02);
  note(f * 2, 0.4, 'sine', 0.03, 0.01, null, 0.02);   // soft octave shimmer
  if (perfect) {
    note(f * semis(4), 0.7, 'sine', 0.07, 0.06); note(f * semis(7), 0.8, 'sine', 0.055, 0.12);
    for (let i = 0; i < 3; i++) note(f * semis(12 + i * 4), 0.3, 'sine', 0.04, 0.05 + i * 0.05, null, 0.004); // sparkle
  }
}

// Soft tick + tiny whoosh when rotating a tile.
export function rotate() {
  if (!ctx || muted) return;
  noise(0.035, 0.04, 0, 2600, 5, 0.2);
  note(720, 0.06, 'sine', 0.03, 0, 1080, 0.002);
}

// Gentle UI click for menu/title buttons.
export function click() {
  if (!ctx || muted) return;
  note(540, 0.05, 'sine', 0.05, 0, 700, 0.002);
  noise(0.02, 0.025, 0, 3000, 5, 0.12);
}

// Watery "bloop" when a coast meets a river (estuary).
export function estuary() {
  if (!ctx || muted) return;
  note(640, 0.2, 'sine', 0.09, 0, 300, 0.004);
  note(960, 0.12, 'sine', 0.035, 0.03, 480, 0.004);
}

// A soft warm swell as a region blooms (decree completes).
export function bloom() {
  if (!ctx || muted) return;
  [0, 4, 7].forEach((s, i) => note((A3 / 2) * semis(s), 1.7, 'sine', 0.05, i * 0.04, null, 0.4));
}

export function decree() {
  if (!ctx || muted) return;
  [0, 4, 7, 12].forEach((s, i) => note(A3 * semis(s), 0.8, 'sine', 0.1, i * 0.13));
  bell(0.12);
}

export function bell(v = 0.18) {
  if (!ctx || muted) return;
  const f = 660;
  note(f, 1.6, 'sine', v, 0, null, 0.005);
  note(f * 1.5, 1.3, 'sine', v * 0.5, 0, null, 0.005);
  note(f * 2.0, 1.0, 'sine', v * 0.28, 0, null, 0.005);
}

export function skip() {
  if (!ctx || muted) return;
  note(330, 0.25, 'sine', 0.08, 0, 262);
}

export function festival() {
  if (!ctx || muted) return;
  [0, 4, 7, 12, 16, 19].forEach((s, i) => note(A3 * semis(s), 0.7, 'sine', 0.1, i * 0.1));
  bell(0.18);
  for (let i = 0; i < 6; i++) note(A3 * semis(12 + i * 2), 0.3, 'sine', 0.045, 0.6 + i * 0.14);
}

export function gameover() {
  if (!ctx || muted) return;
  const root = 196; // G3
  [0, 3, 7, 12].forEach((s, i) => note(root * semis(s), 2.2, 'sine', 0.11, i * 0.2, null, 0.06));
}

// Wildfire catches: a dry whoosh with crackling pops.
export function fireStart() {
  if (!ctx || muted) return;
  noise(0.55, 0.06, 0, 1200, 1.2, 0.3);                       // rushing air
  note(150, 0.7, 'sine', 0.07, 0, 220, 0.05);                 // rising heat
  for (let i = 0; i < 5; i++) noise(0.03, 0.05, 0.08 + i * 0.09 + Math.random() * 0.04, 2400 + Math.random() * 1600, 6, 0.1);   // crackle pops
}

// Floodwater rises: a dark watery swell.
export function flood() {
  if (!ctx || muted) return;
  noise(0.9, 0.05, 0, 420, 0.9, 0.55);                        // surging water
  note(220, 0.6, 'sine', 0.07, 0.05, 130, 0.05);              // sinking bloop
  note(330, 0.3, 'sine', 0.035, 0.2, 240, 0.02);
}

// The flood recedes: a softer draining wash.
export function recede() {
  if (!ctx || muted) return;
  noise(0.7, 0.03, 0, 900, 1.2, 0.45);
  note(180, 0.5, 'sine', 0.05, 0.05, 320, 0.06);              // draining away (rising)
}

// Brambles pruned: two crisp garden snips.
export function prune() {
  if (!ctx || muted) return;
  for (let i = 0; i < 2; i++) {
    noise(0.025, 0.06, i * 0.12, 3400, 7, 0.08);
    note(880 + i * 160, 0.06, 'sine', 0.04, i * 0.12, 660, 0.002);
  }
}

// An ominous low groan when corruption stirs / spreads.
export function blight() {
  if (!ctx || muted) return;
  note(110, 1.1, 'sine', 0.11, 0, 70, 0.06);
  note(110 * semis(1), 0.9, 'sine', 0.05, 0.02, 74, 0.06);   // dissonant minor 2nd
  noise(0.7, 0.045, 0, 200, 0.8, 0.5);                        // dark rumble
}

// A bright purify shimmer when corruption is cleansed.
export function cleanse() {
  if (!ctx || muted) return;
  for (let i = 0; i < 4; i++) note(A3 * semis(7 + i * 3), 0.5, 'sine', 0.07, i * 0.05, null, 0.005);
  note(A3 * semis(19), 0.7, 'sine', 0.04, 0.12);
}
