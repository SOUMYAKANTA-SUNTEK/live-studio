// Upgrades saved setups from older versions to the current shape.
// Used by the server (on load) and the control panel (when loading a file).

function migrateState(s, defaults) {
  // v0.2: one `lineup` → `lineups` for both teams
  if (!s.lineups) {
    const old = s.lineup || {};
    s.lineups = structuredClone(defaults.lineups);
    if (old.players) {
      s.lineups.home.players = old.players;
      s.lineups.home.logo = old.logo || '';
      s.lineups.home.title = old.title || '';
    }
    delete s.lineup;
  }
  for (const team of ['home', 'away']) {
    s.lineups[team] = { ...defaults.lineups[team], ...s.lineups[team] };
  }
  s.lineupView = { ...defaults.lineupView, ...s.lineupView };
  // v0.5: the pop-up banner covers goals and cards too, not just subs
  if (!('banner' in s.match)) s.match.banner = s.match.lastSub ? { kind: 'sub', ...s.match.lastSub } : null;
  delete s.match.lastSub;
  if (!s.match.events) s.match.events = [];
  for (const key of Object.keys(defaults.elements)) {
    const def = defaults.elements[key];
    const cur = s.elements[key] || {};
    s.elements[key] = { ...def, ...cur };
    if (def.style) s.elements[key].style = { ...def.style, ...cur.style };
  }
  s.extras = s.extras || [];
  // v0.6: broadcast look
  if (!s.match.preMatch) s.match.preMatch = structuredClone(defaults.match.preMatch);
  if (!('competition' in s.match)) s.match.competition = '';
  const bc = s.broadcast || {};
  s.broadcast = { ...defaults.broadcast, ...bc };
  for (const k of ['ticker', 'info', 'badge', 'panel']) s.broadcast[k] = { ...defaults.broadcast[k], ...bc[k] };
  return s;
}

if (typeof module !== 'undefined') module.exports = migrateState;
