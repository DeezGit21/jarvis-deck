// HUD companion preload: exposes a minimal, safe bridge to the renderer so the
// HUD can hide the window (✕) and drag it (manual IPC drag — app-region is
// unreliable in transparent frameless windows on Windows). Alt+Space restores.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hudCompanion', {
  hide: () => ipcRenderer.send('hud:hide'),
  startDrag: () => ipcRenderer.send('hud:drag-start'),
  stopDrag: () => ipcRenderer.send('hud:drag-end'),
  resize: h => ipcRenderer.send('hud:resize', h)
})
