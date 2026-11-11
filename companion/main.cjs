// JARVIS HUD companion — frameless, transparent, always-on-top shell.
// Loads the deck in HUD-only mode (?companion=1&mode=hud) and toggles
// visibility with the Alt+Space global shortcut.
//
// Run: npm run hud   (first run needs: npm install)
const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron')
const path = require('path')

const DECK_URL = process.env.JARVIS_DECK_URL || 'http://localhost:4527/?companion=1&mode=hud'
const HOTKEY = process.env.JARVIS_HUD_HOTKEY || 'Alt+Space'

let win = null

function create() {
  win = new BrowserWindow({
    width: 600,
    height: 320,
    x: undefined, // let the OS place it; user can drag the frameless window
    y: undefined,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
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

// Manual window drag: -webkit-app-region is unreliable in transparent
// frameless windows on Windows, so the renderer signals drag start/end and
// the main process moves the window to follow the cursor.
let dragTimer = null
let dragOffset = { x: 0, y: 0 }
function stopDrag() {
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null }
}
function startDrag() {
  if (!win || win.isDestroyed() || dragTimer) return
  const b = win.getBounds()
  const c = screen.getCursorScreenPoint()
  dragOffset = { x: c.x - b.x, y: c.y - b.y }
  dragTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return stopDrag()
    const p = screen.getCursorScreenPoint()
    win.setPosition(p.x - dragOffset.x, p.y - dragOffset.y)
  }, 16)
}

app.whenReady().then(() => {
  ipcMain.on('hud:hide', () => { if (win && win.isVisible()) win.hide() })
  ipcMain.on('hud:drag-start', startDrag)
  ipcMain.on('hud:drag-end', stopDrag)
  // Auto-fit: the renderer reports the HUD panel's height so the window hugs
  // the content instead of leaving dead transparent space below it.
  ipcMain.on('hud:resize', (e, h) => {
    if (!win || win.isDestroyed()) return
    const n = Math.round(Number(h))
    if (!isFinite(n) || n < 60 || n > 900) return
    const b = win.getBounds()
    if (b.height !== n) win.setBounds({ x: b.x, y: b.y, width: b.width, height: n })
  })
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
