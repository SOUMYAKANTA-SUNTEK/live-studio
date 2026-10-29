// "Broadcast" look: full-screen webcam inside a coloured frame, a TV-style
// scorebar, the lineup drawn on a pitch, a date card, a scrolling ticker,
// a rotating info box and a channel badge. Loaded after render.js.

const SHIRT_PATH = 'M31 9 L43 4 Q50 11 57 4 L69 9 L93 24 L84 43 L74 37 L74 94 L26 94 L26 37 L16 43 L7 24 Z';

// "19 B. Mbeumo" → { number: '19', name: 'B. Mbeumo' }
function splitNumber(text) {
  const m = String(text || '').trim().match(/^(\d{1,2})[\s.\-:]+(.+)$/);
  return m ? { number: m[1], name: m[2].trim() } : { number: '', name: String(text || '').trim() };
}

// "4-2-3-1" → [1, 4, 2, 3, 1] (goalkeeper first)
function formationRows(formation, count) {
  const outfield = String(formation || '').split('-').map(Number).filter((n) => n > 0);
  const total = outfield.reduce((a, b) => a + b, 0);
  if (total !== count - 1) return guessRows(count); // formation doesn't match the number of players
  return [1, ...outfield];
}

function guessRows(count) {
  if (count >= 11) return [1, 4, 2, 3, 1];
  const rows = [1];
  let left = count - 1;
  while (left > 0) {
    const n = Math.min(4, left);
    rows.push(n);
    left -= n;
  }
  return rows;
}

function bcStyle(state) {
  const b = state.broadcast;
  return `--accent:${esc(b.accent)};--accent-dark:color-mix(in srgb, ${esc(b.accent)} 70%, black);font-family:'${esc(b.font)}',sans-serif;`;
}

// Text size that fits `text` into `width` px (rough average glyph width)
function fitSize(text, width, max, k = 0.55) {
  return Math.max(12, Math.min(max, Math.floor(width / (Math.max(1, String(text).length) * k))));
}

// ---------- Frame ----------

function renderFrame(state) {
  const st = state.elements.frame.style;
  return `<div class="bc-frame" style="${bcStyle(state)}--frame:${Number(st.width) || 14}px"></div>`;
}

// ---------- Scorebar ----------

function renderBroadcastScorebar(state) {
  const el = state.elements.scorebar;
  const st = el.style;
  const m = state.match;
  const pre = m.preMatch && m.preMatch.enabled;
  const nameOf = (t) => (st.useShortNames ? t.short : t.name);
  const nameW = (el.w - el.h * 2.6) / 2 - 40;
  const nameSize = (t) => fitSize(nameOf(t).toUpperCase(), nameW, Math.round(el.h * 0.5), 0.52);
  if (pre) {
    const text = m.preMatch.text || 'Countdown to kick-off!';
    return `
      <div class="el bc-scorebar pre" data-key="scorebar" style="${boxStyle(el)}${bcStyle(state)}">
        <div class="bc-pre" style="font-size:${fitSize(text.toUpperCase(), el.w * 0.9, Math.round(el.h * 0.55), 0.5)}px">${esc(text)}</div>
      </div>`;
  }
  const homeEvents = teamEvents(state, 'home');
  const awayEvents = teamEvents(state, 'away');
  // When either side has scorers or cards, both sides get the row, so the
  // two team names stay level
  // Shrink the scorer text when there are many entries so nothing is cut off
  const textLen = (html) => (html || '').replace(/<svg[\s\S]*?<\/svg>/g, 'xx').replace(/<[^>]+>/g, '').length + 3;
  const eventsSize = Math.max(10, Math.min(16, Math.floor((nameW + 40) / (Math.max(textLen(homeEvents), textLen(awayEvents)) * 0.56))));
  const eventsRow = (html) => (homeEvents || awayEvents ? `<div class="bc-events" style="font-size:${eventsSize}px">${html}</div>` : '');
  const scoreSize = Math.round(el.h * 0.62);
  return `
    <div class="el bc-scorebar" data-key="scorebar" style="${boxStyle(el)}${bcStyle(state)}--home:${esc(m.home.color)};--away:${esc(m.away.color)};">
      <div class="bc-strip"></div>
      <div class="bc-team home">
        <span class="bc-name" style="font-size:${nameSize(m.home)}px">${esc(nameOf(m.home))}</span>
        ${eventsRow(homeEvents)}
      </div>
      <div class="bc-center" style="height:${Math.round(el.h * 0.86)}px">
        <div class="bc-score" style="font-size:${scoreSize}px">${m.homeScore}</div>
        <div class="bc-mid">
          <div class="bc-clock" style="font-size:${Math.round(el.h * 0.27)}px">${clockHidden(m) ? esc(String(m.period).toUpperCase()) : `<span class="clock">00:00</span>${m.clock.addedTime ? `<span class="bc-added">+${m.clock.addedTime}</span>` : ''}`}</div>
          ${m.competition || (m.period && !clockHidden(m)) ? `<div class="bc-comp" style="font-size:${Math.round(el.h * 0.13)}px">${esc(clockHidden(m) ? m.competition : m.period || m.competition)}</div>` : ''}
        </div>
        <div class="bc-score" style="font-size:${scoreSize}px">${m.awayScore}</div>
      </div>
      <div class="bc-team away">
        <span class="bc-name" style="font-size:${nameSize(m.away)}px">${esc(nameOf(m.away))}</span>
        ${eventsRow(awayEvents)}
      </div>
      <div class="bc-end"></div>
    </div>`;
}

