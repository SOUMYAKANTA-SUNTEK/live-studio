// Control panel: edits the shared state and pushes it to the server,
// which forwards it to the OBS overlay.

const stage = document.getElementById('stage');
const canvasBox = document.getElementById('canvasBox');
const wrap = document.getElementById('previewWrap');
const statusEl = document.getElementById('status');

let state = null;
let serverOffset = 0;
let selected = null; // 'scorebar' | 'lineup' | 'camera' | 'extra:<id>'
let pushTimer = null;
let pushing = false;
let scale = 1;

document.getElementById('overlayUrl').textContent = `${location.origin}/overlay`;

// ---------- State helpers ----------

// Lists such as `lineups.home.playersText` are edited as one name per line.
const LIST_TEXT = /^(.*)Text$/;

function getPath(obj, path) {
  const list = path.match(LIST_TEXT);
  if (list) return (getPath(obj, list[1]) || []).join('\n');
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function setPath(obj, path, value) {
  const list = path.match(LIST_TEXT);
  if (list) {
    setPath(obj, list[1], String(value).split('\n'));
    return;
  }
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

// Push the state to the server. Text edits are debounced, buttons go straight away.
function commit({ immediate = false, rerender = true } = {}) {
  if (rerender) render();
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, immediate ? 0 : 150);
}

async function push() {
  pushTimer = null;
  pushing = true;
  try {
    await fetch('/api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
  } catch {
    setStatus(false);
  } finally {
    pushing = false;
  }
}

function setStatus(ok) {
  statusEl.textContent = ok ? 'Live' : 'Disconnected';
  statusEl.className = 'status ' + (ok ? 'ok' : 'bad');
}

// ---------- Rendering ----------

function render() {
  renderOverlay(stage, state, { editing: true, serverOffset });
  updateClocks(stage, state, serverOffset);
  markSelected();
  syncInputs();
  renderElementList();
  renderSelectedEditor();
  renderLineupEditor();
  renderEventEditor();
  if (window.afterLayout) window.afterLayout();
}

function fitPreview() {
  const pad = 8;
  scale = Math.min((wrap.clientWidth - pad * 2) / CANVAS_W, (wrap.clientHeight - pad * 2) / CANVAS_H);
  const left = (wrap.clientWidth - CANVAS_W * scale) / 2;
  const top = (wrap.clientHeight - CANVAS_H * scale) / 2;
  canvasBox.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
}
window.addEventListener('resize', fitPreview);

function syncInputs() {
  for (const input of document.querySelectorAll('[data-bind]')) {
    if (input === document.activeElement) continue;
    const value = getPath(state, input.dataset.bind);
    if (input.type === 'checkbox') input.checked = !!value;
    else input.value = value ?? '';
  }
  for (const node of document.querySelectorAll('[data-text]')) {
    node.textContent = getPath(state, node.dataset.text);
  }
  document.getElementById('clockToggle').textContent = state.match.clock.running ? 'Pause' : 'Start';
}

const BASE_ELEMENTS = [
  ['camera', 'Webcam'],
  ['lineup', 'Lineup panel'],
  ['scorebar', 'Scorebar'],
  ['subBanner', 'Pop-up banner'],
  ['channelBadge', 'Channel badge'],
  ['dateCard', 'Date and time'],
  ['ticker', 'Ticker'],
  ['infoBox', 'Info box'],
];

function elementByKey(key) {
  if (!key) return null;
  if (key.startsWith('extra:')) return state.extras.find((e) => e.id === key.slice(6)) || null;
  return state.elements[key] || null;
}

function bindPathFor(key) {
  if (key.startsWith('extra:')) return `extras.${state.extras.findIndex((e) => e.id === key.slice(6))}`;
  return `elements.${key}`;
}

function renderElementList() {
  const list = document.getElementById('elementList');
  const items = [
    ...BASE_ELEMENTS.map(([key, name]) => ({ key, name, el: state.elements[key] })),
    ...state.extras.map((ex) => ({
      key: `extra:${ex.id}`,
      name: ex.type === 'image' ? 'Image' : `Text: ${ex.text || '(empty)'}`,
      el: ex,
    })),
  ];
  list.innerHTML = items.map(({ key, name, el }) => `
    <div class="el-item ${key === selected ? 'selected' : ''}" data-select="${esc(key)}">
      <input type="checkbox" data-bind="${bindPathFor(key)}.visible" ${el.visible !== false ? 'checked' : ''} title="Show or hide">
      <span class="el-name">${esc(name)}</span>
    </div>`).join('');
}

function renderSelectedEditor() {
  const box = document.getElementById('selectedEditor');
  const el = elementByKey(selected);
  if (!el) {
    box.innerHTML = '';
    return;
  }
  // Skip rebuilding while the user is typing inside it, so focus is kept.
  if (box.contains(document.activeElement) && box.dataset.key === selected) {
    syncInputs();
    return;
  }
  box.dataset.key = selected;
  const p = bindPathFor(selected);
  let html = `
    <div class="sel-box">
      <div class="grid4">
        <label>X <input type="number" data-bind="${p}.x"></label>
        <label>Y <input type="number" data-bind="${p}.y"></label>
        <label>Width <input type="number" data-bind="${p}.w"></label>
        <label>Height <input type="number" data-bind="${p}.h"></label>
      </div>`;
  if (el.type === 'text') {
    html += `
      <label>Text <textarea rows="2" data-bind="${p}.text"></textarea></label>
      <label>Font <select class="font-select" data-bind="${p}.style.font"></select></label>
      <div class="grid3">
        <label>Size <input type="number" data-bind="${p}.style.fontSize"></label>
        <label>Colour <input type="color" data-bind="${p}.style.color"></label>
        <label>Align <select data-bind="${p}.style.align"><option>left</option><option>center</option><option>right</option></select></label>
      </div>
      <label>Background (CSS) <input data-bind="${p}.style.background"></label>
      <div class="grid2">
        <label>Corner radius <input type="number" min="0" data-bind="${p}.style.radius"></label>
        <label class="check" style="margin-top:28px"><input type="checkbox" data-bind="${p}.style.bold"> Bold</label>
      </div>`;
  }
  if (el.type === 'image') {
    html += `
      <label>Image <input type="file" accept="image/*" data-image="${p}.src" data-max="1920"></label>
      <div class="grid2">
        <label>Fit <select data-bind="${p}.style.fit"><option value="contain">Contain</option><option value="cover">Cover</option><option value="fill">Stretch</option></select></label>
        <label>Corner radius <input type="number" min="0" data-bind="${p}.style.radius"></label>
      </div>`;
  }
  if (selected.startsWith('extra:')) {
    html += `<div class="btn-row"><button data-act="dup-extra">Duplicate</button><button class="danger" data-act="del-extra">Delete</button></div>`;
  }
  html += '</div>';
  box.innerHTML = html;
  fillFontSelects(box);
  syncInputs();
}

// ---------- Goals and cards editor ----------

// Undoing the entry that is on the pop-up takes the pop-up down too
function clearBannerFor(at) {
  if (at && state.match.banner && state.match.banner.at === at) state.match.banner = null;
}

const isGoal = (type) => ['goal', 'owngoal', 'penalty'].includes(type);
let eventDraft = { team: 'home', type: 'goal' }; // remembered between entries

function renderEventEditor() {
  const box = document.getElementById('eventEditor');
  if (box.contains(document.activeElement)) return; // don't disturb typing
  const draft = eventDraft;
  // Suggest names from the team's current XI (the other team's for an own goal)
  const nameTeam = draft.type === 'owngoal' ? (draft.team === 'home' ? 'away' : 'home') : draft.team;
  const names = currentXI(state.lineups[nameTeam]).map((r) => r.name);
  const minuteNow = Math.floor(clockSeconds(state.match.clock, serverOffset) / 60) + 1;
  const m = state.match;
  box.innerHTML = `
    <div class="event-form">
      <label>Team
        <select class="ev-team">
          <option value="home">${esc(m.home.name)}</option>
          <option value="away">${esc(m.away.name)}</option>
        </select>
      </label>
      <label>What happened
        <select class="ev-type">${Object.entries(EVENT_TYPES).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('')}</select>
      </label>
      <label>Player <input class="ev-player" list="evPlayers" placeholder="Name">
        <datalist id="evPlayers">${names.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      </label>
      <label>Minute <input class="ev-minute" placeholder="${minuteNow}"></label>
    </div>
    <p class="hint" style="margin-top:4px">For an own goal, pick the team that gets the goal and type the player who scored it.</p>
    <button class="primary wide" data-act="add-event">Add</button>
    ${m.events.map((ev, i) => `
      <div class="sub-item">
        <span class="min">${esc(ev.minute)}'</span>
        ${EVENT_TYPES[ev.type] ? EVENT_TYPES[ev.type].icon : ''}
        <span class="off" style="color:var(--text)">${esc(ev.player)}${EVENT_TYPES[ev.type]?.suffix || ''} · ${esc(m[ev.team].short)}</span>
        <button class="link" data-act="undo-event" data-index="${i}">Undo</button>
      </div>`).join('')}
    ${m.events.length ? '<div class="btn-row"><button class="danger" data-act="clear-events">Clear all goals and cards (new match)</button></div>' : ''}`;
  box.querySelector('.ev-team').value = draft.team;
  box.querySelector('.ev-type').value = draft.type;
}

// Changing team or type refreshes the name suggestions
document.addEventListener('change', (e) => {
  if (!e.target.matches('.ev-team, .ev-type')) return;
  const box = document.getElementById('eventEditor');
  eventDraft = { team: box.querySelector('.ev-team').value, type: box.querySelector('.ev-type').value };
  const player = box.querySelector('.ev-player').value;
  e.target.blur();
  renderEventEditor();
  box.querySelector('.ev-player').value = player;
});

// ---------- Lineup editor (one team at a time) ----------

let lineupTeam = 'home';

function renderLineupEditor() {
  const box = document.getElementById('lineupEditor');
  for (const b of document.querySelectorAll('[data-lineup-team]')) {
    b.textContent = state.match[b.dataset.lineupTeam].name;
    b.classList.toggle('active', b.dataset.lineupTeam === lineupTeam);
  }
  // Keep focus and half-typed text while the user is working inside it
  if (box.contains(document.activeElement) && box.dataset.team === lineupTeam) {
    syncInputs();
    return;
  }
  box.dataset.team = lineupTeam;
  const p = `lineups.${lineupTeam}`;
  const lu = state.lineups[lineupTeam];
  const club = state.match[lineupTeam];
  const onPitch = currentXI(lu).map((r) => r.name);
  const used = new Set([...onPitch, ...lu.subs.map((s) => s.off)]);
  const bench = (lu.bench || []).map((b) => b.trim()).filter((b) => b && !used.has(b));
  const minuteNow = Math.floor(clockSeconds(state.match.clock, serverOffset) / 60) + 1;
  box.innerHTML = `
    <label>Title <input data-bind="${p}.title" placeholder="${esc(club.name)} XI"></label>
    <label>Crest <span class="file-row"><input type="file" accept="image/*" data-image="${p}.logo" data-max="512"><button class="link" data-clear="${p}.logo">Remove</button></span></label>
    <p class="hint">Leave the title or crest empty to use the team's name and logo from the Match tab.</p>
    <label>Formation (pitch style) <select data-bind="${p}.formation"><option>4-2-3-1</option><option>4-3-3</option><option>4-4-2</option><option>4-1-4-1</option><option>4-3-2-1</option><option>4-4-1-1</option><option>4-1-2-1-2</option><option>3-5-2</option><option>3-4-3</option><option>3-4-2-1</option><option>5-3-2</option><option>5-4-1</option></select></label>
    <p class="hint">Start each line with the shirt number, e.g. <b>19 B. Mbeumo</b>. For the pitch style, list the goalkeeper first, then defenders, midfielders and forwards, each from left to right.</p>
    <div class="grid2">
      <label>Starting XI (one per line) <textarea rows="12" data-bind="${p}.playersText" placeholder="1 Goalkeeper&#10;2 Right back&#10;…"></textarea></label>
      <label>Bench (one per line) <textarea rows="12" data-bind="${p}.benchText" placeholder="Optional"></textarea></label>
    </div>

    <h3>Substitutions</h3>
    <div class="sub-form">
      <label>Going off ▼
        <select class="sub-off-select">${onPitch.map((n) => `<option>${esc(n)}</option>`).join('')}</select>
      </label>
      <label>Coming on ▲
        <input class="sub-on-input" list="benchList" placeholder="Name">
        <datalist id="benchList">${bench.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      </label>
      <label>Min <input class="sub-minute" placeholder="${minuteNow}"></label>
    </div>
    <button class="primary wide" data-act="make-sub">Make substitution</button>
    ${lu.subs.map((s, i) => `
      <div class="sub-item">
        <span class="min">${esc(s.minute)}'</span>
        <span class="on">▲ ${esc(s.on)}</span>
        <span class="off">▼ ${esc(s.off)}</span>
        <button class="link" data-act="undo-sub" data-index="${i}">Undo</button>
      </div>`).join('')}
    ${state.lineups.home.subs.length || state.lineups.away.subs.length
      ? '<div class="btn-row"><button class="danger" data-act="clear-subs">Clear all substitutions (new match)</button></div>' : ''}`;
  syncInputs();
}

function fillFontSelects(root = document) {
  for (const sel of root.querySelectorAll('.font-select')) {
    if (sel.options.length) continue;
    sel.innerHTML = Object.keys(FONTS).map((f) => `<option>${esc(f)}</option>`).join('');
  }
}

function markSelected() {
  stage.querySelectorAll('.handle').forEach((h) => h.remove());
  for (const node of stage.querySelectorAll('.el')) {
    const on = node.dataset.key === selected;
    node.classList.toggle('selected', on);
    if (on) {
      const handle = document.createElement('div');
      handle.className = 'handle';
      node.appendChild(handle);
    }
  }
}

function select(key) {
  selected = key;
  render();
}

// ---------- Inputs ----------

document.addEventListener('input', (e) => {
  const input = e.target.closest('[data-bind]');
  if (!input || !state) return;
  let value;
  if (input.type === 'checkbox') value = input.checked;
  else if (input.type === 'number' || input.type === 'range') {
    value = input.value === '' ? 0 : Number(input.value);
  } else value = input.value;
  setPath(state, input.dataset.bind, value);
  commit();
});

document.addEventListener('change', async (e) => {
  const input = e.target.closest('[data-image]');
  if (!input || !input.files[0]) return;
  const dataUrl = await loadImage(input.files[0], Number(input.dataset.max) || 1024, !!input.dataset.jpeg);
  setPath(state, input.dataset.image, dataUrl);
  input.value = '';
  commit({ immediate: true });
});

// Resize uploaded images so the saved state stays small.
function loadImage(file, max, jpeg) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      if (file.type === 'image/svg+xml' || file.type === 'image/gif') return resolve(reader.result);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * k);
        canvas.height = Math.round(img.height * k);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.88));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// ---------- Buttons ----------

