// One-time onboarding hints. fire(id) returns true the first time ever for that
// id (and remembers it), false thereafter — so each hint shows once per player.
const KEY = 'hearthvale.hints.v1';
let seen = {};
try { seen = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { /* ignore */ }

export function fire(id) {
  if (seen[id]) return false;
  seen[id] = true;
  try { localStorage.setItem(KEY, JSON.stringify(seen)); } catch (e) { /* ignore */ }
  return true;
}