// ---------- Lineup on a pitch ----------

function shirtSvg(color, gradientId) {
  return `<svg class="shirt" viewBox="0 0 100 100" aria-hidden="true">
    <defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.28"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.25"/>
    </linearGradient></defs>
    <path d="${SHIRT_PATH}" fill="${esc(color)}"/>
    <path d="${SHIRT_PATH}" fill="url(#${gradientId})"/>
    <path d="M43 4 Q50 11 57 4" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="2"/>
  </svg>`;
}

function renderPitchLineup(state, team, root) {
  const el = state.elements.lineup;
  const st = el.style;
  const bc = state.broadcast;
  const lu = state.lineups[team];
  const club = state.match[team];
  const players = currentXI(lu);
  const rows = formationRows(lu.formation, players.length);
  const marks = st.showEvents !== false ? lineupMarks(state, team) : {};
  const headerH = Math.round(el.h * 0.17);
  const shirtW = Math.round(Math.min(el.w / 5.4, (el.h - headerH) / (rows.length * 1.35)));

  // Place players: goalkeeper at the bottom, attack at the top, left to right
  let i = 0;
  const shirts = [];
  rows.forEach((n, r) => {
    const y = 92 - (r / (rows.length - 1 || 1)) * 80; // % from the top of the pitch
    for (let k = 0; k < n && i < players.length; k++, i++) {
      const p = players[i];
      const x = ((k + 1) / (n + 1)) * 100;
      const gk = r === 0;
      const sub = st.showSubs !== false && p.sub;
      const number = p.number || '';
      shirts.push(`
        <div class="pl" style="left:${x}%;top:${y}%;width:${shirtW}px">
          <div class="pl-shirt">
            ${shirtSvg(gk ? st.gkColor || '#facc15' : club.color, `sg${team}${i}`)}
            <div class="pl-name" style="color:${gk ? '#111' : '#fff'}">${esc(p.name)}</div>
            <div class="pl-num" style="color:${gk ? '#111' : '#fff'}">${esc(number)}</div>
            ${sub ? '<div class="pl-sub" title="Came on">▲</div>' : ''}
            ${marks[p.name] ? `<div class="pl-marks">${marks[p.name]}</div>` : ''}
          </div>
          <div class="pl-base"></div>
        </div>`);
    }
  });

  const changed = root && lastTeamShown.get(root) !== team;
  if (root) lastTeamShown.set(root, team);
  const title = lu.title || club.short || club.name;
  return `
    <div class="el bc-lineup" data-key="lineup" style="${boxStyle(el)}${bcStyle(state)}">
      <div class="bc-head" style="height:${headerH}px">
        <div class="bc-head-icon">${PITCH_ICON}</div>
        <div class="bc-head-text">
          ${bc.panel.sponsor ? `<div class="bc-sponsor">${esc(bc.panel.sponsor)}</div>` : ''}
          <div class="bc-title" style="font-size:${fitSize(title.toUpperCase(), el.w * 0.5, Math.round(headerH * 0.36))}px">${esc(title)}</div>
          <div class="bc-sub">${esc(bc.panel.subtitle || 'Starting XI')}</div>
        </div>
        ${bc.panel.qr ? `<img class="bc-qr" src="${esc(bc.panel.qr)}" alt="">` : ''}
      </div>
      <div class="bc-pitch-wrap ${changed ? 'fade-in' : ''}">
        <div class="bc-pitch">
          <div class="pitch-lines">
            <div class="pl-half"></div><div class="pl-circle"></div>
            <div class="pl-box top"></div><div class="pl-box bottom"></div>
            <div class="pl-six top"></div><div class="pl-six bottom"></div>
          </div>
          ${shirts.join('')}
        </div>
      </div>
    </div>`;
}