function nowServer() {
  return Date.now() + serverOffset;
}

function clockPause(clock) {
  clock.baseSeconds = clockSeconds(clock, serverOffset);
  clock.running = false;
  clock.startedAt = null;
}

function clockSetTo(secs) {
  const clock = state.match.clock;
  clock.baseSeconds = secs;
  clock.startedAt = clock.running ? nowServer() : null;
}

function newId() {
  return Math.random().toString(36).slice(2, 9);
}

const ACTIONS = {
  'home+': () => state.match.homeScore++,
  'home-': () => (state.match.homeScore = Math.max(0, state.match.homeScore - 1)),
  'away+': () => state.match.awayScore++,
  'away-': () => (state.match.awayScore = Math.max(0, state.match.awayScore - 1)),
  'clock-toggle': () => {
    const clock = state.match.clock;
    if (clock.running) clockPause(clock);
    else {
      clock.running = true;
      clock.startedAt = nowServer();
    }
  },
  'match-reset': () => {
    if (!confirm('Start a new match? This clears the score, clock, period, goals, cards, substitutions and pop-ups. Teams, lineups and design stay.')) return false;
    const m = state.match;
    m.homeScore = 0;
    m.awayScore = 0;
    m.period = '';
    m.events = [];
    m.banner = null;
    Object.assign(m.clock, { running: false, startedAt: null, baseSeconds: 0, addedTime: 0 });
    state.lineups.home.subs = [];
    state.lineups.away.subs = [];
  },
  'clock-reset': () => {
    const clock = state.match.clock;
    clock.running = false;
    clock.startedAt = null;
    clock.baseSeconds = 0;
    clock.addedTime = 0;
  },
  'clock-set': () => {
    const current = formatClock(clockSeconds(state.match.clock, serverOffset));
    const answer = prompt('Set the clock (minutes:seconds)', current);
    if (answer == null) return false;
    const [m, s = '0'] = answer.split(':');
    const secs = Number(m) * 60 + Number(s);
    if (Number.isNaN(secs)) return false;
    clockSetTo(secs);
  },
  'clock-at': (btn) => {
    clockSetTo(Number(btn.dataset.secs));
    state.match.clock.addedTime = 0;
    if (clockHidden(state.match)) state.match.period = '';
  },
  'period-break': (btn) => {
    // Half time / full time: stop the clock and show the label instead
    if (state.match.clock.running) clockPause(state.match.clock);
    state.match.period = btn.dataset.period;
    state.match.clock.addedTime = 0;
    if (btn.dataset.secs) clockSetTo(Number(btn.dataset.secs));
  },
  swap: () => {
    const m = state.match;
    [m.home, m.away] = [m.away, m.home];
    [m.homeScore, m.awayScore] = [m.awayScore, m.homeScore];
    const l = state.lineups;
    [l.home, l.away] = [l.away, l.home];
    if (m.banner) m.banner.team = m.banner.team === 'home' ? 'away' : 'home';
    for (const ev of m.events) ev.team = ev.team === 'home' ? 'away' : 'home';
  },
  'make-sub': () => {
    const box = document.getElementById('lineupEditor');
    const off = box.querySelector('.sub-off-select').value;
    const on = box.querySelector('.sub-on-input').value.trim();
    const minuteInput = box.querySelector('.sub-minute');
    const minute = minuteInput.value.trim() || minuteInput.placeholder;
    if (!off || !on) {
      alert('Pick the player going off and type the player coming on.');
      return false;
    }
    const at = nowServer();
    state.lineups[lineupTeam].subs.push({ off, on, minute, at });
    state.match.banner = { kind: 'sub', team: lineupTeam, off, on, minute, at };
  },
  'undo-sub': (btn) => {
    const subs = state.lineups[lineupTeam].subs;
    const [removed] = subs.splice(Number(btn.dataset.index), 1);
    if (removed) clearBannerFor(removed.at);
  },
  'add-event': () => {
    const box = document.getElementById('eventEditor');
    const team = box.querySelector('.ev-team').value;
    const type = box.querySelector('.ev-type').value;
    const player = box.querySelector('.ev-player').value.trim();
    const minuteInput = box.querySelector('.ev-minute');
    const minute = minuteInput.value.trim() || minuteInput.placeholder;
    if (!player) {
      alert('Type the player\'s name.');
      return false;
    }
    const at = nowServer();
    state.match.events.push({ team, type, player, minute, at });
    if (isGoal(type)) state.match[`${team}Score`]++;
    state.match.banner = { kind: type, team, player, minute, at };
    eventDraft = { team, type };
  },
  'undo-event': (btn) => {
    const [ev] = state.match.events.splice(Number(btn.dataset.index), 1);
    if (ev) clearBannerFor(ev.at);
    if (ev && isGoal(ev.type)) {
      const key = `${ev.team}Score`;
      state.match[key] = Math.max(0, state.match[key] - 1);
    }
  },
  'clear-events': () => {
    if (!confirm('Remove all goals and cards? (The score is not changed.)')) return false;
    state.match.events = [];
    if (state.match.banner && state.match.banner.kind !== 'sub') state.match.banner = null;
  },
  'layout-broadcast': () => {
    const e = state.elements;
    const place = (key, x, y, w, h) => Object.assign(e[key], { x, y, w, h, visible: true });
    place('camera', 0, 0, 1920, 1080);
    place('channelBadge', 30, 40, 380, 125);
    place('lineup', 1380, 45, 500, 750);
    place('dateCard', 50, 848, 150, 195);
    place('scorebar', 215, 848, 1145, 120);
    place('ticker', 215, 980, 1145, 62);
    place('infoBox', 1378, 848, 492, 195);
    Object.assign(e.subBanner, { x: 560, y: 680, w: 720, h: 140 });
    e.frame.visible = true;
    e.lineup.style.variant = 'pitch';
    e.scorebar.style.variant = 'broadcast';
    e.subBanner.style.background = `linear-gradient(90deg, #111827, #1f2937)`;
    state.broadcast.skin = 'stand';
    if (state.broadcast.accent === '#f5b700') state.broadcast.accent = '#e30613';
  },
  'layout-studio': () => {
    const e = state.elements;
    const place = (key, x, y, w, h) => Object.assign(e[key], { x, y, w, h, visible: true });
    place('camera', 0, 0, 1920, 1080);
    place('scorebar', 440, 28, 1040, 100);
    place('channelBadge', 40, 32, 330, 96);
    place('dateCard', 1550, 32, 330, 96);
    place('lineup', 40, 160, 440, 760);
    place('infoBox', 1400, 880, 480, 104);
    place('ticker', 0, 1012, 1920, 68);
    Object.assign(e.subBanner, { x: 600, y: 840, w: 720, h: 130 });
    e.frame.visible = true;
    e.lineup.style.variant = 'pitch';
    e.scorebar.style.variant = 'broadcast';
    e.subBanner.style.background = 'linear-gradient(90deg, #0b1322, #16233d)';
    state.broadcast.skin = 'studio';
    if (state.broadcast.accent === '#e30613') state.broadcast.accent = '#f5b700';
  },
  'layout-classic': async () => {
    const defaults = await (await fetch('/api/defaults')).json();
    for (const key of Object.keys(defaults.elements)) {
      const { x, y, w, h, visible } = defaults.elements[key];
      for (const [k, v] of Object.entries({ x, y, w, h, visible })) if (v !== undefined) state.elements[key][k] = v;
    }
    state.elements.lineup.style.variant = 'list';
    state.elements.scorebar.style.variant = 'classic';
  },
  'clear-subs': () => {
    if (!confirm('Remove all substitutions for both teams?')) return false;
    state.lineups.home.subs = [];
    state.lineups.away.subs = [];
    if (state.match.banner && state.match.banner.kind === 'sub') state.match.banner = null;
  },
  'add-text': () => {
    const ex = {
      id: newId(), type: 'text', text: 'Your text', visible: true,
      x: 1400, y: 40, w: 460, h: 80,
      style: { font: 'Inter', fontSize: 36, color: '#ffffff', background: 'rgba(0,0,0,0.6)', align: 'center', radius: 12, bold: true },
    };
    state.extras.push(ex);
    selected = `extra:${ex.id}`;
  },
  'add-image': () => {
    const ex = { id: newId(), type: 'image', src: '', visible: true, x: 1660, y: 40, w: 220, h: 220, style: { fit: 'contain', radius: 0 } };
    state.extras.push(ex);
    selected = `extra:${ex.id}`;
  },
  'dup-extra': () => {
    const ex = structuredClone(elementByKey(selected));
    ex.id = newId();
    ex.x += 30;
    ex.y += 30;
    state.extras.push(ex);
    selected = `extra:${ex.id}`;
  },
  'del-extra': () => {
    state.extras = state.extras.filter((e) => `extra:${e.id}` !== selected);
    selected = null;
  },
  export: () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const m = state.match;
    a.download = `overlay-${m.home.short}-vs-${m.away.short}.json`.toLowerCase();
    a.click();
    URL.revokeObjectURL(a.href);
    return false;
  },
  import: () => {
    document.getElementById('importFile').click();
    return false;
  },
  reset: async () => {
    if (!confirm('Reset all teams, lineup, design and layout to the defaults?')) return false;
    await fetch('/api/reset', { method: 'POST' });
    selected = null;
    return false;
  },
};

