// JARVIS HUD companion — frameless, transparent, always-on-top shell.
// Loads the deck in HUD-only mode (?companion=1&mode=hud) and toggles
// visibility with the Alt+Space global shortcut.
//
// Run: npm run hud   (first run needs: npm install)
const { app, BrowserWindow, globalShortcut } = require('electron')

const DECK_URL = process.env.JARVIS_DECK_URL || 'http://localhost:4527/?companion=1&mode=hud'
const HOTKEY = process.env.JARVIS_HUD_HOTKEY || 'Alt+Space'

let win = null

function create() {
  win = new BrowserWindow({
    width: 600,
    height: 220,
    x: undefined, // let the OS place it; user can drag the frameless window
    y: undefined,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // drag the frameless window by its background
  win.loadURL(DECK_URL)
  win.on('closed', () => { win = null })
}

function toggle() {
  if (!win) return create()
  if (win.isVisible() && !win.isMinimized()) win.hide()
  else win.show()
}

app.whenReady().then(() => {
  create()
  const ok = globalShortcut.register(HOTKEY, toggle)
  if (!ok) console.error('global shortcut unavailable:', HOTKEY)
  app.on('second-instance', toggle)
  app.on('activate', () => { if (!win) create() })
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())

// single instance — a second launch toggles the first
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
