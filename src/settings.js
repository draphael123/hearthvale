// Persistent player settings (localStorage). Mutate `settings` then call save(),
// or use set() which does both.
const KEY = 'hearthvale.settings.v1';
const defaults = {
  volume: 0.5,
  music: true,        // background music loop
  musicVolume: 0.55,
  dayNight: true,     // day -> night cycle (off = always daytime)
  weather: true,      // rain / rainbow / god rays
  labels: true,       // hand-lettered place names
  symbols: false,     // colorblind aid — a glyph per terrain edge
  corruption: true,   // late-game blight that creeps in past ~30 tiles
  reducedMotion: false, // trims ambient particle layers
};

function load() {
  try { const r = localStorage.getItem(KEY); if (r) return { ...defaults, ...JSON.parse(r) }; } catch (e) { /* ignore */ }
  return { ...defaults };
}

export const settings = load();

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ }
}

export function set(key, val) {
  settings[key] = val;
  save();
}