document.addEventListener('click', async (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    document.querySelectorAll('[data-tab]').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab.dataset.tab));
    return;
  }
  const clear = e.target.closest('[data-clear]');
  if (clear) {
    setPath(state, clear.dataset.clear, '');
    commit({ immediate: true });
    return;
  }
  const item = e.target.closest('[data-select]');
  if (item && e.target.type !== 'checkbox') {
    select(item.dataset.select);
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (btn && state && ACTIONS[btn.dataset.act]) {
    btn.blur(); // so Space does not re-click it
    const result = await ACTIONS[btn.dataset.act](btn);
    if (result !== false) commit({ immediate: true });
    return;
  }
  const teamBtn = e.target.closest('[data-lineup-team]');
  if (teamBtn) {
    lineupTeam = teamBtn.dataset.lineupTeam;
    render();
    return;
  }
  const themeBtn = e.target.closest('[data-theme]');
  if (themeBtn) {
    applyTheme(THEMES[themeBtn.dataset.theme]);
    commit({ immediate: true });
  }
});

document.getElementById('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const loaded = JSON.parse(await file.text());
    if (!loaded.match || !loaded.elements) throw new Error('Not a Live Studio setup file');
    const defaults = await (await fetch('/api/defaults')).json();
    state = migrateState(loaded, defaults);
    selected = null;
    commit({ immediate: true });
  } catch (err) {
    alert(`Could not load that file: ${err.message}`);
  }
  e.target.value = '';
});

