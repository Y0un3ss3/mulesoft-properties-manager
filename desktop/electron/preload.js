const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,   // 'win32' | 'darwin' | 'linux'
  pickFiles: (options) => ipcRenderer.invoke('pick-files', options),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  onThemeChanged: (theme) => ipcRenderer.send('theme-changed', theme),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
})
