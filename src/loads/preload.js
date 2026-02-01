const { contextBridge, ipcRenderer } = require('electron');
const iniciarMyZap = require('../../core/myzap/iniciarMyZap');

contextBridge.exposeInMainWorld('api', {
  send: (channel, data) => ipcRenderer.send(channel, data),
  on: (channel, func) => ipcRenderer.on(channel, (_event, ...args) => func(...args)),
  getStore: (key) => ipcRenderer.invoke('settings:get', key),
  getPrinters: () => ipcRenderer.invoke('printers:list'),
  checkDirectoryHasFiles: (dirPath) => ipcRenderer.invoke('myzap:checkDirectoryHasFiles', dirPath),
  cloneRepository: (dirPath, envContent, reinstall = false) => ipcRenderer.invoke('myzap:cloneRepository', dirPath, envContent, reinstall),
  iniciarMyZap: (dirPath) => ipcRenderer.invoke('myzap:iniciarMyZap', dirPath),
  getConnectionStatus: () => ipcRenderer.invoke('myzap:getConnectionStatus'),
  startSession: () => ipcRenderer.invoke('myzap:startSession'),
  deleteSession: () => ipcRenderer.invoke('myzap:deleteSession')
});