const PITCH_ICON = `<svg viewBox="0 0 40 56" aria-hidden="true" fill="none" stroke="#fff" stroke-width="3">
  <rect x="3" y="3" width="34" height="50" rx="3"/><line x1="3" y1="28" x2="37" y2="28"/><circle cx="20" cy="28" r="6"/>
  <rect x="12" y="3" width="16" height="8"/><rect x="12" y="45" width="16" height="8"/></svg>`;

// ---------- Date card ----------

function renderDateCard(state, serverOffset) {
  const el = state.elements.dateCard;
  const d = new Date(Date.now() + serverOffset);
  const day = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const month = d.toLocaleDateString('en-GB', { month: 'short' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' ', '');
  const u = el.h / 100;
  return `
    <div class="el bc-date" data-key="dateCard" style="${boxStyle(el)}${bcStyle(state)}">
      <div class="bc-date-top" style="font-size:${Math.round(u * 8)}px">${esc(day)}</div>
      <div class="bc-date-day" style="font-size:${Math.round(u * 30)}px">${d.getDate()}</div>
      <div class="bc-date-month" style="font-size:${Math.round(u * 9)}px">${esc(month)}</div>
      <div class="bc-date-time" style="font-size:${Math.round(u * 13)}px">${esc(time)}</div>
    </div>`;
}

// ---------- Ticker ----------

// In the desktop app the scrolling text is drawn straight onto the stream
// canvas (see stream.js), so the overlay doesn't repaint 20 times a second.
const TICKER_DRAWN_BY_APP = typeof location !== 'undefined' && new URLSearchParams(location.search).has('app');

function tickerLayout(state, serverOffset) {
  const el = state.elements.ticker;
  const t = state.broadcast.ticker;
  const text = (t.messages || []).map((s) => s.trim()).filter(Boolean).join('   //   ');
  if (!text) return null;
  const fontSize = Math.round(el.h * 0.58);
  const labelW = Math.round(el.h * 2.2);
  const viewW = el.w - labelW - el.h;
  const textW = text.length * fontSize * 0.5;
  const speed = Math.max(20, Number(t.speed) || 120); // px per second
  const duration = (viewW + textW) / speed;
  // Where the text is now, so a redraw continues instead of restarting
  const elapsed = ((Date.now() + serverOffset) / 1000) % duration;
  return { el, t, text, fontSize, labelW, viewW, textW, duration, elapsed, offsetX: viewW - elapsed * speed };
}

function renderTicker(state, serverOffset) {
  const L = tickerLayout(state, serverOffset);
  if (!L) return '';
  const { el, t, fontSize, labelW, viewW, textW, duration, elapsed } = L;
  const text = TICKER_DRAWN_BY_APP ? '' : L.text;
  return `
    <div class="el bc-ticker" data-key="ticker" style="${boxStyle(el)}${bcStyle(state)}">
      <div class="bc-ticker-label" style="width:${labelW}px;font-size:${Math.round(el.h * 0.34)}px">${esc(t.label || 'Latest')}</div>
      <div class="bc-ticker-view">
        <div class="bc-ticker-text" style="font-size:${fontSize}px;--from:${viewW}px;--to:${-textW}px;animation-duration:${duration.toFixed(2)}s;animation-delay:${(-elapsed).toFixed(2)}s">${esc(text)}</div>
      </div>
      <div class="bc-ticker-end" style="width:${el.h}px">◀</div>
    </div>`;
}

// Draws the moving ticker text onto the stream canvas (1920x1080 units).
function drawTickerText(ctx, state, serverOffset) {
  const el = state && state.elements.ticker;
  if (!el || el.visible === false) return;
  const L = tickerLayout(state, serverOffset);
  if (!L) return;
  const border = 4;
  const left = el.x + border + L.labelW;
  const right = el.x + el.w - border - el.h;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, el.y + border, right - left, el.h - border * 2);
  ctx.clip();
  ctx.font = `500 ${L.fontSize}px Inter, sans-serif`;
  ctx.fillStyle = state.broadcast.skin === 'studio' ? '#fff' : '#111';
  ctx.textBaseline = 'middle';
  ctx.fillText(L.text, left + L.offsetX, el.y + el.h / 2);
  ctx.restore();
}

