// Gives the control panel a small, safe API for the desktop features.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:set', s),
  encoders: () => ipcRenderer.invoke('encoders'),
  startStream: (opts) => ipcRenderer.invoke('stream:start', opts),
  stopStream: () => ipcRenderer.invoke('stream:stop'),
  sendChunk: (buf) => ipcRenderer.send('stream:chunk', buf),
  refreshOverlay: () => ipcRenderer.send('overlay:refresh'),
  onStatus: (cb) => ipcRenderer.on('stream-status', (_e, s) => cb(s)),
  onOverlayFrame: (cb) => ipcRenderer.on('overlay-frame', (_e, png) => cb(png)),
});
