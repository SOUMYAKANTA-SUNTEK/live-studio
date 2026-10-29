// Live Studio desktop app (Electron main process).
// - Runs the overlay server inside the app
// - Shows the control panel with your webcam in the preview
// - Renders the overlay off screen and hands each frame to the window,
//   which combines it with the webcam and records the result
// - Sends the recording through FFmpeg to YouTube

const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// Keep the picture and audio running when the window is minimised or covered
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
process.env.LIVE_STUDIO_DATA = path.join(app.getPath('userData'), 'data');

const { start } = require('./server');
const { Streamer, detectEncoders } = require('./streamer');

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
let mainWin = null;
let overlayWin = null;
let streamer = null;

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function send(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload);
}

function createOverlayRenderer(base) {
  overlayWin = new BrowserWindow({
    show: false,
    width: 1920,
    height: 1080,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  overlayWin.webContents.setFrameRate(20);
  // Only the part of the overlay that changed is sent (e.g. just the clock
  // digits each second), which keeps the PNG work tiny.
  let needFull = true;
  overlayWin.webContents.on('paint', (_event, dirty, image) => {
    const { width: W, height: H } = image.getSize();
    let rect = { x: 0, y: 0, width: W, height: H };
    if (!needFull && dirty) {
      // `dirty` may be in device pixels or in 1920x1080 units on scaled
      // screens; cover both readings so nothing is missed.
      const k = W / 1920;
      const x1 = Math.min(dirty.x, dirty.x * k);
      const y1 = Math.min(dirty.y, dirty.y * k);
      const x2 = Math.max(dirty.x + dirty.width, (dirty.x + dirty.width) * k);
      const y2 = Math.max(dirty.y + dirty.height, (dirty.y + dirty.height) * k);
      const x = Math.max(0, Math.floor(x1) - 2);
      const y = Math.max(0, Math.floor(y1) - 2);
      rect = { x, y, width: Math.min(W, Math.ceil(x2) + 2) - x, height: Math.min(H, Math.ceil(y2) + 2) - y };
    }
    if (rect.width <= 0 || rect.height <= 0) return;
    needFull = false;
    const part = rect.width === W && rect.height === H ? image : image.crop(rect);
    send('overlay-frame', { ...rect, fullWidth: W, fullHeight: H, png: part.toPNG() });
  });
  overlayWin.requestFullFrame = () => {
    needFull = true;
    overlayWin.webContents.invalidate();
  };
  overlayWin.loadURL(`${base}/overlay?app`);
}

async function createWindows() {
  const port = await start(3000);
  const base = `http://localhost:${port}`;

  // Allow the webcam and microphone for our own pages only
  const isOurs = (url) => url && url.startsWith(base);
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
    cb(permission === 'media' && isOurs(wc.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) =>
    permission === 'media' && (!wc || isOurs(wc.getURL())));

  mainWin = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: 'Live Studio',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  // Show the version in the title bar so it's easy to tell which copy is running
  mainWin.setTitle(`Live Studio ${app.getVersion()}`);
  mainWin.on('page-title-updated', (e) => e.preventDefault());
  // Never show screens saved from an older version
  session.defaultSession.clearCache().finally(() => mainWin && mainWin.loadURL(`${base}/control`));

  // Open outside links (YouTube Studio, nodejs.org…) in the normal browser
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Ask before closing while live
  mainWin.on('close', (e) => {
    if (streamer && streamer.proc) {
      const { dialog } = require('electron');
      const choice = dialog.showMessageBoxSync(mainWin, {
        type: 'warning',
        buttons: ['End stream and quit', 'Cancel'],
        defaultId: 1,
        message: 'You are still live. End the stream and quit?',
      });
      if (choice === 1) e.preventDefault();
      else streamer.stop();
    }
  });
  mainWin.on('closed', () => {
    mainWin = null;
    if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy();
  });

  createOverlayRenderer(base);
  // Re-send the latest overlay frame once the control panel has loaded
  mainWin.webContents.on('did-finish-load', () => overlayWin && overlayWin.requestFullFrame());

  streamer = new Streamer((status) => send('stream-status', status));
}

ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_e, settings) => {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
});
ipcMain.handle('encoders', () => detectEncoders());
ipcMain.handle('stream:start', (_e, opts) => streamer.start(opts));
ipcMain.handle('stream:stop', () => streamer.stop());
ipcMain.on('stream:chunk', (_e, chunk) => streamer.write(chunk));
ipcMain.on('overlay:refresh', () => overlayWin && overlayWin.requestFullFrame());

app.whenReady().then(createWindows);
app.on('window-all-closed', () => {
  if (streamer) streamer.stop();
  app.quit();
});