// ---------- Info box (rotating messages) ----------

function infoMessage(state, serverOffset) {
  const info = state.broadcast.info;
  const list = (info.messages || []).map((s) => s.trim()).filter(Boolean);
  if (!list.length) return '';
  const period = Math.max(3, Number(info.interval) || 12) * 1000;
  return list[Math.floor((Date.now() + serverOffset) / period) % list.length];
}

function renderInfoBox(state, serverOffset) {
  const el = state.elements.infoBox;
  const msg = infoMessage(state, serverOffset);
  const textW = el.w * 0.72;
  // Rough fit for up to 3 lines of text
  const size = Math.max(14, Math.min(Math.round(el.h * 0.19), Math.floor(Math.sqrt((textW * el.h * 0.7) / Math.max(1, msg.length * 0.6)))));
  return `
    <div class="el bc-info" data-key="infoBox" style="${boxStyle(el)}${bcStyle(state)}">
      <div class="bc-info-side"><span>?</span></div>
      <div class="bc-info-text fade-in" style="font-size:${size}px">${esc(msg)}</div>
    </div>`;
}

// ---------- Channel badge ----------

function renderChannelBadge(state) {
  const el = state.elements.channelBadge;
  const b = state.broadcast.badge;
  const logoW = b.logo ? Math.round(el.h * 1.05) : 0;
  return `
    <div class="el bc-badge" data-key="channelBadge" style="${boxStyle(el)}${bcStyle(state)}">
      ${b.logo ? `<img class="bc-badge-logo" src="${esc(b.logo)}" style="width:${logoW}px" alt="">` : ''}
      <div class="bc-badge-box" style="margin-left:${logoW ? logoW * 0.55 : 0}px;padding-left:${logoW ? logoW * 0.5 : 16}px">
        <div class="bc-badge-title" style="font-size:${fitSize(b.title, el.w - logoW - 30, Math.round(el.h * 0.38), 0.55)}px">${esc(b.title)}</div>
        <div class="bc-badge-sub" style="font-size:${Math.round(el.h * 0.15)}px">${esc(b.subtitle)}</div>
      </div>
    </div>`;
}
