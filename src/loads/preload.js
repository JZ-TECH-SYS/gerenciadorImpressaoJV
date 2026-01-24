const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  send: (channel, data) => ipcRenderer.send(channel, data),
  on: (channel, func) => ipcRenderer.on(channel, (_event, ...args) => func(...args)),
  getStore: (key) => ipcRenderer.invoke('settings:get', key),
  getPrinters: () => ipcRenderer.invoke('printers:list'),
  checkDirectoryHasFiles: (dirPath) => ipcRenderer.invoke('myzap:checkDirectoryHasFiles', dirPath)
});
