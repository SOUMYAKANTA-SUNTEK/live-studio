// Shared renderer used by both the OBS overlay and the control panel preview.
// Everything is laid out on a fixed 1920 x 1080 canvas.

const CANVAS_W = 1920;
const CANVAS_H = 1080;

// Google Fonts query for each font offered in the control panel
const FONTS = {
  'Inter': 'Inter:wght@400;600;800',
  'Russo One': 'Russo+One',
  'Bebas Neue': 'Bebas+Neue',
  'Anton': 'Anton',
  'Oswald': 'Oswald:wght@400;600;700',
  'Teko': 'Teko:wght@400;600;700',
  'Rajdhani': 'Rajdhani:wght@500;700',
  'Barlow Condensed': 'Barlow+Condensed:ital,wght@0,600;0,800;1,800',
  'Montserrat': 'Montserrat:ital,wght@0,500;0,800;1,800',
  'Roboto Condensed': 'Roboto+Condensed:wght@400;700',
  'Black Ops One': 'Black+Ops+One',
  'Saira Condensed': 'Saira+Condensed:wght@500;800',
  'Archivo Black': 'Archivo+Black',
};

let loadedFontKey = '';
function ensureFonts(state) {
  const used = new Set();
  const { lineup, scorebar, subBanner } = state.elements;
  used.add(lineup.style.font);
  used.add(scorebar.style.font);
  used.add(subBanner.style.font);
  if (state.broadcast) used.add(state.broadcast.font);
  for (const ex of state.extras) if (ex.style && ex.style.font) used.add(ex.style.font);
  const families = [...used].filter((f) => FONTS[f]).sort();
  const key = families.join('|');
  if (key === loadedFontKey || !families.length) return;
  loadedFontKey = key;
  let link = document.getElementById('gfonts');
  if (!link) {
    link = document.createElement('link');
    link.id = 'gfonts';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  link.href = 'https://fonts.googleapis.com/css2?' +
    families.map((f) => 'family=' + FONTS[f]).join('&') + '&display=swap';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function cssUrl(src) {
  return `url("${String(src).replace(/"/g, '%22')}")`;
}

// ---------- Clock ----------

function clockSeconds(clock, serverOffset) {
  let secs = clock.baseSeconds || 0;
  if (clock.running && clock.startedAt) {
    secs += (Date.now() + serverOffset - clock.startedAt) / 1000;
  }
  return Math.max(0, Math.floor(secs));
}

function formatClock(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

// ---------- Pieces ----------

function teamLogo(team, size) {
  if (team.logo) {
    return `<img class="logo" src="${esc(team.logo)}" style="height:${size}px;width:${size}px" alt="">`;
  }
  return `<div class="logo badge" style="height:${size}px;width:${size}px;background:${esc(team.color)};font-size:${size * 0.3}px">${esc(team.short)}</div>`;
}

function boxStyle(el) {
  return `left:${el.x}px;top:${el.y}px;width:${el.w}px;height:${el.h}px;`;
}

// ---------- Match events (goals and cards) ----------

const BALL_SVG = `<svg class="ev-icon" viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="12" cy="12" r="10.6" fill="#fff" stroke="#111" stroke-width="1.4"/>
  <path d="M12 7.3l4.3 3.1-1.6 5h-5.4l-1.6-5z" fill="#111"/>
  <path d="M12 1.6v5.7M16.3 10.4l5.2-1.9M14.7 15.4l3.3 4.7M9.3 15.4L6 20.1M7.7 10.4L2.5 8.5" stroke="#111" stroke-width="1.4" fill="none"/>
</svg>`;

const EVENT_TYPES = {
  goal: { label: 'Goal', icon: BALL_SVG, order: 0 },
  owngoal: { label: 'Own goal', icon: BALL_SVG, suffix: ' (OG)', order: 0 },
  penalty: { label: 'Penalty goal', icon: BALL_SVG, suffix: ' (P)', order: 0 },
  yellow: { label: 'Yellow card', icon: '<span class="ev-icon card yellow"></span>', order: 1 },
  red: { label: 'Red card', icon: '<span class="ev-icon card red"></span>', order: 2 },
};

// Under a team's name: goals first, then cards, one entry per player and type
// with all their minutes, e.g. "⚽ Palmer 23', 67'".
// Half time, full time and similar breaks: show the label, not the clock.
function clockHidden(m) {
  return /^(ht|ft|aet|pens?|half[\s-]*time|full[\s-]*time|break)$/i.test(String(m.period || '').trim());
}

function teamEvents(state, team) {
  const st = state.elements.scorebar.style;
  if (st.showEvents === false) return '';
  const groups = [];
  for (const ev of state.match.events || []) {
    if (ev.team !== team || !EVENT_TYPES[ev.type]) continue;
    let g = groups.find((x) => x.player === ev.player && x.type === ev.type);
    if (!g) groups.push((g = { player: ev.player, type: ev.type, minutes: [] }));
    if (ev.minute) g.minutes.push(`${ev.minute}'`);
  }
  if (!groups.length) return '';
  groups.sort((a, b) => EVENT_TYPES[a.type].order - EVENT_TYPES[b.type].order);
  return `<div class="events" style="font-size:${st.eventSize}px;color:${esc(st.eventColor)}">${groups.map((g) => {
    const t = EVENT_TYPES[g.type];
    return `<span class="ev">${t.icon}<span>${esc(g.player)}${t.suffix || ''} ${esc(g.minutes.join(', '))}</span></span>`;
  }).join('')}</div>`;
}

function renderScorebar(state) {
  const el = state.elements.scorebar;
  const st = el.style;
  const m = state.match;
  const nameOf = (t) => (st.useShortNames ? t.short : t.name);
  const stripe = (t) => (st.showTeamColors ? `border-bottom:6px solid ${esc(t.color)};` : '');
  const logoSize = Math.round(el.h * 0.42);
  // Shrink a long team name so it fits its half of the bar (score stays centred)
  const nameCol = (el.w * 0.94 - 2 * logoSize - 4 * 28 - st.scoreSize * 3.4) / 2;
  const nameSize = (t) => Math.max(14, Math.min(st.nameSize, Math.floor(nameCol / (Math.max(1, nameOf(t).length) * 0.56))));
  const homeEvents = teamEvents(state, 'home');
  const awayEvents = teamEvents(state, 'away');
  const extra = m.clock.addedTime ? ` <span class="added">+${m.clock.addedTime}</span>` : '';
  return `
    <div class="el scorebar" data-key="scorebar" style="${boxStyle(el)}
      background:${esc(st.background)};opacity:${st.opacity};border-radius:${st.radius}px;
      font-family:'${esc(st.font)}',sans-serif;color:${esc(st.textColor)}">
      <div class="sb-name home"><span class="name" style="font-size:${nameSize(m.home)}px;${stripe(m.home)}">${esc(nameOf(m.home))}</span></div>
      <div class="sb-logo home">${teamLogo(m.home, logoSize)}</div>
      <div class="center">
        <div class="score" style="font-size:${st.scoreSize}px;color:${esc(st.scoreColor)}">
          ${m.homeScore} <span class="dash">-</span> ${m.awayScore}
        </div>
        <div class="clock-line" style="font-size:${st.clockSize}px;color:${esc(st.clockColor)}">
          ${clockHidden(m) ? `<span class="period">${esc(m.period)}</span>` : `${m.period ? `<span class="period">${esc(m.period)}</span> ` : ''}<span class="clock">00:00</span>${extra}`}
        </div>
      </div>
      <div class="sb-logo away">${teamLogo(m.away, logoSize)}</div>
      <div class="sb-name away"><span class="name" style="font-size:${nameSize(m.away)}px;${stripe(m.away)}">${esc(nameOf(m.away))}</span></div>
      ${homeEvents || awayEvents ? `
      <div class="sb-events home">${homeEvents}</div>
      <div class="sb-events away">${awayEvents}</div>` : ''}
    </div>`;
}

// Who is on the pitch now: the starting XI with substitutions applied in order.
function currentXI(lu) {
  // A line may start with a shirt number: "19 B. Mbeumo"
  const rows = lu.players.filter((p) => p.trim()).map((line) => ({ ...splitNumber(line), sub: null }));
  for (const sub of lu.subs || []) {
    const off = splitNumber(sub.off).name;
    const row = rows.find((r) => r.name === off);
    if (row) {
      const on = splitNumber(sub.on);
      row.sub = { off, minute: sub.minute };
      row.name = on.name;
      row.number = on.number;
    }
  }
  return rows;
}

// Which lineup is showing and whether the substitution banner is up.
// Based on the shared clock so every screen switches at the same moment.
function liveView(state, serverOffset = 0) {
  const now = Date.now() + serverOffset;
  const view = state.lineupView;
  let team = view.mode;
  if (team === 'rotate') {
    const period = Math.max(3, Number(view.interval) || 20) * 1000;
    team = Math.floor(now / period) % 2 ? 'away' : 'home';
  }
  const b = state.match.banner;
  const banner = !!b && now - b.at < (Number(state.elements.subBanner.style.duration) || 10) * 1000;
  const e = state.elements;
  return {
    team,
    banner,
    // Broadcast pieces that change on their own
    info: e.infoBox.visible ? infoMessage(state, serverOffset) : '',
    minute: e.dateCard.visible ? Math.floor(now / 60000) : 0,
  };
}

const lastTeamShown = new WeakMap();

function renderLineup(state, team, root) {
  const el = state.elements.lineup;
  const st = el.style;
  const lu = state.lineups[team];
  const club = state.match[team];
  const titleText = String(lu.title || `${club.name} XI`).trim();
  // Shrink long titles (e.g. "Tottenham Hotspur XI") so they fit the panel
  const titleSize = Math.min(st.titleSize, Math.floor((el.w * 0.86) / (Math.max(1, titleText.length) * 0.62)));
  const words = titleText.split(/\s+/);
  const last = words.length > 1 ? words.pop() : '';
  const title = `${esc(words.join(' '))}${last ? ` <span style="color:${esc(st.titleAccent)}">${esc(last)}</span>` : ''}`;
  const logo = lu.logo || club.logo;
  const bg = st.backgroundImage
    ? `background:${cssUrl(st.backgroundImage)} center/cover no-repeat;`
    : `background:${esc(st.background)};`;
  const textStyle = `font-style:${st.italic ? 'italic' : 'normal'};text-transform:${st.uppercase ? 'uppercase' : 'none'};`;
  const row1 = st.teamColors ? club.color : st.rowColor;
  const row2 = st.teamColors ? `color-mix(in srgb, ${club.color} 55%, black)` : st.rowColor2;
  const marks = st.showEvents !== false ? lineupMarks(state, team) : {};
  const rows = currentXI(lu).map((p, i) => {
    const sub = st.showSubs !== false && p.sub;
    const mark = marks[p.name] ? `<span class="ev-marks">${marks[p.name]}</span>` : '';
    return `
    <div class="row shape-${esc(st.rowShape)}" style="--row1:${esc(row1)};--row2:${esc(row2)};--mark-size:${Math.round(st.fontSize * 0.7)}px">
      <span style="font-size:${st.fontSize}px;color:${esc(st.textColor)};${textStyle}">
        ${st.showNumbers ? `<b class="num">${esc(p.number || i + 1)}</b>` : ''}${sub ? '<i class="sub-in">▲</i>' : ''}${esc(p.name)}
      </span>${mark}
      ${sub ? `<span class="sub-off" style="font-size:${Math.round(st.fontSize * 0.42)}px">▼ ${esc(sub.off)}${sub.minute ? ` ${esc(sub.minute)}'` : ''}</span>` : ''}
    </div>`;
  }).join('');
  // Fade in only when the team changes, not on every update
  const changed = root && lastTeamShown.get(root) !== team;
  if (root) lastTeamShown.set(root, team);
  return `
    <div class="el lineup" data-key="lineup" style="${boxStyle(el)}${bg}font-family:'${esc(st.font)}',sans-serif">
      <div class="lineup-inner ${changed ? 'fade-in' : ''}">
        ${logo ? `<img class="lineup-logo" src="${esc(logo)}" alt="">` : ''}
        <div class="lineup-title" style="font-size:${titleSize}px;color:${esc(st.titleColor)};${textStyle}">${title}</div>
        <div class="rows">${rows}</div>
      </div>
    </div>`;
}

// Goal / card icons for each player in a team's lineup, keyed by name.
// Own goals are marked on the scorer, who is in the other team's lineup.
function lineupMarks(state, team) {
  const marks = {};
  // Goals first, then cards
  const events = [...(state.match.events || [])]
    .sort((a, b) => (EVENT_TYPES[a.type]?.order ?? 9) - (EVENT_TYPES[b.type]?.order ?? 9));
  for (const ev of events) {
    const playerTeam = ev.type === 'owngoal' ? (ev.team === 'home' ? 'away' : 'home') : ev.team;
    if (playerTeam !== team || !EVENT_TYPES[ev.type]) continue;
    const icon = ev.type === 'owngoal' ? BALL_SVG.replace('class="ev-icon"', 'class="ev-icon og"') : EVENT_TYPES[ev.type].icon;
    marks[ev.player] = (marks[ev.player] || '') + icon;
  }
  return marks;
}

const BANNER_HEADS = {
  sub: 'Substitution',
  goal: 'Goal!',
  penalty: 'Goal! (penalty)',
  owngoal: 'Own goal',
  yellow: 'Yellow card',
  red: 'Red card',
};

// One pop-up for substitutions, goals and cards.
function renderSubBanner(state, editing) {
  const el = state.elements.subBanner;
  const st = el.style;
  const b = state.match.banner || (editing ? { kind: 'sub', team: 'home', on: 'Player coming on', off: 'Player going off', minute: 60 } : null);
  if (!b || !BANNER_HEADS[b.kind]) return '';
  const club = state.match[b.team];
  const m = state.match;
  const logoSize = Math.round(st.fontSize * 1.1);
  const minute = b.minute ? ` · ${esc(b.minute)}'` : '';
  let body;
  if (b.kind === 'sub') {
    body = `
        <div class="sb-on"><span style="color:${esc(st.inColor)}">▲</span> ${esc(b.on)}</div>
        <div class="sb-off"><span style="color:${esc(st.outColor)}">▼</span> ${esc(b.off)}</div>`;
  } else {
    const isGoal = b.kind !== 'yellow' && b.kind !== 'red';
    body = `
        <div class="sb-on">${EVENT_TYPES[b.kind].icon} ${esc(b.player)}${b.kind === 'owngoal' ? ' (OG)' : ''}</div>
        ${isGoal ? `<div class="sb-off">${esc(m.home.short)} ${m.homeScore} - ${m.awayScore} ${esc(m.away.short)}</div>` : ''}`;
  }
  return `
    <div class="el subbanner kind-${esc(b.kind)}" data-key="subBanner" style="${boxStyle(el)}
      background:${esc(st.background)};color:${esc(st.textColor)};border-radius:${st.radius}px;
      font-family:'${esc(st.font)}',sans-serif;font-size:${st.fontSize}px;border-left:10px solid ${esc(club.color)}">
      ${teamLogo(club, logoSize)}
      <div class="sb-text">
        <div class="sb-head">${BANNER_HEADS[b.kind]} · ${esc(club.name)}${minute}</div>${body}
      </div>
    </div>`;
}

function renderExtra(ex) {
  const st = ex.style || {};
  if (ex.type === 'image') {
    const inner = ex.src
      ? `<img src="${esc(ex.src)}" style="width:100%;height:100%;object-fit:${esc(st.fit || 'contain')}" alt="">`
      : '<div class="empty-img">Image</div>';
    return `<div class="el extra" data-key="extra:${esc(ex.id)}" style="${boxStyle(ex)}border-radius:${st.radius || 0}px;overflow:hidden">${inner}</div>`;
  }
  return `
    <div class="el extra text" data-key="extra:${esc(ex.id)}" style="${boxStyle(ex)}
      background:${esc(st.background || 'transparent')};color:${esc(st.color || '#fff')};
      font-family:'${esc(st.font || 'Inter')}',sans-serif;font-size:${st.fontSize || 36}px;
      justify-content:${{ left: 'flex-start', center: 'center', right: 'flex-end' }[st.align || 'center']};
      border-radius:${st.radius || 0}px;font-weight:${st.bold ? 800 : 400}">
      <span>${esc(ex.text)}</span>
    </div>`;
}

function renderCameraGuide(state) {
  const el = state.elements.camera;
  return `<div class="el camera-guide" data-key="camera" style="${boxStyle(el)}"><span>Webcam area (guide only, not shown on stream)</span></div>`;
}

// Render the whole overlay into `root`. `editing` adds the webcam guide
// and keeps the substitution banner on screen so it can be placed.
function renderOverlay(root, state, { editing = false, serverOffset = 0 } = {}) {
  ensureFonts(state);
  const e = state.elements;
  const view = liveView(state, serverOffset);
  let html = '';
  if (editing && e.camera.visible) html += renderCameraGuide(state);
  if (e.frame.visible) html += renderFrame(state);
  if (e.channelBadge.visible) html += renderChannelBadge(state);
  if (e.lineup.visible) {
    html += e.lineup.style.variant === 'pitch' ? renderPitchLineup(state, view.team, root) : renderLineup(state, view.team, root);
  }
  if (e.dateCard.visible) html += renderDateCard(state, serverOffset);
  if (e.scorebar.visible) html += e.scorebar.style.variant === 'broadcast' ? renderBroadcastScorebar(state) : renderScorebar(state);
  if (e.ticker.visible) html += renderTicker(state, serverOffset);
  if (e.infoBox.visible) html += renderInfoBox(state, serverOffset);
  for (const ex of state.extras) if (ex.visible !== false) html += renderExtra(ex);
  if (e.subBanner.visible && (view.banner || editing)) html += renderSubBanner(state, editing);
  root.innerHTML = html;
  root.dataset.skin = state.broadcast.skin || 'stand';
  root.dataset.view = JSON.stringify(view);
}

// True when the lineup should switch or the banner should appear or go.
function viewChanged(root, state, serverOffset) {
  return root.dataset.view !== JSON.stringify(liveView(state, serverOffset));
}

function updateClocks(root, state, serverOffset) {
  const text = formatClock(clockSeconds(state.match.clock, serverOffset));
  // Only touch the page when the text changes: every change repaints the overlay
  for (const node of root.querySelectorAll('.clock')) if (node.textContent !== text) node.textContent = text;
}

// Subscribe to live state. Calls onState(state, serverOffset) on every change.
function subscribe(onState) {
  const source = new EventSource('/events');
  source.onmessage = (msg) => {
    const { state, serverTime } = JSON.parse(msg.data);
    onState(state, serverTime - Date.now());
  };
  return source;
}
