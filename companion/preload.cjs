// HUD companion preload: exposes a minimal, safe bridge to the renderer so the
// ✕ button in the HUD can hide the frameless window (Alt+Space brings it back).
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('hudCompanion', {
  hide: () => ipcRenderer.send('hud:hide')
})