// ---------- Hotkeys ----------

document.addEventListener('keydown', (e) => {
  if (!state) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (typing || e.ctrlKey || e.metaKey) return;
  const key = e.key.toLowerCase();
  let act = null;
  if (key === 'h') act = e.shiftKey ? 'home-' : 'home+';
  else if (key === 'j') act = e.shiftKey ? 'away-' : 'away+';
  else if (e.code === 'Space') act = 'clock-toggle';
  if (act) {
    e.preventDefault();
    ACTIONS[act]();
    commit({ immediate: true });
    return;
  }
  const el = elementByKey(selected);
  const step = e.shiftKey ? 10 : 1;
  const moves = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
  if (el && moves[key]) {
    e.preventDefault();
    el.x += moves[key][0];
    el.y += moves[key][1];
    commit();
  }
});

// ---------- Drag and resize in the preview ----------

let drag = null;
const SNAP = 10;

stage.addEventListener('pointerdown', (e) => {
  const node = e.target.closest('.el');
  if (!node) {
    if (selected) select(null);
    return;
  }
  const key = node.dataset.key;
  if (key !== selected) {
    select(key);
  }
  const el = elementByKey(key);
  const target = stage.querySelector(`.el[data-key="${CSS.escape(key)}"]`);
  drag = {
    el, node: target,
    mode: e.target.classList.contains('handle') ? 'resize' : 'move',
    startX: e.clientX, startY: e.clientY,
    orig: { x: el.x, y: el.y, w: el.w, h: el.h },
  };
  stage.setPointerCapture(e.pointerId);
  e.preventDefault();
});

stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const snap = (v) => (e.altKey ? Math.round(v) : Math.round(v / SNAP) * SNAP);
  const dx = (e.clientX - drag.startX) / scale;
  const dy = (e.clientY - drag.startY) / scale;
  const { el, orig, node } = drag;
  if (drag.mode === 'move') {
    el.x = snap(orig.x + dx);
    el.y = snap(orig.y + dy);
  } else {
    el.w = Math.max(40, snap(orig.w + dx));
    el.h = Math.max(30, snap(orig.h + dy));
  }
  node.style.left = el.x + 'px';
  node.style.top = el.y + 'px';
  node.style.width = el.w + 'px';
  node.style.height = el.h + 'px';
  drag.moved = true;
  if (window.afterLayout) window.afterLayout();
});

stage.addEventListener('pointerup', () => {
  if (!drag) return;
  const moved = drag.moved;
  drag = null;
  if (moved) commit({ immediate: true });
});

// ---------- Themes ----------

const THEMES = {
  'Blue fire': {
    scorebar: { background: '#1c1c1e', textColor: '#ffffff', scoreColor: '#ffffff', clockColor: '#34c759', font: 'Inter', radius: 0 },
    lineup: { background: 'linear-gradient(180deg, #050b2e 0%, #0a1d6b 50%, #050b2e 100%)', rowColor: '#1f4fd1', rowColor2: '#0b2a8a', textColor: '#ffffff', titleColor: '#ffffff', titleAccent: '#4da3ff', font: 'Russo One', rowShape: 'brush', italic: true },
  },
  'Red derby': {
    scorebar: { background: 'linear-gradient(90deg, #2a0005, #6b000f 50%, #2a0005)', textColor: '#ffffff', scoreColor: '#ffd84d', clockColor: '#ffffff', font: 'Oswald', radius: 0 },
    lineup: { background: 'linear-gradient(180deg, #1a0003, #5c0010 55%, #1a0003)', rowColor: '#d1102b', rowColor2: '#6b000f', textColor: '#ffffff', titleColor: '#ffffff', titleAccent: '#ffd84d', font: 'Anton', rowShape: 'slant', italic: true },
  },
  'Clean light': {
    scorebar: { background: '#ffffff', textColor: '#111827', scoreColor: '#111827', clockColor: '#2563eb', font: 'Montserrat', radius: 24 },
    lineup: { background: 'linear-gradient(180deg, #f8fafc, #e2e8f0)', rowColor: '#ffffff', rowColor2: '#ffffff', textColor: '#0f172a', titleColor: '#0f172a', titleAccent: '#2563eb', font: 'Montserrat', rowShape: 'pill', italic: false },
  },
  'Neon night': {
    scorebar: { background: 'rgba(5, 5, 15, 0.85)', textColor: '#e0f2fe', scoreColor: '#22d3ee', clockColor: '#f472b6', font: 'Rajdhani', radius: 16 },
    lineup: { background: 'linear-gradient(180deg, #05010f, #1b0b3a 50%, #05010f)', rowColor: '#7c3aed', rowColor2: '#1e1b4b', textColor: '#f0abfc', titleColor: '#ffffff', titleAccent: '#22d3ee', font: 'Teko', rowShape: 'flat', italic: false },
  },
  'Pitch green': {
    scorebar: { background: '#0b3d20', textColor: '#ffffff', scoreColor: '#ffffff', clockColor: '#facc15', font: 'Barlow Condensed', radius: 0 },
    lineup: { background: 'repeating-linear-gradient(180deg, #14532d 0 90px, #166534 90px 180px)', rowColor: '#0b3d20', rowColor2: '#052e16', textColor: '#ffffff', titleColor: '#ffffff', titleAccent: '#facc15', font: 'Barlow Condensed', rowShape: 'flat', italic: true },
  },
};

function applyTheme(theme) {
  Object.assign(state.elements.scorebar.style, theme.scorebar);
  Object.assign(state.elements.lineup.style, theme.lineup, { backgroundImage: '' });
}

document.getElementById('themes').innerHTML = Object.keys(THEMES)
  .map((name) => `<button data-theme="${esc(name)}">${esc(name)}</button>`).join('');

// ---------- Start ----------

fillFontSelects();

let source = null;
function connect() {
  source = subscribe((incoming, offset) => {
    setStatus(true);
    serverOffset = offset;
    // Ignore our own echo while local edits are still waiting to be sent.
    if (pushTimer || pushing || drag) return;
    const first = !state;
    state = incoming;
    if (selected && !elementByKey(selected)) selected = null;
    render();
    if (first) fitPreview();
  });
  source.onerror = () => setStatus(false);
}
connect();

setInterval(() => {
  if (!state) return;
  // Switch the lineup / show or hide the sub banner on time
  if (!drag && viewChanged(stage, state, serverOffset)) render();
  updateClocks(stage, state, serverOffset);
  document.getElementById('topClock').textContent = formatClock(clockSeconds(state.match.clock, serverOffset));
}, 250);
