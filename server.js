// Overlay Studio: a tiny local server with no dependencies.
// - Serves the control panel (/control) and the OBS overlay (/overlay)
// - Keeps the match state in data/state.json
// - Pushes every change to all open pages over Server-Sent Events

const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, 'public');
// The desktop app stores data in the user's profile folder (set by main.js)
const DATA_DIR = process.env.LIVE_STUDIO_DATA || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const DEFAULT_STATE = require('./default-state.json');
const migrateState = require('./public/migrate.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return migrateState(saved, DEFAULT_STATE); // fill in settings added in newer versions
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

let state = loadState();
let saveTimer = null;
const clients = new Set();

function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }, 300);
}

function broadcast() {
  const payload = `data: ${JSON.stringify({ state, serverTime: Date.now() })}\n\n`;
  for (const res of clients) res.write(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) reject(new Error('Body too large'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': MIME['.json'] });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ state, serverTime: Date.now() })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      clients.delete(res);
    });
    return;
  }

  if (url.pathname === '/api/state') {
    if (req.method === 'GET') return sendJson(res, 200, state);
    if (req.method === 'PUT') {
      try {
        state = JSON.parse(await readBody(req));
        saveState();
        broadcast();
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }
  }

  if (url.pathname === '/api/defaults') return sendJson(res, 200, DEFAULT_STATE);

  if (url.pathname === '/api/reset' && req.method === 'POST') {
    state = structuredClone(DEFAULT_STATE);
    saveState();
    broadcast();
    return sendJson(res, 200, { ok: true });
  }

  // Static files
  let file = url.pathname;
  if (file === '/' || file === '/control') file = '/control.html';
  if (file === '/overlay') file = '/overlay.html';
  const fullPath = path.normalize(path.join(PUBLIC_DIR, file));
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fullPath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

// Start on the given port, trying the next few ports if it is taken.
function start(port = 3000, attempts = 10) {
  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && attempts > 1) resolve(start(port + 1, attempts - 1));
      else reject(err);
    });
    server.listen(port, '127.0.0.1', () => resolve(port));
  });
}

module.exports = { start };

if (require.main === module) {
  start(Number(process.env.PORT) || 3000).then((port) => {
    console.log('');
    console.log('  Overlay Studio is running');
    console.log(`  Control panel:  http://localhost:${port}/control`);
    console.log(`  OBS overlay:    http://localhost:${port}/overlay   (Browser Source, 1920 x 1080)`);
    console.log('');
    console.log('  Keep this window open while you stream. Press Ctrl+C to stop.');
  });
}
