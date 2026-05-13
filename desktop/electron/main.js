const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
const isMac = process.platform === 'darwin'

// Required for Windows taskbar icon
app.setAppUserModelId('com.mulesoft.properties-manager')

// Resolve icon path: dev uses public/, packaged uses extraResources/
function getIconPath() {
  if (isMac) return undefined  // macOS uses the .icns from the app bundle
  if (isDev) return path.join(__dirname, '..', 'public', 'icon.ico')
  return path.join(process.resourcesPath, 'icon.ico')
}

function createWindow() {
  const iconPath = getIconPath()

  const winOptions = {
    width: 1100,
    height: 820,
    minWidth: 720,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hidden',
    show: false,
  }

  if (iconPath) winOptions.icon = iconPath

  // Windows: native overlay for close/min/max buttons on the right
  if (!isMac) {
    winOptions.titleBarOverlay = {
      color: '#f6f8fa',
      symbolColor: '#1f2328',
      height: 56,
    }
  }

  // macOS: traffic lights sit on the left — reserve space via trafficLightPosition
  if (isMac) {
    winOptions.trafficLightPosition = { x: 16, y: 20 }
  }

  const win = new BrowserWindow(winOptions)

  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  win.once('ready-to-show', () => win.show())

  // Update title bar overlay when theme changes
  ipcMain.on('theme-changed', (_, theme) => {
    if (win.setTitleBarOverlay) {
      win.setTitleBarOverlay({
        color: theme === 'dark' ? '#151b23' : '#f6f8fa',
        symbolColor: theme === 'dark' ? '#f0f6fc' : '#1f2328',
        height: 56,
      })
    }
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ── IPC: open file picker ──────────────────────────────────────────────────
ipcMain.handle('pick-files', async (_, options) => {
  const result = await dialog.showOpenDialog({
    title: options?.title || 'Select files',
    filters: [
      { name: 'Property files', extensions: ['properties', 'yaml', 'yml', 'txt'] },
      { name: 'All files', extensions: ['*'] },
    ],
    properties: ['openFile', 'multiSelections'],
  })
  if (result.canceled) return []
  return result.filePaths.map((fp) => ({
    path: fp,
    name: path.basename(fp),
    content: fs.readFileSync(fp, 'utf8'),
  }))
})

// ── IPC: open folder picker ────────────────────────────────────────────────
ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select folder',
    properties: ['openDirectory'],
  })
  if (result.canceled || !result.filePaths.length) return []
  const folder = result.filePaths[0]
  const exts = /\.(properties|ya?ml|txt)$/i
  const files = []
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (exts.test(entry.name)) {
        files.push({ path: full, name: entry.name, content: fs.readFileSync(full, 'utf8') })
      }
    }
  }
  walk(folder)
  return files
})

// ── IPC: open external URL in OS browser ──────────────────────────────────
ipcMain.handle('open-external', (_, url) => {
  const allowed = /^https?:\/\//i
  if (allowed.test(url)) shell.openExternal(url)
})


ipcMain.handle('save-file', async (_, { defaultName, content }) => {
  const result = await dialog.showSaveDialog({
    title: 'Save file',
    defaultPath: defaultName,
    filters: [
      { name: 'Property files', extensions: ['properties', 'yaml', 'yml', 'txt'] },
      { name: 'All files', extensions: ['*'] },
    ],
  })
  if (result.canceled || !result.filePath) return false
  fs.writeFileSync(result.filePath, content, 'utf8')
  return true
})
